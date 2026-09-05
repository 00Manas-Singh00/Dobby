import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { getAccessToken, onTokenChange, API_BASE_URL } from '@/services/apiClient';

const SocketContext = createContext(null);

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    // Re-created whenever the token changes: the server verifies the token in
    // the handshake, so a refreshed token needs a fresh connection to be seen.
    const [token, setToken] = useState(() => getAccessToken());

    useEffect(() => onTokenChange(setToken), []);

    // The socket is derived from the token rather than stored in state. Setting
    // it from inside an effect meant every sign-in rendered twice — once with a
    // null socket, then again once the effect had run — and consumers had to
    // cope with that null. No token means no connection at all; an anonymous
    // socket would only be rejected by the server's handshake middleware.
    const socket = useMemo(() => {
        if (!token) return null;

        const serverUrl = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;
        return io(serverUrl, {
            auth: { token },
            // The token is short-lived, so a stale one must not be retried
            // forever; apiClient's refresh will supply a new one and remount.
            reconnectionAttempts: 5,
        });
    }, [token]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleConnectError = (error) => {
            console.warn('[Socket] Connection error:', error.message);
        };

        // Server-side validation and rate-limit rejections arrive here rather
        // than as silently dropped events.
        const handleServerError = ({ message }) => {
            toast.error(message || 'The server rejected that action.');
        };

        socket.on('connect_error', handleConnectError);
        socket.on('socket:error', handleServerError);

        return () => {
            socket.off('socket:error', handleServerError);
            socket.off('connect_error', handleConnectError);
            socket.close();
        };
    }, [socket]);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};
