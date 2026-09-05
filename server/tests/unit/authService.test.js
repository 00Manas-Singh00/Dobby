/**
 * Token issue, rotation, and revocation.
 *
 * The refresh flow is the part with real logic: it rotates on every use, and a
 * token that has already been spent must not yield a second session. That rule
 * is invisible from the outside — a broken rotation still returns a working
 * token — so it is exactly the kind of thing only a test catches.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import db from '../../db.js';
import { resetDatabase } from '../helpers/db.js';
import {
    register,
    login,
    refresh,
    revokeRefreshToken,
    revokeAllForUser,
    verifyAccessToken,
    getUserById,
    pruneRefreshTokens,
    AuthError,
} from '../../services/authService.js';

const account = (overrides = {}) => ({
    email: 'ada@example.com',
    username: 'ada',
    password: 'correct horse battery staple',
    ...overrides,
});

beforeEach(resetDatabase);

describe('register', () => {
    it('returns a session and stores the user', async () => {
        const session = await register(account());

        expect(session.user.username).toBe('ada');
        expect(session.accessToken).toBeTypeOf('string');
        expect(session.refreshToken).toBeTypeOf('string');
        expect(await getUserById(session.user.id)).toMatchObject({ email: 'ada@example.com' });
    });

    it('never returns the password hash', async () => {
        const session = await register(account());
        expect(session.user).not.toHaveProperty('password_hash');
        expect(JSON.stringify(session.user)).not.toContain('$2');
    });

    it('normalizes the email, so case is not a way to duplicate an account', async () => {
        await register(account({ email: 'Ada@Example.COM' }));
        await expect(register(account({ email: 'ada@example.com' }))).rejects.toThrow(AuthError);
    });

    it('rejects a duplicate email with 409', async () => {
        await register(account());
        await expect(register(account({ username: 'other' }))).rejects.toThrow(
            expect.objectContaining({ status: 409 })
        );
    });
});

describe('login', () => {
    it('accepts the correct password', async () => {
        const created = await register(account());
        const session = await login({ email: 'ada@example.com', password: account().password });
        expect(session.user.id).toBe(created.user.id);
    });

    it('rejects a wrong password with 401', async () => {
        await register(account());
        await expect(
            login({ email: 'ada@example.com', password: 'wrong password here' })
        ).rejects.toThrow(expect.objectContaining({ status: 401 }));
    });

    it('gives an unknown email the same error as a wrong password', async () => {
        await register(account());
        const failure = async (email) => {
            try {
                await login({ email, password: 'whatever at all' });
            } catch (error) {
                return error;
            }
            throw new Error('Expected the login to fail.');
        };
        const unknown = await failure('nobody@example.com');
        const wrongPassword = await failure('ada@example.com');

        // Distinguishable errors would turn login into an account-enumeration
        // oracle.
        expect(unknown.message).toBe(wrongPassword.message);
        expect(unknown.status).toBe(wrongPassword.status);
    });
});

describe('access tokens', () => {
    it('verifies a freshly issued token', async () => {
        const session = await register(account());
        expect((await verifyAccessToken(session.accessToken)).id).toBe(session.user.id);
    });

    it('rejects a token signed with a different secret', async () => {
        const forged = jwt.sign({ sub: 'anyone' }, 'a-different-secret-entirely-long-enough');
        await expect(verifyAccessToken(forged)).rejects.toThrow(AuthError);
    });

    it('rejects an expired token', async () => {
        const session = await register(account());
        const expired = jwt.sign({ sub: session.user.id }, process.env.JWT_SECRET, { expiresIn: '-1s' });
        await expect(verifyAccessToken(expired)).rejects.toThrow(/expired|Invalid/i);
    });

    it('rejects a valid token whose account has been deleted', async () => {
        const session = await register(account());
        await db.run('DELETE FROM users WHERE id = ?', [session.user.id]);

        // The signature is still good; the authorization decisions downstream
        // all assume the user row exists.
        await expect(verifyAccessToken(session.accessToken)).rejects.toThrow(/no longer exists/);
    });
});

describe('refresh', () => {
    it('rotates: the old token stops working and a new one is issued', async () => {
        const first = await register(account());
        const second = await refresh(first.refreshToken);

        expect(second.refreshToken).not.toBe(first.refreshToken);
        expect(second.user.id).toBe(first.user.id);
        await expect(refresh(first.refreshToken)).rejects.toThrow(/invalid or expired/i);
    });

    it('accepts the newly issued token', async () => {
        const first = await register(account());
        const second = await refresh(first.refreshToken);
        await expect(refresh(second.refreshToken)).resolves.toBeDefined();
    });

    it('rejects a missing, unknown, or expired token', async () => {
        await expect(refresh(undefined)).rejects.toThrow(expect.objectContaining({ status: 401 }));
        await expect(refresh('not-a-real-token')).rejects.toThrow(
            expect.objectContaining({ status: 401 })
        );

        const session = await register(account());
        await db.run('UPDATE refresh_tokens SET expires_at = ?', [
            new Date(Date.now() - 1000).toISOString(),
        ]);
        await expect(refresh(session.refreshToken)).rejects.toThrow(/invalid or expired/i);
    });

    it('stores refresh tokens hashed, so a database read is not a credential', async () => {
        const session = await register(account());
        const stored = await db.all('SELECT token_hash FROM refresh_tokens');

        expect(stored).toHaveLength(1);
        expect(stored[0].token_hash).not.toBe(session.refreshToken);
        expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('revocation', () => {
    it('revokeRefreshToken invalidates exactly that token', async () => {
        const session = await register(account());
        await revokeRefreshToken(session.refreshToken);
        await expect(refresh(session.refreshToken)).rejects.toThrow(AuthError);
    });

    it('ignores a missing token rather than throwing', async () => {
        await expect(revokeRefreshToken(undefined)).resolves.toBeUndefined();
    });

    it('revokeAllForUser ends every session for that user and no other', async () => {
        const ada = await register(account());
        const adaSecondDevice = await login({
            email: 'ada@example.com',
            password: account().password,
        });
        const grace = await register(account({ email: 'grace@example.com', username: 'grace' }));

        await revokeAllForUser(ada.user.id);

        await expect(refresh(ada.refreshToken)).rejects.toThrow(AuthError);
        await expect(refresh(adaSecondDevice.refreshToken)).rejects.toThrow(AuthError);
        await expect(refresh(grace.refreshToken)).resolves.toBeDefined();
    });
});

describe('pruneRefreshTokens', () => {
    it('removes expired tokens and leaves live ones', async () => {
        const live = await register(account());
        await register(account({ email: 'grace@example.com', username: 'grace' }));

        await db.run('UPDATE refresh_tokens SET expires_at = ? WHERE user_id != ?', [
            new Date(Date.now() - 1000).toISOString(),
            live.user.id,
        ]);

        expect(await pruneRefreshTokens()).toBe(1);
        await expect(refresh(live.refreshToken)).resolves.toBeDefined();
    });
});
