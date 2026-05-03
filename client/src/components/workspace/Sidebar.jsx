import React, { useState, useRef, useEffect } from 'react';
import { Code2, Video, PenTool, MessageSquare, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULES = [
    { id: 'editor', icon: Code2, label: 'Editor', color: 'blue' },
    { id: 'video', icon: Video, label: 'Video', color: 'purple' },
    { id: 'whiteboard', icon: PenTool, label: 'Whiteboard', color: 'green' },
    { id: 'chat', icon: MessageSquare, label: 'Chat', color: 'orange' },
    { id: 'ai', icon: Sparkles, label: 'AI', color: 'pink' },
];

const COLOR_CLASSES = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
    green: 'bg-green-500/20 text-green-400 border-green-500/50',
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
    pink: 'bg-pink-500/20 text-pink-400 border-pink-500/50',
};

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
            className="relative h-full bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out select-none"
            style={{ width: `${effectiveWidth}px` }}
        >
            {/* Header with Logo */}
            <div className="h-16 flex items-center justify-between px-3 border-b border-slate-800">
                {!isCollapsed && (
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                            <Code2 size={18} className="text-white" />
                        </div>
                        <span className="font-bold text-lg bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Dobby
                        </span>
                    </div>
                )}
                {isCollapsed && (
                    <div className="w-full flex justify-center">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                            <Code2 size={18} className="text-white" />
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
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                                "hover:bg-slate-800/50",
                                isActive && "bg-slate-800 border border-slate-700",
                                !isCollapsed && "justify-start",
                                isCollapsed && "justify-center"
                            )}
                            title={isCollapsed ? module.label : undefined}
                        >
                            <div className={cn(
                                "flex items-center justify-center rounded-md p-1.5",
                                isActive && COLOR_CLASSES[module.color]
                            )}>
                                <Icon size={20} className={isActive ? '' : 'text-slate-400'} />
                            </div>
                            {!isCollapsed && (
                                <span className={cn(
                                    "text-sm font-medium transition-colors",
                                    isActive ? "text-white" : "text-slate-400"
                                )}>
                                    {module.label}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Collapse Toggle */}
            <div className="p-2 border-t border-slate-800">
                <button
                    onClick={onToggleCollapse}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors"
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? (
                        <ChevronRight size={20} className="text-slate-400" />
                    ) : (
                        <>
                            <ChevronLeft size={20} className="text-slate-400" />
                            <span className="text-sm text-slate-400">Collapse</span>
                        </>
                    )}
                </button>
            </div>

            {/* Resize Handle */}
            {!isCollapsed && (
                <div
                    className={cn(
                        "absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize group hover:bg-blue-500/50 transition-colors",
                        isResizing && "bg-blue-500"
                    )}
                    onMouseDown={handleMouseDown}
                >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-slate-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            )}
        </div>
    );
};

export default Sidebar;
