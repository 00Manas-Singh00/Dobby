/**
 * services/apiClient.js
 * Base HTTP client for all server API calls.
 * Centralizes base URL, headers, and error handling.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

/**
 * Core fetch wrapper. Throws a descriptive error on non-2xx responses.
 *
 * @param {string} path - Relative path, e.g. "/api/execute"
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
    const url = `${BASE_URL}${path}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
        try {
            const body = await response.json();
            if (body.error) errorMessage = body.error;
        } catch {
            // Response body wasn't JSON — use status text
        }
        throw new Error(errorMessage);
    }

    return response;
}

/**
 * POST helper that automatically JSON-encodes the body.
 */
export async function apiPost(path, body) {
    return apiFetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/**
 * GET helper.
 */
export async function apiGet(path) {
    return apiFetch(path, { method: 'GET' });
}

export const API_BASE_URL = BASE_URL;
