/**
 * components/workspace/ExecutionPanel.jsx
 * Displays code execution results: stdout, stderr, exit code, timing, compile errors.
 * Rendered below the editor when execution completes or is in progress.
 *
 * The panel is scoped to one file. It used to be shared across the whole
 * workspace, so switching tabs left the previous file's output on screen with
 * nothing to say it did not belong to the file now in front of you — hence the
 * filename in the header.
 */

import { useRef, useEffect } from 'react';
import {
    X,
    CheckCircle,
    XCircle,
    Clock,
    Terminal,
    AlertTriangle,
    Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * @param {object} props
 * @param {string}       props.fileName   - The file this output belongs to
 * @param {boolean}      props.isRunning  - Show loading state
 * @param {object|null}  props.result     - Execution result from server
 * @param {string|null}  props.error      - Client/network error
 * @param {function}     props.onClear    - Clear result callback
 * @param {string}       props.stdin      - Current stdin value
 * @param {function}     props.onStdinChange - Stdin change callback
 */
const ExecutionPanel = ({ fileName, isRunning, result, error, onClear, stdin, onStdinChange }) => {
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
        <div className="border-t-4 border-black bg-white flex flex-col animate-in slide-in-from-bottom-2 duration-200 font-mono z-20">
            {/* Header */}
            <div className="h-10 flex items-center justify-between px-4 border-b-4 border-black flex-shrink-0 bg-[#FFEB3B]">
                <div className="flex items-center gap-2">
                    <Terminal size={16} className="text-black stroke-[3]" />
                    <span className="text-sm font-black text-black uppercase tracking-widest">
                        Output
                    </span>
                    {fileName && (
                        <span
                            className="text-xs font-bold text-black truncate max-w-[14rem]"
                            title={fileName}
                        >
                            {fileName}
                        </span>
                    )}
                    {result && (
                        <>
                            {/* Exit code badge */}
                            <span
                                className={cn(
                                    'flex items-center gap-1 text-xs px-2 py-1 border-2 border-black font-black uppercase',
                                    exitSuccess
                                        ? 'bg-[#00E5FF] text-black'
                                        : 'bg-[#FF4081] text-black'
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
                            <span className="flex items-center gap-1 text-xs text-black font-bold">
                                <Clock size={12} className="stroke-[3]" />
                                {result.time}ms
                            </span>
                            {/* Runtime */}
                            <span className="text-xs text-black font-bold">
                                {result.language} {result.version}
                            </span>
                        </>
                    )}
                </div>

                <button
                    onClick={onClear}
                    className="p-1 hover:bg-[#FF4081] rounded-none border-2 border-transparent hover:border-black transition-none text-black"
                    title="Clear output"
                >
                    <X size={18} className="stroke-[3]" />
                </button>
            </div>

            {/* Output area */}
            <div ref={outputRef} className="flex-1 overflow-y-auto max-h-56 p-3 space-y-2">
                {/* Running spinner */}
                {isRunning && (
                    <div className="flex items-center gap-2 text-black font-bold">
                        <Loader2 size={16} className="animate-spin stroke-[3]" />
                        <span className="text-sm font-mono uppercase tracking-widest">Running...</span>
                    </div>
                )}

                {/* Client/network error */}
                {error && (
                    <div className="flex items-start gap-2 text-black bg-[#FF4081] border-4 border-black p-3 font-bold">
                        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 stroke-[3]" />
                        <span className="text-sm font-mono">{error}</span>
                    </div>
                )}

                {result && (
                    <>
                        {/* Compile output (C, C++, Java, Rust) */}
                        {result.compileOutput && (
                            <div className="space-y-1">
                                <p className="text-xs font-black text-black uppercase tracking-wider">
                                    Compiler
                                </p>
                                <pre className="text-sm font-mono text-black bg-[#FFEB3B] border-4 border-black p-3 whitespace-pre-wrap break-words font-bold">
                                    {result.compileOutput}
                                </pre>
                            </div>
                        )}

                        {/* Stdout */}
                        {result.stdout && (
                            <div className="space-y-1">
                                <p className="text-xs font-black text-black uppercase tracking-wider">
                                    stdout
                                </p>
                                <pre className="text-sm font-mono text-black bg-[#f8f9fa] border-4 border-black p-3 whitespace-pre-wrap break-words leading-5 font-bold">
                                    {result.stdout}
                                </pre>
                            </div>
                        )}

                        {/* Stderr */}
                        {result.stderr && (
                            <div className="space-y-1">
                                <p className="text-xs font-black text-black uppercase tracking-wider">
                                    stderr
                                </p>
                                <pre className="text-sm font-mono text-black bg-[#FF4081] border-4 border-black p-3 whitespace-pre-wrap break-words leading-5 font-bold">
                                    {result.stderr}
                                </pre>
                            </div>
                        )}

                        {/* Empty output */}
                        {!result.stdout && !result.stderr && !result.compileOutput && (
                            <p className="text-sm text-black font-black font-mono uppercase tracking-widest">
                                (no output)
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* Stdin input */}
            <div className="border-t-4 border-black px-4 py-3 flex items-center gap-3 flex-shrink-0 bg-white">
                <span className="text-sm text-black uppercase tracking-widest font-black w-12 flex-shrink-0">
                    stdin
                </span>
                <input
                    type="text"
                    value={stdin}
                    onChange={(e) => onStdinChange(e.target.value)}
                    placeholder="Input for your program (optional)"
                    className="flex-1 bg-white border-4 border-black rounded-none px-3 py-2 text-sm font-mono text-black font-bold placeholder-gray-500 focus:outline-none focus:ring-0 focus:bg-[#FFEB3B] transition-none neo-shadow-sm"
                />
            </div>
        </div>
    );
};

export default ExecutionPanel;
