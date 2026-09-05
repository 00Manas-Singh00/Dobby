import { createContext, useContext, useState, useCallback } from 'react';

const WorkspaceContext = createContext(null);

export const useWorkspace = () => {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used within WorkspaceProvider');
    }
    return context;
};

export const WorkspaceProvider = ({ children }) => {
    // Global layout state
    const [activeModule, setActiveModule] = useState('editor');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        const saved = localStorage.getItem('dobby_sidebar_width');
        return saved ? parseInt(saved, 10) : 240;
    });

    // Editor state
    const [editorState, setEditorState] = useState({
        openFiles: [
            { id: 'welcome', name: 'welcome.md', language: 'markdown', content: '// Welcome to Dobby!\n// Start coding together...' }
        ],
        activeFileId: 'welcome',
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

    // Video state
    const [videoState, setVideoState] = useState({
        streamActive: false,
        miniPlayerPosition: (() => {
            const saved = localStorage.getItem('dobby_video_position');
            if (saved) return JSON.parse(saved);
            return {
                x: typeof window !== 'undefined' ? window.innerWidth - 350 : 0,
                y: typeof window !== 'undefined' ? window.innerHeight - 250 : 0
            };
        })(),
        miniPlayerSize: { width: 320, height: 240 },
        isMuted: false,
        isVideoOff: false,
    });

    // Whiteboard state
    const [whiteboardState, setWhiteboardState] = useState({
        canvasState: null,
    });

    // Chat state
    const [chatState, setChatState] = useState({
        scrollPosition: 0,
    });

    // Actions
    const handleSetActiveModule = useCallback((module) => {
        setActiveModule(module);
    }, []);

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => !prev);
    }, []);

    const handleSetSidebarWidth = useCallback((width) => {
        setSidebarWidth(width);
        localStorage.setItem('dobby_sidebar_width', width.toString());
    }, []);

    const openFile = useCallback((file) => {
        setEditorState(prev => {
            const exists = prev.openFiles.find(f => f.id === file.id);
            if (exists) {
                return { ...prev, activeFileId: file.id };
            }
            return {
                ...prev,
                openFiles: [...prev.openFiles, file],
                activeFileId: file.id,
            };
        });
    }, []);

    const closeFile = useCallback((fileId) => {
        setEditorState(prev => {
            const newOpenFiles = prev.openFiles.filter(f => f.id !== fileId);
            let newActiveFileId = prev.activeFileId;

            if (prev.activeFileId === fileId && newOpenFiles.length > 0) {
                newActiveFileId = newOpenFiles[0].id;
            }

            return {
                ...prev,
                openFiles: newOpenFiles,
                activeFileId: newActiveFileId,
            };
        });
    }, []);

    const setActiveFile = useCallback((fileId) => {
        setEditorState(prev => ({ ...prev, activeFileId: fileId }));
    }, []);

    const updateFileExplorerWidth = useCallback((width) => {
        setEditorState(prev => ({ ...prev, fileExplorerWidth: width }));
        localStorage.setItem('dobby_file_explorer_width', width.toString());
    }, []);

    const updateTerminalHeight = useCallback((height) => {
        setEditorState(prev => ({ ...prev, terminalHeight: height }));
        localStorage.setItem('dobby_terminal_height', height.toString());
    }, []);

    const toggleTerminal = useCallback(() => {
        setEditorState(prev => ({ ...prev, terminalCollapsed: !prev.terminalCollapsed }));
    }, []);

    const updateVideoMiniPlayerPosition = useCallback((position) => {
        setVideoState(prev => ({ ...prev, miniPlayerPosition: position }));
        localStorage.setItem('dobby_video_position', JSON.stringify(position));
    }, []);

    const updateVideoMiniPlayerSize = useCallback((size) => {
        setVideoState(prev => ({ ...prev, miniPlayerSize: size }));
    }, []);

    const setVideoStreamActive = useCallback((active) => {
        setVideoState(prev => ({ ...prev, streamActive: active }));
    }, []);

    const toggleVideoMute = useCallback(() => {
        setVideoState(prev => ({ ...prev, isMuted: !prev.isMuted }));
    }, []);

    const toggleVideoCamera = useCallback(() => {
        setVideoState(prev => ({ ...prev, isVideoOff: !prev.isVideoOff }));
    }, []);

    const value = {
        // Global layout
        activeModule,
        setActiveModule: handleSetActiveModule,
        sidebarCollapsed,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth: handleSetSidebarWidth,

        // Editor
        editorState,
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

        // Whiteboard
        whiteboardState,
        setWhiteboardState,

        // Chat
        chatState,
        setChatState,
    };

    return (
        <WorkspaceContext.Provider value={value}>
            {children}
        </WorkspaceContext.Provider>
    );
};
