/**
 * pistonService.js
 * Piston API client for sandboxed code execution.
 * Docs: https://github.com/engineer-man/piston
 */

const PISTON_BASE_URL = 'https://emkc.org/api/v2/piston';

// Cache runtimes so we only fetch once per server startup
let runtimesCache = null;

/**
 * Fetch and cache available Piston runtimes.
 * @returns {Promise<Array>} Array of runtime objects {language, version, aliases}
 */
async function getRuntimes() {
    if (runtimesCache) return runtimesCache;

    try {
        const response = await fetch(`${PISTON_BASE_URL}/runtimes`);
        if (!response.ok) {
            throw new Error(`Piston runtimes fetch failed: ${response.status}`);
        }
        runtimesCache = await response.json();
        console.log(`✓ Piston: loaded ${runtimesCache.length} runtimes`);
        return runtimesCache;
    } catch (error) {
        console.error('✗ Piston: failed to fetch runtimes:', error.message);
        runtimesCache = null; // Allow retry next call
        throw error;
    }
}

/**
 * Resolve the best-matching Piston runtime for a given language slug.
 * @param {string} language - e.g. "python", "javascript", "cpp"
 * @returns {Promise<{language: string, version: string} | null>}
 */
async function resolveRuntime(language) {
    const runtimes = await getRuntimes();
    const normalized = language.toLowerCase().trim();

    // Direct match or alias match
    const match = runtimes.find(
        (rt) =>
            rt.language === normalized ||
            (rt.aliases && rt.aliases.includes(normalized))
    );

    return match ? { language: match.language, version: match.version } : null;
}

/**
 * Execute code in a sandboxed Piston environment.
 *
 * @param {string} language - Language slug (e.g. "python", "javascript", "cpp")
 * @param {string} code     - Source code to execute
 * @param {string} [stdin]  - Optional standard input
 * @param {string} [filename] - Optional filename hint (affects shebang detection etc.)
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, signal: string|null, time: number}>}
 */
async function execute(language, code, stdin = '', filename = null) {
    const runtime = await resolveRuntime(language);
    if (!runtime) {
        throw new Error(`Unsupported language: "${language}". Check /api/runtimes for available options.`);
    }

    const payload = {
        language: runtime.language,
        version: runtime.version,
        files: [
            {
                name: filename || getDefaultFilename(runtime.language),
                content: code,
            },
        ],
        stdin,
        args: [],
        compile_timeout: 10000, // ms
        run_timeout: 10000,     // ms
        compile_memory_limit: -1,
        run_memory_limit: -1,
    };

    const startTime = Date.now();

    const response = await fetch(`${PISTON_BASE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Piston execution failed (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    const elapsed = Date.now() - startTime;

    // Piston returns { run: {stdout, stderr, code, signal, output}, compile?: {...} }
    const run = result.run || {};
    const compile = result.compile || null;

    return {
        stdout: run.stdout || '',
        stderr: run.stderr || (compile?.stderr) || '',
        exitCode: run.code ?? -1,
        signal: run.signal || null,
        compileOutput: compile?.output || null,
        time: elapsed,
        language: runtime.language,
        version: runtime.version,
    };
}

/**
 * Return default filenames for common languages so Piston picks the right compiler.
 */
function getDefaultFilename(language) {
    const map = {
        python: 'main.py',
        python3: 'main.py',
        javascript: 'main.js',
        typescript: 'main.ts',
        java: 'Main.java',
        'c++': 'main.cpp',
        cpp: 'main.cpp',
        c: 'main.c',
        rust: 'main.rs',
        go: 'main.go',
        ruby: 'main.rb',
        php: 'main.php',
        swift: 'main.swift',
        kotlin: 'main.kt',
        bash: 'main.sh',
        csharp: 'main.cs',
        'c#': 'main.cs',
    };
    return map[language] || 'main.txt';
}

module.exports = { execute, getRuntimes, resolveRuntime };
