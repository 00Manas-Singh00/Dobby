/**
 * components/workspace/EditorWorkspace.jsx
 * Orchestrates the full editor area:
 *   - FileExplorer (left panel)
 *   - EditorTabs + CodeEditor (center), one CodeEditor per open file
 *   - ExecutionPanel (below editor), scoped to the file that produced it
 *   - HistoryPanel (right), the open file's snapshots
 *   - Terminal (bottom)
 *
 * Execution results are keyed by file id rather than held as one value. There
 * was previously a single shared panel for the whole workspace, so running one
 * file and switching tabs showed you the other file's output — or worse, output
 * you would reasonably read as belonging to the file you were looking at.
 */

import { useState, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import ResizablePanel from '../common/ResizablePanel';
import FileExplorer from './FileExplorer';
import EditorTabs from './EditorTabs';
import Terminal from './Terminal';
import ExecutionPanel from './ExecutionPanel';
import HistoryPanel from './HistoryPanel';
import CodeEditor from '../Editor';
import { useCodeExecution } from '@/hooks/useCodeExecution';

const EditorWorkspace = ({ socket, roomId, username, theme = 'vs-dark' }) => {
    const { editorState, activeFile, updateFileExplorerWidth } = useWorkspace();
    const { activeFileId, openFiles } = editorState;

    // ── Code Execution, per file ─────────────────────────────────────────────
    const { isRunning, results, run, clearResult } = useCodeExecution();
    const [stdinByFile, setStdinByFile] = useState({});
    const [historyOpen, setHistoryOpen] = useState(false);

    const stdin = stdinByFile[activeFileId] ?? '';

    const setStdin = useCallback(
        (value) => {
            if (!activeFileId) return;
            setStdinByFile((prev) => ({ ...prev, [activeFileId]: value }));
        },
        [activeFileId]
    );

    const handleRun = useCallback(
        (code, language, fileId) => {
            run(fileId, code, language, stdinByFile[fileId] ?? '');
        },
        [run, stdinByFile]
    );

    const activeResult = activeFileId ? results[activeFileId] : null;
    const showExecutionPanel = Boolean(activeResult);

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
                <EditorTabs />

                <div className="flex-1 flex overflow-hidden min-h-0">
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                        {/* Monaco editor — takes remaining space */}
                        <div className="flex-1 min-h-0 relative">
                            {openFiles.map((file) => (
                                <div
                                    key={file.id}
                                    className="absolute inset-0"
                                    style={{
                                        display: file.id === activeFileId ? 'block' : 'none',
                                    }}
                                >
                                    <CodeEditor
                                        socket={socket}
                                        roomId={roomId}
                                        username={username}
                                        fileId={file.id}
                                        fileName={file.name}
                                        fileLanguage={file.language}
                                        theme={theme}
                                        isRunning={Boolean(isRunning[file.id])}
                                        onRun={handleRun}
                                        historyOpen={historyOpen}
                                        onToggleHistory={() => setHistoryOpen((open) => !open)}
                                    />
                                </div>
                            ))}

                            {openFiles.length === 0 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-white">
                                    <p className="text-black font-black uppercase tracking-widest text-sm">
                                        Open a file from the explorer to start
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Execution output for the file that produced it */}
                        {showExecutionPanel && (
                            <ExecutionPanel
                                fileName={activeFile?.name}
                                isRunning={Boolean(isRunning[activeFileId])}
                                result={activeResult.result}
                                error={activeResult.error}
                                onClear={() => clearResult(activeFileId)}
                                stdin={stdin}
                                onStdinChange={setStdin}
                            />
                        )}
                    </div>

                    {/* ── Document history for the open file ────────────────── */}
                    {historyOpen && activeFile && (
                        <HistoryPanel
                            roomId={roomId}
                            file={activeFile}
                            onClose={() => setHistoryOpen(false)}
                        />
                    )}
                </div>

                <Terminal />
            </div>
        </div>
    );
};

export default EditorWorkspace;
