import pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';

// The terminal hands a room's occupants a real shell on this host. It is opt-in
// and confined to a per-room scratch directory; see docs/04-security-model.md.
export const TERMINAL_ENABLED = process.env.ENABLE_TERMINAL === 'true';

// Root under which each room gets its own working directory. Never the server
// user's $HOME — that would expose the whole machine to anyone with a room URL.
const WORKSPACE_ROOT = path.resolve(
    process.env.TERMINAL_WORKSPACE_ROOT || path.join(os.tmpdir(), 'dobby-workspaces')
);

// Only these variables reach the child shell. `process.env` carries the
// server's own configuration (API keys, DB paths) and must not be inherited.
const ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM'];

function buildChildEnv() {
    const env = { TERM: 'xterm-color' };
    for (const key of ENV_ALLOWLIST) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

/**
 * Resolve (and create) the sandbox directory for a session, guaranteeing the
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

class TerminalManager {
    constructor() {
        this.terminals = new Map(); // sessionKey -> ptyProcess
    }

    /**
     * Create a new PTY session for a socket
     */
    createTerminal(sessionKey) {
        if (!TERMINAL_ENABLED) {
            throw new Error('Terminal is disabled. Set ENABLE_TERMINAL=true to enable it.');
        }

        // Determine shell based on platform
        let shell;
        if (os.platform() === 'win32') {
            shell = 'powershell.exe';
        } else {
            // Always use bash for macOS to avoid zsh issues
            shell = '/bin/bash';
        }

        const cwd = resolveWorkspace(sessionKey);

        console.log(`Creating terminal for session ${sessionKey}`);
        console.log(`  Shell: ${shell}`);
        console.log(`  CWD: ${cwd}`);
        console.log(`  Platform: ${os.platform()}`);

        try {
            // Spawn PTY process
            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd,
                env: buildChildEnv(),
            });

            // Store the PTY process
            this.terminals.set(sessionKey, ptyProcess);

            console.log(`✓ Terminal created successfully with PID ${ptyProcess.pid}`);

            return ptyProcess;
        } catch (error) {
            console.error(`✗ Failed to create terminal:`, error);
            throw error;
        }
    }

    /** Write data to a terminal
     */
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
                console.log(`Resized terminal ${sessionKey} to ${cols}x${rows}`);
                return true;
            } catch (error) {
                console.error(`Error resizing terminal ${sessionKey}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Destroy a terminal session
     */
    destroyTerminal(sessionKey) {
        const terminal = this.terminals.get(sessionKey);
        if (terminal) {
            try {
                terminal.kill();
                this.terminals.delete(sessionKey);
                console.log(`Destroyed terminal for session ${sessionKey}`);
                return true;
            } catch (error) {
                console.error(`Error destroying terminal ${sessionKey}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Get a terminal instance
     */
    getTerminal(sessionKey) {
        return this.terminals.get(sessionKey);
    }

    /**
     * Clean up all terminals
     */
    destroyAll() {
        console.log(`Cleaning up ${this.terminals.size} terminals`);
        for (const [sessionKey, terminal] of this.terminals.entries()) {
            try {
                terminal.kill();
            } catch (error) {
                console.error(`Error killing terminal ${sessionKey}:`, error);
            }
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

process.on('SIGINT', () => {
    terminalManager.destroyAll();
    process.exit();
});

export default terminalManager;
