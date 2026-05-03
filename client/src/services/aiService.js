/**
 * services/aiService.js
 * Client-side AI assistance API calls using SSE streaming.
 */

import { API_BASE_URL } from './apiClient';

/**
 * SSE streaming helper.
 * Calls a POST endpoint and streams `chunk` events back via an onChunk callback.
 *
 * @param {string} path - API path
 * @param {object} body - Request body
 * @param {function} onChunk - Called with each text chunk
 * @param {AbortSignal} [signal] - Optional AbortController signal
 * @returns {Promise<void>} Resolves when stream completes or rejects on error
 */
async function streamPost(path, body, onChunk, signal) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete last line

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.text) onChunk(parsed.text);
                    if (parsed.finished) return;
                    if (parsed.message) throw new Error(parsed.message); // SSE error event
                } catch (e) {
                    if (e.message && !e.message.includes('JSON')) throw e;
                }
            }
        }
    }
}

/**
 * Stream an explanation of selected code.
 *
 * @param {string} code
 * @param {string} language
 * @param {function} onChunk - Called with each streamed text chunk
 * @param {AbortSignal} [signal]
 */
export function streamExplain(code, language, onChunk, signal) {
    return streamPost('/api/ai/explain', { code, language }, onChunk, signal);
}

/**
 * Stream a fix/improvement for buggy code.
 *
 * @param {string} code
 * @param {string} language
 * @param {string} errorContext - Error message or description of the problem
 * @param {function} onChunk
 * @param {AbortSignal} [signal]
 */
export function streamFix(code, language, errorContext, onChunk, signal) {
    return streamPost('/api/ai/fix', { code, language, errorContext }, onChunk, signal);
}

/**
 * Stream an answer to a custom question about code.
 *
 * @param {string} prompt
 * @param {string} code
 * @param {string} language
 * @param {function} onChunk
 * @param {AbortSignal} [signal]
 */
export function streamAsk(prompt, code, language, onChunk, signal) {
    return streamPost('/api/ai/ask', { prompt, code, language }, onChunk, signal);
}

/**
 * Fetch a code completion.
 *
 * @param {string} prefix
 * @param {string} suffix
 * @param {string} language
 * @returns {Promise<string>}
 */
export async function fetchCompletion(prefix, suffix, language) {
    const response = await fetch(`${API_BASE_URL}/api/ai/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, suffix, language }),
    });

    if (!response.ok) return '';
    const data = await response.json();
    return data.completion || '';
}
