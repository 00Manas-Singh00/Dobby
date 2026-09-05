/**
 * hooks/useYjsEditor.js
 * Core CRDT hook for collaborative editing.
 * Initializes Y.Doc, IndexeddbPersistence, SocketIOProvider, and MonacoBinding.
 */

import { useEffect, useState, useRef } from 'react';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io';
import { IndexeddbPersistence } from 'y-indexeddb';
import { MonacoBinding } from 'y-monaco';
import { API_BASE_URL, getAccessToken } from '@/services/apiClient';
import { documentSocketOptions, retryOnDocumentMoved } from '@/services/yjsProvider';

/**
 * @param {string} roomId
 * @param {object} editorInstance - Monaco editor instance. Must be React state,
 *   not a ref: this effect keys off it, so a ref would never re-run the effect
 *   and the binding would silently never attach.
 * @param {string} username - Current user's name for cursor labels
 * @param {string} fileId - Identifies the document within the room. Each open
 *   file gets its own Yjs room so tabs don't share one buffer.
 */
export function useYjsEditor(roomId, editorInstance, username, fileId = 'default') {
    const [synced, setSynced] = useState(false);
    const [offlineReady, setOfflineReady] = useState(false);
    const providerRef = useRef(null);
    const docRef = useRef(null);
    const bindingRef = useRef(null);
    const persistenceRef = useRef(null);

    useEffect(() => {
        if (!roomId || !editorInstance) return;

        // Initialize Yjs Document
        const ydoc = new Y.Doc();
        docRef.current = ydoc;

        // The Yjs room name is room + file, so each tab syncs (and persists to
        // LevelDB) independently, and awareness/cursors scope to that file.
        const yRoomName = `${roomId}:${fileId}`;

        // ── Offline persistence ──────────────────────────────────────────────
        // Attached *before* the network provider, deliberately. IndexedDB loads
        // the last known state into the document immediately, so the editor has
        // content before the socket connects; the server's state then merges
        // into it rather than replacing it. Edits made while disconnected are
        // written here as they happen, so closing the tab — or the laptop lid —
        // no longer loses them: they are still in the document on the next open
        // and merge on reconnect like any other concurrent edit.
        //
        // Keyed on room+file for the same reason the provider is: a shared key
        // would restore one file's contents into another.
        const persistence = new IndexeddbPersistence(`dobby:${yRoomName}`, ydoc);
        persistenceRef.current = persistence;
        persistence.on('synced', () => setOfflineReady(true));

        // Initialize Socket.IO Provider
        // SocketIOProvider(url, roomName, ydoc, options)
        // Yjs connects to its own namespace, which does not inherit the main
        // socket's authentication — it carries the access token itself, and the
        // server checks room membership against the namespace name.
        const provider = new SocketIOProvider(API_BASE_URL, yRoomName, ydoc, {
            autoConnect: true,
            auth: { token: getAccessToken() },
            // y-socket.io also syncs peers over a BroadcastChannel keyed on
            // `${url}/${roomName}`, which reaches every same-origin browsing
            // context *without touching the server* — and therefore without
            // passing the membership check. It is an optimization for multiple
            // tabs of one user; for a two-person room it saves nothing worth
            // having a second, unauthorized sync path for.
            disableBc: true,
        },
        // The fifth argument is passed straight to socket.io. `?doc=` is the
        // routing hint a load balancer hashes on so every client of one document
        // reaches the one replica allowed to serve it.
        documentSocketOptions(yRoomName));
        providerRef.current = provider;

        // If the hint did not work, the server refuses rather than serving a
        // second copy of the document. Socket.IO does not retry a refused
        // handshake by itself, so this does.
        const stopRetrying = retryOnDocumentMoved(provider, yRoomName);

        provider.on('sync', (isSynced) => {
            setSynced(isSynced);
        });

        // Set awareness state (user name and color)
        const awareness = provider.awareness;
        const color = getRandomColor();
        awareness.setLocalStateField('user', {
            name: username,
            color: color,
        });

        // Initialize Monaco Binding
        const ytext = ydoc.getText('monaco');
        const binding = new MonacoBinding(
            ytext,
            editorInstance.getModel(),
            new Set([editorInstance]),
            awareness
        );
        bindingRef.current = binding;

        return () => {
            setSynced(false);
            setOfflineReady(false);
            stopRetrying();
            if (bindingRef.current) {
                bindingRef.current.destroy();
                bindingRef.current = null;
            }
            if (providerRef.current) {
                providerRef.current.disconnect();
                providerRef.current.destroy();
                providerRef.current = null;
            }
            // Destroy, not clearData: the point of the store is that it
            // survives the tab closing. Clearing it here would throw away
            // exactly the offline edits it exists to keep.
            if (persistenceRef.current) {
                persistenceRef.current.destroy();
                persistenceRef.current = null;
            }
            if (docRef.current) {
                docRef.current.destroy();
                docRef.current = null;
            }
        };
    }, [roomId, fileId, editorInstance, username]);

    // Refs, not their current values: reading `.current` here would capture the
    // value at render time, which is null on the first render and never updates.
    return { synced, offlineReady, providerRef, docRef };
}

/**
 * Generates a consistent but "random" color for user cursors.
 */
function getRandomColor() {
    const colors = [
        '#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352',
        '#9ac2c9', '#8acb88', '#1be7ff', '#6eeb83', '#e4ff1a',
        '#ffb800', '#ff5733', '#c70039', '#900c3f', '#581845'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}
