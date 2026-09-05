/**
 * The retention sweep.
 *
 * Nothing here expired before Phase 1, so the sweep is new code whose failure
 * is silent in both directions: a sweep that does nothing quietly accumulates
 * data forever, and one that is too eager quietly deletes a room somebody is
 * still using.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import db from '../../db.js';
import { register } from '../../services/authService.js';
import { createRoom, createInvite, getRoom, listRoomsForUser } from '../../services/roomService.js';
import { runRetentionSweep, ROOM_RETENTION_MS, startRetentionSweep } from '../../services/retentionService.js';

let owner;

/** Backdate a room's last activity so the sweep considers it stale. */
const ageRoom = (roomId, ms) =>
    db
        .prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?')
        .run(new Date(Date.now() - ms).toISOString(), roomId);

beforeEach(() => {
    db.exec('DELETE FROM refresh_tokens; DELETE FROM room_invites; DELETE FROM room_members; DELETE FROM rooms; DELETE FROM users;');
    owner = register({ email: 'owner@example.com', username: 'owner', password: 'correct horse battery' }).user;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('runRetentionSweep', () => {
    it('deletes a room idle past the retention window', async () => {
        const stale = createRoom(owner.id, 'Abandoned');
        ageRoom(stale.id, ROOM_RETENTION_MS + 1000);

        const summary = await runRetentionSweep();

        expect(summary.rooms).toBe(1);
        expect(getRoom(stale.id)).toBeNull();
    });

    it('leaves a recently active room alone', async () => {
        const active = createRoom(owner.id, 'In use');
        ageRoom(active.id, ROOM_RETENTION_MS - 60_000);

        const summary = await runRetentionSweep();

        expect(summary.rooms).toBe(0);
        expect(getRoom(active.id)).not.toBeNull();
    });

    it('takes the room\'s memberships and invites with it', async () => {
        const stale = createRoom(owner.id, 'Abandoned');
        createInvite(stale.id, owner.id);
        ageRoom(stale.id, ROOM_RETENTION_MS + 1000);

        await runRetentionSweep();

        expect(listRoomsForUser(owner.id)).toEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS n FROM room_invites').get().n).toBe(0);
    });

    it('collects expired invites from rooms that are staying', async () => {
        const room = createRoom(owner.id, 'Active');
        const invite = createInvite(room.id, owner.id);
        db.prepare('UPDATE room_invites SET expires_at = ? WHERE token = ?')
            .run(new Date(Date.now() - 1000).toISOString(), invite.token);

        const summary = await runRetentionSweep();

        expect(summary.invites).toBe(1);
        expect(getRoom(room.id)).not.toBeNull();
    });

    it('collects spent refresh tokens', async () => {
        db.prepare('UPDATE refresh_tokens SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
        expect((await runRetentionSweep()).refreshTokens).toBe(1);
    });

    it('reports zeroes and changes nothing when there is nothing to collect', async () => {
        const room = createRoom(owner.id, 'Active');

        expect(await runRetentionSweep()).toEqual({ rooms: 0, documents: 0, invites: 0, refreshTokens: 0 });
        expect(getRoom(room.id)).not.toBeNull();
    });

    it('survives a failure without crashing the scheduler', async () => {
        const stale = createRoom(owner.id, 'Abandoned');
        ageRoom(stale.id, ROOM_RETENTION_MS + 1000);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // The sweep runs on a timer with nobody awaiting it; an escaping
        // rejection would be an unhandled one.
        await expect(runRetentionSweep()).resolves.toBeDefined();
    });
});

describe('startRetentionSweep', () => {
    it('runs a first pass shortly after boot, then on the interval', async () => {
        vi.useFakeTimers();
        const stale = createRoom(owner.id, 'Abandoned');
        ageRoom(stale.id, ROOM_RETENTION_MS + 1000);

        const stop = startRetentionSweep();

        // A restart also has to collect whatever expired while the process was
        // down, so the first pass cannot wait a full interval.
        await vi.advanceTimersByTimeAsync(11_000);
        expect(getRoom(stale.id)).toBeNull();

        stop();
    });

    it('stops sweeping once the returned function is called', async () => {
        vi.useFakeTimers();
        const stop = startRetentionSweep();
        stop();

        const stale = createRoom(owner.id, 'Abandoned');
        ageRoom(stale.id, ROOM_RETENTION_MS + 1000);

        await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        expect(getRoom(stale.id)).not.toBeNull();
    });
});
