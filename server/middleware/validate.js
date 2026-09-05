/**
 * middleware/validate.js
 * Shared payload schemas and validators.
 *
 * Socket payloads used to be relayed verbatim with no size cap (see
 * docs/04-security-model.md §5). Every handler that accepts client data now
 * runs it through one of these schemas first; a payload that fails is dropped
 * with an error back to the sender rather than broadcast to the peer.
 */

import { z } from 'zod';

// ─── Limits ───────────────────────────────────────────────────────────────────
export const LIMITS = {
    chatMessage: Number(process.env.MAX_CHAT_MESSAGE_CHARS || 4_000),
    signalPayload: Number(process.env.MAX_SIGNAL_PAYLOAD_BYTES || 128_000),
    terminalInput: Number(process.env.MAX_TERMINAL_INPUT_BYTES || 8_000),
};

const uuid = z.string().uuid();

// ─── REST schemas ─────────────────────────────────────────────────────────────
export const registerSchema = z.object({
    email: z.string().trim().email().max(254),
    username: z.string().trim().min(2).max(32),
    // Length is the control that actually matters; composition rules push users
    // toward predictable substitutions without adding entropy.
    password: z.string().min(10).max(200),
});

export const loginSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(1).max(500),
});

export const createRoomSchema = z.object({
    name: z.string().trim().max(80).optional(),
});

export const redeemInviteSchema = z.object({
    token: z.string().min(1).max(500),
});

// A name is one path segment; fileService rejects separators and control
// characters. The schema's job here is the size and shape cap, and to make
// `parentId` explicitly nullable — the root is `null`, not a missing key, and
// the difference decides whether a PATCH moves a node or only renames it.
export const createFileSchema = z.object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(['file', 'folder']).default('file'),
    parentId: uuid.nullish(),
});

export const updateFileSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        parentId: uuid.nullish(),
    })
    .refine((body) => body.name !== undefined || 'parentId' in body, {
        message: 'Provide a name, a parentId, or both.',
    });

/** Express middleware factory: validates `req.body` and replaces it. */
export function validateBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body ?? {});
        if (!result.success) {
            const issue = result.error.issues[0];
            const field = issue.path.join('.') || 'body';
            return res.status(400).json({ error: `Invalid ${field}: ${issue.message}` });
        }
        req.body = result.data;
        return next();
    };
}

// ─── Socket schemas ───────────────────────────────────────────────────────────
export const joinRoomSchema = z.object({ roomId: uuid });

export const leaveRoomSchema = z.object({ roomId: uuid });

export const updateLanguageSchema = z.object({
    roomId: uuid,
    languageUsed: z.string().trim().min(1).max(40),
});

export const sendMessageSchema = z.object({
    roomId: uuid,
    message: z.string().trim().min(1).max(LIMITS.chatMessage),
});

// NOTE: `draw` and `clear canvas` schemas were removed with the socket relay
// they validated. Whiteboard strokes are now a `Y.Array` inside the room's
// `<roomId>:__whiteboard__` document, so they travel the CRDT path — which
// means they are bounded by the Yjs namespace's own payload cap, replayed to a
// late joiner, and persisted, none of which the relay did.

export const joinVideoSchema = z.object({ roomId: uuid });

// WebRTC signals are SDP/ICE blobs whose shape is simple-peer's business; cap
// them and confirm the destination is a socket id we can route to.
export const sendingSignalSchema = z.object({
    roomId: uuid,
    userToSignal: z.string().min(1).max(64),
    callerID: z.string().min(1).max(64),
    signal: z.unknown(),
});

export const returningSignalSchema = z.object({
    roomId: uuid,
    callerID: z.string().min(1).max(64),
    signal: z.unknown(),
});

export const terminalCreateSchema = z.object({ roomId: uuid });

export const terminalInputSchema = z.object({
    data: z.string().max(LIMITS.terminalInput),
});

export const terminalResizeSchema = z.object({
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
});

/**
 * Validate a socket payload. On failure emits `socket:error` to the sender and
 * returns null, so handlers read as `const p = parse(...); if (!p) return;`.
 */
export function parsePayload(socket, event, schema, payload) {
    const result = schema.safeParse(payload ?? {});
    if (!result.success) {
        const issue = result.error.issues[0];
        socket.emit('socket:error', {
            event,
            message: `Invalid ${issue.path.join('.') || 'payload'}: ${issue.message}`,
        });
        return null;
    }
    return result.data;
}

/** Approximate serialized size of a value, for the byte caps above. */
export function byteSize(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    } catch {
        return Infinity; // circular or otherwise unserializable — reject it
    }
}
