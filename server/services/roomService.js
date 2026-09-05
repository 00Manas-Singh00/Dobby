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
import { seedRoomFiles } from './fileService.js';

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

export async function createRoom(ownerId, name) {
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
    await db.tx(async (t) => {
        await t.run(
            `INSERT INTO rooms (id, name, owner_id, created_at, last_active_at)
             VALUES (?, ?, ?, ?, ?)`,
            [room.id, room.name, room.owner_id, room.created_at, room.last_active_at]
        );
        await t.run(
            `INSERT INTO room_members (room_id, user_id, role, joined_at)
             VALUES (?, ?, 'owner', ?)`,
            [room.id, ownerId, now]
        );
    });

    // A room whose explorer is empty is indistinguishable from a broken one, so
    // it opens with somewhere to type. Outside the transaction above because a
    // failure to seed should not lose the room.
    await seedRoomFiles(room.id);

    return publicRoom(room);
}

export async function getRoom(roomId) {
    const row = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    return row ? publicRoom(row) : null;
}

export async function isMember(roomId, userId) {
    return Boolean(
        await db.get('SELECT 1 AS ok FROM room_members WHERE room_id = ? AND user_id = ?', [
            roomId,
            userId,
        ])
    );
}

export async function isOwner(roomId, userId) {
    return Boolean(
        await db.get('SELECT 1 AS ok FROM rooms WHERE id = ? AND owner_id = ?', [roomId, userId])
    );
}

export async function listRoomsForUser(userId) {
    const rows = await db.all(
        `SELECT r.*, m.role
           FROM rooms r
           JOIN room_members m ON m.room_id = r.id
          WHERE m.user_id = ?
          ORDER BY r.last_active_at DESC`,
        [userId]
    );
    return rows.map((row) => ({ ...publicRoom(row), role: row.role }));
}

export async function listMembers(roomId) {
    const rows = await db.all(
        `SELECT u.id, u.username, u.email, m.role, m.joined_at
           FROM room_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ?
          ORDER BY m.joined_at ASC`,
        [roomId]
    );
    return rows.map((row) => ({
            id: row.id,
            username: row.username,
            email: row.email,
            role: row.role,
        joinedAt: row.joined_at,
    }));
}

export function countMembers(roomId) {
    return db.count('SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?', [roomId]);
}

export async function touchRoom(roomId) {
    await db.run('UPDATE rooms SET last_active_at = ? WHERE id = ?', [
        new Date().toISOString(),
        roomId,
    ]);
}

export async function createInvite(roomId, userId) {
    if (!(await isOwner(roomId, userId))) {
        throw new RoomError('Only the room owner can create invites.', 403);
    }
    if ((await countMembers(roomId)) >= ROOM_CAPACITY) {
        throw new RoomError(`Room already has its maximum of ${ROOM_CAPACITY} members.`, 409);
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    await db.run(
        `INSERT INTO room_invites (token, room_id, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
            token,
            roomId,
            userId,
            now.toISOString(),
            new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
        ]
    );

    return { token, roomId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString() };
}

/**
 * Redeem an invite, adding the caller as a guest. Idempotent for a user who is
 * already a member — re-opening a shared link should not fail.
 */
export async function redeemInvite(token, userId) {
    const invite = await db.get('SELECT * FROM room_invites WHERE token = ?', [token]);
    if (!invite) throw new RoomError('Invite is invalid.', 404);

    if (await isMember(invite.room_id, userId)) {
        return { room: await getRoom(invite.room_id), alreadyMember: true };
    }

    if (invite.used_at) throw new RoomError('Invite has already been used.', 410);
    if (new Date(invite.expires_at) < new Date()) throw new RoomError('Invite has expired.', 410);
    if ((await countMembers(invite.room_id)) >= ROOM_CAPACITY) {
        throw new RoomError(`Room is full (maximum ${ROOM_CAPACITY} members).`, 409);
    }

    const now = new Date().toISOString();
    await db.tx(async (t) => {
        await t.run(
            `INSERT INTO room_members (room_id, user_id, role, joined_at)
             VALUES (?, ?, 'guest', ?)`,
            [invite.room_id, userId, now]
        );
        await t.run('UPDATE room_invites SET used_at = ?, used_by = ? WHERE token = ?', [
            now,
            userId,
            token,
        ]);
    });

    return { room: await getRoom(invite.room_id), alreadyMember: false };
}

export async function listInvites(roomId, userId) {
    if (!(await isOwner(roomId, userId))) {
        throw new RoomError('Only the room owner can list invites.', 403);
    }
    const rows = await db.all(
        `SELECT token, created_at, expires_at, used_at
           FROM room_invites WHERE room_id = ? ORDER BY created_at DESC`,
        [roomId]
    );
    return rows.map((row) => ({
            token: row.token,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        usedAt: row.used_at,
    }));
}

export async function revokeInvite(roomId, token, userId) {
    if (!(await isOwner(roomId, userId))) {
        throw new RoomError('Only the room owner can revoke invites.', 403);
    }
    const result = await db.run(
        'DELETE FROM room_invites WHERE room_id = ? AND token = ? AND used_at IS NULL',
        [roomId, token]
    );
    if (result.changes === 0) throw new RoomError('No such pending invite.', 404);
}

/** Owner removes a guest, or a guest removes themselves. Owners cannot leave. */
export async function removeMember(roomId, targetUserId, actingUserId) {
    if (await isOwner(roomId, targetUserId)) {
        throw new RoomError('The owner cannot be removed; delete the room instead.', 400);
    }
    if (targetUserId !== actingUserId && !(await isOwner(roomId, actingUserId))) {
        throw new RoomError('Only the room owner can remove other members.', 403);
    }
    const result = await db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [
        roomId,
        targetUserId,
    ]);
    if (result.changes === 0) throw new RoomError('That user is not a member of this room.', 404);
}

export async function deleteRoom(roomId, userId) {
    if (!(await isOwner(roomId, userId))) {
        throw new RoomError('Only the room owner can delete a room.', 403);
    }
    // Members and invites cascade; the room's Yjs documents are removed
    // separately by the caller (see services/yjsService.js).
    await db.run('DELETE FROM rooms WHERE id = ?', [roomId]);
}

/** Rooms untouched for longer than `maxAgeMs`. Drives the retention sweep. */
export async function listStaleRooms(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = await db.all('SELECT * FROM rooms WHERE last_active_at < ?', [cutoff]);
    return rows.map(publicRoom);
}

export async function pruneInvites() {
    const result = await db.run('DELETE FROM room_invites WHERE expires_at < ?', [
        new Date().toISOString(),
    ]);
    return result.changes;
}
