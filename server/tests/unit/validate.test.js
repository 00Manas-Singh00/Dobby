/**
 * Payload schemas.
 *
 * Every socket event is checked against one of these before it is relayed. The
 * cases worth asserting are the ones that used to get through: an unbounded
 * payload, an extra field riding along on a relayed object, and a room id that
 * is not a room id.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    LIMITS,
    registerSchema,
    loginSchema,
    createRoomSchema,
    redeemInviteSchema,
    joinRoomSchema,
    updateLanguageSchema,
    sendMessageSchema,
    drawSchema,
    terminalInputSchema,
    terminalResizeSchema,
    validateBody,
    parsePayload,
    byteSize,
} from '../../middleware/validate.js';

const ROOM_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('registerSchema', () => {
    it('accepts a valid account and trims the inputs', () => {
        const result = registerSchema.parse({
            email: '  ADA@example.com  ',
            username: '  ada  ',
            password: 'correct horse battery staple',
        });

        expect(result.username).toBe('ada');
        expect(result.email).toBe('ADA@example.com');
    });

    it('rejects a malformed email', () => {
        expect(registerSchema.safeParse({ email: 'not-an-email', username: 'ada', password: 'a'.repeat(12) }).success).toBe(false);
    });

    it('enforces a 10-character password floor', () => {
        const attempt = (password) =>
            registerSchema.safeParse({ email: 'a@b.co', username: 'ada', password }).success;

        // Length is the control that matters; composition rules only push users
        // toward predictable substitutions.
        expect(attempt('short')).toBe(false);
        expect(attempt('a'.repeat(10))).toBe(true);
        expect(attempt('a'.repeat(201))).toBe(false);
    });

    it('rejects a username that is too short or too long', () => {
        const attempt = (username) =>
            registerSchema.safeParse({ email: 'a@b.co', username, password: 'a'.repeat(12) }).success;

        expect(attempt('a')).toBe(false);
        expect(attempt('ab')).toBe(true);
        expect(attempt('a'.repeat(33))).toBe(false);
    });
});

describe('loginSchema', () => {
    it('does not impose the registration password floor', () => {
        // An existing account may predate the rule; login must still be able to
        // reject the password rather than the request.
        expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    });
});

describe('room schemas', () => {
    it('treats a room name as optional but bounded', () => {
        expect(createRoomSchema.safeParse({}).success).toBe(true);
        expect(createRoomSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false);
    });

    it('requires a real uuid as the room id', () => {
        expect(joinRoomSchema.safeParse({ roomId: ROOM_ID }).success).toBe(true);
        expect(joinRoomSchema.safeParse({ roomId: '../../etc/passwd' }).success).toBe(false);
        expect(joinRoomSchema.safeParse({ roomId: '' }).success).toBe(false);
        expect(joinRoomSchema.safeParse({}).success).toBe(false);
    });

    it('bounds an invite token', () => {
        expect(redeemInviteSchema.safeParse({ token: 'x'.repeat(501) }).success).toBe(false);
    });
});

describe('sendMessageSchema', () => {
    it('rejects an empty or whitespace-only message', () => {
        expect(sendMessageSchema.safeParse({ roomId: ROOM_ID, message: '   ' }).success).toBe(false);
    });

    it('caps the message length', () => {
        const under = sendMessageSchema.safeParse({ roomId: ROOM_ID, message: 'a'.repeat(LIMITS.chatMessage) });
        const over = sendMessageSchema.safeParse({ roomId: ROOM_ID, message: 'a'.repeat(LIMITS.chatMessage + 1) });

        expect(under.success).toBe(true);
        expect(over.success).toBe(false);
    });
});

describe('drawSchema', () => {
    const stroke = {
        roomId: ROOM_ID,
        data: { prevPos: { x: 1, y: 2 }, currPos: { x: 3, y: 4 }, color: '#fff', lineWidth: 2 },
    };

    it('accepts a well-formed stroke', () => {
        expect(drawSchema.safeParse(stroke).success).toBe(true);
    });

    it('rejects unknown fields, so nothing extra is relayed to the peer', () => {
        // The server relays this object verbatim; a strict schema is what stops
        // it carrying a payload the recipient will act on.
        expect(drawSchema.safeParse({
            ...stroke,
            data: { ...stroke.data, onload: 'alert(1)' },
        }).success).toBe(false);

        expect(drawSchema.safeParse({
            ...stroke,
            data: { ...stroke.data, prevPos: { x: 1, y: 2, z: 3 } },
        }).success).toBe(false);
    });

    it('rejects non-finite coordinates', () => {
        expect(drawSchema.safeParse({
            ...stroke,
            data: { ...stroke.data, prevPos: { x: Infinity, y: 0 } },
        }).success).toBe(false);
    });

    it('bounds the line width', () => {
        expect(drawSchema.safeParse({ ...stroke, data: { ...stroke.data, lineWidth: 201 } }).success).toBe(false);
        expect(drawSchema.safeParse({ ...stroke, data: { ...stroke.data, lineWidth: -1 } }).success).toBe(false);
    });
});

describe('terminal schemas', () => {
    it('caps input size', () => {
        expect(terminalInputSchema.safeParse({ data: 'a'.repeat(LIMITS.terminalInput) }).success).toBe(true);
        expect(terminalInputSchema.safeParse({ data: 'a'.repeat(LIMITS.terminalInput + 1) }).success).toBe(false);
    });

    it('requires positive integer dimensions', () => {
        expect(terminalResizeSchema.safeParse({ cols: 80, rows: 24 }).success).toBe(true);
        expect(terminalResizeSchema.safeParse({ cols: 0, rows: 24 }).success).toBe(false);
        expect(terminalResizeSchema.safeParse({ cols: 80.5, rows: 24 }).success).toBe(false);
        expect(terminalResizeSchema.safeParse({ cols: 100000, rows: 24 }).success).toBe(false);
    });
});

describe('updateLanguageSchema', () => {
    it('requires a non-empty, bounded language name', () => {
        expect(updateLanguageSchema.safeParse({ roomId: ROOM_ID, languageUsed: 'python' }).success).toBe(true);
        expect(updateLanguageSchema.safeParse({ roomId: ROOM_ID, languageUsed: '' }).success).toBe(false);
        expect(updateLanguageSchema.safeParse({ roomId: ROOM_ID, languageUsed: 'a'.repeat(41) }).success).toBe(false);
    });
});

describe('validateBody', () => {
    const run = (schema, body) => {
        const req = { body };
        const res = { statusCode: null, payload: null, status(code) { this.statusCode = code; return this; }, json(p) { this.payload = p; return this; } };
        const next = vi.fn();
        validateBody(schema)(req, res, next);
        return { req, res, next };
    };

    it('replaces the body with the parsed value and continues', () => {
        const { req, next } = run(createRoomSchema, { name: '  Interview  ', extra: 'dropped' });

        expect(next).toHaveBeenCalled();
        // The handler downstream sees only what the schema declared.
        expect(req.body).toEqual({ name: 'Interview' });
    });

    it('answers 400 naming the offending field and does not continue', () => {
        const { res, next } = run(registerSchema, { email: 'nope', username: 'ada', password: 'a'.repeat(12) });

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.payload.error).toMatch(/email/);
    });

    it('treats a missing body as an empty object rather than throwing', () => {
        const { res } = run(registerSchema, undefined);
        expect(res.statusCode).toBe(400);
    });
});

describe('parsePayload', () => {
    const fakeSocket = () => ({ emitted: [], emit(event, payload) { this.emitted.push({ event, payload }); } });

    it('returns the parsed payload on success', () => {
        const socket = fakeSocket();
        expect(parsePayload(socket, 'join room', joinRoomSchema, { roomId: ROOM_ID })).toEqual({ roomId: ROOM_ID });
        expect(socket.emitted).toEqual([]);
    });

    it('returns null and tells the sender on failure', () => {
        const socket = fakeSocket();

        // The failure goes back to the sender rather than being broadcast.
        expect(parsePayload(socket, 'join room', joinRoomSchema, { roomId: 'nope' })).toBeNull();
        expect(socket.emitted).toEqual([
            { event: 'socket:error', payload: { event: 'join room', message: expect.stringMatching(/roomId/) } },
        ]);
    });

    it('handles a null payload', () => {
        const socket = fakeSocket();
        expect(parsePayload(socket, 'join room', joinRoomSchema, null)).toBeNull();
    });
});

describe('byteSize', () => {
    it('measures the serialized size, counting multi-byte characters', () => {
        expect(byteSize('ab')).toBe(4); // the two quotes are part of the JSON
        expect(byteSize('é')).toBe(4);
        expect(byteSize(null)).toBe(4);
    });

    it('reports Infinity for a value that cannot be serialized', () => {
        const circular = {};
        circular.self = circular;

        // Rejecting is the point: an unserializable payload cannot be measured,
        // so it cannot be shown to be under the cap.
        expect(byteSize(circular)).toBe(Infinity);
    });
});
