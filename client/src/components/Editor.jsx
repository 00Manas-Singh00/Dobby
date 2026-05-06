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

const CodeEditor = ({
    socket,
    roomId,
    username,
    theme = 'vs-dark',
    isRunning = false,
    onRun,
}) => {
    const [language, setLanguage] = useState(() => {
        if (!roomId) return 'javascript';
        return localStorage.getItem(`dobby_room_${roomId}_language`) || 'javascript';
    });
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
            if (roomId && languageUsed) {
                localStorage.setItem(`dobby_room_${roomId}_language`, languageUsed);
            }
        };

        socket.on('on language change', handleLanguageChange);

        return () => {
            socket.off('on language change', handleLanguageChange);
        };
    }, [socket, roomId]);

    const handleLanguageChange = useCallback(
        (newLang) => {
            setLanguage(newLang);
            if (roomId) {
                localStorage.setItem(`dobby_room_${roomId}_language`, newLang);
            }
            setShowLangDropdown(false);
            socket?.emit('update language', { roomId, languageUsed: newLang });
        },
        [socket, roomId]
    );

    // ── Monaco editor mount ──────────────────────────────────────────────────
    const handleEditorDidMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
    }, [language]);

    // ── Run handler ──────────────────────────────────────────────────────────
    const handleRun = useCallback(() => {
        const currentCode = editorRef.current?.getValue() || '';
        onRun?.(currentCode, language);
    }, [onRun, language]);

    const canRun = isExecutable(language);
    const currentLangMeta = LANGUAGES.find((l) => l.id === language);

    return (
        <div className="flex flex-col h-full bg-white font-mono">
            {/* ── Editor Toolbar ─────────────────────────────────────────────── */}
            <div className="h-12 flex items-center justify-between px-4 border-b-4 border-black bg-[#FFEB3B] flex-shrink-0 gap-3">
                {/* Left: Language selector */}
                <div className="relative">
                    <button
                        onClick={() => setShowLangDropdown((v) => !v)}
                        className="flex items-center gap-2 text-sm font-black text-black bg-white border-4 border-black px-4 py-1.5 transition-none neo-shadow-sm hover:neo-shadow-hover hover:bg-[#00E5FF] uppercase tracking-widest"
                    >
                        <span className="text-black font-black text-sm">
                            {currentLangMeta?.icon ?? language.toUpperCase()}
                        </span>
                        <span>{currentLangMeta?.label ?? language}</span>
                        <ChevronDown size={16} className={cn('text-black stroke-[3] transition-transform', showLangDropdown && 'rotate-180')} />
                    </button>

                    {showLangDropdown && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowLangDropdown(false)}
                            />
                            <div className="absolute left-0 top-full mt-2 w-56 bg-white border-4 border-black neo-shadow z-20 py-0 max-h-72 overflow-y-auto rounded-none">
                                {LANGUAGES.map((lang) => (
                                    <button
                                        key={lang.id}
                                        onClick={() => handleLanguageChange(lang.id)}
                                        className={cn(
                                            'w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-[#FFEB3B] border-b border-black last:border-b-0 transition-none font-bold text-black uppercase',
                                            language === lang.id && 'bg-[#00E5FF]'
                                        )}
                                    >
                                        <span className="font-mono font-black text-black w-8 flex-shrink-0">
                                            {lang.icon}
                                        </span>
                                        <span>{lang.label}</span>
                                        {language === lang.id && (
                                            <Check size={16} className="ml-auto text-black stroke-[3]" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Right: Sync status + AI button + Run button */}
                <div className="flex items-center gap-3">
                    {/* Sync indicator */}
                    {synced && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#00E5FF] border-4 border-black neo-shadow-sm">
                            <Check size={14} className="text-black stroke-[3]" />
                            <span className="text-xs text-black font-black uppercase tracking-widest">Synced</span>
                        </div>
                    )}

                    {/* Run button */}
                    <button
                        onClick={handleRun}
                        disabled={!canRun || isRunning}
                        title={!canRun ? `${currentLangMeta?.label} is not executable` : 'Run code (Ctrl+Enter)'}
                        className={cn(
                            'flex items-center gap-2 text-sm font-black px-6 py-2 transition-none uppercase tracking-widest border-4 border-black',
                            canRun && !isRunning
                                ? 'bg-white text-black hover:bg-[#FFEB3B] neo-shadow-sm hover:neo-shadow-hover'
                                : 'bg-[#e0e0e0] text-gray-500 cursor-not-allowed border-gray-400'
                        )}
                    >
                        {isRunning ? (
                            <>
                                <Loader2 size={16} className="animate-spin stroke-[3]" />
                                Running
                            </>
                        ) : (
                            <>
                                <Play size={16} className="fill-black stroke-[2]" />
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
                        fontSize: 16,
                        fontFamily: "'Space Grotesk', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                        wordWrap: 'on',
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        smoothScrolling: false,
                        cursorBlinking: 'blink',
                        cursorSmoothCaretAnimation: 'off',
                        padding: { top: 16 },
                        lineHeight: 24,
                        suggestOnTriggerCharacters: true,
                        acceptSuggestionOnEnter: 'on',
                        tabSize: 4,
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
