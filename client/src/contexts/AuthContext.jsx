/**
 * contexts/AuthContext.jsx
 * The signed-in user, and the operations that change who that is.
 *
 * Identity used to be a username string typed on the home page and carried in
 * router state. It is now a verified account: the server issues the tokens, and
 * every username the UI shows for the local user comes from this context.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
    postJson,
    getJson,
    setTokens,
    clearTokens,
    getAccessToken,
} from '@/services/apiClient';

const AuthContext = createContext(null);

export const useAuth = () => {
    const value = useContext(AuthContext);
    if (!value) throw new Error('useAuth must be used inside an AuthProvider');
    return value;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    // Distinguishes "not signed in" from "we haven't checked yet" — routing on
    // the latter would bounce a returning user to the login page on every load.
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            if (!getAccessToken()) {
                setLoading(false);
                return;
            }
            try {
                const { user: me } = await getJson('/api/auth/me');
                if (!cancelled) setUser(me);
            } catch {
                // Token was rejected and could not be refreshed.
                clearTokens();
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const adoptSession = useCallback((session) => {
        setTokens(session);
        setUser(session.user);
        return session.user;
    }, []);

    const login = useCallback(
        async (email, password) => adoptSession(await postJson('/api/auth/login', { email, password }, { skipAuth: true })),
        [adoptSession]
    );

    const register = useCallback(
        async (email, username, password) =>
            adoptSession(await postJson('/api/auth/register', { email, username, password }, { skipAuth: true })),
        [adoptSession]
    );

    const logout = useCallback(async () => {
        try {
            await postJson('/api/auth/logout', {
                refreshToken: localStorage.getItem('dobby_refresh_token'),
            });
        } catch {
            // A failed revoke should not trap the user in a signed-in UI; the
            // token expires on its own.
        }
        clearTokens();
        setUser(null);
    }, []);

    const value = useMemo(
        () => ({ user, loading, login, register, logout, isAuthenticated: Boolean(user) }),
        [user, loading, login, register, logout]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
