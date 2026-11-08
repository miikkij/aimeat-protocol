/**
 * @file test/unit/living-gear-sign-in.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The program road of the living document's inward dialog when the page does not know
 *   who is signed in. The address of an incoming webhook carries the owner's account name, and an
 *   app's own origin has no session until the person signs in there; signing in on the node's own
 *   page does not sign in the app's origin.
 *
 *   THE CASE. A test app without a sign-in showed the call with a bare `<owner>` in it and one small
 *   line under it, and the person read the whole dialog as broken. The road now says the address
 *   needs the person signed in and offers the sign-in, on a page that has the auth library; on a page
 *   that has none it says to write the username in place of the placeholder. Signed in, nothing of
 *   this shows and the address carries the name, as before.
 *
 *   FIRST FAIL: against hooks-shapes.js v0.7.4 there is no `signInNeeded` on the program road and no
 *   ownerNotice(), and hooks-words.js carries no sign-in sentence for the road.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-gear-sign-in.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15c).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const shapes = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
const { WORDS, say, fill } = await import('../../src/static/sdk-libs/living/hooks-words.js');
const { inwardShape } = shapes;
const ownerNotice = (shapes as Record<string, unknown>).ownerNotice as
  | ((receiver: unknown, canSignIn: boolean) => { kind: string, words: string, button?: string } | null)
  | undefined;

const APEX = 'https://node.example';

function shapeFor(extra: Record<string, unknown>) {
  const doc = {
    v: 1, key: 'living.room', title: { en: 'Room' }, lang: 'en',
    model: { nodes: { temp: { type: 'value', label: { en: 'Room temperature' } } } },
  };
  return inwardShape(Object.assign({
    id: 'temp', node: doc.model.nodes.temp, doc, graph: { valueOf: () => 21.5 },
    langs: () => ['en'], base: 'https://room.apps.node.example', apex: APEX,
  }, extra));
}

describe('the program road when the page does not know who is signed in', () => {
  it('marks the road as needing a sign-in, and the call still has no shell operator in it', () => {
    const shape = shapeFor({ owner: '' });
    expect(shape.receiver.signInNeeded).toBe(true);
    expect(shape.receiver.address).toBe(APEX + '/v1/receive/<owner>/' + shape.receiver.name);
    // The placeholder sits inside the single-quoted address, so the shell reads it as text.
    expect(shape.receiver.curl).toContain("'" + APEX + '/v1/receive/<owner>/');
    expect(shape.receiver.curl.replace(/'[^']*'|"[^"]*"/g, '')).not.toMatch(/[<>;|&]/);
  });

  it('offers the sign-in on a page that can sign the person in', () => {
    expect(typeof ownerNotice).toBe('function');
    const notice = ownerNotice!(shapeFor({ owner: '' }).receiver, true);
    expect(notice).toEqual({ kind: 'signIn', words: 'inward.signInWhy', button: 'inward.signIn' });
  });

  it('says to write the username on a page that cannot sign anybody in', () => {
    const notice = ownerNotice!(shapeFor({ owner: '' }).receiver, false);
    expect(notice).toEqual({ kind: 'write', words: 'inward.ownerWhere' });
  });

  it('says nothing when the address carries the signed-in name', () => {
    const shape = shapeFor({ owner: 'alice' });
    expect(shape.receiver.signInNeeded).toBe(false);
    expect(ownerNotice!(shape.receiver, true)).toBeNull();
    expect(shape.receiver.address).toBe(APEX + '/v1/receive/alice/' + shape.receiver.name);
  });

  it('the sign-in sentence and its button exist in English and Finnish, and the sentence names the placeholder', () => {
    for (const lang of ['en', 'fi'] as const) {
      const words = WORDS[lang] as Record<string, string>;
      expect(words['inward.signInWhy'], `${lang} inward.signInWhy`).toContain('{placeholder}');
      expect(words['inward.signIn'], `${lang} inward.signIn`).toBeTruthy();
    }
    const en = fill(say('inward.signInWhy', ['en']), { placeholder: '<owner>' });
    expect(en).toContain('<owner>');
    expect(en.toLowerCase()).toContain('sign in');
    expect(fill(say('inward.signInWhy', ['fi']), { placeholder: '<owner>' }).toLowerCase()).toContain('kirjaudu');
  });
});
