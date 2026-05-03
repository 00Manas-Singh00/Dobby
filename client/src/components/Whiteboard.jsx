import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PenTool, Eraser, Trash2, Circle, Square, Minus, Grid3x3, Undo, Redo } from 'lucide-react';

const Whiteboard = ({ socket, roomId }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState("#3b82f6");
    const [lineWidth, setLineWidth] = useState(3);
    const [tool, setTool] = useState("pen");
    const [showGrid, setShowGrid] = useState(false);
    const prevPos = useRef({ x: 0, y: 0 });

    const colorPresets = [
        { color: "#3b82f6", name: "Blue" },
        { color: "#8b5cf6", name: "Purple" },
        { color: "#ec4899", name: "Pink" },
        { color: "#10b981", name: "Green" },
        { color: "#f59e0b", name: "Orange" },
        { color: "#ef4444", name: "Red" },
        { color: "#000000", name: "Black" },
        { color: "#ffffff", name: "White" },
    ];

    useEffect(() => {
        if (!socket) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        const resize = () => {
            const parent = canvas.parentElement;
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            tempCtx.drawImage(canvas, 0, 0);

            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;

            ctx.drawImage(tempCanvas, 0, 0);

            if (showGrid) {
                drawGrid();
            }
        };

        window.addEventListener('resize', resize);
        resize();

        socket.on("on draw", ({ data }) => {
            draw(data.prevPos, data.currPos, data.color, data.lineWidth, false);
        });

        socket.on("clear canvas", () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (showGrid) {
                drawGrid();
            }
        });

        return () => {
            window.removeEventListener('resize', resize);
            socket.off("on draw");
            socket.off("clear canvas");
        };
    }, [socket, roomId, showGrid]);

    const drawGrid = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const gridSize = 30;

        ctx.strokeStyle = '#e5e7eb20';
        ctx.lineWidth = 1;

        for (let x = 0; x < canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        for (let y = 0; y < canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    };

    const draw = (prev, curr, strokeColor, strokeWidth, emit = true) => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        if (emit && socket) {
            socket.emit("draw", {
                roomId,
                data: { prevPos: prev, currPos: curr, color: strokeColor, lineWidth: strokeWidth }
            });
        }
    };

    const handleMouseDown = (e) => {
        const { offsetX, offsetY } = e.nativeEvent;
        setIsDrawing(true);
        prevPos.current = { x: offsetX, y: offsetY };
    };

    const handleMouseMove = (e) => {
        if (!isDrawing) return;
        const { offsetX, offsetY } = e.nativeEvent;
        const currPos = { x: offsetX, y: offsetY };
        const drawColor = tool === "eraser" ? "#ffffff" : color;
        const drawWidth = tool === "eraser" ? 20 : lineWidth;
        draw(prevPos.current, currPos, drawColor, drawWidth);
        prevPos.current = currPos;
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
    };

    const clearBoard = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (showGrid) {
            drawGrid();
        }
        socket.emit("clear canvas", { roomId });
    };

    const toggleGrid = () => {
        const newShowGrid = !showGrid;
        setShowGrid(newShowGrid);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (newShowGrid) {
            drawGrid();
        }
    };

    return (
        <div className="flex flex-col h-full bg-white relative font-mono">
            {/* Enhanced Floating Toolbar */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-[#FFEB3B] p-3 rounded-none flex items-center gap-4 border-4 border-black z-10 neo-shadow-sm">
                {/* Color Presets */}
                <div className="flex gap-2 pr-4 border-r-4 border-black">
                    {colorPresets.map((preset) => (
                        <button
                            key={preset.color}
                            onClick={() => {
                                setColor(preset.color);
                                setTool("pen");
                            }}
                            className={`w-8 h-8 rounded-none border-4 border-black transition-none ${color === preset.color && tool === "pen"
                                    ? 'scale-110 neo-shadow-sm'
                                    : 'hover:neo-shadow-sm'
                                }`}
                            style={{ backgroundColor: preset.color }}
                            title={preset.name}
                        />
                    ))}
                </div>

                {/* Tools */}
                <div className="flex gap-2 pr-4 border-r-4 border-black">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTool("pen")}
                        className={`h-10 w-10 border-4 border-black rounded-none transition-none ${tool === "pen" ? 'bg-[#00E5FF] neo-shadow-sm' : 'bg-white hover:bg-[#00E5FF]'}`}
                        title="Pen"
                    >
                        <PenTool size={20} className="stroke-[3] text-black" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTool("eraser")}
                        className={`h-10 w-10 border-4 border-black rounded-none transition-none ${tool === "eraser" ? 'bg-[#FF4081] neo-shadow-sm' : 'bg-white hover:bg-[#FF4081]'}`}
                        title="Eraser"
                    >
                        <Eraser size={20} className="stroke-[3] text-black" />
                    </Button>
                </div>

                {/* Stroke Width */}
                <div className="flex items-center gap-3 pr-4 border-r-4 border-black">
                    <input
                        type="range"
                        min="1"
                        max="20"
                        value={lineWidth}
                        onChange={(e) => setLineWidth(Number(e.target.value))}
                        className="w-24 h-3 bg-white border-2 border-black rounded-none cursor-pointer accent-[#FF4081]"
                        title="Stroke Width"
                    />
                    <div
                        className="w-8 h-8 border-4 border-black bg-white flex items-center justify-center neo-shadow-sm"
                    >
                        <div
                            className="rounded-full bg-black"
                            style={{
                                width: `${Math.max(lineWidth, 4)}px`,
                                height: `${Math.max(lineWidth, 4)}px`
                            }}
                        />
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleGrid}
                        className={`h-10 w-10 border-4 border-black rounded-none transition-none ${showGrid ? 'bg-[#00E5FF] neo-shadow-sm' : 'bg-white hover:bg-[#00E5FF]'}`}
                        title="Toggle Grid"
                    >
                        <Grid3x3 size={20} className="stroke-[3] text-black" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={clearBoard}
                        className="h-10 w-10 border-4 border-black rounded-none transition-none bg-white hover:bg-[#FF4081] group"
                        title="Clear Board"
                    >
                        <Trash2 size={20} className="stroke-[3] text-black group-hover:text-black" />
                    </Button>
                </div>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                className={`w-full h-full ${tool === "pen" ? "cursor-crosshair" : "cursor-cell"} touch-none`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </div>
    );
};

export default Whiteboard;
