import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4, validate } from 'uuid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Code2, Video, MessageSquare, PenTool, Sparkles, Users, Clock, ArrowRight, Copy, Check, Trash2 } from 'lucide-react';
import FeatureCard from '@/components/FeatureCard';
import StatsCard from '@/components/StatsCard';

const Home = () => {
    const navigate = useNavigate();
    const [roomId, setRoomId] = useState('');
    const [username, setUsername] = useState('');
    const [createdRoomId, setCreatedRoomId] = useState('');
    const [createUsername, setCreateUsername] = useState('');
    const [recentRooms, setRecentRooms] = useState([]);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        // Load recent rooms from localStorage
        const stored = localStorage.getItem('dobby_recent_rooms');
        if (stored) {
            setRecentRooms(JSON.parse(stored));
        }
    }, []);

    const saveRecentRoom = (roomId, username) => {
        const room = {
            id: roomId,
            username,
            timestamp: new Date().toISOString()
        };
        const updated = [room, ...recentRooms.filter(r => r.id !== roomId)].slice(0, 5);
        setRecentRooms(updated);
        localStorage.setItem('dobby_recent_rooms', JSON.stringify(updated));
    };

    const deleteRoom = (roomId, e) => {
        e.stopPropagation(); // Prevent card click from triggering
        const updated = recentRooms.filter(r => r.id !== roomId);
        setRecentRooms(updated);
        localStorage.setItem('dobby_recent_rooms', JSON.stringify(updated));
        toast.success('Room removed from recent history');
    };

    const handleJoin = (e) => {
        e.preventDefault();
        if (!roomId || !username) {
            toast.error('Please fill in all fields');
            return;
        }
        if (!validate(roomId)) {
            toast.error('Invalid Room ID');
            return;
        }
        saveRecentRoom(roomId, username);
        navigate(`/room/${roomId}`, { state: { username } });
    };

    const handleCreate = () => {
        const newId = uuidv4();
        setCreatedRoomId(newId);
        toast.success('Room ID generated!');
    };

    const handleEnterRoom = (e) => {
        e.preventDefault();
        if (!createdRoomId || !createUsername) {
            toast.error('Please enter a username and generate a room ID');
            return;
        }
        saveRecentRoom(createdRoomId, createUsername);
        navigate(`/room/${createdRoomId}`, { state: { username: createUsername } });
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Room ID copied to clipboard!');
        setTimeout(() => setCopied(false), 2000);
    };

    const joinRecentRoom = (room) => {
        navigate(`/room/${room.id}`, { state: { username: room.username } });
    };

    const features = [
        {
            icon: Code2,
            title: "Collaborative IDE",
            description: "Real-time code editing with syntax highlighting for multiple languages",
            gradient: "from-blue-500 to-cyan-500"
        },
        {
            icon: Video,
            title: "Video Conferencing",
            description: "High-quality video calls with screen sharing capabilities",
            gradient: "from-purple-500 to-pink-500"
        },
        {
            icon: MessageSquare,
            title: "Live Chat",
            description: "Instant messaging with your team members in real-time",
            gradient: "from-green-500 to-emerald-500"
        },
        {
            icon: PenTool,
            title: "Whiteboard",
            description: "Draw, sketch, and brainstorm ideas together visually",
            gradient: "from-orange-500 to-red-500"
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-white flex items-center justify-center p-4">
            {/* Animated background elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
            </div>

            <div className="relative z-10 w-full max-w-2xl">
                {/* Main Action Card */}
                <div className="animate-scale-in">
                    <Card className="border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden">
                        <Tabs defaultValue="join" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 bg-white/5 p-1 rounded-none">
                                <TabsTrigger value="join" className="data-[state=active]:bg-blue-600/80 data-[state=active]:text-white transition-all duration-300">
                                    Join Room
                                </TabsTrigger>
                                <TabsTrigger value="create" className="data-[state=active]:bg-purple-600/80 data-[state=active]:text-white transition-all duration-300">
                                    Create Room
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="join" className="p-6">
                                <CardHeader className="px-0 pt-0 pb-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Users className="text-blue-400" size={24} />
                                        <CardTitle className="text-2xl font-bold tracking-tight">Join a Room</CardTitle>
                                    </div>
                                    <CardDescription className="text-slate-400 text-base">
                                        Enter the Room ID shared by your team to start collaborating
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-0 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="room-id" className="text-sm font-medium text-slate-300 ml-1">Room ID</Label>
                                        <Input
                                            id="room-id"
                                            placeholder="e.g. 123e4567-e89b-12d3..."
                                            value={roomId}
                                            onChange={(e) => setRoomId(e.target.value)}
                                            className="bg-white/5 border-white/10 focus:border-blue-500 h-12 text-base transition-all duration-300"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="username" className="text-sm font-medium text-slate-300 ml-1">Your Name</Label>
                                        <Input
                                            id="username"
                                            placeholder="Enter your name"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="bg-white/5 border-white/10 focus:border-blue-500 h-12 text-base transition-all duration-300"
                                        />
                                    </div>
                                </CardContent>
                                <CardFooter className="px-0 pt-6">
                                    <Button
                                        onClick={handleJoin}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-7 text-lg shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all duration-300"
                                    >
                                        Join Codespace <ArrowRight size={20} className="ml-2" />
                                    </Button>
                                </CardFooter>
                            </TabsContent>

                            <TabsContent value="create" className="p-6">
                                <CardHeader className="px-0 pt-0 pb-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Sparkles className="text-purple-400" size={24} />
                                        <CardTitle className="text-2xl font-bold tracking-tight">Create a Room</CardTitle>
                                    </div>
                                    <CardDescription className="text-slate-400 text-base">
                                        Generate a new secure environment for your team
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-0 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="new-username" className="text-sm font-medium text-slate-300 ml-1">Your Name</Label>
                                        <Input
                                            id="new-username"
                                            placeholder="Enter your name"
                                            value={createUsername}
                                            onChange={(e) => setCreateUsername(e.target.value)}
                                            className="bg-white/5 border-white/10 focus:border-purple-500 h-12 text-base transition-all duration-300"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="generated-id" className="text-sm font-medium text-slate-300 ml-1">Room ID</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="generated-id"
                                                readOnly
                                                value={createdRoomId}
                                                placeholder="Click generate to create an ID"
                                                className="bg-white/5 border-white/10 font-mono text-sm h-12 flex-1"
                                            />
                                            {createdRoomId && (
                                                <Button
                                                    onClick={() => copyToClipboard(createdRoomId)}
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-12 w-12 border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                                                >
                                                    {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        onClick={handleCreate}
                                        variant="outline"
                                        className="w-full border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 h-11 transition-all duration-300"
                                    >
                                        Generate Secure ID
                                    </Button>
                                </CardContent>
                                <CardFooter className="px-0 pt-6">
                                    <Button
                                        onClick={handleEnterRoom}
                                        disabled={!createdRoomId}
                                        className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-7 text-lg shadow-[0_0_20px_rgba(147,51,234,0.3)] transition-all duration-300 disabled:opacity-50"
                                    >
                                        Launch Codespace <ArrowRight size={20} className="ml-2" />
                                    </Button>
                                </CardFooter>
                            </TabsContent>
                        </Tabs>
                    </Card>
                </div>

                {/* Recent Rooms */}
                {recentRooms.length > 0 && (
                    <div className="mt-12 animate-slide-in-up" style={{ animationDelay: '200ms' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-400">
                                <Clock size={18} />
                                Recent Activity
                            </h3>
                            <span className="text-xs text-slate-500 uppercase tracking-widest">Last 5 Rooms</span>
                        </div>
                        <div className="space-y-3">
                            {recentRooms.map((room) => (
                                <div
                                    key={room.id}
                                    className="group relative border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-white/20 transition-all duration-300 rounded-xl cursor-pointer p-4 flex items-center justify-between"
                                    onClick={() => joinRecentRoom(room)}
                                >
                                    <div className="flex-1">
                                        <p className="font-mono text-xs text-blue-400 mb-1 tracking-tight">{room.id}</p>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white">{room.username}</span>
                                            <span className="text-[10px] text-slate-500">•</span>
                                            <span className="text-xs text-slate-500">{new Date(room.timestamp).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={(e) => deleteRoom(room.id, e)}
                                            className="p-2 rounded-lg hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                                            title="Remove from history"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <ArrowRight size={18} className="text-slate-600 group-hover:text-white transition-colors" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Home;
