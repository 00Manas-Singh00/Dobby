/**
 * components/workspace/FileExplorer.jsx
 * The room's real file tree.
 *
 * This used to render a hardcoded `MOCK_FILE_TREE`, and clicking a "file"
 * produced a placeholder buffer belonging to nothing. Every node here is a row
 * the server knows about, and opening one opens the Yjs document keyed on its
 * id — so two people clicking the same file land in the same buffer.
 *
 * Creating, renaming, and deleting all go through `WorkspaceContext`, which
 * refetches the tree afterwards and broadcasts to the other person; nothing in
 * this component keeps its own copy of the tree.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    ChevronRight,
    ChevronDown,
    File,
    Folder,
    FolderOpen,
    FilePlus,
    FolderPlus,
    Pencil,
    Trash2,
    RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * An inline text input that replaces a row while a name is being entered.
 *
 * Naming happens in place rather than in a modal because the name's meaning
 * depends on where in the tree it sits, and a dialog hides that context.
 */
const NameInput = ({ depth, initialValue = '', placeholder, onCommit, onCancel }) => {
    const inputRef = useRef(null);
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        inputRef.current?.focus();
        // Select the stem, not the extension — a rename is almost always to the
        // part before the dot.
        const dot = initialValue.lastIndexOf('.');
        inputRef.current?.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
    }, [initialValue]);

    const commit = () => {
        const trimmed = value.trim();
        if (!trimmed || trimmed === initialValue) onCancel();
        else onCommit(trimmed);
    };

    return (
        <div
            className="flex items-center gap-2 py-1 px-2"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
            <input
                ref={inputRef}
                value={value}
                placeholder={placeholder}
                onChange={(event) => setValue(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') commit();
                    if (event.key === 'Escape') onCancel();
                }}
                className="flex-1 min-w-0 bg-white border-2 border-black px-2 py-1 text-sm font-bold font-mono text-black focus:outline-none focus:bg-[#FFEB3B]"
            />
        </div>
    );
};

const FileTreeNode = ({
    node,
    depth,
    expanded,
    onToggle,
    onOpen,
    activeFileId,
    renamingId,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onDelete,
    creatingIn,
    creatingType,
    onCommitCreate,
    onCancelCreate,
}) => {
    const isFolder = node.type === 'folder';
    const isExpanded = expanded.has(node.id);
    const isActive = activeFileId === node.id;

    if (renamingId === node.id) {
        return (
            <NameInput
                depth={depth}
                initialValue={node.name}
                onCommit={(name) => onCommitRename(node.id, name)}
                onCancel={onCancelRename}
            />
        );
    }

    const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : File;

    return (
        <>
            <div
                className={cn(
                    'group flex items-center gap-2 py-2 px-2 hover:bg-[#FFEB3B] border-2 border-transparent hover:border-black cursor-pointer rounded-none text-sm font-bold text-black uppercase transition-none',
                    isActive && 'bg-[#00E5FF] border-black neo-shadow-sm'
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => (isFolder ? onToggle(node.id) : onOpen(node))}
            >
                {isFolder && (
                    <span className="text-black">
                        {isExpanded ? (
                            <ChevronDown size={16} className="stroke-[3]" />
                        ) : (
                            <ChevronRight size={16} className="stroke-[3]" />
                        )}
                    </span>
                )}
                <Icon size={18} className="text-black stroke-[2]" />
                <span className={cn('flex-1 truncate', isActive ? 'font-black' : '')}>
                    {node.name}
                </span>

                {/* Row actions. Hidden until hover so the tree stays readable. */}
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                        title="Rename"
                        onClick={(event) => {
                            event.stopPropagation();
                            onStartRename(node.id);
                        }}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-white"
                    >
                        <Pencil size={13} className="stroke-[3] text-black" />
                    </button>
                    <button
                        title={isFolder ? 'Delete folder and its contents' : 'Delete file'}
                        onClick={(event) => {
                            event.stopPropagation();
                            onDelete(node);
                        }}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-[#FF4081]"
                    >
                        <Trash2 size={13} className="stroke-[3] text-black" />
                    </button>
                </span>
            </div>

            {isFolder && isExpanded && (
                <div>
                    {creatingIn === node.id && (
                        <NameInput
                            depth={depth + 1}
                            placeholder={creatingType === 'folder' ? 'folder name' : 'file name'}
                            onCommit={(name) => onCommitCreate(name, node.id)}
                            onCancel={onCancelCreate}
                        />
                    )}
                    {(node.children ?? []).map((child) => (
                        <FileTreeNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            expanded={expanded}
                            onToggle={onToggle}
                            onOpen={onOpen}
                            activeFileId={activeFileId}
                            renamingId={renamingId}
                            onStartRename={onStartRename}
                            onCommitRename={onCommitRename}
                            onCancelRename={onCancelRename}
                            onDelete={onDelete}
                            creatingIn={creatingIn}
                            creatingType={creatingType}
                            onCommitCreate={onCommitCreate}
                            onCancelCreate={onCancelCreate}
                        />
                    ))}
                </div>
            )}
        </>
    );
};

const FileExplorer = () => {
    const {
        fileTree,
        filesLoaded,
        refreshFiles,
        createFile,
        renameFile,
        deleteFile,
        openFile,
        editorState,
        activeFile,
    } = useWorkspace();

    const [expanded, setExpanded] = useState(() => new Set());
    const [renamingId, setRenamingId] = useState(null);
    // `creatingIn` is the parent id the new node will land in — `undefined`
    // means "not creating", `null` means "at the root". The three states are
    // distinct, so a falsy check will not do.
    const [creatingIn, setCreatingIn] = useState(undefined);
    const [creatingType, setCreatingType] = useState('file');

    const toggle = useCallback((id) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const startCreate = (type) => {
        setCreatingType(type);
        // A new node goes inside the selected folder if one is selected, and at
        // the root otherwise — the file that is open is not a container.
        const parent = activeFile?.type === 'folder' ? activeFile.id : null;
        if (parent) setExpanded((prev) => new Set(prev).add(parent));
        setCreatingIn(parent);
    };

    const commitCreate = async (name, parentId) => {
        setCreatingIn(undefined);
        try {
            await createFile({ name, type: creatingType, parentId });
        } catch (error) {
            toast.error(error.message || `Could not create "${name}".`);
        }
    };

    const commitRename = async (fileId, name) => {
        setRenamingId(null);
        try {
            await renameFile(fileId, name);
        } catch (error) {
            toast.error(error.message || 'Could not rename that.');
        }
    };

    const handleDelete = async (node) => {
        const message =
            node.type === 'folder'
                ? `Delete "${node.name}" and everything inside it? This cannot be undone.`
                : `Delete "${node.name}"? Its contents and history go with it.`;
        if (!window.confirm(message)) return;

        try {
            await deleteFile(node.id);
        } catch (error) {
            toast.error(error.message || 'Could not delete that.');
        }
    };

    return (
        <div className="h-full bg-white flex flex-col font-mono border-r-4 border-black">
            <div className="h-10 flex items-center justify-between pl-4 pr-2 border-b-4 border-black bg-[#FFEB3B]">
                <span className="text-sm text-black uppercase tracking-widest font-black">
                    Explorer
                </span>
                <span className="flex items-center gap-1">
                    <button
                        title="New file"
                        onClick={() => startCreate('file')}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-white"
                    >
                        <FilePlus size={16} className="stroke-[3] text-black" />
                    </button>
                    <button
                        title="New folder"
                        onClick={() => startCreate('folder')}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-white"
                    >
                        <FolderPlus size={16} className="stroke-[3] text-black" />
                    </button>
                    <button
                        title="Refresh"
                        onClick={() => refreshFiles()}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-white"
                    >
                        <RefreshCw size={15} className="stroke-[3] text-black" />
                    </button>
                </span>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
                {/* A new root-level node is entered above the tree, where it will
                    appear once it exists. */}
                {creatingIn === null && (
                    <NameInput
                        depth={0}
                        placeholder={creatingType === 'folder' ? 'folder name' : 'file name'}
                        onCommit={(name) => commitCreate(name, null)}
                        onCancel={() => setCreatingIn(undefined)}
                    />
                )}

                {fileTree.map((node) => (
                    <FileTreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        onToggle={toggle}
                        onOpen={openFile}
                        activeFileId={editorState.activeFileId}
                        renamingId={renamingId}
                        onStartRename={setRenamingId}
                        onCommitRename={commitRename}
                        onCancelRename={() => setRenamingId(null)}
                        onDelete={handleDelete}
                        creatingIn={creatingIn}
                        creatingType={creatingType}
                        onCommitCreate={commitCreate}
                        onCancelCreate={() => setCreatingIn(undefined)}
                    />
                ))}

                {filesLoaded && fileTree.length === 0 && creatingIn === undefined && (
                    <p className="px-4 py-6 text-xs text-black font-bold uppercase tracking-widest">
                        No files yet — use the + above.
                    </p>
                )}
                {!filesLoaded && (
                    <p className="px-4 py-6 text-xs text-black font-bold uppercase tracking-widest">
                        Loading…
                    </p>
                )}
            </div>
        </div>
    );
};

export default FileExplorer;
