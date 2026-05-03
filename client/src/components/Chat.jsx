import React, { useEffect, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Smile } from 'lucide-react';

const Chat = ({ socket, roomId, username }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (!socket) return;

        socket.on("receive_message", (messageData) => {
            setMessages((prev) => [...prev, messageData]);
        });

        return () => {
            socket.off("receive_message");
        };
    }, [socket]);

    const sendMessage = (e) => {
        e.preventDefault();
        if (input.trim() && socket) {
            const msgData = {
                message: input,
                roomId,
                username,
                timestamp: new Date().toISOString()
            };

            socket.emit("send_message", msgData);
            setMessages((prev) => [...prev, { ...msgData, user: username, messageId: 'temp-' + Date.now() }]);
            setInput("");
        }
    };

    const getAvatarColor = (name) => {
        const colors = [
            'from-blue-500 to-cyan-500',
            'from-purple-500 to-pink-500',
            'from-green-500 to-emerald-500',
            'from-orange-500 to-red-500',
            'from-indigo-500 to-blue-500',
            'from-rose-500 to-pink-500'
        ];
        const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
        return colors[index];
    };

    return (
        <div className="flex flex-col h-full bg-slate-900/30">
            {/* Messages Area */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-4">
                            <Send size={24} className="text-blue-400" />
                        </div>
                        <p className="text-slate-400 text-sm font-medium mb-1">No messages yet</p>
                        <p className="text-slate-500 text-xs">Start the conversation!</p>
                    </div>
                )}
                {messages.map((msg, index) => {
                    const isMe = msg.user === username;
                    return (
                        <div
                            key={index}
                            className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-slide-in-up`}
                        >
                            <div className={`flex items-end gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                <Avatar className="h-7 w-7 ring-2 ring-slate-700/50">
                                    <AvatarFallback className={`text-[10px] bg-gradient-to-br ${getAvatarColor(msg.user)} text-white font-bold`}>
                                        {msg.user.substring(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className={`relative group ${isMe ? 'mr-2' : 'ml-2'}`}>
                                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-lg ${isMe
                                            ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-sm'
                                            : 'bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700'
                                        }`}>
                                        {msg.message}
                                    </div>
                                </div>
                            </div>
                            <span className={`text-[10px] text-slate-500 mt-1 ${isMe ? 'mr-11' : 'ml-11'}`}>
                                {isMe ? 'You' : msg.user} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={sendMessage} className="p-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type a message..."
                            className="bg-slate-800 border-slate-700 focus:border-blue-500 pr-10 h-11 rounded-xl transition-colors"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-slate-700"
                        >
                            <Smile size={18} className="text-slate-400" />
                        </Button>
                    </div>
                    <Button
                        type="submit"
                        size="icon"
                        className="bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 h-11 w-11 rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30"
                        disabled={!input.trim()}
                    >
                        <Send size={18} />
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default Chat;
