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
            'bg-[#00E5FF]',
            'bg-[#FF4081]',
            'bg-[#FFEB3B]',
            'bg-white',
        ];
        const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
        return colors[index];
    };

    return (
        <div className="flex flex-col h-full bg-[#f8f9fa] font-mono">
            {/* Messages Area */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in">
                        <div className="w-16 h-16 border-4 border-black bg-[#FFEB3B] flex items-center justify-center mb-4 neo-shadow-sm">
                            <Send size={32} className="text-black stroke-[3]" />
                        </div>
                        <p className="text-black text-xl font-black mb-2 uppercase tracking-widest">No messages yet</p>
                        <p className="text-black font-bold">Start the conversation!</p>
                    </div>
                )}
                {messages.map((msg, index) => {
                    const isMe = msg.user === username;
                    return (
                        <div
                            key={index}
                            className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-slide-in-up`}
                        >
                            <div className={`flex items-end gap-3 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                <Avatar className="h-10 w-10 border-4 border-black rounded-none neo-shadow-sm">
                                    <AvatarFallback className={`text-sm ${getAvatarColor(msg.user)} text-black font-black uppercase`}>
                                        {msg.user.substring(0, 2)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className={`relative group ${isMe ? 'mr-1' : 'ml-1'}`}>
                                    <div className={`px-4 py-3 rounded-none text-base font-bold leading-relaxed border-4 border-black neo-shadow-sm ${isMe
                                            ? 'bg-[#00E5FF] text-black'
                                            : 'bg-white text-black'
                                        }`}>
                                        {msg.message}
                                    </div>
                                </div>
                            </div>
                            <span className={`text-xs text-black font-black uppercase mt-2 ${isMe ? 'mr-14' : 'ml-14'}`}>
                                {isMe ? 'You' : msg.user} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={sendMessage} className="p-4 border-t-4 border-black bg-white">
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type a message..."
                            className="bg-white border-4 border-black focus:ring-0 focus:outline-none focus:bg-[#FFEB3B] pr-12 h-14 rounded-none transition-none text-base font-bold text-black neo-shadow-sm placeholder-gray-500"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 hover:bg-[#00E5FF] border-2 border-transparent hover:border-black rounded-none transition-none"
                        >
                            <Smile size={24} className="text-black stroke-[3]" />
                        </Button>
                    </div>
                    <Button
                        type="submit"
                        size="icon"
                        className="bg-[#FF4081] hover:bg-[#F50057] text-black border-4 border-black h-14 w-14 rounded-none neo-shadow-sm hover:neo-shadow-hover transition-none"
                        disabled={!input.trim()}
                    >
                        <Send size={24} className="stroke-[3] -ml-1" />
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default Chat;
