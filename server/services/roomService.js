/**
 * services/roomService.js
 * Room ownership and membership.
 *
 * This replaces security-by-UUID. Knowing a room id is no longer sufficient to
 * enter it: a caller must either already be a member or redeem a single-use
 * invite issued by the owner. `isMember` is the single predicate every
 * capability in the room — editor, chat, whiteboard, video, terminal — is
 * gated on.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

export const ROOM_CAPACITY = 2; // see docs/07-adrs.md#adr-006

const INVITE_TTL_MS = Number(process.env.INVITE_TTL_MS || 24 * 60 * 60 * 1000);

export class RoomError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const publicRoom = (row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
});

export function createRoom(ownerId, name) {
    const now = new Date().toISOString();
    const room = {
        id: uuidv4(),
        name: (name || '').trim() || 'Untitled room',
        owner_id: ownerId,
        created_at: now,
        last_active_at: now,
    };

    // The room and its owner membership must appear together — a room with no
    // members would be unreachable by anyone, including its creator.
    db.transaction(() => {
        db.prepare(
            `INSERT INTO rooms (id, name, owner_id, created_at, last_active_at)
             VALUES (@id, @name, @owner_id, @created_at, @last_active_at)`
        ).run(room);
        db.prepare(
            `INSERT INTO room_members (room_id, user_id, role, joined_at)
             VALUES (?, ?, 'owner', ?)`
        ).run(room.id, ownerId, now);
    })();

    return publicRoom(room);
}

export function getRoom(roomId) {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    return row ? publicRoom(row) : null;
}

export function isMember(roomId, userId) {
    return Boolean(
        db
            .prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
            .get(roomId, userId)
    );
}

export function isOwner(roomId, userId) {
    return Boolean(
        db.prepare('SELECT 1 FROM rooms WHERE id = ? AND owner_id = ?').get(roomId, userId)
    );
}

export function listRoomsForUser(userId) {
    return db
        .prepare(
            `SELECT r.*, m.role
               FROM rooms r
               JOIN room_members m ON m.room_id = r.id
              WHERE m.user_id = ?
              ORDER BY r.last_active_at DESC`
        )
        .all(userId)
        .map((row) => ({ ...publicRoom(row), role: row.role }));
}

export function listMembers(roomId) {
    return db
        .prepare(
            `SELECT u.id, u.username, u.email, m.role, m.joined_at
               FROM room_members m
               JOIN users u ON u.id = m.user_id
              WHERE m.room_id = ?
              ORDER BY m.joined_at ASC`
        )
        .all(roomId)
        .map((row) => ({
            id: row.id,
            username: row.username,
            email: row.email,
            role: row.role,
            joinedAt: row.joined_at,
        }));
}

export function countMembers(roomId) {
    return db
        .prepare('SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?')
        .get(roomId).n;
}

export function touchRoom(roomId) {
    db.prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?')
        .run(new Date().toISOString(), roomId);
}

export function createInvite(roomId, userId) {
    if (!isOwner(roomId, userId)) {
        throw new RoomError('Only the room owner can create invites.', 403);
    }
    if (countMembers(roomId) >= ROOM_CAPACITY) {
        throw new RoomError(`Room already has its maximum of ${ROOM_CAPACITY} members.`, 409);
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare(
        `INSERT INTO room_invites (token, room_id, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
        token,
        roomId,
        userId,
        now.toISOString(),
        new Date(now.getTime() + INVITE_TTL_MS).toISOString()
    );

    return { token, roomId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString() };
}

/**
 * Redeem an invite, adding the caller as a guest. Idempotent for a user who is
 * already a member — re-opening a shared link should not fail.
 */
export function redeemInvite(token, userId) {
    const invite = db.prepare('SELECT * FROM room_invites WHERE token = ?').get(token);
    if (!invite) throw new RoomError('Invite is invalid.', 404);

    if (isMember(invite.room_id, userId)) {
        return { room: getRoom(invite.room_id), alreadyMember: true };
    }

    if (invite.used_at) throw new RoomError('Invite has already been used.', 410);
    if (new Date(invite.expires_at) < new Date()) throw new RoomError('Invite has expired.', 410);
    if (countMembers(invite.room_id) >= ROOM_CAPACITY) {
        throw new RoomError(`Room is full (maximum ${ROOM_CAPACITY} members).`, 409);
    }

    const now = new Date().toISOString();
    db.transaction(() => {
        db.prepare(
            `INSERT INTO room_members (room_id, user_id, role, joined_at)
             VALUES (?, ?, 'guest', ?)`
        ).run(invite.room_id, userId, now);
        db.prepare('UPDATE room_invites SET used_at = ?, used_by = ? WHERE token = ?')
            .run(now, userId, token);
    })();

    return { room: getRoom(invite.room_id), alreadyMember: false };
}

export function listInvites(roomId, userId) {
    if (!isOwner(roomId, userId)) {
        throw new RoomError('Only the room owner can list invites.', 403);
    }
    return db
        .prepare(
            `SELECT token, created_at, expires_at, used_at
               FROM room_invites WHERE room_id = ? ORDER BY created_at DESC`
        )
        .all(roomId)
        .map((row) => ({
            token: row.token,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            usedAt: row.used_at,
        }));
}

export function revokeInvite(roomId, token, userId) {
    if (!isOwner(roomId, userId)) {
        throw new RoomError('Only the room owner can revoke invites.', 403);
    }
    const result = db
        .prepare('DELETE FROM room_invites WHERE room_id = ? AND token = ? AND used_at IS NULL')
        .run(roomId, token);
    if (result.changes === 0) throw new RoomError('No such pending invite.', 404);
}

/** Owner removes a guest, or a guest removes themselves. Owners cannot leave. */
export function removeMember(roomId, targetUserId, actingUserId) {
    if (isOwner(roomId, targetUserId)) {
        throw new RoomError('The owner cannot be removed; delete the room instead.', 400);
    }
    if (targetUserId !== actingUserId && !isOwner(roomId, actingUserId)) {
        throw new RoomError('Only the room owner can remove other members.', 403);
    }
    const result = db
        .prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?')
        .run(roomId, targetUserId);
    if (result.changes === 0) throw new RoomError('That user is not a member of this room.', 404);
}

export function deleteRoom(roomId, userId) {
    if (!isOwner(roomId, userId)) {
        throw new RoomError('Only the room owner can delete a room.', 403);
    }
    // Members and invites cascade; the room's Yjs documents are removed
    // separately by the caller (see services/yjsService.js).
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}

/** Rooms untouched for longer than `maxAgeMs`. Drives the retention sweep. */
export function listStaleRooms(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    return db
        .prepare('SELECT * FROM rooms WHERE last_active_at < ?')
        .all(cutoff)
        .map(publicRoom);
}

export function pruneInvites() {
    return db
        .prepare('DELETE FROM room_invites WHERE expires_at < ?')
        .run(new Date().toISOString()).changes;
}
