import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '@/contexts/SocketContext';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';
import Sidebar from './Sidebar';
import WorkspaceHeader from './WorkspaceHeader';
import WorkspaceContainer from './WorkspaceContainer';
import EditorWorkspace from './EditorWorkspace';
import VideoWorkspace from './VideoWorkspace';
import WhiteboardWorkspace from './WhiteboardWorkspace';
import ChatWorkspace from './ChatWorkspace';
import FloatingVideoPlayer from './FloatingVideoPlayer';
const WorkspaceShellContent = () => {
    const { roomId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const socket = useSocket();
    const [username] = useState(location.state?.username || '');
    const [users, setUsers] = useState([]);
    const [editorTheme, setEditorTheme] = useState('vs-dark');

    const {
        activeModule,
        setActiveModule,
        sidebarCollapsed,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth,
        videoState,
    } = useWorkspace();

    // Socket connection and room  management
    useEffect(() => {
        if (!username) {
            navigate('/');
            toast.error("Username required");
            return;
        }

        if (!socket) return;

        socket.emit("join room", { roomId, username });

        socket.on("new member joined", ({ username: newUser }) => {
            toast.success(`${newUser} joined the room`, { icon: '👋' });
        });

        socket.on("member left", ({ username: leftUser }) => {
            toast.info(`${leftUser} left the room`, { icon: '👋' });
        });

        socket.on("updating client list", ({ userslist }) => {
            setUsers(userslist || []);
        });

        socket.on("room full", ({ message }) => {
            toast.error(message);
            setTimeout(() => {
                navigate('/');
            }, 2000);
        });

        return () => {
            socket.off("new member joined");
            socket.off("member left");
            socket.off("updating client list");
            socket.off("room full");
            socket.emit("leave room", { roomId });
        };
    }, [socket, roomId, username, navigate]);

    const showFloatingVideo = videoState.streamActive && activeModule !== 'video';

    return (
        <div className="h-screen w-screen flex flex-col bg-white overflow-hidden text-black font-mono">
            {/* Header */}
            <WorkspaceHeader
                roomId={roomId}
                username={username}
                users={users}
                theme={editorTheme}
                onThemeChange={setEditorTheme}
            />

            {/* Main Workspace Area */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Sidebar */}
                <Sidebar
                    activeModule={activeModule}
                    onModuleChange={setActiveModule}
                    isCollapsed={sidebarCollapsed}
                    width={sidebarWidth}
                    onWidthChange={setSidebarWidth}
                    onToggleCollapse={toggleSidebar}
                />

                {/* Workspace Container */}
                <WorkspaceContainer activeModule={activeModule}>
                    <EditorWorkspace
                        moduleId="editor"
                        socket={socket}
                        roomId={roomId}
                        username={username}
                        theme={editorTheme}
                    />
                    <VideoWorkspace
                        moduleId="video"
                        socket={socket}
                        roomId={roomId}
                        username={username}
                    />
                    <WhiteboardWorkspace
                        moduleId="whiteboard"
                        socket={socket}
                        roomId={roomId}
                    />
                    <ChatWorkspace
                        moduleId="chat"
                        socket={socket}
                        roomId={roomId}
                        username={username}
                    />
                    </WorkspaceContainer>

                {/* Floating Video Player (when video is not active module) */}
                {showFloatingVideo && (
                    <FloatingVideoPlayer
                        onExpand={() => setActiveModule('video')}
                        socket={socket}
                        roomId={roomId}
                        username={username}
                    />
                )}
            </div>
        </div>
    );
};

const WorkspaceShell = () => {
    return (
        <WorkspaceProvider>
            <WorkspaceShellContent />
        </WorkspaceProvider>
    );
};

export default WorkspaceShell;
