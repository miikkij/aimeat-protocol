/**
 * @file test/unit/app-own-parts.test.ts
 * @description What an app made for itself, beyond the kit and beyond the genre it forked: the
 *   publish names it and asks for it to be proposed to the Design Book. The book held 90 parts on
 *   2026-09-19 and not one had come from a builder, so every app that needed something custom
 *   made it again; the advice to propose back was one sentence late in the specification.
 * @usage cd aimeat && pnpm vitest run test/unit/app-own-parts.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { GENRE_BODIES } from '../../src/data/app-templates/genres.js';
import { ownClassNames, designBookStep, OWN_PARTS_MIN } from '../../src/services/app-genre-fork.js';

const receipt = (GENRE_BODIES as Record<string, string>).receipt;
const withStyles = (html: string, names: string[]) => html.replace('</style>', names.map(n => `.${n} { color: red; }`).join('\n') + '\n</style>');
const many = Array.from({ length: OWN_PARTS_MIN + 2 }, (_, i) => `tipdial-${i}`);

describe('the styles an app made for itself', () => {
  it('a genre as served has none: everything in it is the genre', () => {
    expect(ownClassNames(receipt)).toEqual([]);
  });
  it('are the classes its stylesheets define that are neither the kit\'s nor its genre\'s', () => {
    const own = ownClassNames(withStyles(receipt, ['tipdial', 'tipdial-knob', 'ak-card']));
    expect(own).toEqual(['tipdial', 'tipdial-knob']);
  });
  it('a page with a register of its own counts everything but the kit', () => {
    const page = '<html><head><meta name="aimeat-register" content="custom:ledger" /><style>.ledger-row{} .ak-list{} .ledger-sum{}</style></head></html>';
    expect(ownClassNames(page)).toEqual(['ledger-row', 'ledger-sum']);
  });
});

describe('the step the publish answers with', () => {
  it('names how many and the first few, and both tools, when there is enough to be a part', () => {
    const step = designBookStep(withStyles(receipt, many));
    expect(step).toMatch(new RegExp(`${many.length} styles of its own`));
    expect(step).toContain('.tipdial-0');
    expect(step).toContain('aimeat_designbook_search');
    expect(step).toContain('aimeat_designbook_propose');
  });
  it('says nothing for a fork that only changed its words', () => {
    expect(designBookStep(receipt)).toBeUndefined();
    expect(designBookStep(withStyles(receipt, ['one', 'two']))).toBeUndefined();
  });
});
