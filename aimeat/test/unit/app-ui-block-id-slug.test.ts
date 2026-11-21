/**
 * @file app-ui-block-id-slug.test.ts
 * @description A mosaic block id that is not a slug is refused with the slug it should be (appdev
 *   pitfall atelier/mosaic-two-language-headings: ui_set refused historyIntro and the builder had
 *   to guess the rule's spelling).
 *
 *   FIRST FAIL: against validate.ts v1.8.1 the refusal names no slug.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { validateUiLayout, slugFor } from '../../src/services/app-ui/validate.js';

describe('block id refusal', () => {
  it('names the slug a camelCase id should be', () => {
    expect(() => validateUiLayout({ v: 1, blocks: [{ id: 'historyIntro', component: 'section' }] }))
      .toThrow(/Use "history-intro" for "historyIntro"/);
  });

  it('accepts the slug itself', () => {
    expect(() => validateUiLayout({ v: 1, blocks: [{ id: 'history-intro', component: 'section', props: { title: 'History' } }] }))
      .not.toThrow(/slug/);
  });

  it('names no slug when nothing slug-like is left', () => {
    expect(slugFor('Front page')).toBe('front-page');
    expect(slugFor('---')).toBe('');
    expect(() => validateUiLayout({ v: 1, blocks: [{ id: '---', component: 'section' }] })).toThrow(/dashes\) — it is the address later writes and per-viewer overlays use\.$/);
  });
});
