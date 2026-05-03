/**
 * components/Editor.jsx
 * Collaborative Monaco code editor.
 * Features:
 *  - Real-time code sync via Socket.IO
 *  - Language selector (from LANGUAGE_MAP)
 *  - ▶ Run button → code execution via Piston
 *  - AI context menu: "Explain with AI" / "Fix with AI"
 *  - Sync status indicator
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
    Play,
    Loader2,
    ChevronDown,
    Check,
    Sparkles,
    Wrench,
    Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LANGUAGES, isExecutable } from '@/constants/languageMap';
import { useYjsEditor } from '@/hooks/useYjsEditor';
import { fetchCompletion } from '@/services/aiService';

const CodeEditor = ({
    socket,
    roomId,
    username,
    theme = 'vs-dark',
    // Execution props (lifted from EditorWorkspace)
    isRunning = false,
    onRun,
    // AI props (lifted from EditorWorkspace)
    onExplain,
    onFix,
}) => {
    const [language, setLanguage] = useState('javascript');
    const [showLangDropdown, setShowLangDropdown] = useState(false);
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    
    // ── Yjs CRDT Sync ────────────────────────────────────────────────────────
    const { synced } = useYjsEditor(roomId, editorRef.current, username);

    // ── Socket Language Sync ────────────────────────────────────────────────
    useEffect(() => {
        if (!socket) return;

        const handleLanguageChange = ({ languageUsed }) => {
            setLanguage(languageUsed);
        };

        socket.on('on language change', handleLanguageChange);

        return () => {
            socket.off('on language change', handleLanguageChange);
        };
    }, [socket, roomId]);

    const handleLanguageChange = useCallback(
        (newLang) => {
            setLanguage(newLang);
            setShowLangDropdown(false);
            socket?.emit('update language', { roomId, languageUsed: newLang });
        },
        [socket, roomId]
    );

    // ── Monaco editor mount ──────────────────────────────────────────────────
    const handleEditorDidMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Right-click context menu: Explain with AI
        editor.addAction({
            id: 'dobby-ai-explain',
            label: '✨ Explain with AI',
            contextMenuGroupId: 'dobby',
            contextMenuOrder: 1,
            run: (ed) => {
                const selection = ed.getSelection();
                const selected = ed.getModel()?.getValueInRange(selection);
                const codeToSend = selected?.trim() || ed.getValue();
                onExplain?.(codeToSend);
            },
        });

        // Right-click context menu: Fix with AI
        editor.addAction({
            id: 'dobby-ai-fix',
            label: '🔧 Fix with AI',
            contextMenuGroupId: 'dobby',
            contextMenuOrder: 2,
            run: (ed) => {
                const selection = ed.getSelection();
                const selected = ed.getModel()?.getValueInRange(selection);
                const codeToSend = selected?.trim() || ed.getValue();
                onFix?.(codeToSend);
            },
        });

        // ── AI Inline Autocomplete ──────────────────────────────────────────
        const provider = monaco.languages.registerInlineCompletionsProvider(language, {
            provideInlineCompletions: async (model, position) => {
                const textBefore = model.getValueInRange({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                });

                // Only autocomplete if we have some context and at the end of a line
                const currentLine = model.getLineContent(position.lineNumber);
                if (currentLine.trim().length < 2 || position.column < currentLine.length) {
                    return { items: [] };
                }

                const textAfter = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: model.getLineCount(),
                    endColumn: model.getLineMaxColumn(model.getLineCount()),
                });

                try {
                    const completion = await fetchCompletion(textBefore, textAfter, language);
                    if (!completion) return { items: [] };

                    return {
                        items: [
                            {
                                insertText: completion,
                                range: {
                                    startLineNumber: position.lineNumber,
                                    startColumn: position.column,
                                    endLineNumber: position.lineNumber,
                                    endColumn: position.column,
                                },
                            },
                        ],
                    };
                } catch (err) {
                    return { items: [] };
                }
            },
            freeInlineCompletions: () => {},
        });

        return () => provider.dispose();
    }, [onExplain, onFix, language]);

    // ── Run handler ──────────────────────────────────────────────────────────
    const handleRun = useCallback(() => {
        const currentCode = editorRef.current?.getValue() || '';
        onRun?.(currentCode, language);
    }, [onRun, language]);

    const handleExplainCurrent = useCallback(() => {
        const currentCode = editorRef.current?.getValue() || '';
        onExplain?.(currentCode);
    }, [onExplain]);

    const handleFixCurrent = useCallback(() => {
        const currentCode = editorRef.current?.getValue() || '';
        onFix?.(currentCode);
    }, [onFix]);

    const canRun = isExecutable(language);
    const currentLangMeta = LANGUAGES.find((l) => l.id === language);

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e]">
            {/* ── Editor Toolbar ─────────────────────────────────────────────── */}
            <div className="h-10 flex items-center justify-between px-3 border-b border-slate-800 bg-slate-900/80 flex-shrink-0 gap-2">
                {/* Left: Language selector */}
                <div className="relative">
                    <button
                        onClick={() => setShowLangDropdown((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-2.5 py-1 transition-colors"
                    >
                        <span className="text-blue-400 font-bold text-[10px]">
                            {currentLangMeta?.icon ?? language.toUpperCase()}
                        </span>
                        <span>{currentLangMeta?.label ?? language}</span>
                        <ChevronDown size={11} className={cn('text-slate-500 transition-transform', showLangDropdown && 'rotate-180')} />
                    </button>

                    {showLangDropdown && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowLangDropdown(false)}
                            />
                            <div className="absolute left-0 top-full mt-1 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-20 py-1 max-h-72 overflow-y-auto">
                                {LANGUAGES.map((lang) => (
                                    <button
                                        key={lang.id}
                                        onClick={() => handleLanguageChange(lang.id)}
                                        className={cn(
                                            'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left hover:bg-slate-700 transition-colors',
                                            language === lang.id && 'bg-blue-600/20 text-blue-300'
                                        )}
                                    >
                                        <span className="font-mono font-bold text-[10px] text-slate-500 w-8 flex-shrink-0">
                                            {lang.icon}
                                        </span>
                                        <span className="text-slate-200">{lang.label}</span>
                                        {language === lang.id && (
                                            <Check size={10} className="ml-auto text-blue-400" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Right: Sync status + AI button + Run button */}
                <div className="flex items-center gap-2">
                    {/* Sync indicator */}
                    {synced && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20">
                            <Check size={10} className="text-green-400" />
                            <span className="text-[10px] text-green-400 font-medium">Synced</span>
                        </div>
                    )}

                    {/* AI quick action buttons */}
                    <button
                        onClick={handleExplainCurrent}
                        title="Explain code with AI"
                        className="flex items-center gap-1 text-[10px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded px-2 py-1 transition-colors"
                    >
                        <Lightbulb size={11} />
                        Explain
                    </button>
                    <button
                        onClick={handleFixCurrent}
                        title="Fix code with AI"
                        className="flex items-center gap-1 text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded px-2 py-1 transition-colors"
                    >
                        <Wrench size={11} />
                        Fix
                    </button>

                    {/* Run button */}
                    <button
                        onClick={handleRun}
                        disabled={!canRun || isRunning}
                        title={!canRun ? `${currentLangMeta?.label} is not executable` : 'Run code (Ctrl+Enter)'}
                        className={cn(
                            'flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded transition-all',
                            canRun && !isRunning
                                ? 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        )}
                    >
                        {isRunning ? (
                            <>
                                <Loader2 size={12} className="animate-spin" />
                                Running
                            </>
                        ) : (
                            <>
                                <Play size={12} fill="currentColor" />
                                Run
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Monaco Editor ──────────────────────────────────────────────── */}
            <div className="flex-1 relative min-h-0">
                <Editor
                    height="100%"
                    language={language}
                    theme={theme}
                    onMount={handleEditorDidMount}
                    options={{
                        minimap: { enabled: true },
                        fontSize: 14,
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                        wordWrap: 'on',
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        smoothScrolling: true,
                        cursorBlinking: 'smooth',
                        cursorSmoothCaretAnimation: 'on',
                        padding: { top: 12 },
                        lineHeight: 22,
                        suggestOnTriggerCharacters: true,
                        acceptSuggestionOnEnter: 'on',
                        tabSize: 2,
                        renderLineHighlight: 'all',
                        bracketPairColorization: { enabled: true },
                        contextmenu: true,
                    }}
                />
            </div>
        </div>
    );
};

export default CodeEditor;
