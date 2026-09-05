/**
 * services/chatService.js
 * Chat history.
 *
 * This used to be `roomID_to_ChatHistory_Map` in `index.js`: an object of
 * arrays, replayed to a joiner and dropped when the room emptied or the process
 * restarted. The move into the relational store is what makes "survives a
 * restart" true rather than "survives a refresh".
 *
 * The cap is still there, but it is now enforced by deleting rows rather than
 * by slicing an array, so the trim is durable too.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

/** Messages kept per room. Older ones are deleted as new ones arrive. */
export const CHAT_HISTORY_LIMIT = Number(process.env.CHAT_HISTORY_LIMIT || 100);

const publicMessage = (row) => ({
    messageId: row.id,
    message: row.message,
    user: row.username,
    userId: row.user_id,
    timestamp: row.created_at,
});

/**
 * Append a message and return it in the shape the client already expects.
 *
 * The author is the caller's verified identity, not a field on the payload —
 * that property was established in Phase 1 and the storage layer preserves it
 * by taking a user object rather than a username string.
 */
export async function appendMessage(roomId, user, message) {
    const row = {
        id: uuidv4(),
        room_id: roomId,
        user_id: user.id,
        username: user.username,
        message,
        created_at: new Date().toISOString(),
    };

    await db.tx(async (t) => {
        await t.run(
            `INSERT INTO chat_messages (id, room_id, user_id, username, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [row.id, row.room_id, row.user_id, row.username, row.message, row.created_at]
        );

        // Trim inside the same transaction so history can never briefly exceed
        // the cap, and so a crash cannot leave the trim undone.
        await t.run(
            `DELETE FROM chat_messages
              WHERE room_id = ?
                AND id NOT IN (
                    SELECT id FROM chat_messages
                     WHERE room_id = ?
                     ORDER BY created_at DESC, seq DESC
                     LIMIT ?
                )`,
            [roomId, roomId, CHAT_HISTORY_LIMIT]
        );
    });

    return publicMessage(row);
}

/** History oldest-first, which is the order the transcript renders in. */
export async function listMessages(roomId, limit = CHAT_HISTORY_LIMIT) {
    const rows = await db.all(
        // `seq` breaks ties within the same millisecond. It used to be SQLite's
        // rowid, aliased through the subquery; it is a real column now because
        // Postgres has no rowid to alias (see db/schema.js).
        `SELECT * FROM (
             SELECT * FROM chat_messages
              WHERE room_id = ?
              ORDER BY created_at DESC, seq DESC
              LIMIT ?
         ) AS recent ORDER BY created_at ASC, seq ASC`,
        [roomId, limit]
    );
    return rows.map(publicMessage);
}
