/**
 * services/executionService.js
 * Client-side code execution API calls.
 */

import { apiPost, apiGet } from './apiClient';

/**
 * Execute code via the Piston-proxied execution endpoint.
 *
 * @param {object} params
 * @param {string} params.language  - Monaco language ID (will be mapped to Piston slug server-side)
 * @param {string} params.code      - Source code
 * @param {string} [params.stdin]   - Optional standard input
 * @param {string} [params.filename] - Optional filename hint
 * @returns {Promise<ExecutionResult>}
 *
 * @typedef {object} ExecutionResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} exitCode
 * @property {string|null} signal
 * @property {string|null} compileOutput
 * @property {number} time           - Wall-clock time in ms
 * @property {string} language       - Resolved Piston language slug
 * @property {string} version        - Runtime version used
 */
export async function executeCode({ language, code, stdin = '', filename }) {
    const response = await apiPost('/api/execute', { language, code, stdin, filename });
    return response.json();
}

/**
 * Fetch all runtimes supported by Piston.
 * @returns {Promise<Array<{language: string, version: string, aliases: string[]}>>}
 */
export async function fetchRuntimes() {
    const response = await apiGet('/api/runtimes');
    return response.json();
}
