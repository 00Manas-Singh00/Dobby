import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
    listFiles,
    createFile as createFileRequest,
    updateFile as updateFileRequest,
    deleteFile as deleteFileRequest,
    firstFile,
    walkTree,
} from '@/services/fileService';

const WorkspaceContext = createContext(null);

export const useWorkspace = () => {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used within WorkspaceProvider');
    }
    return context;
};

/**
 * Layout state plus the room's file tree.
 *
 * The tree is fetched, not invented. Open tabs are stored as ids rather than as
 * file objects: the tree is the single record of what a file is called and
 * where it lives, so a tab that carried its own copy of the name would go stale
 * the moment the other person renamed it. `openFiles` resolves ids against the
 * tree on every render, which also means a file deleted by the other person
 * simply stops being a tab.
 *
 * Content is not here at all — that is the Yjs document keyed on the file id.
 */
export const WorkspaceProvider = ({ children, roomId, socket }) => {
    // Global layout state
    const [activeModule, setActiveModule] = useState('editor');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        const saved = localStorage.getItem('dobby_sidebar_width');
        return saved ? parseInt(saved, 10) : 240;
    });

    // ── File tree ────────────────────────────────────────────────────────────
    const [fileTree, setFileTree] = useState([]);
    const [filesLoaded, setFilesLoaded] = useState(false);
    const [openFileIds, setOpenFileIds] = useState([]);
    const [activeFileId, setActiveFileId] = useState(null);

    // Panel geometry, which has nothing to do with the tree but shares the
    // editor's slice of state.
    const [editorLayout, setEditorLayout] = useState({
        fileExplorerWidth: (() => {
            const saved = localStorage.getItem('dobby_file_explorer_width');
            return saved ? parseInt(saved, 10) : 250;
        })(),
        terminalHeight: (() => {
            const saved = localStorage.getItem('dobby_terminal_height');
            return saved ? parseInt(saved, 10) : 200;
        })(),
        terminalCollapsed: false,
    });

    const openTabsKey = roomId ? `dobby_room_${roomId}_open_tabs` : null;

    const refreshFiles = useCallback(async () => {
        if (!roomId) return [];
        const files = await listFiles(roomId);
        setFileTree(files);
        return files;
    }, [roomId]);

    // Initial load. Restores whichever tabs were open last time, dropping any
    // whose file has since been deleted — by the other person, or by the
    // retention sweep.
    useEffect(() => {
        if (!roomId) return undefined;
        let cancelled = false;

        (async () => {
            try {
                const files = await listFiles(roomId);
                if (cancelled) return;

                setFileTree(files);

                const existing = new Set(
                    [...walkTree(files)].filter((n) => n.type === 'file').map((n) => n.id)
                );
                const remembered = (() => {
                    try {
                        return JSON.parse(localStorage.getItem(openTabsKey) || '[]');
                    } catch {
                        return [];
                    }
                })().filter((id) => existing.has(id));

                const initial = remembered.length ? remembered : [firstFile(files)?.id].filter(Boolean);
                setOpenFileIds(initial);
                setActiveFileId(initial[0] ?? null);
            } catch (error) {
                if (!cancelled) toast.error(error.message || 'Could not load the file tree.');
            } finally {
                if (!cancelled) setFilesLoaded(true);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [roomId, openTabsKey]);

    useEffect(() => {
        if (!openTabsKey || !filesLoaded) return;
        localStorage.setItem(openTabsKey, JSON.stringify(openFileIds));
    }, [openTabsKey, openFileIds, filesLoaded]);

    /**
     * Tree changes made by the other person.
     *
     * The payload carries the change, but the tree is refetched rather than
     * patched in place: the server is the record, and a client that maintained
     * its own copy would need to replay moves and renames correctly to stay
     * consistent with it. A delete is applied to the open tabs directly, since
     * that is not something the refetch can tell us — those files are simply
     * gone.
     */
    useEffect(() => {
        if (!socket || !roomId) return undefined;

        const handleChange = (payload) => {
            refreshFiles().catch(() => {
                /* a failed refresh leaves the previous tree; the next change retries */
            });

            if (payload?.action === 'deleted') {
                const removed = new Set(payload.fileIds || []);
                setOpenFileIds((prev) => prev.filter((id) => !removed.has(id)));
                setActiveFileId((prev) => (removed.has(prev) ? null : prev));
            }
        };

        socket.on('files:changed', handleChange);
        return () => socket.off('files:changed', handleChange);
    }, [socket, roomId, refreshFiles]);

    // Keep an active tab pointed at something real, whatever caused it to stop
    // being so — a delete, a failed restore, or a tab close.
    useEffect(() => {
        if (activeFileId && openFileIds.includes(activeFileId)) return;
        setActiveFileId(openFileIds[0] ?? null);
    }, [openFileIds, activeFileId]);

    const filesById = new Map(
        [...walkTree(fileTree)].map((node) => [node.id, node])
    );

    // Tabs resolved against the tree, so a rename by either person is reflected
    // without any tab-specific bookkeeping.
    const openFiles = openFileIds.map((id) => filesById.get(id)).filter(Boolean);
    const activeFile = activeFileId ? filesById.get(activeFileId) ?? null : null;

    // ── Actions ──────────────────────────────────────────────────────────────
    const handleSetActiveModule = useCallback((module) => {
        setActiveModule(module);
    }, []);

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed((prev) => !prev);
    }, []);

    const handleSetSidebarWidth = useCallback((width) => {
        setSidebarWidth(width);
        localStorage.setItem('dobby_sidebar_width', width.toString());
    }, []);

    /** Open a tab for a file already in the tree. */
    const openFile = useCallback((file) => {
        const id = typeof file === 'string' ? file : file?.id;
        if (!id) return;

        setOpenFileIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setActiveFileId(id);
    }, []);

    const closeFile = useCallback((fileId) => {
        setOpenFileIds((prev) => prev.filter((id) => id !== fileId));
    }, []);

    const setActiveFile = useCallback((fileId) => {
        setActiveFileId(fileId);
    }, []);

    const createFile = useCallback(
        async ({ name, type = 'file', parentId = null }) => {
            const file = await createFileRequest(roomId, { name, type, parentId });
            await refreshFiles();
            // A new folder is somewhere to put things; a new file is somewhere
            // to type, so only the latter opens.
            if (file.type === 'file') openFile(file);
            return file;
        },
        [roomId, refreshFiles, openFile]
    );

    const renameFile = useCallback(
        async (fileId, name) => {
            const file = await updateFileRequest(roomId, fileId, { name });
            await refreshFiles();
            return file;
        },
        [roomId, refreshFiles]
    );

    const moveFile = useCallback(
        async (fileId, parentId) => {
            const file = await updateFileRequest(roomId, fileId, { parentId: parentId ?? null });
            await refreshFiles();
            return file;
        },
        [roomId, refreshFiles]
    );

    const deleteFile = useCallback(
        async (fileId) => {
            const removed = await deleteFileRequest(roomId, fileId);
            const gone = new Set(removed);
            setOpenFileIds((prev) => prev.filter((id) => !gone.has(id)));
            await refreshFiles();
            return removed;
        },
        [roomId, refreshFiles]
    );

    const updateFileExplorerWidth = useCallback((width) => {
        setEditorLayout((prev) => ({ ...prev, fileExplorerWidth: width }));
        localStorage.setItem('dobby_file_explorer_width', width.toString());
    }, []);

    const updateTerminalHeight = useCallback((height) => {
        setEditorLayout((prev) => ({ ...prev, terminalHeight: height }));
        localStorage.setItem('dobby_terminal_height', height.toString());
    }, []);

    const toggleTerminal = useCallback(() => {
        setEditorLayout((prev) => ({ ...prev, terminalCollapsed: !prev.terminalCollapsed }));
    }, []);

    // Video state
    const [videoState, setVideoState] = useState({
        streamActive: false,
        miniPlayerPosition: (() => {
            const saved = localStorage.getItem('dobby_video_position');
            if (saved) return JSON.parse(saved);
            return {
                x: typeof window !== 'undefined' ? window.innerWidth - 350 : 0,
                y: typeof window !== 'undefined' ? window.innerHeight - 250 : 0,
            };
        })(),
        miniPlayerSize: { width: 320, height: 240 },
        isMuted: false,
        isVideoOff: false,
    });

    const updateVideoMiniPlayerPosition = useCallback((position) => {
        setVideoState((prev) => ({ ...prev, miniPlayerPosition: position }));
        localStorage.setItem('dobby_video_position', JSON.stringify(position));
    }, []);

    const updateVideoMiniPlayerSize = useCallback((size) => {
        setVideoState((prev) => ({ ...prev, miniPlayerSize: size }));
    }, []);

    const setVideoStreamActive = useCallback((active) => {
        setVideoState((prev) => ({ ...prev, streamActive: active }));
    }, []);

    const toggleVideoMute = useCallback(() => {
        setVideoState((prev) => ({ ...prev, isMuted: !prev.isMuted }));
    }, []);

    const toggleVideoCamera = useCallback(() => {
        setVideoState((prev) => ({ ...prev, isVideoOff: !prev.isVideoOff }));
    }, []);

    // Chat state
    const [chatState, setChatState] = useState({ scrollPosition: 0 });

    const value = {
        // Global layout
        activeModule,
        setActiveModule: handleSetActiveModule,
        sidebarCollapsed,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth: handleSetSidebarWidth,

        // Files
        fileTree,
        filesLoaded,
        refreshFiles,
        createFile,
        renameFile,
        moveFile,
        deleteFile,

        // Editor — `editorState` keeps the shape the panels already destructure.
        editorState: { ...editorLayout, openFiles, activeFileId },
        activeFile,
        openFile,
        closeFile,
        setActiveFile,
        updateFileExplorerWidth,
        updateTerminalHeight,
        toggleTerminal,

        // Video
        videoState,
        updateVideoMiniPlayerPosition,
        updateVideoMiniPlayerSize,
        setVideoStreamActive,
        toggleVideoMute,
        toggleVideoCamera,

        // Chat
        chatState,
        setChatState,
    };

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
