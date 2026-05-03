/**
 * hooks/useAI.js
 * Manages AI assistant state: streaming text, loading, errors, and cancellation.
 */

import { useState, useCallback, useRef } from 'react';
import { streamExplain, streamFix, streamAsk } from '@/services/aiService';

/**
 * @typedef {'explain' | 'fix' | 'ask'} AIMode
 */

/**
 * @returns {{
 *   isStreaming: boolean,
 *   streamedText: string,
 *   error: string|null,
 *   mode: AIMode|null,
 *   explain: (code: string, language: string) => void,
 *   fix: (code: string, language: string, errorContext?: string) => void,
 *   ask: (prompt: string, code: string, language: string) => void,
 *   cancel: () => void,
 *   clear: () => void,
 * }}
 */
export function useAI() {
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamedText, setStreamedText] = useState('');
    const [error, setError] = useState(null);
    const [mode, setMode] = useState(null);
    const abortControllerRef = useRef(null);

    /** Cancel the current stream */
    const cancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
    }, []);

    /** Clear all state */
    const clear = useCallback(() => {
        cancel();
        setStreamedText('');
        setError(null);
        setMode(null);
    }, [cancel]);

    /** Internal: start a streaming operation */
    const startStream = useCallback(async (activeMode, streamFn) => {
        cancel(); // Cancel any existing stream

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsStreaming(true);
        setStreamedText('');
        setError(null);
        setMode(activeMode);

        try {
            await streamFn(
                (chunk) => {
                    setStreamedText((prev) => prev + chunk);
                },
                controller.signal
            );
        } catch (err) {
            if (err.name !== 'AbortError') {
                setError(err.message || 'AI service encountered an error.');
            }
        } finally {
            setIsStreaming(false);
            abortControllerRef.current = null;
        }
    }, [cancel]);

    const explain = useCallback(
        (code, language) => {
            startStream('explain', (onChunk, signal) =>
                streamExplain(code, language, onChunk, signal)
            );
        },
        [startStream]
    );

    const fix = useCallback(
        (code, language, errorContext = '') => {
            startStream('fix', (onChunk, signal) =>
                streamFix(code, language, errorContext, onChunk, signal)
            );
        },
        [startStream]
    );

    const ask = useCallback(
        (prompt, code, language) => {
            startStream('ask', (onChunk, signal) =>
                streamAsk(prompt, code, language, onChunk, signal)
            );
        },
        [startStream]
    );

    return { isStreaming, streamedText, error, mode, explain, fix, ask, cancel, clear };
}
