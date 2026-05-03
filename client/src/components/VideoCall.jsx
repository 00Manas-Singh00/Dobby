import React, { useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, MonitorUp } from 'lucide-react';

const VideoCall = ({ socket, roomId, username }) => {
    const [peers, setPeers] = useState([]);
    const [stream, setStream] = useState(null);
    const [muted, setMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(false);

    const userVideo = useRef();
    const peersRef = useRef([]);

    useEffect(() => {
        if (!socket) return;

        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(currentStream => {
            setStream(currentStream);
            if (userVideo.current) {
                userVideo.current.srcObject = currentStream;
            }

            socket.emit("join video", { roomId });

            socket.on("all users video", users => {
                const peers = [];
                users.forEach(userID => {
                    const peer = createPeer(userID, socket.id, currentStream);
                    peersRef.current.push({
                        peerID: userID,
                        peer,
                    });
                    peers.push({
                        peerID: userID,
                        peer,
                    });
                });
                setPeers(peers);
            });

            socket.on("user joined video", payload => {
                const peer = addPeer(payload.signal, payload.callerID, currentStream);
                peersRef.current.push({
                    peerID: payload.callerID,
                    peer,
                });
                setPeers(users => [...users, { peerID: payload.callerID, peer }]);
            });

            socket.on("receiving returned signal", payload => {
                const item = peersRef.current.find(p => p.peerID === payload.id);
                item.peer.signal(payload.signal);
            });
        }).catch(err => {
            console.error("Error accessing media devices:", err);
        });

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            socket.off("all users video");
            socket.off("user joined video");
            socket.off("receiving returned signal");
        };
    }, []);

    function createPeer(userToSignal, callerID, stream) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream,
        });

        peer.on("signal", signal => {
            socket.emit("sending signal", { userToSignal, callerID, signal });
        });

        return peer;
    }

    function addPeer(incomingSignal, callerID, stream) {
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream,
        });

        peer.on("signal", signal => {
            socket.emit("returning signal", { signal, callerID });
        });

        peer.signal(incomingSignal);

        return peer;
    }

    const toggleMute = () => {
        if (stream) {
            setMuted(!muted);
            stream.getAudioTracks()[0].enabled = !stream.getAudioTracks()[0].enabled;
        }
    };

    const toggleVideo = () => {
        if (stream) {
            setVideoOff(!videoOff);
            stream.getVideoTracks()[0].enabled = !stream.getVideoTracks()[0].enabled;
        }
    };

    return (
        <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 to-slate-950 p-4 overflow-y-auto">
            {/* Video Grid */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
                {/* User's own video */}
                <div className="relative aspect-video bg-slate-800 rounded-xl overflow-hidden border-2 border-blue-500/30 shadow-xl shadow-blue-500/10 animate-scale-in">
                    <video
                        ref={userVideo}
                        muted
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                    />
                    {videoOff && (
                        <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <span className="text-2xl font-bold text-white">
                                    {username.substring(0, 2).toUpperCase()}
                                </span>
                            </div>
                        </div>
                    )}
                    <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg glass-dark backdrop-blur-xl">
                        <span className="text-sm text-white font-medium">You ({username})</span>
                    </div>
                    <div className="absolute bottom-3 right-3 flex gap-2">
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-9 w-9 rounded-full transition-all ${muted
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'glass hover:bg-white/20 text-white'
                                }`}
                            onClick={toggleMute}
                        >
                            {muted ? <MicOff size={16} /> : <Mic size={16} />}
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-9 w-9 rounded-full transition-all ${videoOff
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'glass hover:bg-white/20 text-white'
                                }`}
                            onClick={toggleVideo}
                        >
                            {videoOff ? <VideoOff size={16} /> : <Video size={16} />}
                        </Button>
                    </div>
                </div>

                {/* Peer videos */}
                {peers.map((peerObj, index) => (
                    <VideoItem key={peerObj.peerID} peer={peerObj.peer} index={index} />
                ))}

                {/* Empty state if no peers */}
                {peers.length === 0 && (
                    <div className="aspect-video bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700 border-dashed flex flex-col items-center justify-center animate-fade-in">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-3">
                            <Video size={24} className="text-purple-400" />
                        </div>
                        <p className="text-slate-400 text-sm font-medium">Waiting for others to join...</p>
                        <p className="text-slate-500 text-xs mt-1">Invite team members to start video chat</p>
                    </div>
                )}
            </div>

            {/* Control Bar */}
            <div className="mt-4 flex justify-center gap-3 p-3 glass rounded-2xl border border-white/10">
                <Button
                    variant="outline"
                    className="gap-2 border-slate-700 bg-slate-800/50 hover:bg-slate-800"
                >
                    <MonitorUp size={18} />
                    <span className="hidden sm:inline">Share Screen</span>
                </Button>
            </div>
        </div>
    );
};

const VideoItem = ({ peer, index }) => {
    const ref = useRef();
    const [userName, setUserName] = useState(`Participant ${index + 1}`);

    useEffect(() => {
        peer.on("stream", stream => {
            ref.current.srcObject = stream;
        });
    }, [peer]);

    return (
        <div className="relative aspect-video bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-xl animate-scale-in" style={{ animationDelay: `${index * 100}ms` }}>
            <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg glass-dark backdrop-blur-xl">
                <span className="text-sm text-white font-medium">{userName}</span>
            </div>
        </div>
    );
};

export default VideoCall;
