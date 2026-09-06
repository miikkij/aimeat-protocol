/**
 * @file offers-map-filter.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The map's search: filterOffers narrows the offer list as a person types, on the title,
 *   the ask, the tags, the agent's name and the need (its key and the label shown on screen). Every
 *   typed word has to be found somewhere on the item, so the rule stays one a person can predict.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial, with the map page's four views (offers/map-page.js).
 */
import { describe, it, expect } from 'vitest';
// Pure, dependency-free frontend module — importable straight into vitest.
import { filterOffers } from '../../public/js/services/offers-grouping.js';

const item = (title: string, agent: string, need: string, extra: Record<string, unknown> = {}) => ({ agent, need, offer: { title, ask: '', ...extra } });
const items = [
  item('Generate an image from a description', 'image-maker', 'create', { tags: ['seedream'] }),
  item("Rate an idea's feasibility", 'idea-feasibility-rater', 'analyze'),
  item('Translate a tagline to French and German', 'tagline-translator', 'communicate', { ask: 'Give me the English tagline.' }),
];
const titles = (list: Array<{ offer: { title: string } }>) => list.map(x => x.offer.title);

describe('filterOffers', () => {
  it('empty or blank text keeps everything, in order', () => {
    expect(filterOffers(items, '')).toBe(items);
    expect(titles(filterOffers(items, '   '))).toEqual(titles(items));
  });
  it('matches the title, case-insensitively', () => {
    expect(titles(filterOffers(items, 'IMAGE'))).toEqual(['Generate an image from a description']);
  });
  it('matches the agent name', () => {
    expect(titles(filterOffers(items, 'tagline-tr'))).toEqual(['Translate a tagline to French and German']);
  });
  it('matches a tag and the ask text', () => {
    expect(titles(filterOffers(items, 'seedream'))).toEqual(['Generate an image from a description']);
    expect(titles(filterOffers(items, 'english'))).toEqual(['Translate a tagline to French and German']);
  });
  it('matches the need by its key and by the label shown on screen', () => {
    expect(titles(filterOffers(items, 'analyze'))).toEqual(["Rate an idea's feasibility"]);
    expect(titles(filterOffers(items, 'analysoi', { analyze: 'Analysoi & päätä' }))).toEqual(["Rate an idea's feasibility"]);
    expect(filterOffers(items, 'analysoi')).toHaveLength(0);
  });
  it('every typed word has to be found somewhere on the item', () => {
    expect(titles(filterOffers(items, 'tagline german'))).toEqual(['Translate a tagline to French and German']);
    expect(filterOffers(items, 'tagline image')).toHaveLength(0);
  });
  it('an item without a title, tags or a need does not throw', () => {
    const bare = [{ agent: 'x', offer: {} }, ...items];
    expect(filterOffers(bare, 'x')).toHaveLength(1);
  });
});
