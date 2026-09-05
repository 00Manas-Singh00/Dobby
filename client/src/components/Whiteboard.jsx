/**
 * components/Whiteboard.jsx
 * A shared canvas backed by a Yjs `Y.Array` of strokes.
 *
 * The board used to be a relay: each segment was broadcast as a `draw` event
 * and stored nowhere, so a late joiner got a blank canvas and a refresh lost
 * everything. The strokes now live in the room's `__whiteboard__` document, so
 * the canvas is a *rendering* of that array rather than the only copy of it —
 * which is what makes replay, persistence, and offline drawing work.
 *
 * One consequence worth knowing: the local user's strokes are not drawn
 * directly. They are appended to the array, and the observer draws them, so
 * there is exactly one code path that puts ink on the canvas and local and
 * remote strokes cannot diverge.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { PenTool, Eraser, Trash2, Grid3x3, Check, CloudOff } from 'lucide-react';
import { useYjsWhiteboard } from '@/hooks/useYjsWhiteboard';

const GRID_SIZE = 30;

const Whiteboard = ({ roomId }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState(() => {
        if (!roomId) return '#3b82f6';
        return localStorage.getItem(`dobby_room_${roomId}_wb_color`) || '#3b82f6';
    });
    const [lineWidth, setLineWidth] = useState(() => {
        if (!roomId) return 3;
        const saved = localStorage.getItem(`dobby_room_${roomId}_wb_line_width`);
        return saved ? Number(saved) : 3;
    });
    const [tool, setTool] = useState(() => {
        if (!roomId) return 'pen';
        return localStorage.getItem(`dobby_room_${roomId}_wb_tool`) || 'pen';
    });
    const [showGrid, setShowGrid] = useState(() => {
        if (!roomId) return false;
        return localStorage.getItem(`dobby_room_${roomId}_wb_show_grid`) === 'true';
    });
    const prevPos = useRef({ x: 0, y: 0 });
    // The grid is a local view preference, not a stroke, so the repaint path
    // reads it through a ref rather than being torn down when it changes.
    const showGridRef = useRef(showGrid);
    useEffect(() => {
        showGridRef.current = showGrid;
    }, [showGrid]);

    const drawGrid = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        ctx.strokeStyle = '#e5e7eb20';
        ctx.lineWidth = 1;

        for (let x = 0; x < canvas.width; x += GRID_SIZE) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += GRID_SIZE) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }, []);

    /** Paint a batch of strokes. The only place ink reaches the canvas. */
    const paintStrokes = useCallback((strokes) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        for (const stroke of strokes) {
            const { prevPos: from, currPos: to, color: strokeColor, lineWidth: width } = stroke;
            if (!from || !to) continue;

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = strokeColor || '#000000';
            ctx.lineWidth = width || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
    }, []);

    const wipeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        if (showGridRef.current) drawGrid();
    }, [drawGrid]);

    const { synced, addStroke, clear, allStrokes } = useYjsWhiteboard(
        roomId,
        paintStrokes,
        wipeCanvas
    );

    // Resizing the canvas element clears its backing buffer, so the board is
    // repainted from the array rather than copied pixel-for-pixel — the array
    // is the record, the pixels are not.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const resize = () => {
            const parent = canvas.parentElement;
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;
            wipeCanvas();
            paintStrokes(allStrokes());
        };

        window.addEventListener('resize', resize);
        resize();

        return () => window.removeEventListener('resize', resize);
        // allStrokes is stable for a given room; the repaint helpers are memoized.
    }, [wipeCanvas, paintStrokes, allStrokes]);

    // Toggling the grid is a repaint, not a stroke — nobody else sees it.
    useEffect(() => {
        wipeCanvas();
        paintStrokes(allStrokes());
    }, [showGrid, wipeCanvas, paintStrokes, allStrokes]);

    const colorPresets = [
        { color: '#3b82f6', name: 'Blue' },
        { color: '#8b5cf6', name: 'Purple' },
        { color: '#ec4899', name: 'Pink' },
        { color: '#10b981', name: 'Green' },
        { color: '#f59e0b', name: 'Orange' },
        { color: '#ef4444', name: 'Red' },
        { color: '#000000', name: 'Black' },
        { color: '#ffffff', name: 'White' },
    ];

    const handleMouseDown = (e) => {
        const { offsetX, offsetY } = e.nativeEvent;
        setIsDrawing(true);
        prevPos.current = { x: offsetX, y: offsetY };
    };

    const handleMouseMove = (e) => {
        if (!isDrawing) return;
        const { offsetX, offsetY } = e.nativeEvent;
        const currPos = { x: offsetX, y: offsetY };

        addStroke({
            prevPos: prevPos.current,
            currPos,
            color: tool === 'eraser' ? '#ffffff' : color,
            lineWidth: tool === 'eraser' ? 20 : lineWidth,
        });

        prevPos.current = currPos;
    };

    const handleMouseUp = () => setIsDrawing(false);

    const clearBoard = () => {
        // Deleting the array's contents *is* the clear: both sides converge on
        // the same board afterwards, which a separate "clear" message racing a
        // stroke could not guarantee.
        clear();
    };

    useEffect(() => {
        if (!roomId) return;
        localStorage.setItem(`dobby_room_${roomId}_wb_color`, color);
    }, [roomId, color]);

    useEffect(() => {
        if (!roomId) return;
        localStorage.setItem(`dobby_room_${roomId}_wb_line_width`, String(lineWidth));
    }, [roomId, lineWidth]);

    useEffect(() => {
        if (!roomId) return;
        localStorage.setItem(`dobby_room_${roomId}_wb_tool`, tool);
    }, [roomId, tool]);

    useEffect(() => {
        if (!roomId) return;
        localStorage.setItem(`dobby_room_${roomId}_wb_show_grid`, showGrid ? 'true' : 'false');
    }, [roomId, showGrid]);

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
                                setTool('pen');
                            }}
                            className={`w-8 h-8 rounded-none border-4 border-black transition-none ${
                                color === preset.color && tool === 'pen'
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
                        onClick={() => setTool('pen')}
                        className={`h-10 w-10 border-4 border-black rounded-none transition-none ${tool === 'pen' ? 'bg-[#00E5FF] neo-shadow-sm' : 'bg-white hover:bg-[#00E5FF]'}`}
                        title="Pen"
                    >
                        <PenTool size={20} className="stroke-[3] text-black" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTool('eraser')}
                        className={`h-10 w-10 border-4 border-black rounded-none transition-none ${tool === 'eraser' ? 'bg-[#FF4081] neo-shadow-sm' : 'bg-white hover:bg-[#FF4081]'}`}
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
                    <div className="w-8 h-8 border-4 border-black bg-white flex items-center justify-center neo-shadow-sm">
                        <div
                            className="rounded-full bg-black"
                            style={{
                                width: `${Math.max(lineWidth, 4)}px`,
                                height: `${Math.max(lineWidth, 4)}px`,
                            }}
                        />
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pr-4 border-r-4 border-black">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowGrid((on) => !on)}
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
                        title="Clear board for everyone"
                    >
                        <Trash2 size={20} className="stroke-[3] text-black group-hover:text-black" />
                    </Button>
                </div>

                {/* Sync state. Offline drawing is kept locally and merges on
                    reconnect, same as the editor. */}
                <div
                    className="flex items-center gap-2"
                    title={
                        synced
                            ? 'The board is synced with the server.'
                            : 'Offline — strokes are saved locally and merge on reconnect.'
                    }
                >
                    {synced ? (
                        <Check size={16} className="stroke-[3] text-black" />
                    ) : (
                        <CloudOff size={16} className="stroke-[3] text-black" />
                    )}
                </div>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                className={`w-full h-full ${tool === 'pen' ? 'cursor-crosshair' : 'cursor-cell'} touch-none`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </div>
    );
};

export default Whiteboard;
