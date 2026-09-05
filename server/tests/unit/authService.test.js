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

beforeEach(() => {
    db.exec('DELETE FROM refresh_tokens; DELETE FROM room_members; DELETE FROM rooms; DELETE FROM users;');
});

describe('register', () => {
    it('returns a session and stores the user', () => {
        const session = register(account());

        expect(session.user.username).toBe('ada');
        expect(session.accessToken).toBeTypeOf('string');
        expect(session.refreshToken).toBeTypeOf('string');
        expect(getUserById(session.user.id)).toMatchObject({ email: 'ada@example.com' });
    });

    it('never returns the password hash', () => {
        const session = register(account());
        expect(session.user).not.toHaveProperty('password_hash');
        expect(JSON.stringify(session.user)).not.toContain('$2');
    });

    it('normalizes the email, so case is not a way to duplicate an account', () => {
        register(account({ email: 'Ada@Example.COM' }));
        expect(() => register(account({ email: 'ada@example.com' }))).toThrow(AuthError);
    });

    it('rejects a duplicate email with 409', () => {
        register(account());
        expect(() => register(account({ username: 'other' }))).toThrow(
            expect.objectContaining({ status: 409 })
        );
    });
});

describe('login', () => {
    it('accepts the correct password', () => {
        const created = register(account());
        const session = login({ email: 'ada@example.com', password: account().password });
        expect(session.user.id).toBe(created.user.id);
    });

    it('rejects a wrong password with 401', () => {
        register(account());
        expect(() => login({ email: 'ada@example.com', password: 'wrong password here' })).toThrow(
            expect.objectContaining({ status: 401 })
        );
    });

    it('gives an unknown email the same error as a wrong password', () => {
        register(account());
        const unknown = (() => {
            try {
                login({ email: 'nobody@example.com', password: 'whatever at all' });
            } catch (error) {
                return error;
            }
        })();
        const wrongPassword = (() => {
            try {
                login({ email: 'ada@example.com', password: 'whatever at all' });
            } catch (error) {
                return error;
            }
        })();

        // Distinguishable errors would turn login into an account-enumeration
        // oracle.
        expect(unknown.message).toBe(wrongPassword.message);
        expect(unknown.status).toBe(wrongPassword.status);
    });
});

describe('access tokens', () => {
    it('verifies a freshly issued token', () => {
        const session = register(account());
        expect(verifyAccessToken(session.accessToken).id).toBe(session.user.id);
    });

    it('rejects a token signed with a different secret', () => {
        const forged = jwt.sign({ sub: 'anyone' }, 'a-different-secret-entirely-long-enough');
        expect(() => verifyAccessToken(forged)).toThrow(AuthError);
    });

    it('rejects an expired token', () => {
        const session = register(account());
        const expired = jwt.sign({ sub: session.user.id }, process.env.JWT_SECRET, { expiresIn: '-1s' });
        expect(() => verifyAccessToken(expired)).toThrow(/expired|Invalid/i);
    });

    it('rejects a valid token whose account has been deleted', () => {
        const session = register(account());
        db.prepare('DELETE FROM users WHERE id = ?').run(session.user.id);

        // The signature is still good; the authorization decisions downstream
        // all assume the user row exists.
        expect(() => verifyAccessToken(session.accessToken)).toThrow(/no longer exists/);
    });
});

describe('refresh', () => {
    it('rotates: the old token stops working and a new one is issued', () => {
        const first = register(account());
        const second = refresh(first.refreshToken);

        expect(second.refreshToken).not.toBe(first.refreshToken);
        expect(second.user.id).toBe(first.user.id);
        expect(() => refresh(first.refreshToken)).toThrow(/invalid or expired/i);
    });

    it('accepts the newly issued token', () => {
        const first = register(account());
        const second = refresh(first.refreshToken);
        expect(() => refresh(second.refreshToken)).not.toThrow();
    });

    it('rejects a missing, unknown, or expired token', () => {
        expect(() => refresh(undefined)).toThrow(expect.objectContaining({ status: 401 }));
        expect(() => refresh('not-a-real-token')).toThrow(expect.objectContaining({ status: 401 }));

        const session = register(account());
        db.prepare('UPDATE refresh_tokens SET expires_at = ?').run(
            new Date(Date.now() - 1000).toISOString()
        );
        expect(() => refresh(session.refreshToken)).toThrow(/invalid or expired/i);
    });

    it('stores refresh tokens hashed, so a database read is not a credential', () => {
        const session = register(account());
        const stored = db.prepare('SELECT token_hash FROM refresh_tokens').all();

        expect(stored).toHaveLength(1);
        expect(stored[0].token_hash).not.toBe(session.refreshToken);
        expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('revocation', () => {
    it('revokeRefreshToken invalidates exactly that token', () => {
        const session = register(account());
        revokeRefreshToken(session.refreshToken);
        expect(() => refresh(session.refreshToken)).toThrow(AuthError);
    });

    it('ignores a missing token rather than throwing', () => {
        expect(() => revokeRefreshToken(undefined)).not.toThrow();
    });

    it('revokeAllForUser ends every session for that user and no other', () => {
        const ada = register(account());
        const adaSecondDevice = login({ email: 'ada@example.com', password: account().password });
        const grace = register(account({ email: 'grace@example.com', username: 'grace' }));

        revokeAllForUser(ada.user.id);

        expect(() => refresh(ada.refreshToken)).toThrow(AuthError);
        expect(() => refresh(adaSecondDevice.refreshToken)).toThrow(AuthError);
        expect(() => refresh(grace.refreshToken)).not.toThrow();
    });
});

describe('pruneRefreshTokens', () => {
    it('removes expired tokens and leaves live ones', () => {
        const live = register(account());
        register(account({ email: 'grace@example.com', username: 'grace' }));

        db.prepare('UPDATE refresh_tokens SET expires_at = ? WHERE user_id != ?').run(
            new Date(Date.now() - 1000).toISOString(),
            live.user.id
        );

        expect(pruneRefreshTokens()).toBe(1);
        expect(() => refresh(live.refreshToken)).not.toThrow();
    });
});
