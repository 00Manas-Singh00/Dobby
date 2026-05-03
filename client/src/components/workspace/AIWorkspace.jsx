/**
 * components/workspace/AIWorkspace.jsx
 * Full-page AI assistant workspace — rendered when user selects AI from sidebar.
 * Provides a standalone AI chat experience with code context.
 */

import React, { useState } from 'react';
import { useAI } from '@/hooks/useAI';
import AIPanel from './AIPanel';
import { Sparkles } from 'lucide-react';

const AIWorkspace = ({ moduleId }) => {
    const { isStreaming, streamedText, error, mode, explain, fix, ask, cancel, clear } = useAI();
    const [currentCode] = useState('');
    const [currentLanguage] = useState('javascript');

    return (
        <div className="w-full h-full flex bg-slate-950">
            {/* Left info pane */}
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <Sparkles size={28} className="text-white" />
                </div>
                <div className="text-center max-w-sm">
                    <h2 className="text-xl font-bold text-white mb-2">AI Pair Programmer</h2>
                    <p className="text-sm text-slate-400 leading-relaxed">
                        Go to the <span className="text-blue-400 font-medium">Editor</span> and select
                        code, then right-click to <span className="text-amber-400">✨ Explain</span> or{' '}
                        <span className="text-blue-400">🔧 Fix</span> with AI. Or use the{' '}
                        <span className="text-amber-400">Explain</span> /{' '}
                        <span className="text-blue-400">Fix</span> buttons in the editor toolbar.
                    </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-xs">
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-center">
                        <p className="text-amber-400 font-semibold text-sm mb-1">✨ Explain</p>
                        <p className="text-xs text-slate-400">Understand what code does</p>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-center">
                        <p className="text-blue-400 font-semibold text-sm mb-1">🔧 Fix</p>
                        <p className="text-xs text-slate-400">Improve or debug your code</p>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-center col-span-2">
                        <p className="text-purple-400 font-semibold text-sm mb-1">💬 Ask Anything</p>
                        <p className="text-xs text-slate-400">Free-form questions about your code</p>
                    </div>
                </div>
            </div>

            {/* Right: AI Panel (always open in this workspace) */}
            <AIPanel
                isOpen={true}
                onClose={null}
                isStreaming={isStreaming}
                streamedText={streamedText}
                error={error}
                mode={mode}
                onCancel={cancel}
                onClear={clear}
                onAsk={(prompt, code, language) => ask(prompt, code || currentCode, language || currentLanguage)}
                currentCode={currentCode}
                currentLanguage={currentLanguage}
            />
        </div>
    );
};

export default AIWorkspace;
