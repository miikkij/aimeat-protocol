/**
 * @file test/unit/app-tour-parse.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's reading of an app's guided tour (services/app/tour.ts): a page without the
 *   block has none, a good block becomes the manifest's tour with its languages, a bare string is a
 *   help id, and every broken shape is refused with words that say what to fix. And the owner's switch
 *   for the invitation travels in #aimeat-app-ref from the node (appRefSnippet) to the kit (appRef).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tour-parse.test.ts
 * @version-history
 *   v1.0.0 - 2026-11-22 - Initial (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAppTour, tourSummary } from '../../src/services/app/tour.js';
import { appRefSnippet } from '../../src/utils/app-agent-discovery.js';
import { installGlobals } from './phaser-stub.mjs';

const page = (json: unknown) => `<!doctype html><html><head><script type="application/json" id="aimeat-tour">${typeof json === 'string' ? json : JSON.stringify(json)}</script></head><body></body></html>`;

describe('parseAppTour', () => {
  it('answers null for a page without a tour', () => {
    expect(parseAppTour('<html><body>hi</body></html>')).toBeNull();
  });

  it('reads tours, steps by help id and the languages the words are in', () => {
    const out = parseAppTour(page({ tours: [{ id: 'first', title: { en: 'First tour', fi: 'Ensimmäinen kierros' }, version: 2,
      steps: [{ title: { en: 'What this is', fi: 'Mikä tämä on' }, text: 'Keeps errands.' }, 'add', { target: '#save', text: 'Save.', do: 'click' }] }] }));
    expect(out && 'tour' in out).toBe(true);
    const tour = (out as any).tour;
    expect(tour.languages).toEqual(['en', 'fi']);
    expect(tour.tours[0].version).toBe(2);
    expect(tour.tours[0].steps[1]).toEqual({ help: 'add' });
    expect(tour.tours[0].steps[2]).toEqual({ target: '#save', text: 'Save.', do: 'click' });
    expect(tourSummary(tour)).toEqual({ tours: 1, steps: 3, languages: ['en', 'fi'] });
  });

  it('takes { steps } as one tour', () => {
    const out = parseAppTour(page({ steps: ['add'] })) as any;
    expect(out.tour.tours).toEqual([{ id: 'main', version: 1, steps: [{ help: 'add' }] }]);
  });

  const refused: Array<[string, unknown, RegExp]> = [
    ['not JSON', '{ tours: ', /not JSON/],
    ['no tours', { tours: [] }, /no tours/],
    ['a tour without steps', { tours: [{ id: 'a', steps: [] }] }, /has no steps/],
    ['too many steps', { steps: Array.from({ length: 21 }, (_, i) => 'h' + i) }, /at most 20/],
    ['two tours with one id', { tours: [{ id: 'a', steps: ['x'] }, { id: 'a', steps: ['y'] }] }, /two tours have the id "a"/],
    ['a do-step without a place', { steps: [{ text: 'Press it', do: 'click' }] }, /needs a place/],
    ['a step that says nothing', { steps: [{}] }, /says nothing/],
    ['a bad language code', { steps: [{ text: { English: 'x' } }] }, /not a language code/],
    ['an unknown do', { steps: [{ help: 'x', do: 'hover' }] }, /"click", "input" or "change"/],
  ];
  for (const [name, json, why] of refused) {
    it('refuses ' + name, () => {
      const out = parseAppTour(page(json));
      expect(out && 'error' in out).toBe(true);
      expect((out as any).error).toMatch(why);
    });
  }
});

describe('the invitation switch in #aimeat-app-ref', () => {
  let restore: any;
  let appRef: () => any;
  beforeAll(async () => {
    restore = installGlobals({ motion: 'auto' });
    ({ appRef } = await import('../../src/static/sdk-libs/_core/app-ref.js'));
  });
  afterAll(() => restore());

  function read(snippet: string) {
    const doc = restore.document;
    const node = doc.createElement('script');
    node.id = 'aimeat-app-ref';
    node.textContent = snippet.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    doc.head.appendChild(node);
    try { return appRef(); } finally { node.remove(); }
  }

  it('says tour_invite: false only when the owner switched it off, and the kit reads it', () => {
    const base = { owner: 'alice', filename: 'errands.html', baseUrl: 'https://node.example' };
    const off = appRefSnippet({ ...base, tourInvite: false });
    expect(off).toContain('"tour_invite":false');
    expect(read(off)).toEqual({ owner: 'alice', filename: 'errands.html', tourInvite: false });
    const on = appRefSnippet(base);
    expect(on).not.toContain('tour_invite');
    expect(read(on)).toEqual({ owner: 'alice', filename: 'errands.html' });
  });
});
