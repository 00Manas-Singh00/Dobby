/**
 * components/workspace/EditorWorkspace.jsx
 * Orchestrates the full editor area:
 *   - FileExplorer (left panel)
 *   - EditorTabs + CodeEditor (center)
 *   - ExecutionPanel (below editor, shown after running)
 *   - AIPanel (right panel, shown when AI is active)
 *   - Terminal (bottom)
 *
 * Owns code execution state (useCodeExecution) and AI state (useAI).
 */

import React, { useState, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import ResizablePanel from '../common/ResizablePanel';
import FileExplorer from './FileExplorer';
import EditorTabs from './EditorTabs';
import Terminal from './Terminal';
import ExecutionPanel from './ExecutionPanel';
import AIPanel from './AIPanel';
import CodeEditor from '../Editor';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import { useAI } from '@/hooks/useAI';

const EditorWorkspace = ({ moduleId, socket, roomId, username, theme = 'vs-dark' }) => {
    const { editorState, updateFileExplorerWidth } = useWorkspace();

    // ── Code Execution ───────────────────────────────────────────────────────
    const { isRunning, result, error: execError, run, clearResult } = useCodeExecution();
    const [stdin, setStdin] = useState('');

    const handleRun = useCallback(
        (code, language) => {
            run(code, language, stdin);
        },
        [run, stdin]
    );

    // ── AI Assistant ─────────────────────────────────────────────────────────
    const { isStreaming, streamedText, error: aiError, mode, explain, fix, ask, cancel, clear } = useAI();
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [currentCode, setCurrentCode] = useState('');
    const [currentLanguage, setCurrentLanguage] = useState('javascript');

    const handleExplain = useCallback(
        (code) => {
            setCurrentCode(code);
            setAiPanelOpen(true);
            explain(code, currentLanguage);
        },
        [explain, currentLanguage]
    );

    const handleFix = useCallback(
        (code) => {
            setCurrentCode(code);
            setAiPanelOpen(true);
            // Include execution error as context if available
            const errorContext = execError || result?.stderr || '';
            fix(code, currentLanguage, errorContext);
        },
        [fix, currentLanguage, execError, result]
    );

    const handleAsk = useCallback(
        (prompt, code, language) => {
            setCurrentCode(code);
            ask(prompt, code, language);
        },
        [ask]
    );

    const showExecutionPanel = isRunning || result || execError;

    return (
        <div className="w-full h-full flex overflow-hidden">
            {/* ── File Explorer ─────────────────────────────────────────────── */}
            <ResizablePanel
                direction="horizontal"
                minSize={180}
                maxSize={400}
                defaultSize={editorState.fileExplorerWidth}
                onResize={updateFileExplorerWidth}
            >
                <FileExplorer />
            </ResizablePanel>

            {/* ── Editor Area (center, takes remaining width) ────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Editor Tabs */}
                <EditorTabs />

                {/* Code Editor + Execution Panel stacked */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    {/* Monaco editor — takes remaining space */}
                    <div className="flex-1 min-h-0">
                        {editorState.openFiles.map((file) => (
                            <div
                                key={file.id}
                                className="absolute inset-0"
                                style={{
                                    display: file.id === editorState.activeFileId ? 'block' : 'none',
                                    position: 'relative',
                                    height: '100%',
                                }}
                            >
                                <CodeEditor
                                    socket={socket}
                                    roomId={roomId}
                                    username={username}
                                    theme={theme}
                                    isRunning={isRunning}
                                    onRun={handleRun}
                                    onExplain={handleExplain}
                                    onFix={handleFix}
                                />
                            </div>
                        ))}
                    </div>

                    {/* Execution Output Panel */}
                    {showExecutionPanel && (
                        <ExecutionPanel
                            isRunning={isRunning}
                            result={result}
                            error={execError}
                            onClear={clearResult}
                            stdin={stdin}
                            onStdinChange={setStdin}
                        />
                    )}
                </div>

                {/* Terminal */}
                <Terminal />
            </div>

            {/* ── AI Panel (right side) ─────────────────────────────────────── */}
            <AIPanel
                isOpen={aiPanelOpen}
                onClose={() => setAiPanelOpen(false)}
                isStreaming={isStreaming}
                streamedText={streamedText}
                error={aiError}
                mode={mode}
                onCancel={cancel}
                onClear={clear}
                onAsk={handleAsk}
                currentCode={currentCode}
                currentLanguage={currentLanguage}
            />
        </div>
    );
};

export default EditorWorkspace;
