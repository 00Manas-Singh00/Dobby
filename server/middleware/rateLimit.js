/**
 * middleware/rateLimit.js
 * Quotas for the REST surface and for socket events.
 *
 * Both limiters are in-process, which is correct for the single-node
 * deployment Dobby supports today. A second replica would need a shared store
 * (see docs/06-roadmap.md, Phase 4) — the limits would otherwise be per-replica.
 */

// `ipKeyGenerator` normalizes IPv6 addresses to a /64 prefix, so a client
// cannot sidestep a limit by walking its own address range.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const minutes = (n) => n * 60 * 1000;

/**
 * Key by authenticated user when there is one, falling back to IP. Without
 * this, every request from a shared NAT would share one bucket, and an
 * authenticated attacker could rotate IPs to multiply their quota.
 */
const keyByUserOrIp = (req, res) => req.user?.id || ipKeyGenerator(req.ip);

const limiterOptions = (max, windowMs, message) => ({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    handler: (req, res) => res.status(429).json({ error: message }),
});

/**
 * The execute endpoint proxies to a third-party service we do not pay for and
 * cannot rate-limit from the other side. This is the control that stops Dobby
 * being used as an open proxy to Piston.
 */
export const executeLimiter = rateLimit(
    limiterOptions(
        Number(process.env.EXECUTE_RATE_LIMIT || 20),
        minutes(1),
        'Too many code executions. Wait a minute and try again.'
    )
);

/** Credential endpoints: slow enough to make online guessing impractical. */
export const authLimiter = rateLimit(
    limiterOptions(
        Number(process.env.AUTH_RATE_LIMIT || 10),
        minutes(15),
        'Too many authentication attempts. Try again in a few minutes.'
    )
);

/** Everything else under /api. Generous — it exists to bound accidents. */
export const apiLimiter = rateLimit(
    limiterOptions(
        Number(process.env.API_RATE_LIMIT || 300),
        minutes(1),
        'Too many requests. Slow down.'
    )
);

/**
 * Token bucket for socket events, keyed per socket per event class.
 *
 * Express limiters do not apply to Socket.IO: once the connection is upgraded,
 * events bypass the HTTP stack entirely, so a client could previously emit
 * `send_message` in a tight loop unchecked.
 */
class TokenBucket {
    constructor(capacity, refillPerSecond) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }

    take() {
        const now = Date.now();
        this.tokens = Math.min(
            this.capacity,
            this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond
        );
        this.lastRefill = now;

        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}

// capacity = burst allowance, refill = sustained rate per second.
const SOCKET_LIMITS = {
    'join room': { capacity: 10, refill: 0.5 },
    'leave room': { capacity: 10, refill: 0.5 },
    'update language': { capacity: 10, refill: 1 },
    send_message: { capacity: 20, refill: 2 },
    // Strokes arrive per mousemove, so this ceiling is high by necessity; it is
    // there to stop a scripted flood, not to shape normal drawing.
    draw: { capacity: 200, refill: 120 },
    'clear canvas': { capacity: 5, refill: 0.2 },
    'join video': { capacity: 10, refill: 0.5 },
    'sending signal': { capacity: 40, refill: 4 },
    'returning signal': { capacity: 40, refill: 4 },
    'terminal:create': { capacity: 5, refill: 0.1 },
    'terminal:input': { capacity: 500, refill: 200 },
    'terminal:resize': { capacity: 20, refill: 2 },
};

const buckets = new WeakMap(); // socket -> Map<event, TokenBucket>

/**
 * Consume one token for `event` on `socket`. Returns false and notifies the
 * client when the budget is exhausted.
 */
export function allowSocketEvent(socket, event) {
    const limit = SOCKET_LIMITS[event];
    if (!limit) return true;

    if (!buckets.has(socket)) buckets.set(socket, new Map());
    const perEvent = buckets.get(socket);

    if (!perEvent.has(event)) {
        perEvent.set(event, new TokenBucket(limit.capacity, limit.refill));
    }

    if (perEvent.get(event).take()) return true;

    socket.emit('socket:error', {
        event,
        message: 'Rate limit exceeded. Slow down.',
    });
    return false;
}
