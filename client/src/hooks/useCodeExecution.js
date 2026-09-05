/**
 * hooks/useCodeExecution.js
 * Execution state, keyed by file.
 *
 * This used to hold one `result` for the whole workspace, so running one file
 * and switching tabs left the previous file's output on screen under a
 * different filename. State is now a map from file id to that file's last run,
 * which is the only way an "output beside the editor, per file" panel can be
 * correct.
 */

import { useState, useCallback } from 'react';
import { executeCode } from '@/services/executionService';
import { getPistonSlug } from '@/constants/languageMap';

/**
 * @typedef {object} FileExecution
 * @property {object|null} result  - Full execution result from Piston
 * @property {string|null} error   - Error message if execution failed
 */

/**
 * @returns {{
 *   isRunning: Record<string, boolean>,
 *   results: Record<string, FileExecution>,
 *   run: (fileId: string, code: string, language: string, stdin?: string) => Promise<void>,
 *   clearResult: (fileId: string) => void,
 * }}
 */
export function useCodeExecution() {
    const [isRunning, setIsRunning] = useState({});
    const [results, setResults] = useState({});

    const run = useCallback(async (fileId, code, language, stdin = '') => {
        if (!fileId) return;

        setIsRunning((prev) => ({ ...prev, [fileId]: true }));
        // The panel stays mounted while a run is in flight, showing a spinner
        // rather than the previous run's output — which would otherwise read as
        // the result of the run that has not finished yet.
        setResults((prev) => ({ ...prev, [fileId]: { result: null, error: null } }));

        const pistonSlug = getPistonSlug(language);
        if (!pistonSlug) {
            setResults((prev) => ({
                ...prev,
                [fileId]: { result: null, error: `"${language}" does not support code execution.` },
            }));
            setIsRunning((prev) => ({ ...prev, [fileId]: false }));
            return;
        }

        try {
            const executionResult = await executeCode({ language: pistonSlug, code, stdin });
            setResults((prev) => ({ ...prev, [fileId]: { result: executionResult, error: null } }));
        } catch (err) {
            setResults((prev) => ({
                ...prev,
                [fileId]: {
                    result: null,
                    error: err.message || 'Code execution failed. Please try again.',
                },
            }));
        } finally {
            setIsRunning((prev) => ({ ...prev, [fileId]: false }));
        }
    }, []);

    const clearResult = useCallback((fileId) => {
        setResults((prev) => {
            const next = { ...prev };
            delete next[fileId];
            return next;
        });
    }, []);

    return { isRunning, results, run, clearResult };
}
