/**
 * services/clientId.js
 * A stable per-browser id, used only as a load-balancing key.
 *
 * A Socket.IO connection has to keep reaching the same replica: the HTTP
 * long-polling transport makes several requests that belong to one connection,
 * and a terminal session is a live PTY in one process that cannot be reattached
 * from another. The portable way to arrange that at the balancer is `ip_hash`,
 * and it is wrong wherever many users share an address — behind a CDN, a
 * corporate NAT, a mobile carrier — because it pins all of them to one replica
 * and unpins any of them the moment their address changes.
 *
 * So the client names itself instead. The id is appended to the handshake as
 * `?client=<id>` and `deploy/nginx.conf` hashes on it, falling back to the
 * address when it is absent.
 *
 * **It is not an identity and grants nothing.** Authentication is the JWT in
 * the handshake, checked by the server on every connection; this value is never
 * read by application code. A client that forges or reuses someone else's id
 * changes which replica it lands on and nothing else — the worst outcome is a
 * refused document lease and a reconnect. It is therefore deliberately not
 * derived from the user: sharing one across that user's tabs is exactly the
 * behaviour wanted, and it survives sign-out because the replica it selects is
 * not a session.
 */

const STORAGE_KEY = 'dobby.clientId';

const random = () =>
    // randomUUID needs a secure context; a plain http:// origin is a legitimate
    // way to run this in development, and any value that is stable and unlikely
    // to collide does this job.
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let cached = null;

/**
 * The id for this browser, created on first use.
 *
 * Falls back to a per-tab value when storage is unavailable (private mode,
 * blocked cookies). That is a graceful degradation rather than a failure: the
 * connection is still pinned for its lifetime, which is what affinity needs;
 * only the pinning across reloads is lost.
 */
export function getClientId() {
    if (cached) return cached;

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
            cached = stored;
            return cached;
        }
        cached = random();
        window.localStorage.setItem(STORAGE_KEY, cached);
    } catch {
        cached = random();
    }

    return cached;
}
