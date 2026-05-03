/**
 * routes/ai.js
 * AI assistance endpoints using Gemini via aiService.
 * Uses Server-Sent Events (SSE) for streaming responses.
 */

const express = require('express');
const { explainCode, fixCode, askAboutCode, getCompletion } = require('../services/aiService');

const router = express.Router();

/**
 * Send an SSE event to the client.
 */
function sendSSE(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Setup SSE headers and handle client disconnect.
 */
function setupSSEStream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Keep-alive ping every 15s
    const pingInterval = setInterval(() => {
        res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(pingInterval);
    });

    return pingInterval;
}

/**
 * Stream a Gemini generator to SSE response.
 */
async function streamToSSE(req, res, generator) {
    const pingInterval = setupSSEStream(req, res);

    try {
        for await (const chunk of generator) {
            if (req.destroyed) break;
            sendSSE(res, 'chunk', { text: chunk });
        }
        sendSSE(res, 'done', { finished: true });
    } catch (error) {
        console.error('[AI Stream] Error:', error.message);
        sendSSE(res, 'error', {
            message: error.message.includes('GEMINI_API_KEY')
                ? 'AI service not configured. Please set GEMINI_API_KEY.'
                : 'AI service encountered an error. Please try again.',
        });
    } finally {
        clearInterval(pingInterval);
        res.end();
    }
}

/**
 * POST /api/ai/explain
 * Body: { code: string, language: string }
 * Streams SSE events: chunk | done | error
 */
router.post('/ai/explain', async (req, res) => {
    const { code, language = 'code' } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "code" field.' });
    }
    if (code.length > 50_000) {
        return res.status(400).json({ error: 'Code too long for AI analysis (max 50,000 chars).' });
    }

    console.log(`[AI] explain — language=${language}, codeLen=${code.length}`);
    await streamToSSE(req, res, explainCode(code, language));
});

/**
 * POST /api/ai/fix
 * Body: { code: string, language: string, errorContext?: string }
 * Streams SSE events: chunk | done | error
 */
router.post('/ai/fix', async (req, res) => {
    const { code, language = 'code', errorContext = '' } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "code" field.' });
    }

    console.log(`[AI] fix — language=${language}, codeLen=${code.length}`);
    await streamToSSE(req, res, fixCode(code, language, errorContext));
});

/**
 * POST /api/ai/ask
 * Body: { prompt: string, code?: string, language?: string }
 * Streams SSE events: chunk | done | error
 */
router.post('/ai/ask', async (req, res) => {
    const { prompt, code = '', language = 'code' } = req.body;

    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "prompt" field.' });
    }

    console.log(`[AI] ask — language=${language}, promptLen=${prompt.length}`);
    await streamToSSE(req, res, askAboutCode(prompt, code, language));
});

/**
 * POST /api/ai/complete
 * Body: { prefix: string, suffix: string, language: string }
 * Returns: { completion: string }
 */
router.post('/ai/complete', async (req, res) => {
    const { prefix, suffix = '', language = 'code' } = req.body;

    if (!prefix && prefix !== '') {
        return res.status(400).json({ error: 'Missing "prefix" field.' });
    }

    try {
        const completion = await getCompletion(prefix, suffix, language);
        res.json({ completion });
    } catch (error) {
        console.error('[AI Completion] Error:', error.message);
        res.status(500).json({ error: 'Completion failed.' });
    }
});

module.exports = router;
