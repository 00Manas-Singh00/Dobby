/**
 * hooks/useYjsWhiteboard.js
 * Whiteboard strokes as a CRDT.
 *
 * Strokes used to be relayed as `draw` events and stored nowhere, which had two
 * consequences: a second person arriving mid-session saw a blank canvas, and a
 * refresh lost the board. Modelling the board as a `Y.Array` inside the room's
 * `<roomId>:__whiteboard__` document reuses the sync machinery the editor
 * already has, so history, persistence, late-joiner replay, and offline merge
 * all come for free rather than needing a second protocol.
 *
 * A clear is `array.delete(0, length)` rather than a separate "clear" message,
 * which is what makes it converge: a stroke drawn concurrently with a clear
 * either survives or does not, consistently on both sides, instead of the two
 * peers disagreeing about which arrived first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io';
import { IndexeddbPersistence } from 'y-indexeddb';
import { API_BASE_URL, getAccessToken } from '@/services/apiClient';
import { documentSocketOptions, retryOnDocumentMoved } from '@/services/yjsProvider';

/** The file-id half of the document name. Never a real file, so it cannot collide. */
export const WHITEBOARD_DOC_ID = '__whiteboard__';

const STROKES_KEY = 'strokes';

/**
 * @param {string} roomId
 * @param {(strokes: object[]) => void} onStrokes
 *   Called with the strokes appended since the previous call, and with the full
 *   board when it has to be redrawn from scratch (initial sync, or a clear).
 *   Incremental where possible: a canvas is a pixel buffer, and redrawing a
 *   long session on every stroke would be visibly slow.
 * @param {() => void} onReset - Called when the board should be wiped first.
 */
export function useYjsWhiteboard(roomId, onStrokes, onReset) {
    const [synced, setSynced] = useState(false);
    const arrayRef = useRef(null);
    // Callbacks are read through refs so a parent re-render does not tear down
    // the provider and reconnect the socket.
    const onStrokesRef = useRef(onStrokes);
    const onResetRef = useRef(onReset);

    useEffect(() => {
        onStrokesRef.current = onStrokes;
        onResetRef.current = onReset;
    }, [onStrokes, onReset]);

    useEffect(() => {
        if (!roomId) return undefined;

        const ydoc = new Y.Doc();
        const docName = `${roomId}:${WHITEBOARD_DOC_ID}`;

        const persistence = new IndexeddbPersistence(`dobby:${docName}`, ydoc);
        const provider = new SocketIOProvider(API_BASE_URL, docName, ydoc, {
            autoConnect: true,
            auth: { token: getAccessToken() },
            disableBc: true,
        }, documentSocketOptions(docName));

        // Same routing hint and same retry as the editor — the whiteboard is
        // just another document, and gets no special path for being one.
        const stopRetrying = retryOnDocumentMoved(provider, docName);

        const strokes = ydoc.getArray(STROKES_KEY);
        arrayRef.current = strokes;

        const handleChange = (event) => {
            // A delete anywhere means the board no longer matches what is on the
            // canvas, so the only correct response is to repaint it. Appends —
            // the overwhelmingly common case — are drawn incrementally.
            const removed = event.changes.deleted.size > 0;
            if (removed) {
                onResetRef.current?.();
                onStrokesRef.current?.(strokes.toArray());
                return;
            }

            const added = [];
            for (const item of event.changes.added) {
                added.push(...item.content.getContent());
            }
            if (added.length) onStrokesRef.current?.(added);
        };

        strokes.observe(handleChange);

        // Draw whatever is already there — from IndexedDB first, then from the
        // server once it has synced. Both arrive as a repaint rather than an
        // append, because the canvas may already hold a partial board.
        const paintAll = () => {
            onResetRef.current?.();
            onStrokesRef.current?.(strokes.toArray());
        };

        persistence.on('synced', paintAll);
        provider.on('sync', (isSynced) => {
            setSynced(isSynced);
            if (isSynced) paintAll();
        });

        return () => {
            strokes.unobserve(handleChange);
            stopRetrying();
            setSynced(false);
            arrayRef.current = null;
            provider.disconnect();
            provider.destroy();
            persistence.destroy();
            ydoc.destroy();
        };
    }, [roomId]);

    // Memoized because the canvas keys effects on them: an identity that
    // changed every render would re-run the resize listener and repaint the
    // board on each one.

    /** Append one stroke. The observer draws it, so callers must not also draw. */
    const addStroke = useCallback((stroke) => arrayRef.current?.push([stroke]), []);

    /** Wipe the board for everyone. */
    const clear = useCallback(() => {
        const strokes = arrayRef.current;
        if (strokes?.length) strokes.delete(0, strokes.length);
    }, []);

    /** Repaint request from the canvas itself — a resize, say. */
    const allStrokes = useCallback(() => arrayRef.current?.toArray() ?? [], []);

    return { synced, addStroke, clear, allStrokes };
}
