import { X, FileCode, FileJson, FileType, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const FILE_ICONS = {
    javascript: { icon: Code2, color: 'text-black stroke-[3]' },
    typescript: { icon: Code2, color: 'text-black stroke-[3]' },
    jsx: { icon: FileCode, color: 'text-black stroke-[3]' },
    tsx: { icon: FileCode, color: 'text-black stroke-[3]' },
    json: { icon: FileJson, color: 'text-black stroke-[3]' },
    html: { icon: FileType, color: 'text-black stroke-[3]' },
    css: { icon: FileType, color: 'text-black stroke-[3]' },
    markdown: { icon: FileType, color: 'text-black stroke-[3]' },
};

/**
 * Tabs for the open files.
 *
 * Each tab is a node from the file tree rather than a buffer of its own, so a
 * rename by either person retitles the tab and a delete closes it — neither
 * needs handling here.
 */
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

    if (openFiles.length === 0) {
        return (
            <div className="h-12 bg-white border-b-4 border-black flex items-center px-4 font-mono">
                <span className="text-xs font-bold uppercase tracking-widest text-black/60">
                    No open files
                </span>
            </div>
        );
    }

    return (
        <div className="h-12 bg-white border-b-4 border-black flex items-center overflow-x-auto scrollbar-thin font-mono">
            {openFiles.map((file) => {
                const isActive = file.id === activeFileId;
                const iconConfig = getFileIcon(file.language);
                const Icon = iconConfig.icon;

                return (
                    <div
                        key={file.id}
                        className={cn(
                            "h-full flex items-center gap-2 px-4 min-w-[120px] max-w-[200px] border-r-4 border-black cursor-pointer group relative transition-none",
                            isActive
                                ? "bg-[#00E5FF] text-black font-black"
                                : "bg-white text-black font-bold hover:bg-[#FFEB3B]"
                        )}
                        onClick={() => setActiveFile(file.id)}
                    >
                        <Icon size={16} className={isActive ? iconConfig.color : 'text-black stroke-[2]'} />

                        <span className="flex-1 text-sm truncate uppercase tracking-widest">
                            {file.name}
                        </span>

                        <button
                            className={cn(
                                "opacity-0 group-hover:opacity-100 hover:bg-[#FF4081] rounded-none p-1 border-2 border-transparent hover:border-black transition-none",
                                isActive && "opacity-100"
                            )}
                            onClick={(e) => handleCloseFile(e, file.id)}
                        >
                            <X size={16} className="text-black stroke-[3]" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default EditorTabs;
