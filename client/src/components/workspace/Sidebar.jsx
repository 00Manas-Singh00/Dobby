import { useState, useRef, useEffect } from 'react';
import { Code2, Video, PenTool, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULES = [
    { id: 'editor', icon: Code2, label: 'Editor', color: 'blue' },
    { id: 'video', icon: Video, label: 'Video', color: 'purple' },
    { id: 'whiteboard', icon: PenTool, label: 'Whiteboard', color: 'green' },
    { id: 'chat', icon: MessageSquare, label: 'Chat', color: 'orange' },
];

const COLOR_CLASSES = {
    blue: 'bg-[#00E5FF] text-black border-4 border-black neo-shadow-sm',
    purple: 'bg-[#FF4081] text-black border-4 border-black neo-shadow-sm',
    green: 'bg-[#FFEB3B] text-black border-4 border-black neo-shadow-sm',
    orange: 'bg-white text-black border-4 border-black neo-shadow-sm',
    pink: 'bg-[#FF4081] text-black border-4 border-black neo-shadow-sm' };

const Sidebar = ({ activeModule, onModuleChange, isCollapsed, width, onWidthChange, onToggleCollapse }) => {
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef(null);

    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing) return;

            const newWidth = e.clientX;
            if (newWidth >= 60 && newWidth <= 300) {
                onWidthChange(newWidth);
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
    }, [isResizing, onWidthChange]);

    const effectiveWidth = isCollapsed ? 60 : width;

    return (
        <div
            ref={sidebarRef}
            className="relative h-full bg-[#FFEB3B] border-r-4 border-black flex flex-col transition-all duration-300 ease-in-out select-none font-mono z-10"
            style={{ width: `${effectiveWidth}px` }}
        >
            {/* Header with Logo */}
            <div className="h-16 flex items-center justify-between px-3 border-b-4 border-black bg-white">
                {!isCollapsed && (
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 border-4 border-black bg-[#00E5FF] flex items-center justify-center neo-shadow-sm hover:rotate-12 transition-transform cursor-pointer">
                            <span className="font-black text-black text-xl">D</span>
                        </div>
                        <span className="font-black text-2xl text-black uppercase tracking-tighter">
                            Dobby<span className="text-[#FF4081]">.</span>
                        </span>
                    </div>
                )}
                {isCollapsed && (
                    <div className="w-full flex justify-center">
                        <div className="w-10 h-10 border-4 border-black bg-[#00E5FF] flex items-center justify-center neo-shadow-sm hover:rotate-12 transition-transform cursor-pointer">
                            <span className="font-black text-black text-xl">D</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Module Navigation */}
            <nav className="flex-1 py-4 px-2 space-y-1">
                {MODULES.map((module) => {
                    const Icon = module.icon;
                    const isActive = activeModule === module.id;

                    return (
                        <button
                            key={module.id}
                            onClick={() => onModuleChange(module.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-3 rounded-none transition-none border-4 border-transparent hover:border-black hover:bg-white hover:neo-shadow-sm",
                                isActive && "bg-white border-black neo-shadow-sm",
                                !isCollapsed && "justify-start",
                                isCollapsed && "justify-center"
                            )}
                            title={isCollapsed ? module.label : undefined}
                        >
                            <div className={cn(
                                "flex items-center justify-center p-2 rounded-none",
                                isActive ? COLOR_CLASSES[module.color] : "bg-[#f8f9fa] border-4 border-black text-black"
                            )}>
                                <Icon size={24} className={isActive ? 'stroke-[3]' : 'stroke-[3]'} />
                            </div>
                            {!isCollapsed && (
                                <span className={cn(
                                    "text-base font-black uppercase tracking-widest",
                                    isActive ? "text-black" : "text-black"
                                )}>
                                    {module.label}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Collapse Toggle */}
            <div className="p-2 border-t-4 border-black bg-white">
                <button
                    onClick={onToggleCollapse}
                    className="w-full flex items-center justify-center gap-2 px-3 py-3 border-4 border-transparent hover:border-black hover:bg-[#FFEB3B] hover:neo-shadow-sm rounded-none transition-none"
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? (
                        <ChevronRight size={24} className="text-black stroke-[3]" />
                    ) : (
                        <>
                            <ChevronLeft size={24} className="text-black stroke-[3]" />
                            <span className="text-sm font-black text-black uppercase tracking-widest">Collapse</span>
                        </>
                    )}
                </button>
            </div>

            {/* Resize Handle */}
            {!isCollapsed && (
                <div
                    className={cn(
                        "absolute right-[-4px] top-0 bottom-0 w-2 cursor-ew-resize group hover:bg-[#00E5FF] transition-none z-50",
                        isResizing && "bg-[#FF4081]"
                    )}
                    onMouseDown={handleMouseDown}
                >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-black opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            )}
        </div>
    );
};

export default Sidebar;
