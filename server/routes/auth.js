/**
 * routes/auth.js
 * Account creation and session management.
 */

import express from 'express';
import {
    register,
    login,
    refresh,
    revokeRefreshToken,
    revokeAllForUser,
    AuthError,
} from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
    validateBody,
    registerSchema,
    loginSchema,
    refreshSchema,
} from '../middleware/validate.js';

const router = express.Router();

async function handle(res, fn) {
    try {
        return res.json(await fn());
    } catch (error) {
        if (error instanceof AuthError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('[Auth] Unexpected error:', error);
        return res.status(500).json({ error: 'Authentication failed.' });
    }
}

/** POST /api/auth/register → { user, accessToken, refreshToken } */
router.post('/register', authLimiter, validateBody(registerSchema), (req, res) =>
    handle(res, () => register(req.body))
);

/** POST /api/auth/login → { user, accessToken, refreshToken } */
router.post('/login', authLimiter, validateBody(loginSchema), (req, res) =>
    handle(res, () => login(req.body))
);

/**
 * POST /api/auth/refresh → { user, accessToken, refreshToken }
 * Rotates the refresh token; the presented one is revoked on use.
 */
router.post('/refresh', authLimiter, validateBody(refreshSchema), (req, res) =>
    handle(res, () => refresh(req.body.refreshToken))
);

/** POST /api/auth/logout — revokes the presented refresh token. */
router.post('/logout', async (req, res) => {
    await revokeRefreshToken(req.body?.refreshToken);
    res.json({ ok: true });
});

/** POST /api/auth/logout-all — revokes every session for the caller. */
router.post('/logout-all', requireAuth, async (req, res) => {
    await revokeAllForUser(req.user.id);
    res.json({ ok: true });
});

/** GET /api/auth/me → the current user, or 401. */
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
