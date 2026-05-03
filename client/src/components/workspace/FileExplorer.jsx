import React, { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// Mock file tree structure
const MOCK_FILE_TREE = {
    name: 'project',
    type: 'folder',
    expanded: true,
    children: [
        {
            name: 'src',
            type: 'folder',
            expanded: true,
            children: [
                { name: 'index.js', type: 'file', language: 'javascript' },
                { name: 'App.jsx', type: 'file', language: 'javascript' },
                { name: 'styles.css', type: 'file', language: 'css' },
            ],
        },
        {
            name: 'public',
            type: 'folder',
            expanded: false,
            children: [
                { name: 'index.html', type: 'file', language: 'html' },
                { name: 'favicon.ico', type: 'file' },
            ],
        },
        { name: 'package.json', type: 'file', language: 'json' },
        { name: 'README.md', type: 'file', language: 'markdown' },
    ],
};

const FileTreeNode = ({ node, path, depth = 0, expandedFolders, onToggleFolder, onFileClick, activeFileId }) => {
    const isFolder = node.type === 'folder';
    const isExpanded = expandedFolders[path] ?? node.expanded;
    const fileId = path.replace(/\//g, '_');
    const isActive = activeFileId === fileId;

    const handleClick = () => {
        if (isFolder) {
            onToggleFolder(path);
        } else {
            onFileClick({
                id: fileId,
                name: node.name,
                language: node.language || 'plaintext',
                content: `// ${node.name}\n// This is a placeholder file\n`,
                path,
            });
        }
    };

    const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : File;

    return (
        <>
            <div
                className={cn(
                    "flex items-center gap-2 py-1 px-2 hover:bg-slate-800/50 cursor-pointer rounded text-sm",
                    isActive && "bg-blue-500/20 text-blue-300"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={handleClick}
            >
                {isFolder && (
                    <span className="text-slate-500">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                )}
                <Icon size={16} className={cn(
                    isFolder ? "text-blue-400" : "text-slate-400",
                    isActive && "text-blue-300"
                )} />
                <span className={cn(
                    "flex-1 truncate",
                    isActive ? "text-blue-200 font-medium" : "text-slate-300"
                )}>
                    {node.name}
                </span>
            </div>
            {isFolder && isExpanded && node.children && (
                <div>
                    {node.children.map((child) => (
                        <FileTreeNode
                            key={child.name}
                            node={child}
                            path={`${path}/${child.name}`}
                            depth={depth + 1}
                            expandedFolders={expandedFolders}
                            onToggleFolder={onToggleFolder}
                            onFileClick={onFileClick}
                            activeFileId={activeFileId}
                        />
                    ))}
                </div>
            )}
        </>
    );
};

const FileExplorer = () => {
    const { editorState, openFile } = useWorkspace();
    const [expandedFolders, setExpandedFolders] = useState({});

    const handleToggleFolder = (path) => {
        setExpandedFolders(prev => ({
            ...prev,
            [path]: !prev[path],
        }));
    };

    const handleFileClick = (file) => {
        openFile(file);
    };

    return (
        <div className="h-full bg-slate-900 flex flex-col">
            {/* Header */}
            <div className="h-10 flex items-center px-3 border-b border-slate-800">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                    Explorer</span>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto py-2">
                <FileTreeNode
                    node={MOCK_FILE_TREE}
                    path="project"
                    expandedFolders={expandedFolders}
                    onToggleFolder={handleToggleFolder}
                    onFileClick={handleFileClick}
                    activeFileId={editorState.activeFileId}
                />
            </div>
        </div>
    );
};

export default FileExplorer;
