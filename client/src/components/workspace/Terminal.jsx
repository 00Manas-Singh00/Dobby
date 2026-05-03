import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSocket } from '@/contexts/SocketContext';
import { useParams } from 'react-router-dom';

const TerminalComponent = () => {
    const { editorState, updateTerminalHeight, toggleTerminal } = useWorkspace();
    const { terminalHeight, terminalCollapsed } = editorState;
    const [isResizing, setIsResizing] = useState(false);
    const socket = useSocket();
    const { roomId } = useParams();

    const terminalRef = useRef(null);
    const containerRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);

    // Initialize xterm.js
    useEffect(() => {
        if (!terminalRef.current || terminalCollapsed) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
            theme: {
                background: '#0a0e14',
                foreground: '#b3b1ad',
                cursor: '#00ff00',
                cursorAccent: '#000000',
                selection: '#4f5b66',
                black: '#000000',
                red: '#ff3333',
                green: '#b8cc52',
                yellow: '#e7c547',
                blue: '#36a3d9',
                magenta: '#f07178',
                cyan: '#95e6cb',
                white: '#ffffff',
                brightBlack: '#676e7a',
                brightRed: '#ff6565',
                brightGreen: '#dfed93',
                brightYellow: '#fff68f',
                brightBlue: '#68d5ff',
                brightMagenta: '#ffb7b7',
                brightCyan: '#c7fffd',
                brightWhite: '#ffffff',
            },
            scrollback: 1000,
            rows: 20,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        // Focus terminal for immediate interaction
        setTimeout(() => {
            term.focus();
        }, 100);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Request terminal creation from backend
        if (socket) {
            socket.emit('terminal:create', { roomId });
        }

        // Handle terminal input
        term.onData((data) => {
            if (socket) {
                socket.emit('terminal:input', { data });
            }
        });

        // Cleanup
        return () => {
            term.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
    }, [terminalCollapsed, socket, roomId]);

    // Handle socket events
    useEffect(() => {
        if (!socket || !xtermRef.current) return;

        const handleOutput = ({ data }) => {
            if (xtermRef.current) {
                xtermRef.current.write(data);
            }
        };

        const handleReady = ({ message }) => {
            if (xtermRef.current) {
                xtermRef.current.writeln('\x1b[1;32mTerminal ready. Type your commands here.\x1b[0m');
            }
        };

        const handleExit = ({ exitCode }) => {
            if (xtermRef.current) {
                xtermRef.current.writeln(`\r\n\x1b[1;31mTerminal exited with code ${exitCode}\x1b[0m`);
            }
        };

        socket.on('terminal:output', handleOutput);
        socket.on('terminal:ready', handleReady);
        socket.on('terminal:exit', handleExit);

        return () => {
            socket.off('terminal:output', handleOutput);
            socket.off('terminal:ready', handleReady);
            socket.off('terminal:exit', handleExit);
        };
    }, [socket]);

    // Handle resize events
    useEffect(() => {
        if (!xtermRef.current || !fitAddonRef.current || terminalCollapsed) return;

        const handleResize = () => {
            if (fitAddonRef.current && xtermRef.current) {
                try {
                    fitAddonRef.current.fit();
                    const { cols, rows } = xtermRef.current;
                    if (socket) {
                        socket.emit('terminal:resize', { cols, rows });
                    }
                } catch (error) {
                    console.error('Error resizing terminal:', error);
                }
            }
        };

        // Fit on mount and height changes
        const timeoutId = setTimeout(handleResize, 100);

        // Fit on window resize
        window.addEventListener('resize', handleResize);

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', handleResize);
        };
    }, [terminalHeight, terminalCollapsed, socket]);

    // Handle manual resize
    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing || !containerRef.current) return;

            const containerRect = containerRef.current.parentElement.getBoundingClientRect();
            // Calculate height from bottom of viewport to mouse position
            const newHeight = containerRect.bottom - e.clientY;

            // Enforce min/max constraints
            const constrainedHeight = Math.max(100, Math.min(newHeight, 600));

            updateTerminalHeight(constrainedHeight);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            // Re-fit terminal after resize
            if (fitAddonRef.current && xtermRef.current) {
                setTimeout(() => {
                    try {
                        fitAddonRef.current.fit();
                        const { cols, rows } = xtermRef.current;
                        if (socket) {
                            socket.emit('terminal:resize', { cols, rows });
                        }
                    } catch (error) {
                        console.error('Error fitting terminal after resize:', error);
                    }
                }, 100);
            }
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, updateTerminalHeight, socket]);

    if (terminalCollapsed) {
        return (
            <div
                className="h-10 bg-slate-900 border-t border-slate-800 flex items-center px-4 justify-between cursor-pointer hover:bg-slate-850"
                onClick={toggleTerminal}
            >
                <div className="flex items-center gap-2">
                    <TerminalIcon size={16} className="text-slate-400" />
                    <span className="text-sm text-slate-400">Terminal</span>
                </div>
                <ChevronUp size={16} className="text-slate-400" />
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="bg-slate-950 border-t border-slate-800 flex flex-col select-none relative z-10"
            style={{ height: `${terminalHeight}px`, minHeight: '100px' }}
        >
            {/* Resize Handle */}
            <div
                className={cn(
                    "h-1 cursor-ns-resize hover:bg-blue-500/50 transition-colors group relative",
                    isResizing && "bg-blue-500"
                )}
                onMouseDown={handleMouseDown}
            >
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-12 h-1 bg-slate-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Header */}
            <div className="h-10 flex items-center justify-between px-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                    <TerminalIcon size={16} className="text-green-400" />
                    <span className="text-sm text-slate-300 font-medium">Terminal</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        className="p-1 hover:bg-slate-800 rounded transition-colors"
                        onClick={toggleTerminal}
                        title="Minimize terminal"
                    >
                        <ChevronDown size={16} className="text-slate-400" />
                    </button>
                </div>
            </div>

            {/* Terminal Content */}
            <div
                ref={terminalRef}
                className="flex-1 p-2 overflow-hidden cursor-text"
                onClick={() => {
                    // Focus terminal on click
                    if (xtermRef.current) {
                        xtermRef.current.focus();
                    }
                }}
            />
        </div>
    );
};

export default TerminalComponent;
