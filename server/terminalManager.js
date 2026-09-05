import pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// The terminal hands a room's occupants a real shell. It is opt-in, and by
// default that shell runs inside a per-session container with CPU, memory,
// process, and network limits; see docs/04-security-model.md.
export const TERMINAL_ENABLED = process.env.ENABLE_TERMINAL === 'true';

/**
 * Isolation mode.
 *  - 'docker' (default): the shell runs in a throwaway container. The PTY is a
 *    `docker run -it` process, so node-pty still owns a real TTY and vim,
 *    colors, and interactive prompts keep working.
 *  - 'host': the shell runs directly on the server host, confined only to a
 *    scratch directory with a scrubbed environment. This is the pre-Phase-1
 *    behaviour and is NOT a sandbox — a shell can still read whatever the
 *    server user can read. Only for local development on a machine you own.
 */
export const TERMINAL_ISOLATION = process.env.TERMINAL_ISOLATION === 'host' ? 'host' : 'docker';

const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const CONTAINER_IMAGE = process.env.TERMINAL_IMAGE || 'alpine:3.20';

// Resource ceilings. Every one of these is a denial-of-service control: without
// them a single `while true` or fork bomb takes down the host for everyone.
const LIMITS = {
    cpus: process.env.TERMINAL_CPU_LIMIT || '0.5',
    memory: process.env.TERMINAL_MEMORY_LIMIT || '256m',
    pids: process.env.TERMINAL_PIDS_LIMIT || '128',
    // Writable layer size. Only enforced on storage drivers that support it
    // (overlay2 with pquota); harmless elsewhere, so it is opt-in.
    storage: process.env.TERMINAL_STORAGE_LIMIT || '',
    // Containers get no network by default: a shell that cannot dial out cannot
    // be used to scan the internal network or exfiltrate what it reads.
    network: process.env.TERMINAL_NETWORK || 'none',
};

// Root under which each session gets its own working directory. Never the
// server user's $HOME. In docker mode this is bind-mounted into the container
// as /workspace; in host mode it is the shell's cwd.
const WORKSPACE_ROOT = path.resolve(
    process.env.TERMINAL_WORKSPACE_ROOT || path.join(os.tmpdir(), 'dobby-workspaces')
);

// Only these variables reach a host-mode child shell. `process.env` carries the
// server's own configuration (JWT secret, DB paths) and must not be inherited.
const ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM'];

function buildChildEnv() {
    const env = { TERM: 'xterm-color' };
    for (const key of ENV_ALLOWLIST) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

/** Container and volume names must be a safe, stable function of the session. */
function containerName(sessionKey) {
    return `dobby-term-${sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_')}`.slice(0, 60);
}

/**
 * Resolve (and create) the workspace directory for a session, guaranteeing the
 * result stays inside WORKSPACE_ROOT even if the session key is hostile.
 */
function resolveWorkspace(sessionKey) {
    const slug = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.resolve(WORKSPACE_ROOT, slug);
    if (dir !== WORKSPACE_ROOT && !dir.startsWith(WORKSPACE_ROOT + path.sep)) {
        throw new Error(`Refusing to create terminal outside workspace root: ${sessionKey}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Is a working Docker daemon reachable? Cached — the answer rarely changes. */
let dockerAvailable = null;
export function isDockerAvailable() {
    if (dockerAvailable !== null) return dockerAvailable;
    try {
        execFileSync(DOCKER_BIN, ['info'], { stdio: 'ignore', timeout: 10_000 });
        dockerAvailable = true;
    } catch {
        dockerAvailable = false;
    }
    return dockerAvailable;
}

/** Arguments for the sandboxed `docker run`. */
function dockerRunArgs(sessionKey, workspaceDir) {
    const args = [
        'run',
        '--rm',
        '-i',
        '-t',
        '--name', containerName(sessionKey),
        // Resource ceilings.
        '--cpus', LIMITS.cpus,
        `--memory=${LIMITS.memory}`,
        // Without a swap ceiling equal to memory, the container swaps instead of
        // being capped, and the memory limit stops meaning anything.
        `--memory-swap=${LIMITS.memory}`,
        `--pids-limit=${LIMITS.pids}`,
        `--network=${LIMITS.network}`,
        // Privilege reduction: no new privileges via setuid binaries, every
        // capability dropped, non-root user, read-only image layer.
        '--security-opt', 'no-new-privileges',
        '--cap-drop=ALL',
        '--user', '1000:1000',
        '--read-only',
        // The image is read-only, so give the shell writable space explicitly:
        // a small tmpfs for /tmp and the bind-mounted per-session workspace.
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
        '-v', `${workspaceDir}:/workspace:rw`,
        '-w', '/workspace',
        '-e', 'TERM=xterm-color',
        '-e', 'HOME=/workspace',
    ];

    if (LIMITS.storage) args.push('--storage-opt', `size=${LIMITS.storage}`);

    args.push(CONTAINER_IMAGE, '/bin/sh');
    return args;
}

class TerminalManager {
    constructor() {
        this.terminals = new Map(); // sessionKey -> ptyProcess
    }

    /**
     * Create a new PTY session, sandboxed according to TERMINAL_ISOLATION.
     */
    createTerminal(sessionKey) {
        if (!TERMINAL_ENABLED) {
            throw new Error('Terminal is disabled. Set ENABLE_TERMINAL=true to enable it.');
        }

        const cwd = resolveWorkspace(sessionKey);
        const useDocker = TERMINAL_ISOLATION === 'docker';

        // Failing closed matters here: silently falling back to a host shell
        // would turn a missing daemon into an unsandboxed shell for anyone in
        // the room, which is exactly the risk the container removes.
        if (useDocker && !isDockerAvailable()) {
            throw new Error(
                'Terminal requires Docker, which is not available on this host. ' +
                'Start Docker, or set TERMINAL_ISOLATION=host to run an unsandboxed shell ' +
                '(development only).'
            );
        }

        let file;
        let args;
        if (useDocker) {
            file = DOCKER_BIN;
            args = dockerRunArgs(sessionKey, cwd);
        } else {
            file = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
            args = [];
        }

        console.log(`[Terminal] Creating session ${sessionKey}`);
        console.log(`  Isolation: ${TERMINAL_ISOLATION}`);
        console.log(`  Workspace: ${cwd}`);
        if (useDocker) {
            console.log(`  Image: ${CONTAINER_IMAGE} (cpus=${LIMITS.cpus}, memory=${LIMITS.memory}, pids=${LIMITS.pids}, network=${LIMITS.network})`);
        }

        try {
            const ptyProcess = pty.spawn(file, args, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                // In docker mode the cwd only affects the `docker` client
                // itself; the shell's cwd is the container's /workspace.
                cwd,
                env: buildChildEnv(),
            });

            ptyProcess.dobbySession = { sessionKey, isolation: TERMINAL_ISOLATION };
            this.terminals.set(sessionKey, ptyProcess);

            console.log(`✓ Terminal created successfully with PID ${ptyProcess.pid}`);

            return ptyProcess;
        } catch (error) {
            console.error(`✗ Failed to create terminal:`, error);
            throw error;
        }
    }

    /** Write data to a terminal */
    writeToTerminal(sessionKey, data) {
        const terminal = this.terminals.get(sessionKey);
        if (terminal) {
            terminal.write(data);
            return true;
        }
        return false;
    }

    /**
     * Resize a terminal
     */
    resizeTerminal(sessionKey, cols, rows) {
        const terminal = this.terminals.get(sessionKey);
        if (terminal) {
            try {
                terminal.resize(cols, rows);
                return true;
            } catch (error) {
                console.error(`Error resizing terminal ${sessionKey}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Destroy a terminal session.
     *
     * Killing the PTY kills the `docker run` client, and `--rm` reaps the
     * container — but only if the client exits cleanly. `docker rm -f` is the
     * backstop, because a container that outlives its session keeps holding its
     * CPU and memory reservation.
     */
    destroyTerminal(sessionKey) {
        const terminal = this.terminals.get(sessionKey);
        if (!terminal) return false;

        const isolation = terminal.dobbySession?.isolation ?? TERMINAL_ISOLATION;

        try {
            terminal.kill();
        } catch (error) {
            console.error(`Error killing terminal ${sessionKey}:`, error);
        }
        this.terminals.delete(sessionKey);

        if (isolation === 'docker') {
            this.forceRemoveContainer(sessionKey);
        }

        console.log(`Destroyed terminal for session ${sessionKey}`);
        return true;
    }

    forceRemoveContainer(sessionKey) {
        try {
            execFileSync(DOCKER_BIN, ['rm', '-f', containerName(sessionKey)], {
                stdio: 'ignore',
                timeout: 15_000,
            });
        } catch {
            // Already gone, which is the expected case when `--rm` did its job.
        }
    }

    /**
     * Get a terminal instance
     */
    getTerminal(sessionKey) {
        return this.terminals.get(sessionKey);
    }

    /**
     * Live PTYs on this process. Read on every metrics scrape rather than
     * tracked by a counter, so it cannot drift away from the truth on the paths
     * where a session dies without going through `destroyTerminal` — an exited
     * shell, a container OOM-killed under its memory cap.
     */
    sessionCount() {
        return this.terminals.size;
    }

    /**
     * Clean up all terminals
     */
    destroyAll() {
        console.log(`Cleaning up ${this.terminals.size} terminals`);
        for (const sessionKey of [...this.terminals.keys()]) {
            this.destroyTerminal(sessionKey);
        }
        this.terminals.clear();
    }
}

// Create singleton instance
const terminalManager = new TerminalManager();

// Cleanup on process exit
process.on('exit', () => {
    terminalManager.destroyAll();
});

/**
 * Containers must die with the process, so these handlers stay. What they no
 * longer do is call `process.exit()` unconditionally: a clustered server also
 * has to hand its document leases back on SIGTERM, and exiting from the first
 * listener to run would cut that short. Whoever else is listening owns the
 * exit; with nobody listening, this does, so a bare `node index.js` still stops
 * on Ctrl-C.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        terminalManager.destroyAll();
        if (process.listenerCount(signal) === 1) process.exit();
    });
}

export default terminalManager;
