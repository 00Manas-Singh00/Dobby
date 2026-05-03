import React, { useState } from 'react';
import { Copy, Check, LogOut, Users, ChevronDown, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const themes = [
    { value: "vs-dark", label: "Dark" },
    { value: "vs-light", label: "Light" },
    { value: "hc-black", label: "High Contrast" },
];

const WorkspaceHeader = ({ roomId, username, users = [], theme = 'vs-dark', onThemeChange }) => {
    const [copied, setCopied] = useState(false);
    const [showUsers, setShowUsers] = useState(false);
    const navigate = useNavigate();

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
        <header className="h-14 border-b border-slate-800 flex items-center px-6 justify-between bg-slate-900/95 backdrop-blur-sm relative z-20">
            {/* Left: Room Info */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 glass-dark rounded-lg px-3 py-1.5">
                    <span className="text-xs text-slate-400 font-medium">Room:</span>
                    <code className="text-xs text-blue-300 font-mono">{roomId.slice(0, 8)}...</code>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-white/10"
                        onClick={copyRoomId}
                    >
                        {copied ? (
                            <Check size={14} className="text-green-400" />
                        ) : (
                            <Copy size={14} className="text-slate-400" />
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
                        className="flex items-center gap-2 glass-dark rounded-lg px-3 py-1.5 hover:bg-slate-800/50 transition-colors"
                    >
                        <Users size={16} className="text-slate-400" />
                        <span className="text-sm text-slate-300">{users.length}</span>
                        <ChevronDown size={14} className={cn(
                            "text-slate-400 transition-transform",
                            showUsers && "rotate-180"
                        )} />
                    </button>

                    {showUsers && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowUsers(false)}
                            />
                            <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-20 py-2">
                                <div className="px-3 py-2 border-b border-slate-700">
                                    <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                                        Active Users ({users.length})
                                    </p>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {users.map((user, index) => (
                                        <div
                                            key={index}
                                            className="px-3 py-2 hover:bg-slate-700/50 flex items-center gap-2"
                                        >
                                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                            <span className="text-sm text-slate-200">{user}</span>
                                            {user === username && (
                                                <span className="ml-auto text-xs text-blue-400">(You)</span>
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
                    <SelectTrigger className="w-[130px] bg-slate-800 border-slate-700 text-white h-8 hover:bg-slate-700 transition-colors">
                        <div className="flex items-center gap-2">
                            <Palette size={14} />
                            <SelectValue placeholder="Theme" />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                        {themes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Current User */}
                <div className="flex items-center gap-2 glass-dark rounded-lg px-3 py-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-sm text-slate-300 font-medium">{username}</span>
                </div>

                {/* Leave Button */}
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
    );
};

export default WorkspaceHeader;
