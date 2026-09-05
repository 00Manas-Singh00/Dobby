import { useState, useRef, useEffect } from 'react';
import { Maximize2, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

const FloatingVideoPlayer = ({ onExpand }) => {
    const { videoState, updateVideoMiniPlayerPosition, toggleVideoMute, toggleVideoCamera } = useWorkspace();
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
                "fixed z-50 bg-[#FFEB3B] rounded-none border-4 border-black neo-shadow overflow-hidden group font-mono",
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
            <div className="w-full h-full bg-white flex items-center justify-center">
                <div className="text-center">
                    <Video size={36} className="text-black stroke-[3] mx-auto mb-2" />
                    <p className="text-xs font-black text-black uppercase tracking-widest">Video Call</p>
                </div>
            </div>

            {/* Controls Overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t-4 border-black p-2 opacity-0 group-hover:opacity-100 transition-none flex justify-center items-center gap-2">
                <div className="flex items-center justify-center gap-1">
                    <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                            "control-button h-8 w-8 hover:bg-[#FFEB3B] border-2 border-transparent hover:border-black rounded-none transition-none",
                            isMuted && "bg-[#FF4081] text-black hover:bg-[#F50057]"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleVideoMute();
                        }}
                    >
                        {isMuted ? <MicOff size={16} className="stroke-[3] text-black" /> : <Mic size={16} className="stroke-[3] text-black" />}
                    </Button>

                    <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                            "control-button h-8 w-8 hover:bg-[#FFEB3B] border-2 border-transparent hover:border-black rounded-none transition-none",
                            isVideoOff && "bg-[#FF4081] text-black hover:bg-[#F50057]"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleVideoCamera();
                        }}
                    >
                        {isVideoOff ? <VideoOff size={16} className="stroke-[3] text-black" /> : <Video size={16} className="stroke-[3] text-black" />}
                    </Button>

                    <Button
                        size="icon"
                        variant="ghost"
                        className="control-button h-8 w-8 hover:bg-[#00E5FF] border-2 border-transparent hover:border-black rounded-none transition-none"
                        onClick={(e) => {
                            e.stopPropagation();
                            onExpand();
                        }}
                    >
                        <Maximize2 size={16} className="stroke-[3] text-black" />
                    </Button>
                </div>
            </div>

            {/* Resize Handle (corner) - simplified for now */}
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-[#00E5FF] opacity-0 group-hover:opacity-100 transition-none border-t-2 border-l-2 border-black" />
        </div>
    );
};

export default FloatingVideoPlayer;
