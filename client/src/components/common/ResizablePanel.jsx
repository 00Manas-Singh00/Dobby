import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const ResizablePanel = ({
    children,
    direction = 'horizontal', // 'horizontal' or 'vertical'
    minSize = 150,
    maxSize = 600,
    defaultSize = 250,
    onResize,
    className = '',
}) => {
    const [size, setSize] = useState(defaultSize);
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef(null);

    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing || !panelRef.current) return;

            const panelRect = panelRef.current.getBoundingClientRect();
            let newSize;

            if (direction === 'horizontal') {
                newSize = e.clientX - panelRect.left;
            } else {
                newSize = e.clientY - panelRect.top;
            }

            if (newSize >= minSize && newSize <= maxSize) {
                setSize(newSize);
                onResize?.(newSize);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, direction, minSize, maxSize, onResize]);

    const resizeHandleClass = direction === 'horizontal'
        ? 'absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/50 transition-colors group'
        : 'absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/50 transition-colors group';

    const sizeStyle = direction === 'horizontal'
        ? { width: `${size}px`, position: 'relative' }
        : { height: `${size}px`, position: 'relative' };

    return (
        <div
            ref={panelRef}
            className={cn("relative", className)}
            style={sizeStyle}
        >
            {children}

            {/* Resize Handle */}
            <div
                className={cn(resizeHandleClass, isResizing && "bg-blue-500")}
                onMouseDown={handleMouseDown}
            >
                <div className={cn(
                    "absolute bg-slate-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                    direction === 'horizontal'
                        ? "right-0 top-1/2 -translate-y-1/2 w-1 h-12"
                        : "bottom-0 left-1/2 -translate-x-1/2 h-1 w-12"
                )} />
            </div>
        </div>
    );
};

export default ResizablePanel;
