/**
 * components/workspace/HistoryPanel.jsx
 * The open file's snapshots, with a preview and a restore.
 *
 * The server takes these on a timer; the "Snapshot now" button is here because
 * the moment a user actually wants marked — just before a risky edit — is not
 * one a timer can know about.
 *
 * Restoring does not update the editor from this response. The server rewrites
 * the live Yjs document, and the editor receives that as an ordinary remote
 * edit through the binding it already has — the same path a partner's typing
 * takes. That is why a restore is safe mid-session: it merges rather than
 * overwrites, and both people see it at once.
 */

import { useCallback, useEffect, useState } from 'react';
import { History, X, Camera, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    listSnapshots,
    readSnapshot,
    captureSnapshot,
    restoreSnapshot,
} from '@/services/fileService';

const formatWhen = (iso) => {
    const date = new Date(iso);
    const minutesAgo = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutesAgo < 1) return 'just now';
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    if (minutesAgo < 60 * 24) return `${Math.round(minutesAgo / 60)}h ago`;
    return date.toLocaleDateString();
};

const formatSize = (bytes) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const HistoryPanel = ({ roomId, file, onClose }) => {
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [previewId, setPreviewId] = useState(null);
    const [previewText, setPreviewText] = useState('');

    const refresh = useCallback(async () => {
        try {
            setSnapshots(await listSnapshots(roomId, file.id));
        } catch (error) {
            toast.error(error.message || 'Could not load history.');
        } finally {
            setLoading(false);
        }
    }, [roomId, file.id]);

    // Switching tabs switches the file this panel is about, so the list and any
    // open preview both reset.
    useEffect(() => {
        setLoading(true);
        setPreviewId(null);
        setPreviewText('');
        refresh();
    }, [refresh]);

    const handleCapture = async () => {
        setBusy(true);
        try {
            const { unchanged } = await captureSnapshot(roomId, file.id);
            toast[unchanged ? 'info' : 'success'](
                unchanged ? 'Nothing has changed since the last snapshot.' : 'Snapshot taken.'
            );
            await refresh();
        } catch (error) {
            toast.error(error.message || 'Could not take a snapshot.');
        } finally {
            setBusy(false);
        }
    };

    const handlePreview = async (snapshot) => {
        if (previewId === snapshot.id) {
            setPreviewId(null);
            return;
        }
        try {
            const { text } = await readSnapshot(roomId, file.id, snapshot.id);
            setPreviewId(snapshot.id);
            setPreviewText(text);
        } catch (error) {
            toast.error(error.message || 'Could not read that snapshot.');
        }
    };

    const handleRestore = async (snapshot) => {
        const when = formatWhen(snapshot.createdAt);
        if (
            !window.confirm(
                `Restore "${file.name}" to its state from ${when}? ` +
                'The current version is snapshotted first, so this can be undone.'
            )
        ) {
            return;
        }

        setBusy(true);
        try {
            const { changed } = await restoreSnapshot(roomId, file.id, snapshot.id);
            toast[changed ? 'success' : 'info'](
                changed ? `Restored to ${when}.` : 'The file already matches that snapshot.'
            );
            await refresh();
        } catch (error) {
            toast.error(error.message || 'Could not restore that snapshot.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="w-80 flex-shrink-0 border-l-4 border-black bg-white flex flex-col font-mono">
            <div className="h-12 flex items-center justify-between px-3 border-b-4 border-black bg-[#FFEB3B] flex-shrink-0">
                <span className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-black">
                    <History size={16} className="stroke-[3]" />
                    History
                </span>
                <span className="flex items-center gap-1">
                    <button
                        title="Snapshot now"
                        disabled={busy}
                        onClick={handleCapture}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-white disabled:opacity-40"
                    >
                        {busy ? (
                            <Loader2 size={16} className="animate-spin stroke-[3] text-black" />
                        ) : (
                            <Camera size={16} className="stroke-[3] text-black" />
                        )}
                    </button>
                    <button
                        title="Close history"
                        onClick={onClose}
                        className="p-1 border-2 border-transparent hover:border-black hover:bg-[#FF4081]"
                    >
                        <X size={16} className="stroke-[3] text-black" />
                    </button>
                </span>
            </div>

            <p className="px-3 py-2 text-xs font-bold text-black border-b-2 border-black truncate">
                {file.name}
            </p>

            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <p className="px-3 py-6 text-xs font-bold uppercase tracking-widest text-black">
                        Loading…
                    </p>
                )}

                {!loading && snapshots.length === 0 && (
                    <p className="px-3 py-6 text-xs font-bold text-black leading-5">
                        No snapshots yet. One is taken automatically as you work, or take one now
                        with the camera above.
                    </p>
                )}

                {snapshots.map((snapshot) => (
                    <div key={snapshot.id} className="border-b-2 border-black">
                        <div
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#FFEB3B]',
                                previewId === snapshot.id && 'bg-[#00E5FF]'
                            )}
                            onClick={() => handlePreview(snapshot)}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black text-black">
                                    {formatWhen(snapshot.createdAt)}
                                </p>
                                <p className="text-[11px] font-bold text-black/70">
                                    {new Date(snapshot.createdAt).toLocaleTimeString()} ·{' '}
                                    {formatSize(snapshot.size)}
                                </p>
                            </div>
                            <button
                                title="Restore this version"
                                disabled={busy}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleRestore(snapshot);
                                }}
                                className="p-1 border-2 border-black bg-white hover:bg-[#FF4081] disabled:opacity-40"
                            >
                                <RotateCcw size={14} className="stroke-[3] text-black" />
                            </button>
                        </div>

                        {previewId === snapshot.id && (
                            <pre className="max-h-56 overflow-auto px-3 py-2 text-[11px] leading-4 font-mono text-black bg-[#f8f9fa] border-t-2 border-black whitespace-pre">
                                {previewText || '(empty)'}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HistoryPanel;
