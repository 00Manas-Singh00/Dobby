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

const newUser = (name) =>
    register({ email: `${name}@example.com`, username: name, password: 'correct horse battery' }).user;

beforeEach(() => {
    db.exec('DELETE FROM refresh_tokens; DELETE FROM room_invites; DELETE FROM room_members; DELETE FROM rooms; DELETE FROM users;');
    owner = newUser('owner');
    guest = newUser('guest');
    stranger = newUser('stranger');
});

/** Move an invite's expiry into the past without waiting for it. */
const expireInvite = (token) =>
    db
        .prepare('UPDATE room_invites SET expires_at = ? WHERE token = ?')
        .run(new Date(Date.now() - 1000).toISOString(), token);

describe('createRoom', () => {
    it('makes the creator a member and the owner', () => {
        const room = createRoom(owner.id, 'Interview');

        expect(room.ownerId).toBe(owner.id);
        expect(isOwner(room.id, owner.id)).toBe(true);
        expect(isMember(room.id, owner.id)).toBe(true);
        expect(listMembers(room.id)).toEqual([expect.objectContaining({ id: owner.id, role: 'owner' })]);
    });

    it('falls back to a placeholder name for a blank one', () => {
        expect(createRoom(owner.id, '   ').name).toBe('Untitled room');
        expect(createRoom(owner.id, undefined).name).toBe('Untitled room');
    });

    it('leaves nobody a member of a room that failed to create', () => {
        // The room row and the owner membership are written in one transaction;
        // a room with no members would be unreachable by anyone, including its
        // creator.
        expect(() => createRoom('no-such-user', 'Orphan')).toThrow();
        expect(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n).toBe(0);
    });
});

describe('isMember', () => {
    it('is false for a stranger who knows the room id', () => {
        const room = createRoom(owner.id, 'Private');
        // Security-by-UUID is retired: the id is a lookup key, not a capability.
        expect(isMember(room.id, stranger.id)).toBe(false);
    });

    it('is false for a room that does not exist', () => {
        expect(isMember('00000000-0000-0000-0000-000000000000', owner.id)).toBe(false);
    });
});

describe('createInvite', () => {
    it('issues a token only for the owner', () => {
        const room = createRoom(owner.id, 'Interview');

        expect(createInvite(room.id, owner.id).token).toBeTypeOf('string');
        expect(() => createInvite(room.id, stranger.id)).toThrow(
            expect.objectContaining({ status: 403 })
        );
    });

    it('refuses once the room is already full', () => {
        const room = createRoom(owner.id, 'Interview');
        redeemInvite(createInvite(room.id, owner.id).token, guest.id);

        expect(countMembers(room.id)).toBe(ROOM_CAPACITY);
        expect(() => createInvite(room.id, owner.id)).toThrow(
            expect.objectContaining({ status: 409 })
        );
    });

    it('sets an expiry in the future', () => {
        const room = createRoom(owner.id, 'Interview');
        const invite = createInvite(room.id, owner.id);
        expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
});

describe('redeemInvite', () => {
    it('adds the redeemer as a guest', () => {
        const room = createRoom(owner.id, 'Interview');
        const result = redeemInvite(createInvite(room.id, owner.id).token, guest.id);

        expect(result.alreadyMember).toBe(false);
        expect(isMember(room.id, guest.id)).toBe(true);
        expect(isOwner(room.id, guest.id)).toBe(false);
    });

    it('is single use', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        redeemInvite(token, guest.id);

        expect(() => redeemInvite(token, stranger.id)).toThrow(
            expect.objectContaining({ status: 410 })
        );
        expect(isMember(room.id, stranger.id)).toBe(false);
    });

    it('is idempotent for someone who is already a member', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        redeemInvite(token, guest.id);

        // Re-opening a shared link should not fail for the person who already
        // used it.
        const again = redeemInvite(token, guest.id);
        expect(again.alreadyMember).toBe(true);
        expect(countMembers(room.id)).toBe(2);
    });

    it('rejects an expired token', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        expireInvite(token);

        expect(() => redeemInvite(token, guest.id)).toThrow(expect.objectContaining({ status: 410 }));
        expect(isMember(room.id, guest.id)).toBe(false);
    });

    it('rejects an unknown token with 404', () => {
        expect(() => redeemInvite('never-issued', guest.id)).toThrow(
            expect.objectContaining({ status: 404 })
        );
    });

    it('rejects a valid token once the room is at capacity', () => {
        const room = createRoom(owner.id, 'Interview');
        // Two outstanding invites, then the second redeemer arrives late.
        const first = createInvite(room.id, owner.id);
        const second = createInvite(room.id, owner.id);

        redeemInvite(first.token, guest.id);
        expect(() => redeemInvite(second.token, stranger.id)).toThrow(
            expect.objectContaining({ status: 409 })
        );
        expect(countMembers(room.id)).toBe(ROOM_CAPACITY);
    });

    it('leaves the invite unspent when redemption fails', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        expireInvite(token);

        expect(() => redeemInvite(token, guest.id)).toThrow();
        expect(db.prepare('SELECT used_at FROM room_invites WHERE token = ?').get(token).used_at).toBeNull();
    });
});

describe('listInvites and revokeInvite', () => {
    it('are owner-only', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        redeemInvite(createInvite(room.id, owner.id).token, guest.id);

        expect(() => listInvites(room.id, guest.id)).toThrow(expect.objectContaining({ status: 403 }));
        expect(() => revokeInvite(room.id, token, guest.id)).toThrow(
            expect.objectContaining({ status: 403 })
        );
    });

    it('revoking makes a pending invite unredeemable', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);

        revokeInvite(room.id, token, owner.id);
        expect(() => redeemInvite(token, guest.id)).toThrow(expect.objectContaining({ status: 404 }));
    });

    it('refuses to revoke an invite that has already been used', () => {
        const room = createRoom(owner.id, 'Interview');
        const { token } = createInvite(room.id, owner.id);
        redeemInvite(token, guest.id);

        // Nothing to revoke — the membership it created is what would have to
        // be removed instead.
        expect(() => revokeInvite(room.id, token, owner.id)).toThrow(
            expect.objectContaining({ status: 404 })
        );
    });
});

describe('removeMember', () => {
    let room;
    beforeEach(() => {
        room = createRoom(owner.id, 'Interview');
        redeemInvite(createInvite(room.id, owner.id).token, guest.id);
    });

    it('lets the owner remove a guest', () => {
        removeMember(room.id, guest.id, owner.id);
        expect(isMember(room.id, guest.id)).toBe(false);
    });

    it('lets a guest remove themselves', () => {
        removeMember(room.id, guest.id, guest.id);
        expect(isMember(room.id, guest.id)).toBe(false);
    });

    it('refuses to remove the owner', () => {
        expect(() => removeMember(room.id, owner.id, owner.id)).toThrow(
            expect.objectContaining({ status: 400 })
        );
        expect(isMember(room.id, owner.id)).toBe(true);
    });

    it('refuses to let a guest remove somebody else', () => {
        expect(() => removeMember(room.id, guest.id, stranger.id)).toThrow(
            expect.objectContaining({ status: 403 })
        );
        expect(isMember(room.id, guest.id)).toBe(true);
    });

    it('frees a seat, so a new invite can be issued', () => {
        expect(() => createInvite(room.id, owner.id)).toThrow();
        removeMember(room.id, guest.id, owner.id);
        expect(() => createInvite(room.id, owner.id)).not.toThrow();
    });
});

describe('deleteRoom', () => {
    it('is owner-only', () => {
        const room = createRoom(owner.id, 'Interview');
        redeemInvite(createInvite(room.id, owner.id).token, guest.id);

        expect(() => deleteRoom(room.id, guest.id)).toThrow(expect.objectContaining({ status: 403 }));
        expect(getRoom(room.id)).not.toBeNull();
    });

    it('cascades to memberships and invites', () => {
        const room = createRoom(owner.id, 'Interview');
        createInvite(room.id, owner.id);
        redeemInvite(createInvite(room.id, owner.id).token, guest.id);

        deleteRoom(room.id, owner.id);

        expect(getRoom(room.id)).toBeNull();
        expect(countMembers(room.id)).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM room_invites WHERE room_id = ?').get(room.id).n).toBe(0);
    });
});

describe('listRoomsForUser', () => {
    it('returns owned and joined rooms with the right role, and nobody else\'s', () => {
        const owned = createRoom(owner.id, 'Mine');
        const joined = createRoom(guest.id, 'Theirs');
        redeemInvite(createInvite(joined.id, guest.id).token, owner.id);
        createRoom(stranger.id, 'Unrelated');

        const rooms = listRoomsForUser(owner.id);

        expect(rooms.map((r) => r.id).sort()).toEqual([owned.id, joined.id].sort());
        expect(rooms.find((r) => r.id === owned.id).role).toBe('owner');
        expect(rooms.find((r) => r.id === joined.id).role).toBe('guest');
    });
});

describe('retention helpers', () => {
    /** Backdate a room's last activity by `ms`. */
    const ageRoom = (roomId, ms) =>
        db
            .prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?')
            .run(new Date(Date.now() - ms).toISOString(), roomId);

    it('listStaleRooms returns only rooms past the cutoff', () => {
        const fresh = createRoom(owner.id, 'Fresh');
        const stale = createRoom(owner.id, 'Stale');
        ageRoom(stale.id, 10_000);

        const found = listStaleRooms(5_000);
        expect(found.map((r) => r.id)).toEqual([stale.id]);
        expect(found.map((r) => r.id)).not.toContain(fresh.id);
    });

    it('touchRoom takes a room back out of the stale set', () => {
        const room = createRoom(owner.id, 'Stale');
        ageRoom(room.id, 10_000);
        expect(listStaleRooms(5_000)).toHaveLength(1);

        touchRoom(room.id);
        expect(listStaleRooms(5_000)).toHaveLength(0);
    });

    it('pruneInvites drops expired ones and keeps live ones', () => {
        const room = createRoom(owner.id, 'Interview');
        const expired = createInvite(room.id, owner.id);
        expireInvite(expired.token);
        const live = createInvite(room.id, owner.id);

        expect(pruneInvites()).toBe(1);
        expect(db.prepare('SELECT token FROM room_invites').all()).toEqual([{ token: live.token }]);
    });
});
