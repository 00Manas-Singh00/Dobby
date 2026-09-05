import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Crown, Circle } from 'lucide-react';

const UserList = ({ socket }) => {
    const [users, setUsers] = useState([]);

    useEffect(() => {
        if (!socket) return;

        socket.on("updating client list", ({ userslist }) => {
            setUsers(userslist);
        });

        return () => {
            socket.off("updating client list");
        };
    }, [socket]);

    const getAvatarColor = (name) => {
        const colors = [
            'bg-[#00E5FF]',
            'bg-[#FF4081]',
            'bg-[#FFEB3B]',
            'bg-[#f8f9fa]',
            'bg-[#e0e0e0]'
        ];
        const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
        return colors[index];
    };

    return (
        <div className="p-6 h-full bg-white font-mono">
            <div className="mb-6 animate-slide-in-down">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-black uppercase tracking-widest flex items-center gap-2">
                        <Circle size={10} className="text-[#00E5FF] fill-[#00E5FF] stroke-[3]" />
                        Active Users
                    </h3>
                    <span className="px-3 py-1 bg-[#00E5FF] text-black text-xs font-black uppercase tracking-widest border-4 border-black neo-shadow-sm">
                        {users.length}
                    </span>
                </div>
                <div className="h-1 bg-black w-full" />
            </div>

            {users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                    <div className="w-16 h-16 border-4 border-black bg-[#FFEB3B] flex items-center justify-center mb-4 neo-shadow-sm">
                        <Crown size={32} className="text-black stroke-[3]" />
                    </div>
                    <p className="text-black text-lg font-black uppercase tracking-widest mb-2">No users yet</p>
                    <p className="text-black font-bold">Waiting for participants...</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {users.map((user, index) => (
                        <div
                            key={index}
                            className="group flex items-center gap-4 p-4 bg-white hover:bg-[#FFEB3B] border-4 border-black transition-none cursor-pointer animate-slide-in-left neo-shadow-sm hover:neo-shadow-hover"
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            <Avatar className="h-12 w-12 border-4 border-black rounded-none neo-shadow-sm">
                                <AvatarFallback className={`${getAvatarColor(user)} text-black font-black uppercase text-sm`}>
                                    {user.substring(0, 2)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-base font-black text-black uppercase tracking-widest truncate">
                                        {user}
                                    </span>
                                    {index === 0 && (
                                        <Crown size={16} className="text-black stroke-[3] flex-shrink-0" title="Room Host" />
                                    )}
                                </div>
                                <p className="text-xs font-bold text-black uppercase tracking-widest mt-1">
                                    {index === 0 ? 'Host' : 'Participant'}
                                </p>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-4 h-4 border-2 border-black bg-[#00E5FF] neo-shadow-sm" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default UserList;
