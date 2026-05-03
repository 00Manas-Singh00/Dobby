/**
 * components/workspace/AIPanel.jsx
 * Slide-in AI assistant panel. Shows streaming Gemini responses for code explanation,
 * fixing, and custom questions. Supports markdown rendering and response copying.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    X,
    Copy,
    Check,
    Sparkles,
    Loader2,
    StopCircle,
    MessageSquare,
    Lightbulb,
    Wrench,
    RotateCcw,
    Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const MODE_CONFIG = {
    explain: {
        icon: Lightbulb,
        label: 'Explain',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/20',
        title: 'Code Explanation',
    },
    fix: {
        icon: Wrench,
        label: 'Fix / Improve',
        color: 'text-blue-400',
        bg: 'bg-blue-500/10 border-blue-500/20',
        title: 'Code Fix',
    },
    ask: {
        icon: MessageSquare,
        label: 'Ask',
        color: 'text-purple-400',
        bg: 'bg-purple-500/10 border-purple-500/20',
        title: 'AI Answer',
    },
};

/**
 * Minimal markdown renderer — handles code blocks, bold, and line breaks.
 * Avoids heavy dependencies. For a production app, swap with react-markdown.
 */
function RenderMarkdown({ text }) {
    if (!text) return null;

    // Split by code blocks
    const parts = text.split(/(```[\s\S]*?```)/g);

    return (
        <div className="space-y-2">
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    const lines = part.slice(3, -3).split('\n');
                    const lang = lines[0].trim();
                    const code = lines.slice(1).join('\n');
                    return (
                        <div key={i} className="relative group">
                            {lang && (
                                <div className="text-[10px] text-slate-500 px-3 pt-2 pb-0 font-mono uppercase tracking-wider">
                                    {lang}
                                </div>
                            )}
                            <pre className="bg-slate-900 border border-slate-700 rounded p-3 text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre leading-5">
                                {code}
                            </pre>
                        </div>
                    );
                }

                // Inline formatting: **bold**, line breaks
                const lines = part.split('\n');
                return (
                    <div key={i} className="space-y-1">
                        {lines.map((line, j) => {
                            const formatted = line.replace(
                                /\*\*(.*?)\*\*/g,
                                '<strong class="text-white font-semibold">$1</strong>'
                            );
                            return (
                                <p
                                    key={j}
                                    className="text-xs text-slate-300 leading-5"
                                    dangerouslySetInnerHTML={{ __html: formatted }}
                                />
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * @param {object} props
 * @param {boolean}         props.isOpen
 * @param {function}        props.onClose
 * @param {boolean}         props.isStreaming
 * @param {string}          props.streamedText
 * @param {string|null}     props.error
 * @param {'explain'|'fix'|'ask'|null} props.mode
 * @param {function}        props.onCancel
 * @param {function}        props.onClear
 * @param {function}        props.onAsk         - (prompt, code, language) => void
 * @param {string}          props.currentCode    - Current editor code (for Ask tab)
 * @param {string}          props.currentLanguage
 */
const AIPanel = ({
    isOpen,
    onClose,
    isStreaming,
    streamedText,
    error,
    mode,
    onCancel,
    onClear,
    onAsk,
    currentCode,
    currentLanguage,
}) => {
    const [prompt, setPrompt] = useState('');
    const [copied, setCopied] = useState(false);
    const outputRef = useRef(null);

    // Auto-scroll as text streams in
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [streamedText]);

    const handleCopy = async () => {
        if (!streamedText) return;
        await navigator.clipboard.writeText(streamedText);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleAskSubmit = (e) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        onAsk(prompt.trim(), currentCode, currentLanguage);
        setPrompt('');
    };

    const modeConfig = mode ? MODE_CONFIG[mode] : null;
    const hasContent = streamedText || error || isStreaming;

    if (!isOpen) return null;

    return (
        <div className="w-[380px] flex-shrink-0 flex flex-col border-l border-slate-700/80 bg-slate-900 h-full">
            {/* Panel Header */}
            <div className="h-10 flex items-center justify-between px-4 border-b border-slate-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-purple-400" />
                    <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        AI Assistant
                    </span>
                    {modeConfig && (
                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', modeConfig.bg, modeConfig.color)}>
                            {modeConfig.label}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {hasContent && (
                        <button
                            onClick={onClear}
                            className="p-1.5 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-slate-300"
                            title="Clear"
                        >
                            <RotateCcw size={12} />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-slate-300"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Output Area */}
            <div ref={outputRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Empty state */}
                {!hasContent && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                        <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                            <Bot size={20} className="text-purple-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-300 mb-1">
                                AI Pair Programmer
                            </p>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Select code in the editor and right-click to
                                <br />
                                <span className="text-purple-400">✨ Explain</span> or{' '}
                                <span className="text-blue-400">🔧 Fix with AI</span>, or ask a
                                question below.
                            </p>
                        </div>
                    </div>
                )}

                {/* Streaming indicator */}
                {isStreaming && (
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Loader2 size={12} className="animate-spin" />
                        <span className="text-xs">Generating response...</span>
                        <button
                            onClick={onCancel}
                            className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
                        >
                            <StopCircle size={12} />
                            Stop
                        </button>
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                        {error}
                    </div>
                )}

                {/* Streamed content */}
                {streamedText && (
                    <div className="relative">
                        <RenderMarkdown text={streamedText} />
                        {streamedText && !isStreaming && (
                            <button
                                onClick={handleCopy}
                                className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                {copied ? (
                                    <>
                                        <Check size={11} className="text-green-400" />
                                        <span className="text-green-400">Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy size={11} />
                                        Copy response
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Streaming cursor */}
                {isStreaming && streamedText && (
                    <span className="inline-block w-1.5 h-3.5 bg-purple-400 animate-pulse rounded-sm ml-0.5" />
                )}
            </div>

            {/* Ask input */}
            <div className="border-t border-slate-800 p-3 flex-shrink-0">
                <form onSubmit={handleAskSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Ask anything about this code..."
                        disabled={isStreaming}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={isStreaming || !prompt.trim()}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                        <Sparkles size={14} />
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AIPanel;
