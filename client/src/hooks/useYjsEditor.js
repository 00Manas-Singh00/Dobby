/**
 * hooks/useYjsEditor.js
 * Core CRDT hook for collaborative editing.
 * Initializes Y.Doc, SocketIOProvider, and MonacoBinding.
 */

import { useEffect, useState, useRef } from 'react';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io';
import { MonacoBinding } from 'y-monaco';
import { API_BASE_URL } from '@/services/apiClient';

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
    const providerRef = useRef(null);
    const docRef = useRef(null);
    const bindingRef = useRef(null);

    useEffect(() => {
        if (!roomId || !editorInstance) return;

        // Initialize Yjs Document
        const ydoc = new Y.Doc();
        docRef.current = ydoc;

        // Initialize Socket.IO Provider
        // SocketIOProvider(url, roomName, ydoc, options)
        // The Yjs room name is room + file, so each tab syncs (and persists to
        // LevelDB) independently, and awareness/cursors scope to that file.
        const yRoomName = `${roomId}:${fileId}`;
        const provider = new SocketIOProvider(API_BASE_URL, yRoomName, ydoc, {
            autoConnect: true,
            auth: { username },
        });
        providerRef.current = provider;

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
        // MonacoBinding(ydoc.getText('monaco'), editorInstance.getModel(), [editorInstance], awareness)
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
            if (bindingRef.current) {
                bindingRef.current.destroy();
                bindingRef.current = null;
            }
            if (providerRef.current) {
                providerRef.current.disconnect();
                providerRef.current.destroy();
                providerRef.current = null;
            }
            if (docRef.current) {
                docRef.current.destroy();
                docRef.current = null;
            }
        };
    }, [roomId, fileId, editorInstance, username]);

    // Refs, not their current values: reading `.current` here would capture the
    // value at render time, which is null on the first render and never updates.
    return { synced, providerRef, docRef };
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
