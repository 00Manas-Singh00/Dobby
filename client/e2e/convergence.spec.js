/**
 * Two browsers, one file, converging.
 *
 * This is the test the roadmap singled out, and it exists because the failure
 * it guards against is silent: the Yjs binding once took an editor *ref* as its
 * dependency, so the effect never re-ran, the binding never attached, and
 * collaborative editing was simply off. Everything still rendered. Nothing
 * logged an error. Only a second browser would have noticed.
 *
 * Each test asserts on the *other* browser's editor, never the one that typed.
 */

import { test, expect } from '@playwright/test';
import {
    registerUser,
    createRoom,
    addMember,
    signIn,
    openRoom,
    typeInEditor,
    typeLines,
    clickLineEnd,
    editorText,
} from './fixtures.js';

/**
 * Two signed-in browser contexts, both members of one room, both with the
 * editor open.
 */
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
        owner: { user: owner, page: ownerPage, context: ownerContext },
        guest: { user: guest, page: guestPage, context: guestContext },
        async close() {
            await ownerContext.close();
            await guestContext.close();
        },
    };
}

test.describe('collaborative editing', () => {
    test('what one browser types appears in the other', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await typeInEditor(pair.owner.page, 'hello from the owner');

        await expect
            .poll(() => editorText(pair.guest.page), {
                message: 'the guest never received the owner\'s text',
            })
            .toContain('hello from the owner');

        await pair.close();
    });

    test('both directions work on the same document', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        await typeInEditor(pair.owner.page, 'from the owner');
        await expect.poll(() => editorText(pair.guest.page)).toContain('from the owner');

        // A one-way binding is a real failure mode: the provider can be
        // connected and applying remote updates while never observing the local
        // Monaco model.
        await pair.guest.page.locator('.monaco-editor .view-lines').first().click();
        await pair.guest.page.keyboard.press('Control+End');
        await pair.guest.page.keyboard.type(' and the guest', { delay: 20 });
        await pair.guest.page.keyboard.press('Escape');

        await expect.poll(() => editorText(pair.owner.page)).toContain('and the guest');

        await pair.close();
    });

    test('concurrent typing converges without losing characters', async ({ browser }) => {
        const pair = await pairInARoom(browser);

        // Seed a two-line document so each side can edit its own line at the
        // same time without fighting over one cursor position.
        await typeLines(pair.owner.page, ['one', 'two']);
        // Both lines have to exist on the guest's side before it can put its
        // caret on the second one.
        await expect
            .poll(() => pair.guest.page.locator('.monaco-editor .view-line').count())
            .toBeGreaterThanOrEqual(2);

        // Both type at once. This is exactly what the removed last-write-wins
        // `update code` broadcast could not do: under concurrent typing it
        // dropped characters and made cursors jump.
        await Promise.all([
            (async () => {
                await clickLineEnd(pair.owner.page, 0);
                await pair.owner.page.keyboard.type('-owner', { delay: 20 });
                await pair.owner.page.keyboard.press('Escape');
            })(),
            (async () => {
                await clickLineEnd(pair.guest.page, 1);
                await pair.guest.page.keyboard.type('-guest', { delay: 20 });
                await pair.guest.page.keyboard.press('Escape');
            })(),
        ]);

        // Convergence is the assertion: both sides end at the same text, and
        // neither edit is lost.
        await expect
            .poll(async () => {
                const [a, b] = await Promise.all([
                    editorText(pair.owner.page),
                    editorText(pair.guest.page),
                ]);
                return a === b ? a : null;
            }, { message: 'the two editors never converged on the same text' })
            .not.toBeNull();

        const finalText = await editorText(pair.owner.page);
        expect(finalText).toContain('-owner');
        expect(finalText).toContain('-guest');

        await pair.close();
    });

    test('a late joiner receives the document as it already stands', async ({ browser }) => {
        const [owner, guest] = await Promise.all([registerUser('owner'), registerUser('guest')]);
        const room = await createRoom(owner);
        await addMember(owner, room, guest);

        const ownerContext = await browser.newContext();
        await signIn(ownerContext, owner);
        const ownerPage = await ownerContext.newPage();
        await openRoom(ownerPage, room);

        await typeInEditor(ownerPage, 'written before the guest arrived');

        // The document is persisted server-side, so the second browser must be
        // handed the existing state rather than an empty buffer.
        const guestContext = await browser.newContext();
        await signIn(guestContext, guest);
        const guestPage = await guestContext.newPage();
        await openRoom(guestPage, room);

        await expect
            .poll(() => editorText(guestPage))
            .toContain('written before the guest arrived');

        await ownerContext.close();
        await guestContext.close();
    });

    test('a non-member cannot open the room', async ({ browser }) => {
        const owner = await registerUser('owner');
        const stranger = await registerUser('stranger');
        const room = await createRoom(owner);

        const context = await browser.newContext();
        await signIn(context, stranger);
        const page = await context.newPage();
        await page.goto(`/room/${room.id}`);

        // Knowing the room id is not a capability — the server refuses both the
        // main socket's `join room` and the document namespace.
        await expect(page.getByText(/access|not found|invite/i).first()).toBeVisible({
            timeout: 20_000,
        });

        await context.close();
    });
});
