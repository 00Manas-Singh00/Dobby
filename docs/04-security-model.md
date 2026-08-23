# 04 — Security Model

**Project:** Dobby
**Status:** Honest assessment. Dobby has no authentication; read §1 before deploying anything.

---

## 1. The headline

**Dobby has no authentication and no authorization.** A room is reachable by
anyone who has its URL, and every capability in the room — editing, chat, the
whiteboard, the video call, and the terminal — is available to whoever is in it.

Room ids are v4 UUIDs, so they aren't guessable by brute force. That is
security-by-obscurity: it survives a scanner and does not survive a URL pasted
into a Slack channel, a bug report, or a browser history on a shared machine.

The practical consequence: **Dobby is safe to run on localhost or a trusted
network. It is not safe to expose to the public internet as-is.** The controls
below reduce the blast radius of that fact; they do not remove it.

## 2. The terminal

The terminal is the sharpest edge in the product. It spawns a real shell process
on the server host, and any code typed into it runs with the privileges of the
server process. On an unauthenticated system that is, in the worst case, remote
code execution granted to anyone with a link.

Four controls apply:

**Disabled by default.** `ENABLE_TERMINAL` must be explicitly set to `true`.
Both `terminalManager.createTerminal` and the `terminal:create` socket handler
check it, so the feature cannot be reached by accident or by a stale client.

**Room membership required.** `terminal:create` rejects any socket that is not
already a member of the room it names (`socket.rooms.has(roomId)`). Previously
the handler trusted the `roomId` in the payload and would create a session for
any connected socket.

**Session identity comes from the server.** The session key is
`roomId:username` where the username is read from the server's own record for
that socket, not from the client's message. A client that supplied its own
username could otherwise attach to another user's shell by naming it.

**Confined environment.** Sessions run with:
- `cwd` set to a per-session directory under `TERMINAL_WORKSPACE_ROOT`
  (default `<tmpdir>/dobby-workspaces`), path-checked so a crafted session key
  cannot escape the root — **never** the server user's `$HOME`, which was the
  previous behavior;
- an environment built from an allowlist (`PATH`, `LANG`, `LC_ALL`, `TZ`,
  `TERM`) rather than an inherited `process.env`, which carries the server's own
  configuration and any credentials in it.

**What these controls do not do:** they do not sandbox the process. A shell in a
scratch directory can still read whatever the server user can read, open network
connections, and consume CPU and disk. There is no container, no seccomp
profile, no resource limit, and no allowlist of commands. Real isolation needs
per-room containers — see [06 Roadmap](./06-roadmap.md).

## 3. Code execution

Unlike the terminal, `POST /api/execute` is genuinely sandboxed, because it does
not execute anything locally. The server proxies to the public **Piston** API,
which runs the code in its own isolated environment with compile and run
timeouts of 10 seconds each. Requests are capped at 100,000 characters.

The trade-offs are that user code leaves our infrastructure — do not paste
secrets into the editor and press Run — and that availability depends on a
third-party service. The endpoint is also **unauthenticated and unrate-limited**,
so it can be used as an open proxy to Piston. That is the main gap here.

## 4. CORS

`ALLOWED_ORIGINS` is a comma-separated allowlist of exact origins, defaulting to
`http://localhost:5173`, and applies to both Express and Socket.IO. A
disallowed origin is denied by withholding the CORS headers rather than by
throwing, so the browser blocks the request cleanly instead of the server
returning a 500 with a stack trace.

This replaces `origin: '*'`, which permitted any page on the internet to open a
Socket.IO connection and join rooms.

Note what CORS does and does not buy: it constrains **browsers**. It does not
stop a script, a curl invocation, or anything else that simply omits the
`Origin` header. It is a defense against a malicious web page acting through a
victim's browser, not an access control.

## 5. Input handling

| Surface | Handling |
|---|---|
| `POST /api/execute` | Type and presence checks on `language`; 100k-char cap on `code` |
| REST bodies | Capped at 500kb by `express.json` |
| `terminal:create` | Membership checked; session key derives from server state; key sanitized for filesystem use |
| Chat messages | **Unvalidated** — no length cap on a single message, no content checks |
| Whiteboard strokes | **Unvalidated** — payload relayed verbatim |
| WebRTC signals | **Unvalidated** — relayed verbatim to the named socket id |
| Yjs updates | Handled by `y-socket.io`; no application-level validation |

Chat and whiteboard payloads are the notable soft spots. Both are relayed to the
peer without inspection, and neither has a size limit beyond the socket's own.

Rendering is safer than it looks: chat messages render as React text nodes, not
`dangerouslySetInnerHTML`, so stored XSS via chat is not currently possible. That
is a property of the current components, not an enforced invariant.

## 6. Data at rest

Yjs documents persist to LevelDB at `server/.yjs-persistence` — **unencrypted,
and never expired**. Anything typed into a room's editor stays on disk
indefinitely. There is no delete path and no retention policy. Chat, whiteboard
content, and terminal scrollback are memory-only and vanish 30 minutes after a
room empties.

The persistence directory is now gitignored; it had previously been committed,
which meant document content from local sessions was in version control.

## 7. Deployment checklist

Before Dobby is reachable from anywhere untrusted:

- [ ] **Add authentication.** Nothing below substitutes for this.
- [ ] Set `ALLOWED_ORIGINS` to your real front-end origin. Do not leave the default.
- [ ] Leave `ENABLE_TERMINAL=false` unless the host is disposable or containerized.
- [ ] If the terminal is enabled, run the server as an unprivileged user with no
      access to anything you would mind a stranger reading.
- [ ] Set `TERMINAL_WORKSPACE_ROOT` to a dedicated volume you are willing to lose.
- [ ] Put a rate limiter in front of `/api/execute`.
- [ ] Terminate TLS in front of the app; WebRTC requires a secure context anyway.
- [ ] Confirm `server/.env` and `client/.env` are untracked (they now are; they
      were previously committed, though they contained no secrets).

## 8. Threat model summary

| Threat | Status |
|---|---|
| Stranger guesses a room URL | Mitigated by UUIDs; not prevented |
| Stranger with a leaked room URL joins | **Not mitigated** — no auth |
| Malicious page opens a socket via a victim's browser | Mitigated by the CORS allowlist |
| Client hijacks another user's terminal session | Mitigated — server-derived session identity |
| Terminal user reads server secrets from the environment | Mitigated — env allowlist |
| Terminal user reads the server user's home directory | Mitigated — scoped `cwd` |
| Terminal user escapes to the wider filesystem | **Not mitigated** — no sandbox |
| Untrusted code execution via Run | Mitigated — Piston runs it, not us |
| `/api/execute` abused as an open proxy | **Not mitigated** — no auth, no rate limit |
| Denial of service by resource exhaustion | **Not mitigated** — no quotas anywhere |
