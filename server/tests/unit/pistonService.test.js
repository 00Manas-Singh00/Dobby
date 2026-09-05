/**
 * Piston runtime resolution and language mapping.
 *
 * `fetch` is stubbed throughout: these tests are about how Dobby picks a
 * runtime and names the file it sends, not about whether emkc.org is up. A
 * test that reached the network would be slow, flaky, and would stop testing
 * this code the moment Piston changed its catalogue.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const RUNTIMES = [
    { language: 'python', version: '3.10.0', aliases: ['py', 'py3', 'python3'] },
    { language: 'javascript', version: '18.15.0', aliases: ['node', 'node-js', 'js'] },
    { language: 'c++', version: '10.2.0', aliases: ['cpp', 'g++'] },
    { language: 'java', version: '15.0.2', aliases: [] },
    { language: 'rust', version: '1.68.2', aliases: ['rs'] },
    { language: 'elixir', version: '1.11.3', aliases: [] },
];

/** Fresh module instance per test — the runtime cache is module-level state. */
async function loadService() {
    vi.resetModules();
    return import('../../services/pistonService.js');
}

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

let fetchMock;

beforeEach(() => {
    fetchMock = vi.fn(async (url) => {
        if (String(url).endsWith('/runtimes')) return okResponse(RUNTIMES);
        return okResponse({ run: { stdout: 'hello\n', stderr: '', code: 0, signal: null } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('getRuntimes', () => {
    it('fetches once and caches for the process lifetime', async () => {
        const { getRuntimes } = await loadService();

        await getRuntimes();
        await getRuntimes();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws on a failed fetch and allows a retry afterwards', async () => {
        const { getRuntimes } = await loadService();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

        await expect(getRuntimes()).rejects.toThrow(/503/);

        // The cache must not hold a failure, or one bad response would disable
        // execution until the next restart.
        await expect(getRuntimes()).resolves.toHaveLength(RUNTIMES.length);
    });
});

describe('resolveRuntime', () => {
    it('matches a language by its canonical name', async () => {
        const { resolveRuntime } = await loadService();
        expect(await resolveRuntime('python')).toEqual({ language: 'python', version: '3.10.0' });
    });

    it('matches by alias', async () => {
        const { resolveRuntime } = await loadService();

        expect(await resolveRuntime('py')).toEqual({ language: 'python', version: '3.10.0' });
        expect(await resolveRuntime('node')).toEqual({ language: 'javascript', version: '18.15.0' });
        expect(await resolveRuntime('cpp')).toEqual({ language: 'c++', version: '10.2.0' });
    });

    it('is case- and whitespace-insensitive', async () => {
        const { resolveRuntime } = await loadService();

        // Monaco reports language ids that do not always match Piston's casing.
        expect(await resolveRuntime('  PYTHON  ')).toEqual({ language: 'python', version: '3.10.0' });
        expect(await resolveRuntime('JS')).toEqual({ language: 'javascript', version: '18.15.0' });
    });

    it('returns null for a language Piston does not offer', async () => {
        const { resolveRuntime } = await loadService();
        expect(await resolveRuntime('brainfuck')).toBeNull();
    });
});

describe('execute', () => {
    /** The JSON body of the Nth POST to /execute. */
    const executePayload = (call = 0) =>
        JSON.parse(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')[call][1].body);

    it('refuses an unsupported language without calling Piston', async () => {
        const { execute } = await loadService();

        await expect(execute('brainfuck', 'code')).rejects.toThrow(/Unsupported language/);
        expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    });

    it('sends the resolved language and version, not the alias the caller used', async () => {
        const { execute } = await loadService();
        await execute('py', 'print(1)');

        expect(executePayload()).toMatchObject({ language: 'python', version: '3.10.0' });
    });

    it('names the file so Piston picks the right compiler', async () => {
        const { execute } = await loadService();

        // Java in particular fails outright with the wrong filename, because
        // the public class name has to match.
        await execute('java', 'class Main {}');
        expect(executePayload(0).files[0].name).toBe('Main.java');

        await execute('cpp', 'int main(){}');
        expect(executePayload(1).files[0].name).toBe('main.cpp');

        await execute('py', 'print(1)');
        expect(executePayload(2).files[0].name).toBe('main.py');
    });

    it('prefers an explicit filename over the default', async () => {
        const { execute } = await loadService();
        await execute('python', 'print(1)', '', 'solution.py');

        expect(executePayload().files[0].name).toBe('solution.py');
    });

    it('falls back to main.txt for a language with no mapping', async () => {
        const { execute } = await loadService();
        await execute('elixir', 'IO.puts 1');

        // elixir has no entry in the filename map — the run still has to be
        // attempted rather than rejected.
        expect(executePayload().files[0].name).toBe('main.txt');
    });

    it('passes stdin through', async () => {
        const { execute } = await loadService();
        await execute('python', 'input()', 'hello input');

        expect(executePayload().stdin).toBe('hello input');
    });

    it('normalizes the response', async () => {
        const { execute } = await loadService();
        const result = await execute('python', 'print("hello")');

        expect(result).toMatchObject({
            stdout: 'hello\n',
            stderr: '',
            exitCode: 0,
            signal: null,
            language: 'python',
            version: '3.10.0',
        });
        expect(result.time).toBeTypeOf('number');
    });

    it('surfaces compiler stderr when the run produced none', async () => {
        const { execute } = await loadService();
        fetchMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/runtimes')) return okResponse(RUNTIMES);
            return okResponse({
                run: { stdout: '', stderr: '', code: 1 },
                compile: { stderr: 'error: expected ;', output: 'error: expected ;' },
            });
        });

        // A compile failure with an empty run.stderr would otherwise report
        // nothing at all to the user.
        const result = await execute('cpp', 'int main(){}');
        expect(result.stderr).toBe('error: expected ;');
        expect(result.compileOutput).toBe('error: expected ;');
    });

    it('reports a non-2xx from Piston as an error', async () => {
        const { execute } = await loadService();
        fetchMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/runtimes')) return okResponse(RUNTIMES);
            return { ok: false, status: 429, text: async () => 'Too many requests' };
        });

        await expect(execute('python', 'print(1)')).rejects.toThrow(/429/);
    });

    it('reports a missing exit code as -1 rather than undefined', async () => {
        const { execute } = await loadService();
        fetchMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/runtimes')) return okResponse(RUNTIMES);
            return okResponse({ run: { stdout: '', stderr: 'killed' } });
        });

        expect((await execute('python', 'while True: pass')).exitCode).toBe(-1);
    });
});
