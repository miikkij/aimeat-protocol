/**
 * @file test/unit/app-genre-fork.test.ts
 * @description An app that NAMES a genre is told at publish when it was not forked from it.
 *
 *   The threshold was chosen from real pages, measured on 2026-09-19 on a sandbox node: six
 *   cold-agent forks (three of genre-receipt, three of genre-living) kept 0.77 to 0.90 of their
 *   genre's own class names, and a page that named genre-receipt over markup of its own kept 0.00.
 *   The line is at 0.20, so a fork reworked a long way still passes.
 * @usage cd aimeat && pnpm vitest run test/unit/app-genre-fork.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { GENRE_BODIES } from '../../src/data/app-templates/genres.js';
import { genreForkFindings, genreKeptShare, genreClassNames, GENRE_KEPT_MIN } from '../../src/services/app-genre-fork.js';

const page = (register: string, body: string) => `<!DOCTYPE html><html><head><meta name="aimeat-track" content="atelier" />
<meta name="aimeat-register" content="${register}" /><link href="/lib/aimeat-atelier.css" rel="stylesheet" /></head><body>${body}</body></html>`;
const STACK = '<div class="ak-hero"><h1>Voice</h1></div><div class="ak-card"><form class="ak-form"></form></div><div class="ak-card-grid"></div>';

describe('a genre named over a page that is not its fork', () => {
  it('is told so, with the share it kept and what to do', () => {
    const f = genreForkFindings(page('genre-nightradio', STACK));
    expect(f.map(x => x.pitfall)).toEqual(['genre-not-forked']);
    expect(f[0].severity).toBe('warn');
    expect(f[0].message).toMatch(/genre-nightradio/);
    expect(f[0].message).toMatch(/custom:/);
  });
});

describe('what stays quiet', () => {
  it('every genre, as served, is a fork of itself', () => {
    for (const [id, body] of Object.entries(GENRE_BODIES as Record<string, string>)) {
      const share = genreKeptShare(body, id);
      if (share === null) continue; // a genre with too few classes of its own to judge by
      expect(share, id).toBeGreaterThan(0.9);
      expect(genreForkFindings(body), id).toEqual([]);
    }
  });

  it('a fork that changed its words and dropped half its sections', () => {
    const receipt = (GENRE_BODIES as Record<string, string>).receipt;
    const names = genreClassNames('receipt');
    const half = names.slice(0, Math.ceil(names.length / 2)).map(n => `<div class="${n}">x</div>`).join('');
    expect(genreKeptShare(page('genre-receipt', half), 'receipt')!).toBeGreaterThanOrEqual(GENRE_KEPT_MIN);
    expect(genreForkFindings(page('genre-receipt', half))).toEqual([]);
    expect(receipt.length).toBeGreaterThan(1000);
  });

  it('a register of its own', () => expect(genreForkFindings(page('custom:ledger', STACK))).toEqual([]));
  it('a genre this node does not ship', () => expect(genreForkFindings(page('genre-nowhere', STACK))).toEqual([]));
  it('a page with no register at all', () => expect(genreForkFindings('<html><head></head><body></body></html>')).toEqual([]));
});
