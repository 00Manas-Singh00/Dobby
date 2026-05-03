/**
 * services/aiService.js
 * Gemini-powered AI assistance for code explanation, fixing, and chat.
 * Uses @google/generative-ai for streaming responses.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getClient() {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not set in environment variables.');
        }
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

function getModel() {
    return getClient().getGenerativeModel({ model: 'gemini-2.0-flash' });
}

/**
 * Build a system prompt for code assistance tasks.
 */
function buildSystemPrompt(language) {
    return `You are an expert ${language} developer and code reviewer acting as an AI pair programmer inside a collaborative coding IDE called Dobby. 
Be concise, precise, and technical. Use markdown formatting for code blocks. 
When explaining code, focus on the key concepts and non-obvious parts.
When fixing code, explain what was wrong and why your fix works.
Language context: ${language}.`;
}

/**
 * Explain code — returns an async generator yielding text chunks.
 *
 * @param {string} code - The code to explain
 * @param {string} language - Language context (e.g. "javascript")
 * @returns {AsyncGenerator<string>}
 */
async function* explainCode(code, language = 'code') {
    const model = getModel();
    const prompt = `${buildSystemPrompt(language)}

Explain the following ${language} code clearly and concisely. Cover:
1. What it does (high level)
2. Key logic or algorithms used
3. Any potential issues or improvements

\`\`\`${language}
${code}
\`\`\``;

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
    }
}

/**
 * Fix / improve code — returns an async generator yielding text chunks.
 *
 * @param {string} code - The buggy or improvable code
 * @param {string} language - Language context
 * @param {string} [errorContext] - Optional error message or description of the problem
 * @returns {AsyncGenerator<string>}
 */
async function* fixCode(code, language = 'code', errorContext = '') {
    const model = getModel();
    const errorSection = errorContext
        ? `\n\nError / Problem description:\n${errorContext}`
        : '';

    const prompt = `${buildSystemPrompt(language)}

Review and fix the following ${language} code. Identify bugs, logic errors, or improvements.
Show the corrected code in a code block, then explain what you changed and why.${errorSection}

\`\`\`${language}
${code}
\`\`\``;

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
    }
}

/**
 * Custom prompt — free-form question about code.
 *
 * @param {string} prompt - User's question
 * @param {string} code - Code context
 * @param {string} language - Language context
 * @returns {AsyncGenerator<string>}
 */
async function* askAboutCode(prompt, code, language = 'code') {
    const model = getModel();
    const fullPrompt = `${buildSystemPrompt(language)}

Code context:
\`\`\`${language}
${code}
\`\`\`

User question: ${prompt}`;

    const result = await model.generateContentStream(fullPrompt);
    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
    }
}

/**
 * Get inline code completion — returns a short string to complete the current line/block.
 *
 * @param {string} prefix - Code before the cursor
 * @param {string} suffix - Code after the cursor
 * @param {string} language - Language context
 * @returns {Promise<string>}
 */
async function getCompletion(prefix, suffix, language = 'code') {
    const model = getModel();
    const prompt = `You are an AI code completion engine. 
Context: ${language} file.
Code before cursor:
"""
${prefix}
"""
Code after cursor:
"""
${suffix}
"""

Task: Provide the single most likely completion that should follow the code before the cursor.
Rules:
1. Return ONLY the code completion. 
2. Do NOT use markdown code blocks.
3. Be extremely concise.
4. Match the indentation of the preceding line.
5. If no clear completion exists, return an empty string.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text.replace(/^[\s\S]*?```[\s\S]*?\n/, '').replace(/```$/, '').trimEnd();
}

module.exports = { explainCode, fixCode, askAboutCode, getCompletion };
