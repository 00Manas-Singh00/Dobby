/**
 * routes/execution.js
 * Code execution endpoints. Proxies to Piston API via pistonService.
 */

import express from 'express';
import { execute, getRuntimes } from '../services/pistonService.js';
import { executeLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

/**
 * POST /api/execute
 * Body: { language: string, code: string, stdin?: string, filename?: string }
 * Returns: { stdout, stderr, exitCode, signal, time, language, version, compileOutput? }
 */
router.post('/execute', executeLimiter, async (req, res) => {
    const { language, code, stdin = '', filename } = req.body;

    if (typeof code !== 'string') {
        return res.status(400).json({ error: 'Field "code" must be a string.' });
    }
    if (typeof stdin !== 'string' || stdin.length > 100_000) {
        return res.status(400).json({ error: 'Field "stdin" must be a string under 100,000 characters.' });
    }
    if (filename !== undefined && (typeof filename !== 'string' || !/^[\w.-]{1,64}$/.test(filename))) {
        return res.status(400).json({ error: 'Field "filename" must be a simple file name.' });
    }

    // Validate required fields
    if (!language || typeof language !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "language" field.' });
    }
    if (code.length > 100_000) {
        return res.status(400).json({ error: 'Code exceeds maximum size of 100,000 characters.' });
    }

    try {
        console.log(`[Execute] language=${language}, codeLen=${code.length}`);
        const result = await execute(language, code, stdin, filename);
        return res.json(result);
    } catch (error) {
        console.error('[Execute] Error:', error.message);

        if (error.message.includes('Unsupported language')) {
            return res.status(400).json({ error: error.message });
        }

        return res.status(502).json({
            error: 'Code execution service unavailable. Please try again.',
            detail: error.message,
        });
    }
});

/**
 * GET /api/runtimes
 * Returns the list of supported languages from Piston.
 * Cached after first call.
 */
router.get('/runtimes', async (req, res) => {
    try {
        const runtimes = await getRuntimes();
        return res.json(runtimes);
    } catch (error) {
        return res.status(502).json({ error: 'Could not fetch runtimes from Piston.' });
    }
});

export default router;
