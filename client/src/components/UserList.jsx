import React, { useEffect, useState } from 'react';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Crown, Circle } from 'lucide-react';

const UserList = ({ socket, roomId }) => {
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
            'from-blue-500 to-cyan-500',
            'from-purple-500 to-pink-500',
            'from-green-500 to-emerald-500',
            'from-orange-500 to-red-500',
            'from-indigo-500 to-blue-500',
            'from-rose-500 to-pink-500',
            'from-teal-500 to-emerald-500',
            'from-amber-500 to-orange-500'
        ];
        const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
        return colors[index];
    };

    return (
        <div className="p-6 h-full bg-gradient-to-b from-slate-900/30 to-transparent">
            <div className="mb-6 animate-slide-in-down">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Circle size={8} className="text-green-400 fill-green-400 animate-pulse" />
                        Active Users
                    </h3>
                    <span className="px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/30">
                        {users.length}
                    </span>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
            </div>

            {users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center mb-4 border border-slate-700">
                        <Crown size={24} className="text-slate-500" />
                    </div>
                    <p className="text-slate-400 text-sm font-medium mb-1">No users yet</p>
                    <p className="text-slate-500 text-xs">Waiting for participants...</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {users.map((user, index) => (
                        <div
                            key={index}
                            className="group flex items-center gap-3 p-3 rounded-xl bg-slate-800/30 hover:bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300 cursor-pointer animate-slide-in-left"
                            style={{ animationDelay: `${index * 50}ms` }}
                        >
                            <Avatar className="h-10 w-10 ring-2 ring-slate-700 group-hover:ring-blue-500/50 transition-all duration-300">
                                <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(user)} text-white font-bold text-sm`}>
                                    {user.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors">
                                        {user}
                                    </span>
                                    {index === 0 && (
                                        <Crown size={14} className="text-yellow-500 flex-shrink-0" title="Room Host" />
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors">
                                    {index === 0 ? 'Host' : 'Participant'}
                                </p>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default UserList;
