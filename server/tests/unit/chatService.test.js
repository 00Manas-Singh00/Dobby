/**
 * Chat history.
 *
 * The move from a process-memory array to a table is only worth anything if the
 * two properties that array had are preserved — replay order and the history
 * cap — so those are what this file asserts, plus the one that array never had:
 * the transcript outliving the process that received it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../db.js';
import { register } from '../../services/authService.js';
import { createRoom } from '../../services/roomService.js';
import { appendMessage, listMessages, CHAT_HISTORY_LIMIT } from '../../services/chatService.js';

let room;
let alice;
let bob;
let counter = 0;

const makeUser = async (label) => {
    counter += 1;
    const session = await register({
        email: `${label}${counter}-${Date.now()}@example.com`,
        username: `${label}${counter}`,
        password: 'correct horse battery staple',
    });
    return session.user;
};

beforeEach(async () => {
    alice = await makeUser('alice');
    bob = await makeUser('bob');
    room = await createRoom(alice.id, 'Chat');
});

describe('appendMessage', () => {
    it('returns the message in the shape the client already renders', async () => {
        const message = await appendMessage(room.id, alice, 'hello');

        expect(message).toMatchObject({
            message: 'hello',
            user: alice.username,
            userId: alice.id,
        });
        expect(message.messageId).toEqual(expect.any(String));
        expect(Date.parse(message.timestamp)).not.toBeNaN();
    });

    it('records the author from the user object, not from the text', async () => {
        // Authorship moved server-side in Phase 1; taking a user rather than a
        // username string is what keeps that true through the storage layer.
        const message = await appendMessage(room.id, bob, 'not from alice');

        expect(message.user).toBe(bob.username);
        expect(message.userId).toBe(bob.id);
    });
});

describe('listMessages', () => {
    it('replays oldest first, which is the order a transcript reads in', async () => {
        await appendMessage(room.id, alice, 'first');
        await appendMessage(room.id, bob, 'second');
        await appendMessage(room.id, alice, 'third');

        expect((await listMessages(room.id)).map((m) => m.message)).toEqual(['first', 'second', 'third']);
    });

    it('keeps order for messages landing in the same millisecond', async () => {
        // ISO timestamps are millisecond-resolution, so a fast exchange ties on
        // created_at and `seq` is the only remaining tiebreak.
        const sent = Array.from({ length: 20 }, (_, i) => `m${i}`);
        for (const text of sent) await appendMessage(room.id, alice, text);

        expect((await listMessages(room.id)).map((m) => m.message)).toEqual(sent);
    });

    it('is empty for a room nobody has spoken in', async () => {
        expect(await listMessages(room.id)).toEqual([]);
    });

    it('does not leak the transcript of another room', async () => {
        const other = await createRoom(bob.id, 'Elsewhere');
        await appendMessage(other.id, bob, 'private');

        expect(await listMessages(room.id)).toEqual([]);
    });
});

describe('the history cap', () => {
    it('keeps the most recent messages and drops the rest', async () => {
        for (let i = 0; i < CHAT_HISTORY_LIMIT + 10; i += 1) {
            await appendMessage(room.id, alice, `m${i}`);
        }

        const history = await listMessages(room.id);

        expect(history).toHaveLength(CHAT_HISTORY_LIMIT);
        expect(history[0].message).toBe('m10');
        expect(history.at(-1).message).toBe(`m${CHAT_HISTORY_LIMIT + 9}`);
    });

    it('deletes the rows rather than hiding them, so the trim is durable', async () => {
        for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i += 1) {
            await appendMessage(room.id, alice, `m${i}`);
        }

        // The old implementation sliced an array in memory; a cap enforced only
        // at read time would let the table grow without bound.
        const stored = await db.count(
            'SELECT COUNT(*) AS n FROM chat_messages WHERE room_id = ?',
            [room.id]
        );

        expect(stored).toBe(CHAT_HISTORY_LIMIT);
    });

    it('trims only the room being written to', async () => {
        const other = await createRoom(bob.id, 'Elsewhere');
        await appendMessage(other.id, bob, 'survivor');

        for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i += 1) {
            await appendMessage(room.id, alice, `m${i}`);
        }

        expect((await listMessages(other.id)).map((m) => m.message)).toEqual(['survivor']);
    });
});

describe('durability', () => {
    it('goes with the room when the room is deleted', async () => {
        await appendMessage(room.id, alice, 'ephemeral');

        // The foreign key cascade is the delete path — there is no separate
        // sweep for chat, and a room delete must not leave a transcript behind.
        await db.run('DELETE FROM rooms WHERE id = ?', [room.id]);

        expect(
            await db.count('SELECT COUNT(*) AS n FROM chat_messages WHERE room_id = ?', [room.id])
        ).toBe(0);
    });
});
