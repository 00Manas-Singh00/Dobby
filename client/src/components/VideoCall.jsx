import { useEffect, useRef, useState } from 'react';
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

    function createPeer(userToSignal, callerID, stream) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream,
        });

        peer.on("signal", signal => {
            // roomId scopes the relay: the server only forwards a signal to a
            // socket that is in the same room as the sender.
            socket.emit("sending signal", { roomId, userToSignal, callerID, signal });
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
            socket.emit("returning signal", { roomId, signal, callerID });
        });

        peer.signal(incomingSignal);

        return peer;
    }

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
        <div className="flex flex-col h-full bg-white p-4 overflow-y-auto font-mono">
            {/* Video Grid */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
                {/* User's own video */}
                <div className="relative aspect-video bg-[#00E5FF] rounded-none overflow-hidden border-4 border-black neo-shadow-sm animate-scale-in">
                    <video
                        ref={userVideo}
                        muted
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                    />
                    {videoOff && (
                        <div className="absolute inset-0 bg-[#00E5FF] flex items-center justify-center">
                            <div className="w-24 h-24 border-4 border-black bg-white flex items-center justify-center neo-shadow-sm">
                                <span className="text-3xl font-black text-black">
                                    {username.substring(0, 2).toUpperCase()}
                                </span>
                            </div>
                        </div>
                    )}
                    <div className="absolute bottom-4 left-4 px-4 py-2 bg-white border-4 border-black rounded-none neo-shadow-sm">
                        <span className="text-sm text-black font-black uppercase tracking-widest">You ({username})</span>
                    </div>
                    <div className="absolute bottom-4 right-4 flex gap-3">
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-12 w-12 border-4 border-black rounded-none transition-none neo-shadow-sm hover:neo-shadow-hover ${muted
                                    ? 'bg-[#FF4081] text-black hover:bg-[#F50057]'
                                    : 'bg-white text-black hover:bg-[#FFEB3B]'
                                }`}
                            onClick={toggleMute}
                        >
                            {muted ? <MicOff size={24} className="stroke-[3]" /> : <Mic size={24} className="stroke-[3]" />}
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className={`h-12 w-12 border-4 border-black rounded-none transition-none neo-shadow-sm hover:neo-shadow-hover ${videoOff
                                    ? 'bg-[#FF4081] text-black hover:bg-[#F50057]'
                                    : 'bg-white text-black hover:bg-[#FFEB3B]'
                                }`}
                            onClick={toggleVideo}
                        >
                            {videoOff ? <VideoOff size={24} className="stroke-[3]" /> : <Video size={24} className="stroke-[3]" />}
                        </Button>
                    </div>
                </div>

                {/* Peer videos */}
                {peers.map((peerObj, index) => (
                    <VideoItem key={peerObj.peerID} peer={peerObj.peer} index={index} />
                ))}

                {/* Empty state if no peers */}
                {peers.length === 0 && (
                    <div className="aspect-video bg-white rounded-none border-4 border-black border-dashed flex flex-col items-center justify-center animate-fade-in neo-shadow-sm">
                        <div className="w-20 h-20 bg-[#FFEB3B] border-4 border-black flex items-center justify-center mb-4 neo-shadow-sm">
                            <Video size={36} className="text-black stroke-[3]" />
                        </div>
                        <p className="text-black text-xl font-black uppercase tracking-widest">Waiting for others</p>
                        <p className="text-black font-bold mt-2">Invite team members to start video chat</p>
                    </div>
                )}
            </div>

            {/* Control Bar */}
            <div className="mt-6 flex justify-center gap-3 p-4 bg-[#FFEB3B] border-4 border-black rounded-none neo-shadow-sm">
                <Button
                    variant="outline"
                    className="gap-2 border-4 border-black bg-white hover:bg-[#00E5FF] text-black font-black uppercase tracking-widest rounded-none transition-none h-12 px-6 neo-shadow-sm hover:neo-shadow-hover"
                >
                    <MonitorUp size={20} className="stroke-[3]" />
                    <span className="hidden sm:inline">Share Screen</span>
                </Button>
            </div>
        </div>
    );
};

const VideoItem = ({ peer, index }) => {
    const ref = useRef();
    const [userName] = useState(`Participant ${index + 1}`);

    useEffect(() => {
        peer.on("stream", stream => {
            ref.current.srcObject = stream;
        });
    }, [peer]);

    return (
        <div className="relative aspect-video bg-[#00E5FF] rounded-none overflow-hidden border-4 border-black neo-shadow-sm animate-scale-in" style={{ animationDelay: `${index * 100}ms` }}>
            <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-4 left-4 px-4 py-2 rounded-none bg-white border-4 border-black neo-shadow-sm">
                <span className="text-sm text-black font-black uppercase tracking-widest">{userName}</span>
            </div>
        </div>
    );
};

export default VideoCall;
