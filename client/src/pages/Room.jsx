import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '@/contexts/SocketContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import CodeEditor from '@/components/Editor';
import Chat from '@/components/Chat';
import UserList from '@/components/UserList';
import Whiteboard from '@/components/Whiteboard';
import VideoCall from '@/components/VideoCall';
import { MessageSquare, Users, PenTool, Video, LogOut, Copy, Check, Sparkles } from 'lucide-react';

const Room = () => {
    const { roomId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const socket = useSocket();
    const [username, setUsername] = useState(location.state?.username || '');
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState('editor');

    useEffect(() => {
        if (!username) {
            navigate('/');
            toast.error("Username required");
        }
    }, [username, navigate]);

    useEffect(() => {
        if (!socket || !username) return;

        socket.emit("join room", { roomId, username });

        socket.on("new member joined", ({ username: newUser }) => {
            toast.success(`${newUser} joined the room`, {
                icon: '👋',
            });
        });

        socket.on("member left", ({ username: leftUser }) => {
            toast.info(`${leftUser} left the room`, {
                icon: '👋',
            });
        });

        return () => {
            socket.off("new member joined");
            socket.off("member left");
            socket.emit("leave room", { roomId });
        };
    }, [socket, roomId, username]);

    const copyRoomId = () => {
        navigator.clipboard.writeText(roomId);
        setCopied(true);
        toast.success('Room ID copied to clipboard!');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleLeave = () => {
        navigate('/');
        toast.info('You left the room');
    };

    return (
        <div className="h-screen w-full bg-slate-950 overflow-hidden flex flex-col">
            {/* Enhanced Header */}
            <header className="h-16 border-b border-slate-800 flex items-center px-6 justify-between bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900 backdrop-blur-xl shadow-lg relative overflow-hidden">
                {/* Subtle animated background */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-pink-500/5 animate-pulse" style={{ animationDuration: '4s' }} />

                <div className="relative z-10 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Sparkles size={24} className="text-blue-400" />
                        <h1 className="font-bold text-xl bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Dobby
                        </h1>
                    </div>
                    <div className="h-8 w-px bg-slate-700" />
                    <div className="flex items-center gap-2 glass-dark rounded-lg px-3 py-1.5">
                        <span className="text-xs text-slate-400 font-medium">Room ID:</span>
                        <code className="text-xs text-blue-300 font-mono">{roomId.slice(0, 8)}...</code>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:bg-white/10"
                            onClick={copyRoomId}
                        >
                            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-slate-400" />}
                        </Button>
                    </div>
                </div>

                <div className="relative z-10 flex items-center gap-4">
                    <div className="flex items-center gap-2 glass-dark rounded-lg px-4 py-2">
                        <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-sm text-slate-300 font-medium">{username}</span>
                    </div>
                    <Button
                        onClick={handleLeave}
                        variant="ghost"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-2"
                    >
                        <LogOut size={16} />
                        Leave
                    </Button>
                </div>
            </header>

            {/* Main Content Area - Simplified Layout */}
            <div className="flex-1 overflow-hidden flex">
                {/* Left Panel - Always shows Editor */}
                <div className="flex-1 bg-[#1e1e1e]">
                    <CodeEditor socket={socket} roomId={roomId} />
                </div>

                {/* Right Panel - Tabs for other features */}
                <div className="w-96 flex flex-col bg-slate-900/50 border-l border-slate-800">
                    {/* Tab Header */}
                    <div className="h-12 border-b border-slate-800 bg-slate-900/50 flex">
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`flex-1 flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'chat'
                                    ? 'border-blue-500 text-blue-400'
                                    : 'border-transparent text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            <MessageSquare size={16} />
                            <span className="text-sm">Chat</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('whiteboard')}
                            className={`flex-1 flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'whiteboard'
                                    ? 'border-purple-500 text-purple-400'
                                    : 'border-transparent text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            <PenTool size={16} />
                            <span className="text-sm">Board</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('video')}
                            className={`flex-1 flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'video'
                                    ? 'border-pink-500 text-pink-400'
                                    : 'border-transparent text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            <Video size={16} />
                            <span className="text-sm">Video</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`flex-1 flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'users'
                                    ? 'border-green-500 text-green-400'
                                    : 'border-transparent text-slate-400 hover:text-slate-300'
                                }`}
                        >
                            <Users size={16} />
                            <span className="text-sm">Users</span>
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-hidden">
                        {activeTab === 'chat' && <Chat socket={socket} roomId={roomId} username={username} />}
                        {activeTab === 'whiteboard' && <Whiteboard socket={socket} roomId={roomId} />}
                        {activeTab === 'video' && <VideoCall socket={socket} roomId={roomId} username={username} />}
                        {activeTab === 'users' && <UserList socket={socket} roomId={roomId} />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Room;
