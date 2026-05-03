import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

const FloatingVideoPlayer = ({ onExpand, socket, roomId, username }) => {
    const { videoState, updateVideoMiniPlayerPosition, updateVideoMiniPlayerSize, toggleVideoMute, toggleVideoCamera } = useWorkspace();
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const playerRef = useRef(null);

    const { miniPlayerPosition, miniPlayerSize, isMuted, isVideoOff } = videoState;

    const handleMouseDown = (e) => {
        if (e.target.closest('.control-button')) return; // Don't drag when clicking controls

        setIsDragging(true);
        setDragOffset({
            x: e.clientX - miniPlayerPosition.x,
            y: e.clientY - miniPlayerPosition.y,
        });
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            let newX = e.clientX - dragOffset.x;
            let newY = e.clientY - dragOffset.y;

            // Constrain to viewport
            const maxX = window.innerWidth - miniPlayerSize.width;
            const maxY = window.innerHeight - miniPlayerSize.height;

            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            // Snap to edges
            const snapThreshold = 20;
            if (newX < snapThreshold) newX = 0;
            if (newY < snapThreshold) newY = 0;
            if (newX > maxX - snapThreshold) newX = maxX;
            if (newY > maxY - snapThreshold) newY = maxY;

            updateVideoMiniPlayerPosition({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, dragOffset, miniPlayerSize, updateVideoMiniPlayerPosition]);

    return (
        <div
            ref={playerRef}
            className={cn(
                "fixed z-50 bg-slate-900 rounded-lg shadow-2xl border-2 border-slate-700 overflow-hidden group",
                isDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            style={{
                left: `${miniPlayerPosition.x}px`,
                top: `${miniPlayerPosition.y}px`,
                width: `${miniPlayerSize.width}px`,
                height: `${miniPlayerSize.height}px`,
            }}
            onMouseDown={handleMouseDown}
        >
            {/* Video Content - Placeholder for now */}
            <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <Video size={32} className="text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Video Call Active</p>
                </div>
            </div>

            {/* Controls Overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center justify-center gap-1">
                    <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                            "control-button h-7 w-7 hover:bg-white/10",
                            isMuted && "bg-red-500/20 text-red-400"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleVideoMute();
                        }}
                    >
                        {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                    </Button>

                    <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                            "control-button h-7 w-7 hover:bg-white/10",
                            isVideoOff && "bg-red-500/20 text-red-400"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleVideoCamera();
                        }}
                    >
                        {isVideoOff ? <VideoOff size={14} /> : <Video size={14} />}
                    </Button>

                    <Button
                        size="icon"
                        variant="ghost"
                        className="control-button h-7 w-7 hover:bg-white/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            onExpand();
                        }}
                    >
                        <Maximize2 size={14} />
                    </Button>
                </div>
            </div>

            {/* Resize Handle (corner) - simplified for now */}
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-blue-500/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
    );
};

export default FloatingVideoPlayer;
