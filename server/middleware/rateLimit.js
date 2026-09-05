/**
 * middleware/rateLimit.js
 * Quotas for the REST surface and for socket events.
 *
 * The two halves scale differently, and Phase 4 only had to move one of them.
 *
 * **REST limits are per user, and a user's requests can land on any replica.**
 * In-process counters would therefore multiply every published quota by the
 * replica count — 20 executions a minute becomes 60 on three nodes, which is
 * not a limit. These now use a shared Redis store when one is configured.
 *
 * **Socket limits are per socket**, and a socket lives on exactly one node for
 * its whole life. A per-socket bucket is *already* cluster-correct: there is no
 * second process holding a second bucket for the same connection, because there
 * is no second connection. It stays in process memory deliberately, and moving
 * it to Redis would add a network round trip to every keystroke of terminal
 * input to defend a property it already has.
 */

// `ipKeyGenerator` normalizes IPv6 addresses to a /64 prefix, so a client
// cannot sidestep a limit by walking its own address range.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { key } from '../services/cluster.js';
import { recordSocketEvent } from '../services/metrics.js';

const minutes = (n) => n * 60 * 1000;

/**
 * `express-rate-limit` takes its store at construction, and at import time the
 * Redis connection does not exist yet — so each limiter is a stable wrapper
 * around an instance that is *built* later, when the server is constructed and
 * the store is known.
 *
 * Built there rather than on the first request, deliberately: a limiter created
 * inside a request handler would be recreated by anything that reset the
 * module, silently starting everyone's quota over, and the library warns about
 * exactly that. `useSharedRateLimitStore` is the one call that decides the
 * store, and it builds all three at once.
 */
let sharedRedis = null;

/** The built instances, keyed by name. Replaced wholesale by a rebuild. */
const built = new Map();

/** Registered builders, so `useSharedRateLimitStore` can rebuild every limiter. */
const builders = new Map();

const storeFor = (name) =>
    sharedRedis
        ? new RedisStore({
              prefix: key('rl', name) + ':',
              // rate-limit-redis speaks raw commands so it works with any
              // client; node-redis exposes exactly that.
              sendCommand: (...args) => sharedRedis.sendCommand(args),
          })
        : undefined;

/**
 * Point every limiter at a shared store, or back at process memory.
 *
 * Called once during server construction, before the first request.
 *
 * @param {object|null} redis a connected client, or null to stay in-process
 */
export function useSharedRateLimitStore(redis) {
    sharedRedis = redis;
    for (const [name, build] of builders) built.set(name, build(storeFor(name)));
}

function limiter(name, build) {
    builders.set(name, build);
    return (req, res, next) => {
        // The fallback covers a caller that never went through
        // `createDobbyServer` — a router mounted directly in a unit test. It
        // builds in-process, which is the safe default.
        if (!built.has(name)) built.set(name, build(storeFor(name)));
        return built.get(name)(req, res, next);
    };
}

/**
 * Key by authenticated user when there is one, falling back to IP. Without
 * this, every request from a shared NAT would share one bucket, and an
 * authenticated attacker could rotate IPs to multiply their quota.
 */
const keyByUserOrIp = (req, res) => req.user?.id || ipKeyGenerator(req.ip);

const limiterOptions = (max, windowMs, message, store) => ({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    handler: (req, res) => res.status(429).json({ error: message }),
    ...(store ? { store } : {}),
});

/**
 * The execute endpoint proxies to a third-party service we do not pay for and
 * cannot rate-limit from the other side. This is the control that stops Dobby
 * being used as an open proxy to Piston.
 */
export const executeLimiter = limiter('execute', (store) =>
    rateLimit(
        limiterOptions(
            Number(process.env.EXECUTE_RATE_LIMIT || 20),
            minutes(1),
            'Too many code executions. Wait a minute and try again.',
            store
        )
    )
);

/** Credential endpoints: slow enough to make online guessing impractical. */
export const authLimiter = limiter('auth', (store) =>
    rateLimit(
        limiterOptions(
            Number(process.env.AUTH_RATE_LIMIT || 10),
            minutes(15),
            'Too many authentication attempts. Try again in a few minutes.',
            store
        )
    )
);

/** Everything else under /api. Generous — it exists to bound accidents. */
export const apiLimiter = limiter('api', (store) =>
    rateLimit(
        limiterOptions(
            Number(process.env.API_RATE_LIMIT || 300),
            minutes(1),
            'Too many requests. Slow down.',
            store
        )
    )
);

/**
 * Token bucket for socket events, keyed per socket per event class.
 *
 * Express limiters do not apply to Socket.IO: once the connection is upgraded,
 * events bypass the HTTP stack entirely, so a client could previously emit
 * `send_message` in a tight loop unchecked.
 *
 * Keyed on the socket object itself through a `WeakMap`, so the buckets are
 * collected with the connection and there is nothing to expire. That is also
 * why this needs no shared store: the key cannot exist on another node.
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
    // Whiteboard strokes used to be listed here as `draw` and `clear canvas`.
    // They now ride the Yjs namespaces, which this limiter does not cover —
    // those are bounded by `maxHttpBufferSize` and by the membership check on
    // the namespace instead.
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

    recordSocketEvent(event, 'rate_limited');
    socket.emit('socket:error', {
        event,
        message: 'Rate limit exceeded. Slow down.',
    });
    return false;
}
