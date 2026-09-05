/**
 * e2e/fixtures.js
 * Account and room setup for the end-to-end tests.
 *
 * Accounts and invites are created over the REST API rather than by driving the
 * sign-in form. These tests exist to prove that two browsers editing one file
 * converge; routing the setup through the UI would make an unrelated change to
 * the auth page fail the convergence test, which is the opposite of useful.
 */

import { SERVER_URL } from '../playwright.config.js';

const ACCESS_TOKEN_KEY = 'dobby_access_token';
const REFRESH_TOKEN_KEY = 'dobby_refresh_token';

async function api(path, { method = 'POST', token, body } = {}) {
    const response = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(`${method} ${path} → ${response.status}: ${payload.error}`);
    }
    return payload;
}

let counter = 0;

/** Register a throwaway account. */
export async function registerUser(prefix = 'e2e') {
    counter += 1;
    const unique = `${prefix}-${Date.now()}-${counter}`;
    const credentials = {
        email: `${unique}@example.com`,
        username: `${prefix}${counter}`,
        password: 'correct horse battery staple',
    };

    return { ...(await api('/api/auth/register', { body: credentials })), credentials };
}

/** Create a room owned by `user`. */
export async function createRoom(user, name = 'E2E room') {
    const { room } = await api('/api/rooms', { token: user.accessToken, body: { name } });
    return room;
}

/** Mint an invite for `room` and have `guest` redeem it. */
export async function addMember(owner, room, guest) {
    const { invite } = await api(`/api/rooms/${room.id}/invites`, { token: owner.accessToken });
    await api('/api/rooms/join', { token: guest.accessToken, body: { token: invite.token } });
}

/**
 * Put `user`'s session into a browser context's localStorage, so the next
 * navigation lands already signed in.
 *
 * `addInitScript` runs before any page script, which matters: apiClient reads
 * the token at module scope, so writing it after load would be too late.
 */
export async function signIn(context, user) {
    await context.addInitScript(
        ([accessKey, refreshKey, access, refresh]) => {
            window.localStorage.setItem(accessKey, access);
            window.localStorage.setItem(refreshKey, refresh);
        },
        [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, user.accessToken, user.refreshToken]
    );
}

/**
 * The editor for the *active* tab.
 *
 * `EditorWorkspace` mounts one Monaco instance per open file and hides the
 * inactive ones with `display: none`, so a plain `.first()` picks whichever
 * file happens to be first in the tab list — which stopped being the visible
 * one as soon as files became real and a room could hold more than one open
 * tab. Every helper below goes through this.
 */
export const activeEditor = (page) => page.locator('.monaco-editor:visible').first();

/** The active editor's line container. */
export const activeEditorLines = (page) =>
    page.locator('.monaco-editor:visible .view-lines').first();

/**
 * Open a room and wait until Monaco is mounted and the Yjs provider reports it
 * has synced. Returns the editor container.
 *
 * Waiting for "Synced" rather than for a fixed delay is what makes these tests
 * stable: until the provider has synced, a keystroke goes into a local buffer
 * that is about to be replaced by the server's state.
 */
export async function openRoom(page, room) {
    await page.goto(`/room/${room.id}`);

    const editor = activeEditor(page);
    await editor.waitFor({ timeout: 45_000 });
    await activeEditorLines(page).waitFor({ timeout: 45_000 });
    await waitForSynced(page);

    return editor;
}

/**
 * Put the caret in the editor and type. Monaco's input is a hidden textarea
 * that ignores `fill()`, so this goes through real key events — which is also
 * closer to what the CRDT sees in practice.
 */
export async function typeInEditor(page, text) {
    await activeEditorLines(page).click();
    await page.keyboard.type(text, { delay: 20 });
    // Monaco's suggestion widget swallows subsequent keys and can accept a
    // completion into the buffer; dismiss it before anything reads the text.
    await page.keyboard.press('Escape');
}

/**
 * Type several lines, one per array entry.
 *
 * Not `type('one\ntwo')`: the suggestion widget is open after a word, and it
 * treats Enter as "accept the highlighted completion" rather than "new line",
 * so the newline is swallowed and both lines land as one.
 */
export async function typeLines(page, lines) {
    await activeEditorLines(page).click();
    for (const [index, line] of lines.entries()) {
        if (index > 0) {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Enter');
        }
        await page.keyboard.type(line, { delay: 20 });
    }
    await page.keyboard.press('Escape');
}

/** Put the caret at the end of a given (0-indexed) editor line. */
export async function clickLineEnd(page, lineIndex) {
    await page.locator('.monaco-editor:visible .view-line').nth(lineIndex).click();
    await page.keyboard.press('End');
}

/** The editor's full visible text, with Monaco's non-breaking spaces normalized. */
export async function editorText(page) {
    const lines = await page
        .locator('.monaco-editor:visible .view-lines .view-line')
        .allInnerTexts();
    // Monaco pads with non-breaking spaces; normalize so assertions can use
    // ordinary text.
    return lines.join('\n').replace(/\u00a0/g, ' ');
}

/**
 * Wait until the visible editor reports it has synced with the server.
 *
 * The badge exists once per open tab, so it is scoped to the visible one — the
 * hidden tabs' badges say "Synced" too, and waiting on one of those would let a
 * test type into a buffer the server has not caught up with.
 */
export async function waitForSynced(page, timeout = 45_000) {
    await page
        .getByText('Synced', { exact: true })
        .locator('visible=true')
        .first()
        .waitFor({ timeout });
}
