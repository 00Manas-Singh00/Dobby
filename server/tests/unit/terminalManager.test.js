/**
 * Terminal session lifecycle and sandbox arguments.
 *
 * `node-pty` and `docker` are both stubbed. What is worth asserting here is
 * not that a shell runs — it is that the process is never spawned outside its
 * workspace, never spawned unsandboxed by accident, and always cleaned up. Each
 * of those is a security control from Phase 1 whose failure is silent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT = path.join(os.tmpdir(), `dobby-term-test-${process.pid}`);

// The module registers exit/SIGINT/SIGTERM handlers at import, and these tests
// import it many times to exercise different configurations. In production it
// is imported once; here the accumulation is an artifact of the test, so raise
// the ceiling rather than let Node warn about a leak that is not one.
process.setMaxListeners(0);

/** A stand-in for a node-pty process, recording what was written to it. */
function fakePty() {
    return {
        pid: 4242,
        written: [],
        killed: false,
        resizedTo: null,
        write(data) { this.written.push(data); },
        kill() { this.killed = true; },
        resize(cols, rows) { this.resizedTo = { cols, rows }; },
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        onExit: vi.fn(() => ({ dispose: vi.fn() })),
    };
}

const spawn = vi.fn(() => fakePty());
const execFileSync = vi.fn();

vi.mock('node-pty', () => ({ default: { spawn: (...args) => spawn(...args) } }));
vi.mock('child_process', () => ({ execFileSync: (...args) => execFileSync(...args) }));

/**
 * Load a fresh terminalManager under the given environment. The module reads
 * ENABLE_TERMINAL and TERMINAL_ISOLATION at import time, so each configuration
 * needs its own module instance.
 */
async function loadManager(env = {}) {
    vi.resetModules();
    Object.assign(process.env, {
        ENABLE_TERMINAL: 'true',
        TERMINAL_ISOLATION: 'docker',
        TERMINAL_WORKSPACE_ROOT: WORKSPACE_ROOT,
        ...env,
    });
    return import('../../terminalManager.js');
}

beforeEach(() => {
    spawn.mockClear();
    spawn.mockImplementation(() => fakePty());
    execFileSync.mockClear();
    execFileSync.mockImplementation(() => Buffer.from(''));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
    delete process.env.ENABLE_TERMINAL;
    delete process.env.TERMINAL_ISOLATION;
});

/** The `docker run` argv from the most recent spawn. */
const lastSpawnArgs = () => spawn.mock.calls.at(-1)[1];

describe('enablement', () => {
    it('refuses to create a terminal when disabled', async () => {
        const { default: manager } = await loadManager({ ENABLE_TERMINAL: 'false' });

        expect(() => manager.createTerminal('room:user')).toThrow(/disabled/i);
        expect(spawn).not.toHaveBeenCalled();
    });

    it('treats anything other than the literal "true" as disabled', async () => {
        const { TERMINAL_ENABLED } = await loadManager({ ENABLE_TERMINAL: '1' });
        expect(TERMINAL_ENABLED).toBe(false);
    });

    it('defaults isolation to docker for any unrecognized value', async () => {
        // Only the exact string 'host' opts out of the container; a typo must
        // not silently produce an unsandboxed shell.
        expect((await loadManager({ TERMINAL_ISOLATION: 'hosts' })).TERMINAL_ISOLATION).toBe('docker');
        expect((await loadManager({ TERMINAL_ISOLATION: '' })).TERMINAL_ISOLATION).toBe('docker');
        expect((await loadManager({ TERMINAL_ISOLATION: 'host' })).TERMINAL_ISOLATION).toBe('host');
    });
});

describe('docker mode', () => {
    it('fails closed when no Docker daemon is reachable', async () => {
        const { default: manager } = await loadManager();
        execFileSync.mockImplementation(() => {
            throw new Error('Cannot connect to the Docker daemon');
        });

        // The alternative — falling back to a host shell — would turn a missing
        // daemon into an unsandboxed shell for everyone in the room.
        expect(() => manager.createTerminal('room:user')).toThrow(/requires Docker/i);
        expect(spawn).not.toHaveBeenCalled();
    });

    it('spawns docker with every resource and privilege limit', async () => {
        const { default: manager } = await loadManager();
        manager.createTerminal('room1:user1');

        const args = lastSpawnArgs();
        const flag = (name) => args[args.indexOf(name) + 1];

        expect(spawn.mock.calls.at(-1)[0]).toBe('docker');
        expect(args[0]).toBe('run');
        expect(args).toContain('--rm');
        expect(flag('--cpus')).toBe('0.5');
        expect(args).toContain('--memory=256m');
        // Without a swap ceiling the container swaps instead of being capped,
        // and the memory limit stops meaning anything.
        expect(args).toContain('--memory-swap=256m');
        expect(args).toContain('--pids-limit=128');
        expect(args).toContain('--network=none');
        expect(args).toContain('--cap-drop=ALL');
        expect(args).toContain('--read-only');
        expect(flag('--security-opt')).toBe('no-new-privileges');
        expect(flag('--user')).toBe('1000:1000');
    });

    it('omits the storage cap unless one is configured', async () => {
        // `--storage-opt size=` is rejected outright on storage drivers that do
        // not support it, so it has to stay opt-in.
        const { default: plain } = await loadManager();
        plain.createTerminal('room1:user1');
        expect(lastSpawnArgs()).not.toContain('--storage-opt');

        const { default: capped } = await loadManager({ TERMINAL_STORAGE_LIMIT: '1g' });
        capped.createTerminal('room2:user2');
        expect(lastSpawnArgs()).toContain('size=1g');
    });

    it('bind-mounts only that session\'s workspace', async () => {
        const { default: manager } = await loadManager();
        manager.createTerminal('room1:user1');

        const mount = lastSpawnArgs().find((arg) => String(arg).endsWith(':/workspace:rw'));
        expect(mount).toBeDefined();
        expect(mount.startsWith(WORKSPACE_ROOT + path.sep)).toBe(true);
    });

    it('gives two sessions separate workspaces', async () => {
        const { default: manager } = await loadManager();
        manager.createTerminal('room1:user1');
        const first = lastSpawnArgs().find((a) => String(a).endsWith(':/workspace:rw'));
        manager.createTerminal('room1:user2');
        const second = lastSpawnArgs().find((a) => String(a).endsWith(':/workspace:rw'));

        expect(first).not.toBe(second);
    });
});

describe('workspace containment', () => {
    it('keeps a traversal-shaped session key inside the workspace root', async () => {
        const { default: manager } = await loadManager();

        // The session key is server-built today, but this is the control that
        // holds if that ever changes.
        manager.createTerminal('../../etc:passwd');

        const mount = lastSpawnArgs().find((a) => String(a).endsWith(':/workspace:rw'));
        const dir = mount.replace(':/workspace:rw', '');
        expect(path.resolve(dir).startsWith(WORKSPACE_ROOT + path.sep)).toBe(true);
        expect(fs.existsSync(dir)).toBe(true);
    });
});

describe('host mode', () => {
    it('spawns a shell directly and passes no docker arguments', async () => {
        const { default: manager } = await loadManager({ TERMINAL_ISOLATION: 'host' });
        manager.createTerminal('room1:user1');

        const [file, args, options] = spawn.mock.calls.at(-1);
        expect(file).not.toBe('docker');
        expect(args).toEqual([]);
        expect(options.cwd.startsWith(WORKSPACE_ROOT)).toBe(true);
    });

    it('does not leak the server\'s own configuration into the child shell', async () => {
        process.env.JWT_SECRET = 'a-real-signing-key-that-must-not-escape';
        const { default: manager } = await loadManager({ TERMINAL_ISOLATION: 'host' });
        manager.createTerminal('room1:user1');

        const { env } = spawn.mock.calls.at(-1)[2];
        expect(env).not.toHaveProperty('JWT_SECRET');
        expect(env).not.toHaveProperty('DATABASE_PATH');
        expect(env.TERM).toBe('xterm-color');
        // PATH is allowlisted — without it nothing in the shell resolves.
        expect(env).toHaveProperty('PATH');
    });
});

describe('session binding', () => {
    it('tracks a terminal by session key and returns the same instance', async () => {
        const { default: manager } = await loadManager();
        const created = manager.createTerminal('room1:user1');

        expect(manager.getTerminal('room1:user1')).toBe(created);
        expect(manager.getTerminal('room1:user2')).toBeUndefined();
    });

    it('routes input and resize to the right session', async () => {
        const { default: manager } = await loadManager();
        const first = manager.createTerminal('room1:user1');
        const second = manager.createTerminal('room1:user2');

        manager.writeToTerminal('room1:user1', 'ls\n');
        manager.resizeTerminal('room1:user2', 120, 40);

        expect(first.written).toEqual(['ls\n']);
        expect(second.written).toEqual([]);
        expect(second.resizedTo).toEqual({ cols: 120, rows: 40 });
        expect(first.resizedTo).toBeNull();
    });

    it('reports rather than throws for an unknown session', async () => {
        const { default: manager } = await loadManager();

        expect(manager.writeToTerminal('nope', 'x')).toBe(false);
        expect(manager.resizeTerminal('nope', 80, 24)).toBe(false);
        expect(manager.destroyTerminal('nope')).toBe(false);
    });
});

describe('destruction', () => {
    it('kills the pty, forgets the session, and force-removes the container', async () => {
        const { default: manager } = await loadManager();
        const pty = manager.createTerminal('room1:user1');
        execFileSync.mockClear();

        expect(manager.destroyTerminal('room1:user1')).toBe(true);
        expect(pty.killed).toBe(true);
        expect(manager.getTerminal('room1:user1')).toBeUndefined();

        // `--rm` normally reaps the container, but only if the client exited
        // cleanly; a container that outlives its session keeps its reservation.
        const removal = execFileSync.mock.calls.find((c) => c[1][0] === 'rm');
        expect(removal[1]).toEqual(['rm', '-f', expect.stringContaining('dobby-term-room1_user1')]);
    });

    it('does not reach for docker when the session ran on the host', async () => {
        const { default: manager } = await loadManager({ TERMINAL_ISOLATION: 'host' });
        manager.createTerminal('room1:user1');
        execFileSync.mockClear();

        manager.destroyTerminal('room1:user1');
        expect(execFileSync.mock.calls.some((c) => c[1][0] === 'rm')).toBe(false);
    });

    it('still forgets the session when killing the pty throws', async () => {
        const { default: manager } = await loadManager();
        const pty = manager.createTerminal('room1:user1');
        pty.kill = () => { throw new Error('already dead'); };

        // A session left in the map would never be cleaned up and would block
        // the user from getting a new shell.
        expect(() => manager.destroyTerminal('room1:user1')).not.toThrow();
        expect(manager.getTerminal('room1:user1')).toBeUndefined();
    });

    it('destroyAll clears every session', async () => {
        const { default: manager } = await loadManager();
        manager.createTerminal('room1:user1');
        manager.createTerminal('room2:user2');

        manager.destroyAll();

        expect(manager.getTerminal('room1:user1')).toBeUndefined();
        expect(manager.getTerminal('room2:user2')).toBeUndefined();
    });
});
