/**
 * middleware/auth.js
 * Bearer-token authentication for the REST surface, and the equivalent
 * handshake check for Socket.IO.
 */

import { verifyAccessToken } from '../services/authService.js';

function bearerToken(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
}

/** Rejects the request unless it carries a valid access token. */
export async function requireAuth(req, res, next) {
    const token = bearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
        req.user = await verifyAccessToken(token);
        return next();
    } catch (error) {
        return res.status(error.status || 401).json({ error: error.message });
    }
}

/**
 * Socket.IO handshake middleware. Runs before any event handler, so an
 * unauthenticated socket never reaches `join room`. The verified user is
 * attached to the socket and is the only identity the server trusts —
 * client-supplied usernames are ignored everywhere downstream.
 */
export async function socketAuth(socket, next) {
    const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '');

    if (!token) {
        return next(new Error('Authentication required.'));
    }

    try {
        socket.data.user = await verifyAccessToken(token);
        return next();
    } catch (error) {
        return next(new Error(error.message));
    }
}
