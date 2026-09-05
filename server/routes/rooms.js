/**
 * routes/rooms.js
 * Room ownership, membership, and invites.
 *
 * Rooms are created here rather than by the client generating a UUID. That is
 * the substantive change: a room now has an owner from the moment it exists,
 * and its id is a lookup key rather than a capability.
 */

import express from 'express';
import {
    createRoom,
    getRoom,
    listRoomsForUser,
    listMembers,
    isMember,
    createInvite,
    listInvites,
    revokeInvite,
    redeemInvite,
    removeMember,
    deleteRoom,
    RoomError,
} from '../services/roomService.js';
import { deleteRoomDocuments } from '../services/yjsService.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, createRoomSchema, redeemInviteSchema } from '../middleware/validate.js';

const router = express.Router();

// Nothing in this router is reachable anonymously.
router.use(requireAuth);

function handle(res, fn) {
    try {
        const body = fn();
        return res.json(body ?? { ok: true });
    } catch (error) {
        if (error instanceof RoomError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('[Rooms] Unexpected error:', error);
        return res.status(500).json({ error: 'Request failed.' });
    }
}

/** Membership gate for every :roomId route below. */
function requireMembership(req, res, next) {
    const room = getRoom(req.params.roomId);
    // Same response for "no such room" and "not your room": distinguishing them
    // would let a caller enumerate which room ids exist.
    if (!room || !isMember(room.id, req.user.id)) {
        return res.status(404).json({ error: 'Room not found.' });
    }
    req.room = room;
    return next();
}

/** GET /api/rooms → rooms the caller owns or has been invited to. */
router.get('/', (req, res) => handle(res, () => ({ rooms: listRoomsForUser(req.user.id) })));

/** POST /api/rooms → creates a room owned by the caller. */
router.post('/', validateBody(createRoomSchema), (req, res) =>
    handle(res, () => ({ room: createRoom(req.user.id, req.body.name) }))
);

/** POST /api/rooms/join → redeem an invite token. */
router.post('/join', validateBody(redeemInviteSchema), (req, res) =>
    handle(res, () => redeemInvite(req.body.token, req.user.id))
);

/** GET /api/rooms/:roomId → room plus its members. */
router.get('/:roomId', requireMembership, (req, res) =>
    handle(res, () => ({ room: req.room, members: listMembers(req.room.id) }))
);

/** POST /api/rooms/:roomId/invites → a single-use, expiring invite token. */
router.post('/:roomId/invites', requireMembership, (req, res) =>
    handle(res, () => ({ invite: createInvite(req.room.id, req.user.id) }))
);

/** GET /api/rooms/:roomId/invites — owner only. */
router.get('/:roomId/invites', requireMembership, (req, res) =>
    handle(res, () => ({ invites: listInvites(req.room.id, req.user.id) }))
);

/** DELETE /api/rooms/:roomId/invites/:token — owner only. */
router.delete('/:roomId/invites/:token', requireMembership, (req, res) =>
    handle(res, () => {
        revokeInvite(req.room.id, req.params.token, req.user.id);
    })
);

/** DELETE /api/rooms/:roomId/members/:userId — owner removes a guest, or a guest leaves. */
router.delete('/:roomId/members/:userId', requireMembership, (req, res) =>
    handle(res, () => {
        removeMember(req.room.id, req.params.userId, req.user.id);
    })
);

/** DELETE /api/rooms/:roomId — owner only; also drops the room's Yjs documents. */
router.delete('/:roomId', requireMembership, (req, res) =>
    handle(res, () => {
        deleteRoom(req.room.id, req.user.id);
        // Best-effort: the room record is already gone, so a failure here leaves
        // orphaned documents for the retention sweep rather than a live leak.
        deleteRoomDocuments(req.room.id).catch((error) =>
            console.error(`[Rooms] Failed to drop documents for ${req.room.id}:`, error.message)
        );
    })
);

export default router;
