/**
 * pages/Home.jsx
 * The room list.
 *
 * This used to be "type a username, paste a UUID". Rooms now belong to an
 * account: the list comes from the server, creating one makes you its owner,
 * and the only way another person gets in is an invite you mint for them.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
    listRooms,
    createRoom,
    createInvite,
    inviteUrl,
    deleteRoom,
    leaveRoom,
} from '@/services/roomService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Sparkles, ArrowRight, Check, Trash2, LogOut, Share2, Users } from 'lucide-react';

const Home = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [roomName, setRoomName] = useState('');
    const [creating, setCreating] = useState(false);
    const [copiedRoomId, setCopiedRoomId] = useState(null);

    const refresh = useCallback(async () => {
        try {
            setRooms(await listRooms());
        } catch (error) {
            toast.error(error.message || 'Could not load your rooms.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleCreate = async (event) => {
        event.preventDefault();
        setCreating(true);
        try {
            const room = await createRoom(roomName);
            setRoomName('');
            toast.success('Room created');
            navigate(`/room/${room.id}`);
        } catch (error) {
            toast.error(error.message || 'Could not create the room.');
        } finally {
            setCreating(false);
        }
    };

    const handleShare = async (room, event) => {
        event.stopPropagation();
        try {
            const invite = await createInvite(room.id);
            const url = inviteUrl(invite.token);
            await navigator.clipboard.writeText(url);
            setCopiedRoomId(room.id);
            setTimeout(() => setCopiedRoomId(null), 2000);
            toast.success('Invite link copied — it works once, and expires in 24 hours.');
        } catch (error) {
            toast.error(error.message || 'Could not create an invite.');
        }
    };

    const handleRemove = async (room, event) => {
        event.stopPropagation();
        const owned = room.role === 'owner';
        const confirmed = window.confirm(
            owned
                ? `Delete "${room.name}"? Its documents are deleted too, and this cannot be undone.`
                : `Leave "${room.name}"? You will need a new invite to return.`
        );
        if (!confirmed) return;

        try {
            if (owned) await deleteRoom(room.id);
            else await leaveRoom(room.id, user.id);
            toast.success(owned ? 'Room deleted' : 'Left the room');
            refresh();
        } catch (error) {
            toast.error(error.message || 'Could not complete that.');
        }
    };

    return (
        <div
            className="min-h-screen text-black relative overflow-x-hidden bg-[linear-gradient(180deg,#FFF8DB_0%,#FFE8F2_45%,#E7F7FF_100%)]"
            style={{
                backgroundImage:
                    'radial-gradient(#00000022 1px, transparent 1px), linear-gradient(180deg,#FFF8DB 0%,#FFE8F2 45%,#E7F7FF 100%)',
                backgroundSize: '26px 26px, auto',
            }}
        >
            <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
                {/* Account bar */}
                <div className="flex items-center justify-between gap-4 mb-8 border-4 border-black bg-white px-4 py-3 shadow-[6px_6px_0_0_#000]">
                    <div className="min-w-0">
                        <p className="font-black uppercase tracking-widest text-black truncate">
                            {user?.username}
                        </p>
                        <p className="text-xs font-bold text-black/60 truncate">{user?.email}</p>
                    </div>
                    <button
                        onClick={async () => {
                            await logout();
                            navigate('/signin', { replace: true });
                        }}
                        className="flex items-center gap-2 border-4 border-black bg-[#FFEB3B] hover:bg-[#ffd600] px-4 h-12 font-black uppercase tracking-widest text-black text-sm transition-none shrink-0"
                    >
                        <LogOut size={18} className="stroke-[3]" />
                        Sign out
                    </button>
                </div>

                {/* Create */}
                <Card className="border-4 border-black bg-[#fffdf5] neo-shadow overflow-hidden rounded-none shadow-[8px_8px_0_0_#000]">
                    <form onSubmit={handleCreate}>
                        <CardHeader className="px-0 pt-0 pb-6 border-b-4 border-black mb-6 bg-[#FFD6E5]">
                            <div className="flex items-center gap-2 mb-2 p-6 pb-0">
                                <Sparkles className="text-black stroke-[3]" size={28} />
                                <CardTitle className="text-3xl font-black tracking-tight text-black uppercase">
                                    New Room
                                </CardTitle>
                            </div>
                            <CardDescription className="text-black font-bold text-base px-6">
                                You own it. Share it with one person via an invite link.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-2 sm:px-6 pb-6 space-y-6">
                            <div className="space-y-3">
                                <Label htmlFor="room-name" className="text-sm font-black text-black ml-1 uppercase tracking-widest">
                                    Room name
                                </Label>
                                <Input
                                    id="room-name"
                                    placeholder="e.g. Backend interview"
                                    maxLength={80}
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    className="bg-white border-4 border-black neo-shadow-sm h-14 text-lg font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-[#FFF9C4] rounded-none"
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={creating}
                                className="w-full bg-[#FF4081] hover:bg-[#f50057] text-black font-black py-8 text-xl uppercase tracking-widest border-4 border-black neo-shadow-hover rounded-none transition-none disabled:opacity-50"
                            >
                                {creating ? 'Creating…' : 'Create Room'}
                                <ArrowRight size={24} className="ml-2 stroke-[3]" />
                            </Button>
                        </CardContent>
                    </form>
                </Card>

                {/* Room list */}
                <div className="mt-8 sm:mt-12">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 border-b-4 border-black pb-2 bg-white px-4 py-2 shadow-[4px_4px_0_0_#000]">
                        <h3 className="text-lg font-black flex items-center gap-2 text-black uppercase">
                            <Users size={20} className="stroke-[3]" />
                            Your Rooms
                        </h3>
                        <span className="text-xs text-black font-bold uppercase tracking-widest">
                            {rooms.length} total
                        </span>
                    </div>

                    {loading ? (
                        <p className="font-bold uppercase tracking-widest text-black/60 px-4 py-6">Loading…</p>
                    ) : rooms.length === 0 ? (
                        <p className="font-bold text-black/60 px-4 py-6">
                            No rooms yet. Create one above, or open an invite link someone sent you.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {rooms.map((room) => (
                                <div
                                    key={room.id}
                                    className="group relative border-4 border-black bg-white hover:bg-[#FFF9C4] shadow-[4px_4px_0_0_#000] transition-none rounded-none cursor-pointer p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                                    onClick={() => navigate(`/room/${room.id}`)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-black uppercase truncate">{room.name}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-black uppercase tracking-widest border-2 border-black px-2 py-0.5 bg-[#00E5FF]">
                                                {room.role}
                                            </span>
                                            <span className="text-xs text-black font-bold">
                                                Active {new Date(room.lastActiveAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                        {room.role === 'owner' && (
                                            <button
                                                onClick={(e) => handleShare(room, e)}
                                                className="p-2 border-2 border-black bg-[#FFEB3B] hover:bg-[#ffd600] text-black transition-none"
                                                title="Copy an invite link"
                                            >
                                                {copiedRoomId === room.id ? (
                                                    <Check size={20} className="stroke-[3]" />
                                                ) : (
                                                    <Share2 size={20} className="stroke-[3]" />
                                                )}
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => handleRemove(room, e)}
                                            className="p-2 border-2 border-transparent hover:border-black hover:bg-[#FF80AB] text-black transition-none"
                                            title={room.role === 'owner' ? 'Delete room' : 'Leave room'}
                                        >
                                            <Trash2 size={20} className="stroke-[3]" />
                                        </button>
                                        <ArrowRight size={24} className="text-black stroke-[3] group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Home;
