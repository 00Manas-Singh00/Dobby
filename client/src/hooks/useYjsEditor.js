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
 * @param {object} editorInstance - Monaco editor instance
 * @param {string} username - Current user's name for cursor labels
 */
export function useYjsEditor(roomId, editorInstance, username) {
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
        const provider = new SocketIOProvider(API_BASE_URL, roomId, ydoc, {
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
            if (bindingRef.current) {
                bindingRef.current.destroy();
            }
            if (providerRef.current) {
                providerRef.current.disconnect();
                providerRef.current.destroy();
            }
            if (docRef.current) {
                docRef.current.destroy();
            }
        };
    }, [roomId, editorInstance, username]);

    return { synced, provider: providerRef.current, doc: docRef.current };
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
