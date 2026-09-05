import { useState } from 'react';
import { Check, LogOut, Users, ChevronDown, Palette, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createInvite, inviteUrl } from '@/services/roomService';

const themes = [
    { value: "vs-dark", label: "Dark" },
    { value: "vs-light", label: "Light" },
    { value: "hc-black", label: "High Contrast" },
];

const WorkspaceHeader = ({ roomId, roomName, username, users = [], theme = 'vs-dark', onThemeChange }) => {
    const [copied, setCopied] = useState(false);
    const [showUsers, setShowUsers] = useState(false);
    const navigate = useNavigate();

    // The room id is no longer a credential, so copying it would share nothing.
    // Inviting someone means minting a single-use token for them.
    const copyInviteLink = async () => {
        try {
            const invite = await createInvite(roomId);
            await navigator.clipboard.writeText(inviteUrl(invite.token));
            setCopied(true);
            toast.success('Invite link copied — single use, expires in 24 hours.');
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            toast.error(error.message || 'Could not create an invite.');
        }
    };

    const handleLeave = () => {
        navigate('/home');
        toast.info('You left the room');
    };

    return (
        <header className="h-16 border-b-4 border-black flex items-center px-6 justify-between bg-white relative z-20 font-mono">
            {/* Left: Room Info */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-[#f8f9fa] border-4 border-black neo-shadow-sm px-4 py-2 rounded-none">
                    <span className="text-sm text-black font-black uppercase tracking-widest">Room:</span>
                    <code className="text-sm text-black font-bold bg-[#FFEB3B] px-2 py-1 border-2 border-black max-w-[16rem] truncate">
                        {roomName || `${roomId.slice(0, 8)}…`}
                    </code>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-[#00E5FF] border-2 border-transparent hover:border-black rounded-none transition-none ml-2"
                        onClick={copyInviteLink}
                        title="Copy an invite link"
                    >
                        {copied ? (
                            <Check size={18} className="text-black stroke-[3]" />
                        ) : (
                            <Share2 size={18} className="text-black stroke-[3]" />
                        )}
                    </Button>
                </div>
            </div>

            {/* Right: User Info & Actions */}
            <div className="flex items-center gap-4">
                {/* User List Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => setShowUsers(!showUsers)}
                        className="flex items-center gap-2 bg-[#f8f9fa] border-4 border-black neo-shadow-sm hover:neo-shadow-hover px-4 py-2 rounded-none transition-none"
                    >
                        <Users size={20} className="text-black stroke-[3]" />
                        <span className="text-base font-black text-black">{users.length}</span>
                        <ChevronDown size={18} className={cn(
                            "text-black stroke-[3] transition-transform",
                            showUsers && "rotate-180"
                        )} />
                    </button>

                    {showUsers && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowUsers(false)}
                            />
                            <div className="absolute right-0 top-full mt-2 w-64 bg-white border-4 border-black neo-shadow z-20 py-0 rounded-none">
                                <div className="px-4 py-3 border-b-4 border-black bg-[#00E5FF]">
                                    <p className="text-sm text-black font-black uppercase tracking-wider">
                                        Active Users ({users.length})
                                    </p>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {users.map((user, index) => (
                                        <div
                                            key={index}
                                            className="px-4 py-3 hover:bg-[#FFEB3B] border-b border-black last:border-b-0 flex items-center gap-3 transition-none"
                                        >
                                            <div className="w-3 h-3 border-2 border-black bg-green-400 animate-pulse" />
                                            <span className="text-base font-bold text-black">{user}</span>
                                            {user === username && (
                                                <span className="ml-auto text-xs font-black text-black uppercase">(You)</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Theme Selector */}
                <Select value={theme} onValueChange={onThemeChange}>
                    <SelectTrigger className="w-[140px] bg-white border-4 border-black neo-shadow-sm text-black h-10 hover:bg-[#FFEB3B] transition-none rounded-none font-bold uppercase tracking-widest text-xs focus:ring-0 focus:ring-offset-0">
                        <div className="flex items-center gap-2">
                            <Palette size={16} className="stroke-[3]" />
                            <SelectValue placeholder="Theme" />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="bg-white border-4 border-black text-black rounded-none">
                        {themes.map((t) => (
                            <SelectItem key={t.value} value={t.value} className="hover:bg-[#00E5FF] font-bold text-sm rounded-none focus:bg-[#00E5FF] focus:text-black">
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Current User */}
                <div className="flex items-center gap-3 bg-[#f8f9fa] border-4 border-black neo-shadow-sm px-4 py-2 rounded-none">
                    <div className="w-3 h-3 border-2 border-black bg-green-400 animate-pulse" />
                    <span className="text-base text-black font-black uppercase tracking-widest">{username}</span>
                </div>

                {/* Leave Button */}
                <Button
                    onClick={handleLeave}
                    variant="ghost"
                    className="text-black font-black uppercase tracking-widest border-4 border-black bg-[#FF4081] hover:bg-[#F50057] hover:text-black neo-shadow-hover rounded-none h-10 px-6 gap-2 transition-none"
                >
                    <LogOut size={18} className="stroke-[3]" />
                    Leave
                </Button>
            </div>
        </header>
    );
};

export default WorkspaceHeader;
