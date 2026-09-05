/**
 * services/apiClient.js
 * Base HTTP client for all server API calls.
 * Centralizes base URL, headers, auth, and error handling.
 *
 * Token handling lives here rather than in AuthContext so that every caller —
 * including modules that render outside the React tree — sends credentials
 * without having to remember to.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

const ACCESS_TOKEN_KEY = 'dobby_access_token';
const REFRESH_TOKEN_KEY = 'dobby_refresh_token';

// In-memory copy of the access token. localStorage is the durable store (so a
// reload keeps the session), but reads go through this to avoid touching
// storage on every request.
let accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
let refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(accessToken));

/** Subscribe to token changes — used by SocketContext to reconnect. */
export function onTokenChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export const getAccessToken = () => accessToken;

export function setTokens({ accessToken: access, refreshToken: refresh }) {
    accessToken = access ?? null;
    refreshToken = refresh ?? null;

    if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);

    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);

    notify();
}

export function clearTokens() {
    setTokens({ accessToken: null, refreshToken: null });
}

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/**
 * Exchange the refresh token for a new pair.
 *
 * Concurrent 401s share one in-flight refresh: without this, several parallel
 * requests would each rotate the token and all but one would be invalidated.
 */
let refreshInFlight = null;

async function refreshSession() {
    if (!refreshToken) throw new ApiError('Session expired.', 401);

    if (!refreshInFlight) {
        refreshInFlight = (async () => {
            try {
                const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken }),
                });

                if (!response.ok) {
                    clearTokens();
                    throw new ApiError('Session expired. Please sign in again.', 401);
                }

                const data = await response.json();
                setTokens(data);
                return data;
            } finally {
                refreshInFlight = null;
            }
        })();
    }

    return refreshInFlight;
}

/**
 * Core fetch wrapper. Attaches the bearer token, transparently refreshes an
 * expired one exactly once, and throws a descriptive error on non-2xx.
 *
 * @param {string} path - Relative path, e.g. "/api/execute"
 * @param {RequestInit & { skipAuth?: boolean }} options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
    const { skipAuth = false, ...fetchOptions } = options;

    const send = () =>
        fetch(`${BASE_URL}${path}`, {
            ...fetchOptions,
            headers: {
                'Content-Type': 'application/json',
                ...(accessToken && !skipAuth ? { Authorization: `Bearer ${accessToken}` } : {}),
                ...fetchOptions.headers,
            },
        });

    let response = await send();

    if (response.status === 401 && !skipAuth && refreshToken) {
        await refreshSession();
        response = await send();
    }

    if (!response.ok) {
        let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
        try {
            const body = await response.json();
            if (body.error) errorMessage = body.error;
        } catch {
            // Response body wasn't JSON — use status text
        }
        throw new ApiError(errorMessage, response.status);
    }

    return response;
}

/** POST helper that automatically JSON-encodes the body. */
export async function apiPost(path, body, options = {}) {
    return apiFetch(path, { ...options, method: 'POST', body: JSON.stringify(body ?? {}) });
}

/** PATCH helper. Used for partial updates — renaming or moving a file. */
export async function apiPatch(path, body, options = {}) {
    return apiFetch(path, { ...options, method: 'PATCH', body: JSON.stringify(body ?? {}) });
}

/** GET helper. */
export async function apiGet(path, options = {}) {
    return apiFetch(path, { ...options, method: 'GET' });
}

/** DELETE helper. */
export async function apiDelete(path, options = {}) {
    return apiFetch(path, { ...options, method: 'DELETE' });
}

/** Same as the helpers above, but parses the JSON body. */
export const getJson = async (path, options) => (await apiGet(path, options)).json();
export const postJson = async (path, body, options) => (await apiPost(path, body, options)).json();
export const deleteJson = async (path, options) => (await apiDelete(path, options)).json();
export const patchJson = async (path, body, options) => (await apiPatch(path, body, options)).json();

export const API_BASE_URL = BASE_URL;
