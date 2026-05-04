import pty from 'node-pty';
import os from 'os';

class TerminalManager {
    constructor() {
        this.terminals = new Map(); // socketId -> ptyProcess
    }

    /**
     * Create a new PTY session for a socket
     */
    createTerminal(socketId) {
        // Determine shell based on platform
        let shell;
        if (os.platform() === 'win32') {
            shell = 'powershell.exe';
        } else {
            // Always use bash for macOS to avoid zsh issues
            shell = '/bin/bash';
        }

        console.log(`Creating terminal for socket ${socketId}`);
        console.log(`  Shell: ${shell}`);
        console.log(`  CWD: ${process.env.HOME}`);
        console.log(`  Platform: ${os.platform()}`);

        try {
            // Spawn PTY process
            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: process.env.HOME || process.env.USERPROFILE || '/',
                env: process.env,
            });

            // Store the PTY process
            this.terminals.set(socketId, ptyProcess);

            console.log(`✓ Terminal created successfully with PID ${ptyProcess.pid}`);

            return ptyProcess;
        } catch (error) {
            console.error(`✗ Failed to create terminal:`, error);
            throw error;
        }
    }

    /** Write data to a terminal
     */
    writeToTerminal(socketId, data) {
        const terminal = this.terminals.get(socketId);
        if (terminal) {
            terminal.write(data);
            return true;
        }
        return false;
    }

    /**
     * Resize a terminal
     */
    resizeTerminal(socketId, cols, rows) {
        const terminal = this.terminals.get(socketId);
        if (terminal) {
            try {
                terminal.resize(cols, rows);
                console.log(`Resized terminal ${socketId} to ${cols}x${rows}`);
                return true;
            } catch (error) {
                console.error(`Error resizing terminal ${socketId}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Destroy a terminal session
     */
    destroyTerminal(socketId) {
        const terminal = this.terminals.get(socketId);
        if (terminal) {
            try {
                terminal.kill();
                this.terminals.delete(socketId);
                console.log(`Destroyed terminal for socket ${socketId}`);
                return true;
            } catch (error) {
                console.error(`Error destroying terminal ${socketId}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Get a terminal instance
     */
    getTerminal(socketId) {
        return this.terminals.get(socketId);
    }

    /**
     * Clean up all terminals
     */
    destroyAll() {
        console.log(`Cleaning up ${this.terminals.size} terminals`);
        for (const [socketId, terminal] of this.terminals.entries()) {
            try {
                terminal.kill();
            } catch (error) {
                console.error(`Error killing terminal ${socketId}:`, error);
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
