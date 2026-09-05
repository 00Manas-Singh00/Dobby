import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '@/contexts/SocketContext';
import { useAuth } from '@/contexts/AuthContext';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { getRoom } from '@/services/roomService';
import { toast } from 'sonner';
import Sidebar from './Sidebar';
import WorkspaceHeader from './WorkspaceHeader';
import WorkspaceContainer from './WorkspaceContainer';
import EditorWorkspace from './EditorWorkspace';
import VideoWorkspace from './VideoWorkspace';
import WhiteboardWorkspace from './WhiteboardWorkspace';
import ChatWorkspace from './ChatWorkspace';
import FloatingVideoPlayer from './FloatingVideoPlayer';

const getRoomStorageKey = (roomId, key) => `dobby_room_${roomId}_${key}`;

const WorkspaceShellContent = () => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const socket = useSocket();
    const { user } = useAuth();
    // The display name is the account's, not a string typed on the way in, so
    // it cannot be changed per-room or impersonated.
    const username = user?.username || '';
    const [users, setUsers] = useState([]);
    const [room, setRoom] = useState(null);
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

    // Confirm membership before rendering the room. The socket would reject a
    // non-member anyway, but this turns a wall of failed events into one clear
    // message and a redirect.
    useEffect(() => {
        if (!roomId) return undefined;
        let cancelled = false;

        (async () => {
            try {
                const { room: fetched } = await getRoom(roomId);
                if (!cancelled) setRoom(fetched);
            } catch (error) {
                if (cancelled) return;
                toast.error(
                    error.status === 404
                        ? 'That room does not exist, or you have not been invited to it.'
                        : error.message || 'Could not open that room.'
                );
                navigate('/home', { replace: true });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [roomId, navigate]);

    useEffect(() => {
        if (!roomId) return;
        const savedModule = localStorage.getItem(getRoomStorageKey(roomId, 'active_module'));
        if (savedModule) {
            setActiveModule(savedModule);
        }
    }, [roomId, setActiveModule]);

    useEffect(() => {
        if (!roomId || !activeModule) return;
        localStorage.setItem(getRoomStorageKey(roomId, 'active_module'), activeModule);
    }, [roomId, activeModule]);

    // Socket connection and room  management
    useEffect(() => {
        // Wait for the membership check: joining before it resolves would race
        // the server's own rejection and produce a confusing double error.
        if (!socket || !room) return;

        socket.emit("join room", { roomId });

        socket.on("room denied", ({ message }) => {
            toast.error(message);
            navigate('/home', { replace: true });
        });

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
                navigate('/home');
            }, 2000);
        });

        return () => {
            socket.off("room denied");
            socket.off("new member joined");
            socket.off("member left");
            socket.off("updating client list");
            socket.off("room full");
            socket.emit("leave room", { roomId });
        };
    }, [socket, roomId, room, navigate]);

    const showFloatingVideo = videoState.streamActive && activeModule !== 'video';

    // Mounting the modules before membership is confirmed would open a Yjs
    // provider per tab that the server then rejects.
    if (!room) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#fffdf5] font-mono">
                <p className="text-black font-black uppercase tracking-widest">Opening room…</p>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-white overflow-hidden text-black font-mono">
            {/* Header */}
            <WorkspaceHeader
                roomId={roomId}
                roomName={room.name}
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
                    <FloatingVideoPlayer onExpand={() => setActiveModule('video')} />
                )}
            </div>
        </div>
    );
};

/**
 * The provider needs the room and the socket: it owns the file tree, which is
 * fetched per room and kept current by the room's `files:changed` broadcast.
 * The room id comes from the route rather than from the inner component, so the
 * tree starts loading in the same render the room does.
 */
const WorkspaceShell = () => {
    const { roomId } = useParams();
    const socket = useSocket();

    return (
        <WorkspaceProvider roomId={roomId} socket={socket}>
            <WorkspaceShellContent />
        </WorkspaceProvider>
    );
};

export default WorkspaceShell;
