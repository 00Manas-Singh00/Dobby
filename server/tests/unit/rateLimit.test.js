/**
 * The socket token bucket.
 *
 * Express limiters stop applying the moment the connection is upgraded, so
 * this is the only quota on the socket surface. The behaviour that matters is
 * that the budget is per socket and per event — a shared bucket would let one
 * user's drawing exhaust their partner's chat allowance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { allowSocketEvent } from '../../middleware/rateLimit.js';

const fakeSocket = () => ({ emitted: [], emit(event, payload) { this.emitted.push({ event, payload }); } });

/** Drain a socket's budget for an event, returning how many calls were allowed. */
function drain(socket, event, attempts = 1000) {
    let allowed = 0;
    for (let i = 0; i < attempts; i += 1) {
        if (allowSocketEvent(socket, event)) allowed += 1;
        else break;
    }
    return allowed;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('allowSocketEvent', () => {
    it('allows an event it has no limit for', () => {
        const socket = fakeSocket();
        // Unlisted events pass through; the guard is opt-in per event class.
        expect(allowSocketEvent(socket, 'not-a-known-event')).toBe(true);
    });

    it('allows a burst up to the bucket capacity and then refuses', () => {
        const socket = fakeSocket();

        expect(drain(socket, 'clear canvas')).toBe(5);
        expect(allowSocketEvent(socket, 'clear canvas')).toBe(false);
    });

    it('tells the sender when the budget runs out', () => {
        const socket = fakeSocket();
        drain(socket, 'clear canvas');
        allowSocketEvent(socket, 'clear canvas');

        expect(socket.emitted.at(-1)).toEqual({
            event: 'socket:error',
            payload: { event: 'clear canvas', message: expect.stringMatching(/rate limit/i) },
        });
    });

    it('refills over time at the configured rate', () => {
        const socket = fakeSocket();
        drain(socket, 'clear canvas');

        // 0.2 tokens/second: five seconds buys exactly one more event.
        vi.advanceTimersByTime(5_000);
        expect(allowSocketEvent(socket, 'clear canvas')).toBe(true);
        expect(allowSocketEvent(socket, 'clear canvas')).toBe(false);
    });

    it('never refills past the burst capacity', () => {
        const socket = fakeSocket();
        drain(socket, 'clear canvas');

        vi.advanceTimersByTime(60 * 60 * 1000); // an hour of idling
        expect(drain(socket, 'clear canvas')).toBe(5);
    });

    it('budgets each event class separately', () => {
        const socket = fakeSocket();
        drain(socket, 'clear canvas');

        // Exhausting one event must not silence the socket entirely.
        expect(allowSocketEvent(socket, 'send_message')).toBe(true);
    });

    it('budgets each socket separately', () => {
        const one = fakeSocket();
        const two = fakeSocket();
        drain(one, 'clear canvas');

        expect(allowSocketEvent(two, 'clear canvas')).toBe(true);
    });

    it('gives drawing a ceiling high enough for real mouse input', () => {
        const socket = fakeSocket();
        // Strokes arrive per mousemove; the limit exists to stop a scripted
        // flood, not to shape normal drawing.
        expect(drain(socket, 'draw')).toBe(200);
    });

    it('gives terminal creation a deliberately tight budget', () => {
        const socket = fakeSocket();
        // Each one may spawn a container.
        expect(drain(socket, 'terminal:create')).toBe(5);
    });
});
