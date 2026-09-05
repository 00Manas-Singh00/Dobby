/**
 * services/authService.js
 * Accounts, password hashing, and JWT issuance.
 *
 * Two token types:
 *  - access token: short-lived JWT, sent as a Bearer header on REST calls and
 *    in the Socket.IO handshake `auth`. Verified statelessly.
 *  - refresh token: long-lived opaque random string, stored hashed in the
 *    relational store so it can be revoked. Exchanged for a new access token at
 *    /api/auth/refresh.
 *
 * Every function that touches the store is async as of Phase 5 — see db.js.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;

// A default secret would mean every deployment that forgot to set one shares
// forgeable tokens. Refuse to start instead.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error(
        'JWT_SECRET must be set to a random string of at least 32 characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
}

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_MS = Number(
    process.env.REFRESH_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000
);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

export class AuthError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const publicUser = (row) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
});

function signAccessToken(user) {
    return jwt.sign(
        { sub: user.id, username: user.username, email: user.email },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL }
    );
}

async function issueRefreshToken(userId) {
    const token = crypto.randomBytes(48).toString('base64url');
    await db.run(
        `INSERT INTO refresh_tokens (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [
            hashToken(token),
            userId,
            new Date().toISOString(),
            new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
        ]
    );
    return token;
}

async function session(userRow) {
    return {
        user: publicUser(userRow),
        accessToken: signAccessToken(userRow),
        refreshToken: await issueRefreshToken(userRow.id),
    };
}

export async function register({ email, username, password }) {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) throw new AuthError('An account with that email already exists.', 409);

    const row = {
        id: uuidv4(),
        email: normalizedEmail,
        username: username.trim(),
        password_hash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
        created_at: new Date().toISOString(),
    };

    await db.run(
        `INSERT INTO users (id, email, username, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.email, row.username, row.password_hash, row.created_at]
    );

    return session(row);
}

export async function login({ email, password }) {
    const row = await db.get('SELECT * FROM users WHERE email = ?', [
        email.trim().toLowerCase(),
    ]);

    // Compare against a dummy hash when the account is missing so that a
    // non-existent email costs the same time as a wrong password.
    const hash = row ? row.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = bcrypt.compareSync(password, hash);

    if (!row || !ok) throw new AuthError('Incorrect email or password.', 401);

    return session(row);
}

/**
 * Exchange a refresh token for a fresh pair, rotating the old one. Reuse of an
 * already-consumed token fails rather than silently issuing a second session.
 */
export async function refresh(refreshToken) {
    if (!refreshToken) throw new AuthError('Missing refresh token.', 401);

    const tokenHash = hashToken(refreshToken);
    const row = await db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);

    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
        throw new AuthError('Refresh token is invalid or expired.', 401);
    }

    await db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?', [
        new Date().toISOString(),
        tokenHash,
    ]);

    const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    if (!user) throw new AuthError('Account no longer exists.', 401);

    return session(user);
}

export async function revokeRefreshToken(refreshToken) {
    if (!refreshToken) return;
    await db.run(
        'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
        [new Date().toISOString(), hashToken(refreshToken)]
    );
}

export async function revokeAllForUser(userId) {
    await db.run(
        'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [new Date().toISOString(), userId]
    );
}

/**
 * Verify an access token and return the current user record.
 * Used by both the Express middleware and the Socket.IO handshake.
 */
export async function verifyAccessToken(token) {
    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        throw new AuthError('Invalid or expired token.', 401);
    }

    // The token is signed, but the account may have been deleted since. Every
    // authorization decision downstream assumes this user still exists.
    const row = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    if (!row) throw new AuthError('Account no longer exists.', 401);

    return publicUser(row);
}

export async function getUserById(userId) {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    return row ? publicUser(row) : null;
}

/** Drop refresh tokens that are expired or long revoked. Called on a timer. */
export async function pruneRefreshTokens() {
    const result = await db.run(
        'DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at < ?',
        [new Date().toISOString(), new Date(Date.now() - REFRESH_TOKEN_TTL_MS).toISOString()]
    );
    return result.changes;
}
