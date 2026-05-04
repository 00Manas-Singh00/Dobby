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
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative" style={{ backgroundImage: 'radial-gradient(#000 2px, transparent 2px)', backgroundSize: '32px 32px' }}>

            <div className="relative z-10 w-full max-w-2xl mt-12">
                {/* Main Action Card */}
                <div className="animate-scale-in">
                    <Card className="border-4 border-border bg-background neo-shadow overflow-hidden rounded-none">
                        <Tabs defaultValue="join" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 bg-background border-b-4 border-border p-0 rounded-none h-14">
                                <TabsTrigger value="join" className="data-[state=active]:bg-accent data-[state=active]:text-foreground text-foreground font-black uppercase tracking-widest border-r-4 border-transparent data-[state=active]:border-border rounded-none h-full transition-none">
                                    Join Room
                                </TabsTrigger>
                                <TabsTrigger value="create" className="data-[state=active]:bg-primary data-[state=active]:text-foreground text-foreground font-black uppercase tracking-widest rounded-none h-full transition-none">
                                    Create Room
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="join" className="p-6">
                                <CardHeader className="px-0 pt-0 pb-6 border-b-4 border-border mb-6">
                                    <div className="flex items-center gap-2 mb-2 p-6 pb-0">
                                        <Users className="text-foreground stroke-[3]" size={28} />
                                        <CardTitle className="text-3xl font-black tracking-tight text-foreground uppercase">Join a Room</CardTitle>
                                    </div>
                                    <CardDescription className="text-foreground font-bold text-base px-6">
                                        Enter the Room ID shared by your team to start collaborating
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-6 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="room-id" className="text-sm font-black text-foreground ml-1 uppercase tracking-widest">Room ID</Label>
                                        <Input
                                            id="room-id"
                                            placeholder="e.g. 123e4567-e89b-12d3..."
                                            value={roomId}
                                            onChange={(e) => setRoomId(e.target.value)}
                                            className="bg-background border-4 border-border neo-shadow-sm h-14 text-lg font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-background rounded-none"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="username" className="text-sm font-black text-foreground ml-1 uppercase tracking-widest">Your Name</Label>
                                        <Input
                                            id="username"
                                            placeholder="Enter your name"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="bg-background border-4 border-border neo-shadow-sm h-14 text-lg font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-background rounded-none"
                                        />
                                    </div>
                                </CardContent>
                                <CardFooter className="px-6 pt-6 pb-6">
                                    <Button
                                        onClick={handleJoin}
                                        className="w-full bg-accent hover:opacity-90 text-foreground font-black py-8 text-xl uppercase tracking-widest border-4 border-border neo-shadow-hover rounded-none transition-none"
                                    >
                                        Join Codespace <ArrowRight size={24} className="ml-2 stroke-[3]" />
                                    </Button>
                                </CardFooter>
                            </TabsContent>

                            <TabsContent value="create" className="p-6">
                                <CardHeader className="px-0 pt-0 pb-6 border-b-4 border-border mb-6 bg-primary">
                                    <div className="flex items-center gap-2 mb-2 p-6 pb-0">
                                        <Sparkles className="text-foreground stroke-[3]" size={28} />
                                        <CardTitle className="text-3xl font-black tracking-tight text-foreground uppercase">Create a Room</CardTitle>
                                    </div>
                                    <CardDescription className="text-foreground font-bold text-base px-6">
                                        Generate a new secure environment for your team
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-6 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="new-username" className="text-sm font-black text-foreground ml-1 uppercase tracking-widest">Your Name</Label>
                                        <Input
                                            id="new-username"
                                            placeholder="Enter your name"
                                            value={createUsername}
                                            onChange={(e) => setCreateUsername(e.target.value)}
                                            className="bg-background border-4 border-border neo-shadow-sm h-14 text-lg font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-background rounded-none"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="generated-id" className="text-sm font-black text-foreground ml-1 uppercase tracking-widest">Room ID</Label>
                                        <div className="flex gap-4">
                                            <Input
                                                id="generated-id"
                                                readOnly
                                                value={createdRoomId}
                                                placeholder="Click generate to create an ID"
                                                className="bg-background border-4 border-border neo-shadow-sm font-mono text-sm h-14 flex-1 rounded-none text-foreground"
                                            />
                                            {createdRoomId && (
                                                <Button
                                                    onClick={() => copyToClipboard(createdRoomId)}
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-14 w-14 border-4 border-border bg-primary neo-shadow-hover rounded-none transition-none"
                                                >
                                                    {copied ? <Check size={24} className="text-foreground stroke-[3]" /> : <Copy size={24} className="stroke-[3]" />}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        onClick={handleCreate}
                                        variant="outline"
                                        className="w-full border-4 border-border bg-secondary text-foreground hover:opacity-90 neo-shadow-hover h-14 text-lg font-black uppercase tracking-widest rounded-none transition-none"
                                    >
                                        Generate Secure ID
                                    </Button>
                                </CardContent>
                                <CardFooter className="px-6 pt-6 pb-6">
                                    <Button
                                        onClick={handleEnterRoom}
                                        disabled={!createdRoomId}
                                        className="w-full bg-primary hover:opacity-90 text-foreground font-black py-8 text-xl uppercase tracking-widest border-4 border-border neo-shadow-hover rounded-none transition-none disabled:opacity-50 disabled:neo-shadow-sm"
                                    >
                                        Launch Codespace <ArrowRight size={24} className="ml-2 stroke-[3]" />
                                    </Button>
                                </CardFooter>
                            </TabsContent>
                        </Tabs>
                    </Card>
                </div>

                {/* Recent Rooms */}
                {recentRooms.length > 0 && (
                    <div className="mt-12 animate-slide-in-up" style={{ animationDelay: '200ms' }}>
                        <div className="flex items-center justify-between mb-4 border-b-4 border-border pb-2 bg-background px-4 py-2 neo-shadow-sm">
                            <h3 className="text-lg font-black flex items-center gap-2 text-foreground uppercase">
                                <Clock size={20} className="stroke-[3]" />
                                Recent Activity
                            </h3>
                            <span className="text-xs text-foreground font-bold uppercase tracking-widest">Last 5 Rooms</span>
                        </div>
                        <div className="space-y-4">
                            {recentRooms.map((room) => (
                                <div
                                    key={room.id}
                                    className="group relative border-4 border-border bg-background hover:bg-accent neo-shadow-sm hover:neo-shadow-hover transition-none rounded-none cursor-pointer p-4 flex items-center justify-between"
                                    onClick={() => joinRecentRoom(room)}
                                >
                                    <div className="flex-1">
                                        <p className="font-mono text-sm text-foreground font-bold mb-1 tracking-tight">{room.id}</p>
                                        <div className="flex items-center gap-2">
                                            <span className="text-base font-black text-foreground uppercase">{room.username}</span>
                                            <span className="text-xs text-foreground font-bold border-l-2 border-border pl-2">{new Date(room.timestamp).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button
                                            onClick={(e) => deleteRoom(room.id, e)}
                                            className="p-2 border-2 border-transparent hover:border-border hover:bg-secondary text-foreground transition-none opacity-0 group-hover:opacity-100"
                                            title="Remove from history"
                                        >
                                            <Trash2 size={20} className="stroke-[3]" />
                                        </button>
                                        <ArrowRight size={24} className="text-foreground stroke-[3] group-hover:translate-x-1 transition-transform" />
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
