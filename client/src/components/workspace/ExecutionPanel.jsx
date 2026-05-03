/**
 * components/workspace/ExecutionPanel.jsx
 * Displays code execution results: stdout, stderr, exit code, timing, compile errors.
 * Rendered below the editor when execution completes or is in progress.
 */

import React, { useRef, useEffect } from 'react';
import {
    Play,
    X,
    CheckCircle,
    XCircle,
    Clock,
    Terminal,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * @param {object} props
 * @param {boolean}      props.isRunning  - Show loading state
 * @param {object|null}  props.result     - Execution result from server
 * @param {string|null}  props.error      - Client/network error
 * @param {function}     props.onClear    - Clear result callback
 * @param {string}       props.stdin      - Current stdin value
 * @param {function}     props.onStdinChange - Stdin change callback
 */
const ExecutionPanel = ({ isRunning, result, error, onClear, stdin, onStdinChange }) => {
    const outputRef = useRef(null);

    // Scroll output to bottom on new content
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [result]);

    const hasOutput = result || error || isRunning;
    if (!hasOutput) return null;

    const exitSuccess = result?.exitCode === 0;

    return (
        <div className="border-t border-slate-700 bg-slate-950 flex flex-col animate-in slide-in-from-bottom-2 duration-200">
            {/* Header */}
            <div className="h-9 flex items-center justify-between px-4 border-b border-slate-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Output
                    </span>
                    {result && (
                        <>
                            {/* Exit code badge */}
                            <span
                                className={cn(
                                    'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
                                    exitSuccess
                                        ? 'bg-green-500/15 text-green-400'
                                        : 'bg-red-500/15 text-red-400'
                                )}
                            >
                                {exitSuccess ? (
                                    <CheckCircle size={10} />
                                ) : (
                                    <XCircle size={10} />
                                )}
                                exit {result.exitCode}
                            </span>
                            {/* Timing */}
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                                <Clock size={10} />
                                {result.time}ms
                            </span>
                            {/* Runtime */}
                            <span className="text-xs text-slate-600">
                                {result.language} {result.version}
                            </span>
                        </>
                    )}
                </div>

                <button
                    onClick={onClear}
                    className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-slate-300"
                    title="Clear output"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Output area */}
            <div ref={outputRef} className="flex-1 overflow-y-auto max-h-56 p-3 space-y-2">
                {/* Running spinner */}
                {isRunning && (
                    <div className="flex items-center gap-2 text-blue-400">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-xs font-mono">Running...</span>
                    </div>
                )}

                {/* Client/network error */}
                {error && (
                    <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded p-2">
                        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                        <span className="text-xs font-mono">{error}</span>
                    </div>
                )}

                {result && (
                    <>
                        {/* Compile output (C, C++, Java, Rust) */}
                        {result.compileOutput && (
                            <div className="space-y-1">
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                                    Compiler
                                </p>
                                <pre className="text-xs font-mono text-yellow-300 bg-yellow-500/5 rounded p-2 whitespace-pre-wrap break-words">
                                    {result.compileOutput}
                                </pre>
                            </div>
                        )}

                        {/* Stdout */}
                        {result.stdout && (
                            <div className="space-y-1">
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                                    stdout
                                </p>
                                <pre className="text-xs font-mono text-green-300 whitespace-pre-wrap break-words leading-5">
                                    {result.stdout}
                                </pre>
                            </div>
                        )}

                        {/* Stderr */}
                        {result.stderr && (
                            <div className="space-y-1">
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                                    stderr
                                </p>
                                <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-words leading-5">
                                    {result.stderr}
                                </pre>
                            </div>
                        )}

                        {/* Empty output */}
                        {!result.stdout && !result.stderr && !result.compileOutput && (
                            <p className="text-xs text-slate-500 italic font-mono">
                                (no output)
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* Stdin input */}
            <div className="border-t border-slate-800 px-3 py-2 flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium w-8 flex-shrink-0">
                    stdin
                </span>
                <input
                    type="text"
                    value={stdin}
                    onChange={(e) => onStdinChange(e.target.value)}
                    placeholder="Input for your program (optional)"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
            </div>
        </div>
    );
};

export default ExecutionPanel;
