/**
 * The Phase 3 surfaces, end to end.
 *
 * Two things here are only observable across two browsers, which is why they
 * are tested at this level rather than against the API:
 *
 *  - **The file tree is shared.** A file created in one browser has to appear in
 *    the other's explorer without a reload, and opening it in both has to land
 *    in the *same* document — a per-tab buffer would look identical until a
 *    second person typed.
 *  - **The whiteboard has history.** The old relay stored nothing, so the way
 *    this failed was silent: the person who drew saw their strokes, and only the
 *    person who arrived afterwards saw a blank canvas.
 */

import { test, expect } from '@playwright/test';
import {
    registerUser,
    createRoom,
    addMember,
    signIn,
    openRoom,
    typeInEditor,
    editorText,
    activeEditorLines,
    waitForSynced,
} from './fixtures.js';

/** Two signed-in browsers, both members of one room, both with the room open. */
async function pairInARoom(browser) {
    const [owner, guest] = await Promise.all([registerUser('owner'), registerUser('guest')]);
    const room = await createRoom(owner);
    await addMember(owner, room, guest);

    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    await signIn(ownerContext, owner);
    await signIn(guestContext, guest);

    const ownerPage = await ownerContext.newPage();
    const guestPage = await guestContext.newPage();
    await openRoom(ownerPage, room);
    await openRoom(guestPage, room);

    return {
        room,
        owner: { user: owner, page: ownerPage },
        guest: { user: guest, page: guestPage },
        async close() {
            await ownerContext.close();
            await guestContext.close();
        },
    };
}

/** A row in the explorer, by name. */
const explorerRow = (page, name) =>
    page.locator('div').filter({ hasText: new RegExp(`^${name}$`) }).last();

/**
 * Create a file through the explorer's new-file button.
 *
 * Creating a file also opens it, which mounts a fresh Monaco instance and a
 * fresh Yjs provider — so this waits for that editor to be up before returning.
 * Without the wait, the next keystroke can land while the previous tab's editor
 * is still the visible one.
 */
async function createFileInUi(page, name) {
    await page.getByTitle('New file').click();
    const input = page.getByPlaceholder('file name');
    await input.waitFor();
    await input.fill(name);
    await input.press('Enter');

    await expect(page.locator('.monaco-editor:visible').first()).toBeVisible({ timeout: 45_000 });
    await waitForSynced(page);
}

test.describe('the file tree', () => {
    test('a new room opens with a real file, not a placeholder', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        // The explorer used to render a hardcoded tree; this is the seeded row.
        await expect(pair.owner.page.getByText('main.js').first()).toBeVisible();

        await pair.close();
    });

    test('a file created in one browser appears in the other', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await createFileInUi(pair.owner.page, 'shared.py');

        // No reload: the server broadcasts `files:changed` to the room and the
        // other explorer refetches.
        await expect(pair.guest.page.getByText('shared.py').first()).toBeVisible({
            timeout: 20_000,
        });

        await pair.close();
    });

    test('the same file opened in both browsers is the same document', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await createFileInUi(pair.owner.page, 'notes.txt');
        await expect(pair.guest.page.getByText('notes.txt').first()).toBeVisible({
            timeout: 20_000,
        });

        // The guest opens it from their own explorer, so nothing but the file
        // id links the two editors.
        await explorerRow(pair.guest.page, 'notes.txt').click();
        await waitForSynced(pair.guest.page);

        await typeInEditor(pair.owner.page, 'typed into notes.txt');

        await expect
            .poll(() => editorText(pair.guest.page), {
                message: 'the two browsers were not editing the same document',
            })
            .toContain('typed into notes.txt');

        await pair.close();
    });

    test('two files are two buffers, not one shared one', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await createFileInUi(pair.owner.page, 'first.js');
        await typeInEditor(pair.owner.page, 'CONTENT OF FIRST');

        await createFileInUi(pair.owner.page, 'second.js');

        // Creating a file opens it, and it must be empty — a room-scoped
        // document name would show the previous file's text here.
        await expect.poll(() => editorText(pair.owner.page)).not.toContain('CONTENT OF FIRST');

        await pair.close();
    });

    test('a file deleted in one browser closes in the other', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await createFileInUi(pair.owner.page, 'doomed.js');
        await expect(pair.guest.page.getByText('doomed.js').first()).toBeVisible({
            timeout: 20_000,
        });
        await explorerRow(pair.guest.page, 'doomed.js').click();

        // The confirm dialog is a real browser prompt.
        pair.owner.page.on('dialog', (dialog) => dialog.accept());
        await explorerRow(pair.owner.page, 'doomed.js').hover();
        await pair.owner.page.getByTitle('Delete file').first().click();

        await expect(pair.guest.page.getByText('doomed.js')).toHaveCount(0, { timeout: 20_000 });

        await pair.close();
    });
});

test.describe('the whiteboard', () => {
    /** Switch to the whiteboard module and return its canvas. */
    async function openWhiteboard(page) {
        await page.getByRole('button', { name: /whiteboard/i }).first().click();
        // `canvas` alone would match Monaco's minimap, which is painted and
        // would read as ink; the board is the one canvas with `touch-none`.
        const canvas = page.locator('canvas.touch-none');
        await canvas.waitFor();
        return canvas;
    }

    /** Draw a short stroke across the canvas. */
    async function draw(page, canvas) {
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 60, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 8; step += 1) {
            await page.mouse.move(box.x + 60 + step * 25, box.y + box.height / 2 + step * 4);
        }
        await page.mouse.up();
    }

    /** Whether any pixel on the canvas has been painted. */
    const hasInk = (canvas) =>
        canvas.evaluate((element) => {
            const { width, height } = element;
            const data = element.getContext('2d').getImageData(0, 0, width, height).data;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] !== 0) return true;
            }
            return false;
        });

    test('a stroke reaches the other browser', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        const ownerCanvas = await openWhiteboard(pair.owner.page);
        const guestCanvas = await openWhiteboard(pair.guest.page);

        await expect.poll(() => hasInk(guestCanvas)).toBe(false);
        await draw(pair.owner.page, ownerCanvas);

        await expect
            .poll(() => hasInk(guestCanvas), { message: 'the stroke never reached the guest' })
            .toBe(true);

        await pair.close();
    });

    test('a late joiner sees the board that was drawn before they arrived', async ({ browser }) => {
        const [owner, guest] = await Promise.all([registerUser('owner'), registerUser('guest')]);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerContext = await browser.newContext();
        await signIn(ownerContext, owner);
        const ownerPage = await ownerContext.newPage();
        await openRoom(ownerPage, room);

        const ownerCanvas = await openWhiteboard(ownerPage);
        await draw(ownerPage, ownerCanvas);

        // This is the gap the roadmap named: under the old relay the board was
        // never stored, so this browser opened onto a blank canvas.
        const guestContext = await browser.newContext();
        await signIn(guestContext, guest);
        const guestPage = await guestContext.newPage();
        await openRoom(guestPage, room);
        const guestCanvas = await openWhiteboard(guestPage);

        await expect
            .poll(() => hasInk(guestCanvas), { message: 'the late joiner got a blank canvas' })
            .toBe(true);

        await ownerContext.close();
        await guestContext.close();
    });

    test('clearing the board clears it for both', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        const ownerCanvas = await openWhiteboard(pair.owner.page);
        const guestCanvas = await openWhiteboard(pair.guest.page);

        await draw(pair.owner.page, ownerCanvas);
        await expect.poll(() => hasInk(guestCanvas)).toBe(true);

        await pair.owner.page.getByTitle('Clear board for everyone').click();

        await expect
            .poll(() => hasInk(guestCanvas), { message: 'the clear never reached the guest' })
            .toBe(false);

        await pair.close();
    });
});

test.describe('document history', () => {
    test('a snapshot can be taken and restored', async ({ browser }) => {
        const pair = await pairInARoom(browser);
        const page = pair.owner.page;

        await typeInEditor(page, 'the good version');
        await expect.poll(() => editorText(page)).toContain('the good version');

        await page.getByTitle('Document history').click();
        await page.getByTitle('Snapshot now').click();
        await expect(page.getByText(/just now/i).first()).toBeVisible({ timeout: 20_000 });

        // Wreck it, then put it back.
        await activeEditorLines(page).click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type('the bad version', { delay: 20 });
        await page.keyboard.press('Escape');
        await expect.poll(() => editorText(page)).toContain('the bad version');

        page.on('dialog', (dialog) => dialog.accept());
        await page.getByTitle('Restore this version').first().click();

        // The restore is applied to the server's copy of the document and
        // arrives here as an ordinary remote edit — the same path a partner's
        // typing takes — so the editor updates without a reload.
        await expect
            .poll(() => editorText(page), { message: 'the restore never reached the editor' })
            .toContain('the good version');

        await pair.close();
    });

    test('a restore is visible to the other person too', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await typeInEditor(pair.owner.page, 'keep this line');
        await expect.poll(() => editorText(pair.guest.page)).toContain('keep this line');

        await pair.owner.page.getByTitle('Document history').click();
        await pair.owner.page.getByTitle('Snapshot now').click();
        await expect(pair.owner.page.getByText(/just now/i).first()).toBeVisible({
            timeout: 20_000,
        });

        await activeEditorLines(pair.guest.page).click();
        await pair.guest.page.keyboard.press('Control+A');
        await pair.guest.page.keyboard.type('overwritten by the guest', { delay: 20 });
        await pair.guest.page.keyboard.press('Escape');
        await expect.poll(() => editorText(pair.owner.page)).toContain('overwritten by the guest');

        pair.owner.page.on('dialog', (dialog) => dialog.accept());
        await pair.owner.page.getByTitle('Restore this version').first().click();

        await expect
            .poll(() => editorText(pair.guest.page), {
                message: 'the guest never saw the restore',
            })
            .toContain('keep this line');

        await pair.close();
    });
});
