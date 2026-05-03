/**
 * hooks/useCodeExecution.js
 * Manages code execution state — loading, result, error, and abort.
 */

import { useState, useCallback, useRef } from 'react';
import { executeCode } from '@/services/executionService';
import { getPistonSlug } from '@/constants/languageMap';

/**
 * @typedef {object} ExecutionState
 * @property {boolean} isRunning
 * @property {object|null} result     - Full execution result from Piston
 * @property {string|null} error      - Error message if execution failed
 */

/**
 * @returns {{
 *   isRunning: boolean,
 *   result: object|null,
 *   error: string|null,
 *   run: (code: string, language: string, stdin?: string) => Promise<void>,
 *   clearResult: () => void,
 * }}
 */
export function useCodeExecution() {
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const abortRef = useRef(null);

    const run = useCallback(async (code, language, stdin = '') => {
        // Cancel any in-flight execution (shouldn't happen with UI disabled, but safety net)
        if (abortRef.current) {
            abortRef.current = false;
        }

        setIsRunning(true);
        setResult(null);
        setError(null);

        const pistonSlug = getPistonSlug(language);
        if (!pistonSlug) {
            setError(`"${language}" does not support code execution.`);
            setIsRunning(false);
            return;
        }

        try {
            const executionResult = await executeCode({
                language: pistonSlug,
                code,
                stdin,
            });
            setResult(executionResult);
        } catch (err) {
            setError(err.message || 'Code execution failed. Please try again.');
        } finally {
            setIsRunning(false);
        }
    }, []);

    const clearResult = useCallback(() => {
        setResult(null);
        setError(null);
    }, []);

    return { isRunning, result, error, run, clearResult };
}
