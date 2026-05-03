import React from 'react';
import { X, FileCode, FileJson, FileType, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const FILE_ICONS = {
    javascript: { icon: Code2, color: 'text-yellow-400' },
    typescript: { icon: Code2, color: 'text-blue-400' },
    jsx: { icon: FileCode, color: 'text-cyan-400' },
    tsx: { icon: FileCode, color: 'text-cyan-400' },
    json: { icon: FileJson, color: 'text-green-400' },
    html: { icon: FileType, color: 'text-orange-400' },
    css: { icon: FileType, color: 'text-purple-400' },
    markdown: { icon: FileType, color: 'text-slate-400' },
};

const EditorTabs = () => {
    const { editorState, setActiveFile, closeFile } = useWorkspace();
    const { openFiles, activeFileId } = editorState;

    const getFileIcon = (language) => {
        const config = FILE_ICONS[language] || { icon: FileType, color: 'text-slate-400' };
        return config;
    };

    const handleCloseFile = (e, fileId) => {
        e.stopPropagation();
        closeFile(fileId);
    };

    return (
        <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center overflow-x-auto scrollbar-thin">
            {openFiles.map((file) => {
                const isActive = file.id === activeFileId;
                const iconConfig = getFileIcon(file.language);
                const Icon = iconConfig.icon;

                return (
                    <div
                        key={file.id}
                        className={cn(
                            "h-full flex items-center gap-2 px-4 min-w-[120px] max-w-[200px] border-r border-slate-800 cursor-pointer group relative",
                            isActive
                                ? "bg-slate-800 text-white"
                                : "bg-slate-900 text-slate-400 hover:bg-slate-850 hover:text-slate-300"
                        )}
                        onClick={() => setActiveFile(file.id)}
                    >
                        {isActive && (
                            <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />
                        )}

                        <Icon size={14} className={isActive ? iconConfig.color : 'text-slate-500'} />

                        <span className="flex-1 text-sm truncate">
                            {file.name}
                        </span>

                        <button
                            className={cn(
                                "opacity-0 group-hover:opacity-100 hover:bg-slate-700 rounded p-0.5 transition-opacity",
                                isActive && "opacity-100"
                            )}
                            onClick={(e) => handleCloseFile(e, file.id)}
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default EditorTabs;
