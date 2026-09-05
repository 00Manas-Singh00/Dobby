/**
 * Room ownership, invite redemption, and capacity.
 *
 * `isMember` is the single predicate every capability in the product is gated
 * on, and invites are what create membership. The rules that matter are the
 * ones that fail open if broken: single use, expiry, capacity, and who may
 * issue or revoke.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../db.js';
import { resetDatabase } from '../helpers/db.js';
import { register } from '../../services/authService.js';
import {
    createRoom,
    getRoom,
    isMember,
    isOwner,
    listRoomsForUser,
    listMembers,
    countMembers,
    createInvite,
    redeemInvite,
    listInvites,
    revokeInvite,
    removeMember,
    deleteRoom,
    listStaleRooms,
    pruneInvites,
    touchRoom,
    ROOM_CAPACITY,
    RoomError,
} from '../../services/roomService.js';

let owner;
let guest;
let stranger;

const newUser = async (name) => {
    const session = await register({
        email: `${name}@example.com`,
        username: name,
        password: 'correct horse battery',
    });
    return session.user;
};

beforeEach(async () => {
    await resetDatabase();
    owner = await newUser('owner');
    guest = await newUser('guest');
    stranger = await newUser('stranger');
});

/** Move an invite's expiry into the past without waiting for it. */
const expireInvite = (token) =>
    db.run('UPDATE room_invites SET expires_at = ? WHERE token = ?', [
        new Date(Date.now() - 1000).toISOString(),
        token,
    ]);

describe('createRoom', () => {
    it('makes the creator a member and the owner', async () => {
        const room = await createRoom(owner.id, 'Interview');

        expect(room.ownerId).toBe(owner.id);
        expect(await isOwner(room.id, owner.id)).toBe(true);
        expect(await isMember(room.id, owner.id)).toBe(true);
        expect(await listMembers(room.id)).toEqual([expect.objectContaining({ id: owner.id, role: 'owner' })]);
    });

    it('falls back to a placeholder name for a blank one', async () => {
        expect((await createRoom(owner.id, '   ')).name).toBe('Untitled room');
        expect((await createRoom(owner.id, undefined)).name).toBe('Untitled room');
    });

    it('leaves nobody a member of a room that failed to create', async () => {
        // The room row and the owner membership are written in one transaction;
        // a room with no members would be unreachable by anyone, including its
        // creator.
        await expect(createRoom('no-such-user', 'Orphan')).rejects.toThrow();
        expect(await db.count('SELECT COUNT(*) AS n FROM rooms')).toBe(0);
    });
});

describe('isMember', () => {
    it('is false for a stranger who knows the room id', async () => {
        const room = await createRoom(owner.id, 'Private');
        // Security-by-UUID is retired: the id is a lookup key, not a capability.
        expect(await isMember(room.id, stranger.id)).toBe(false);
    });

    it('is false for a room that does not exist', async () => {
        expect(await isMember('00000000-0000-0000-0000-000000000000', owner.id)).toBe(false);
    });
});

describe('createInvite', () => {
    it('issues a token only for the owner', async () => {
        const room = await createRoom(owner.id, 'Interview');

        expect((await createInvite(room.id, owner.id)).token).toBeTypeOf('string');
        await expect(createInvite(room.id, stranger.id)).rejects.toThrow(expect.objectContaining({ status: 403 }));
    });

    it('refuses once the room is already full', async () => {
        const room = await createRoom(owner.id, 'Interview');
        await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);

        expect(await countMembers(room.id)).toBe(ROOM_CAPACITY);
        await expect(createInvite(room.id, owner.id)).rejects.toThrow(expect.objectContaining({ status: 409 }));
    });

    it('sets an expiry in the future', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const invite = await createInvite(room.id, owner.id);
        expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
});

describe('redeemInvite', () => {
    it('adds the redeemer as a guest', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const result = await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);

        expect(result.alreadyMember).toBe(false);
        expect(await isMember(room.id, guest.id)).toBe(true);
        expect(await isOwner(room.id, guest.id)).toBe(false);
    });

    it('is single use', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await redeemInvite(token, guest.id);

        await expect(redeemInvite(token, stranger.id)).rejects.toThrow(expect.objectContaining({ status: 410 }));
        expect(await isMember(room.id, stranger.id)).toBe(false);
    });

    it('is idempotent for someone who is already a member', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await redeemInvite(token, guest.id);

        // Re-opening a shared link should not fail for the person who already
        // used it.
        const again = await redeemInvite(token, guest.id);
        expect(again.alreadyMember).toBe(true);
        expect(await countMembers(room.id)).toBe(2);
    });

    it('rejects an expired token', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await expireInvite(token);

        await expect(redeemInvite(token, guest.id)).rejects.toThrow(expect.objectContaining({ status: 410 }));
        expect(await isMember(room.id, guest.id)).toBe(false);
    });

    it('rejects an unknown token with 404', async () => {
        await expect(redeemInvite('never-issued', guest.id)).rejects.toThrow(expect.objectContaining({ status: 404 }));
    });

    it('rejects a valid token once the room is at capacity', async () => {
        const room = await createRoom(owner.id, 'Interview');
        // Two outstanding invites, then the second redeemer arrives late.
        const first = await createInvite(room.id, owner.id);
        const second = await createInvite(room.id, owner.id);

        await redeemInvite(first.token, guest.id);
        await expect(redeemInvite(second.token, stranger.id)).rejects.toThrow(expect.objectContaining({ status: 409 }));
        expect(await countMembers(room.id)).toBe(ROOM_CAPACITY);
    });

    it('leaves the invite unspent when redemption fails', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await expireInvite(token);

        await expect(redeemInvite(token, guest.id)).rejects.toThrow();
        const stored = await db.get('SELECT used_at FROM room_invites WHERE token = ?', [token]);
        expect(stored.used_at).toBeNull();
    });
});

describe('listInvites and revokeInvite', () => {
    it('are owner-only', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);

        await expect(listInvites(room.id, guest.id)).rejects.toThrow(expect.objectContaining({ status: 403 }));
        await expect(revokeInvite(room.id, token, guest.id)).rejects.toThrow(expect.objectContaining({ status: 403 }));
    });

    it('revoking makes a pending invite unredeemable', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);

        await revokeInvite(room.id, token, owner.id);
        await expect(redeemInvite(token, guest.id)).rejects.toThrow(expect.objectContaining({ status: 404 }));
    });

    it('refuses to revoke an invite that has already been used', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const { token } = await createInvite(room.id, owner.id);
        await redeemInvite(token, guest.id);

        // Nothing to revoke — the membership it created is what would have to
        // be removed instead.
        await expect(revokeInvite(room.id, token, owner.id)).rejects.toThrow(expect.objectContaining({ status: 404 }));
    });
});

describe('removeMember', () => {
    let room;
    beforeEach(async () => {
        room = await createRoom(owner.id, 'Interview');
        await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);
    });

    it('lets the owner remove a guest', async () => {
        await removeMember(room.id, guest.id, owner.id);
        expect(await isMember(room.id, guest.id)).toBe(false);
    });

    it('lets a guest remove themselves', async () => {
        await removeMember(room.id, guest.id, guest.id);
        expect(await isMember(room.id, guest.id)).toBe(false);
    });

    it('refuses to remove the owner', async () => {
        await expect(removeMember(room.id, owner.id, owner.id)).rejects.toThrow(expect.objectContaining({ status: 400 }));
        expect(await isMember(room.id, owner.id)).toBe(true);
    });

    it('refuses to let a guest remove somebody else', async () => {
        await expect(removeMember(room.id, guest.id, stranger.id)).rejects.toThrow(expect.objectContaining({ status: 403 }));
        expect(await isMember(room.id, guest.id)).toBe(true);
    });

    it('frees a seat, so a new invite can be issued', async () => {
        await expect(createInvite(room.id, owner.id)).rejects.toThrow();
        await removeMember(room.id, guest.id, owner.id);
        await expect(createInvite(room.id, owner.id)).resolves.toBeDefined();
    });
});

describe('deleteRoom', () => {
    it('is owner-only', async () => {
        const room = await createRoom(owner.id, 'Interview');
        await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);

        await expect(deleteRoom(room.id, guest.id)).rejects.toThrow(expect.objectContaining({ status: 403 }));
        expect(await getRoom(room.id)).not.toBeNull();
    });

    it('cascades to memberships and invites', async () => {
        const room = await createRoom(owner.id, 'Interview');
        await createInvite(room.id, owner.id);
        await redeemInvite((await createInvite(room.id, owner.id)).token, guest.id);

        await deleteRoom(room.id, owner.id);

        expect(await getRoom(room.id)).toBeNull();
        expect(await countMembers(room.id)).toBe(0);
        expect(
            await db.count('SELECT COUNT(*) AS n FROM room_invites WHERE room_id = ?', [room.id])
        ).toBe(0);
    });
});

describe('listRoomsForUser', () => {
    it('returns owned and joined rooms with the right role, and nobody else\'s', async () => {
        const owned = await createRoom(owner.id, 'Mine');
        const joined = await createRoom(guest.id, 'Theirs');
        await redeemInvite((await createInvite(joined.id, guest.id)).token, owner.id);
        await createRoom(stranger.id, 'Unrelated');

        const rooms = await listRoomsForUser(owner.id);

        expect(rooms.map((r) => r.id).sort()).toEqual([owned.id, joined.id].sort());
        expect(rooms.find((r) => r.id === owned.id).role).toBe('owner');
        expect(rooms.find((r) => r.id === joined.id).role).toBe('guest');
    });
});

describe('retention helpers', () => {
    /** Backdate a room's last activity by `ms`. */
    const ageRoom = (roomId, ms) =>
        db.run('UPDATE rooms SET last_active_at = ? WHERE id = ?', [
            new Date(Date.now() - ms).toISOString(),
            roomId,
        ]);

    it('listStaleRooms returns only rooms past the cutoff', async () => {
        const fresh = await createRoom(owner.id, 'Fresh');
        const stale = await createRoom(owner.id, 'Stale');
        await ageRoom(stale.id, 10_000);

        const found = await listStaleRooms(5_000);
        expect(found.map((r) => r.id)).toEqual([stale.id]);
        expect(found.map((r) => r.id)).not.toContain(fresh.id);
    });

    it('touchRoom takes a room back out of the stale set', async () => {
        const room = await createRoom(owner.id, 'Stale');
        await ageRoom(room.id, 10_000);
        expect(await listStaleRooms(5_000)).toHaveLength(1);

        await touchRoom(room.id);
        expect(await listStaleRooms(5_000)).toHaveLength(0);
    });

    it('pruneInvites drops expired ones and keeps live ones', async () => {
        const room = await createRoom(owner.id, 'Interview');
        const expired = await createInvite(room.id, owner.id);
        await expireInvite(expired.token);
        const live = await createInvite(room.id, owner.id);

        expect(await pruneInvites()).toBe(1);
        expect(await db.all('SELECT token FROM room_invites')).toEqual([{ token: live.token }]);
    });
});
