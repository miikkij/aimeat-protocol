/**
 * @file test/unit/build-atelier-layers.test.ts
 * @description The Atelier specification reaches a chat in parts. Three things must hold or the
 *   parts are worse than nothing: each one fits in a tool result (the client writes a larger one to
 *   a file a chat cannot read), nothing of the text is lost or changed between the whole and the
 *   parts, and a section somebody adds to the specification is PLACED by a person, because one
 *   that lands in `start` by default can push it over the limit without anybody deciding so.
 * @usage cd aimeat && pnpm vitest run test/unit/build-atelier-layers.test.ts
 * @version-history
 *   v1.6.0 — 2026-11-08 — The level is the interview's question 0 and decides the rest; reading by level.
 *   v1.5.0 — 2026-11-08 — The genre index line and the parts index in `start` say the fork and the
 *     register refusal hold on `fine`.
 *   v1.4.0 — 2026-11-05 — The first part also names `motion`, the seventh part.
 *   v1.3.0 — 2026-10-01 — The interview tells the person, before its questions, that Claude Opus or Fable builds the better app.
 *   v1.2.0 — 2026-09-28 — The rules name the workbench pieces, and every piece is in the catalogue and exported by the kit.
 *   v1.1.0 — 2026-09-28 — The layout rules for a settings page and a queue page land in one part with their numbers.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_QUALITY_ADVICE } from '../../src/services/model-recommendation.js';
import type { AimeatConfig } from '../../src/config.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';
import { ATELIER_PARTS, atelierPiece, splitAtelierSpec, MAX_PART_CHARS } from '../../src/services/build-atelier-layers.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-test' } as unknown as AimeatConfig;
const full = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).full;

describe('the Atelier specification in parts', () => {
  it('places every heading by name, none by default', () => {
    const unplaced = splitAtelierSpec(full).filter(s => !s.placed).map(s => s.title);
    expect(unplaced, 'add these headings to ATELIER_HEADING_PART').toEqual([]);
  });

  it('keeps every part inside one tool result', () => {
    for (const p of ATELIER_PARTS) {
      const piece = atelierPiece(full, p.id, config.baseUrl);
      expect(piece, p.id).not.toBeNull();
      expect(piece!.text.length, `${p.id} is ${piece!.text.length} characters`).toBeLessThanOrEqual(MAX_PART_CHARS);
    }
  });

  it('loses nothing: every section of the whole is in exactly one part, word for word', () => {
    const parts = ATELIER_PARTS.map(p => atelierPiece(full, p.id, config.baseUrl)!.text);
    for (const s of splitAtelierSpec(full)) {
      expect(parts.filter(t => t.includes(s.text)).length, s.title || '(opening)').toBe(1);
    }
  });

  it('the first part names the others, says which come before code, and carries the token', () => {
    const start = atelierPiece(full, 'start', config.baseUrl)!.text;
    for (const id of ['genre', 'libraries', 'book', 'patterns', 'look', 'motion']) expect(start).toContain('`' + id + '`');
    // Since 2026-11-08 (B): `libraries` and `patterns` on every level, `genre` and `book` on `fine`.
    expect(start).toMatch(/Read `libraries` and `patterns` BEFORE you write any code, and on `fine` `genre` and `book` too/);
    expect(start).toMatch(/aimeat_handbook_get \{ tier: "build-app-atelier\/<id>" \}/);
    expect(start).toMatch(/spec_token: atelier-[0-9a-f]{12}/);
  });

  // B, 2026-11-08: two real builds met four rounds of questions before the level was asked. The
  // level is question 0, and it decides what a prototype and an ordinary page skip.
  it('the interview asks the level first and lets it decide the rest', () => {
    const start = atelierPiece(full, 'start', config.baseUrl)!.text;
    const interview = start.slice(start.indexOf('## First, a short interview'), start.indexOf('BEFORE YOU SEND THESE QUESTIONS'));
    expect(interview.indexOf('0. Which level')).toBeGreaterThan(-1);
    expect(interview.indexOf('0. Which level')).toBeLessThan(interview.indexOf('1. What should the app do'));
    expect(interview).toMatch(/`proto`: ask 1, 2 and 4 only, draw no layouts, no introduction/);
    expect(interview).toMatch(/`fine` or no answer: all of it/);
  });

  it('the interview opens with the model rule, by quality and naming no model', () => {
    // Measured 2026-10-01: a lighter model built the asked app on this track in 1 of 3 runs, a strong
    // one in 3 of 3. Since 2026-11-08 the rule names no model (Jouni): quality, and a plain word to
    // the person when errors keep coming.
    const start = atelierPiece(full, 'start', config.baseUrl)!.text;
    const interview = start.slice(start.indexOf('## First, a short interview'), start.indexOf('1. What should the app do'));
    expect(interview).toContain(MODEL_QUALITY_ADVICE);
    expect(interview).not.toMatch(/Claude Opus|Claude Fable/);
  });

  it('carries the layout rules for a settings page and a queue page in one part, with the numbers', () => {
    const parts = ATELIER_PARTS.map(p => atelierPiece(full, p.id, config.baseUrl)!.text);
    const holding = parts.filter(t => t.includes('A SETTINGS PAGE AND A QUEUE PAGE HAVE RULES'));
    expect(holding.length).toBe(1);
    for (const fact of ['60ch', '840 px', '`settingsGroup`', '`width`', "nav: 'side'", '"3 / 10"', 'genre `workbench`', 'becomes a GENRE first']) {
      expect(holding[0], fact).toContain(fact);
    }
  });

  it('lists every workbench piece in the component catalogue, each one an export of the kit', async () => {
    const { ATELIER_COMPONENTS } = await import('../../src/services/build-atelier-prompt.js');
    const ids = ATELIER_COMPONENTS.map(c => c.id);
    const kit = await import('node:fs').then(fs => fs.readFileSync('src/static/sdk-libs/atelier/index.js', 'utf8'));
    for (const id of ['sideNav', 'statusBand', 'checkGrid', 'choiceCards', 'settingsGroup', 'progressFigure', 'callout']) {
      expect(ids, id).toContain(id);
      expect(kit, id).toMatch(new RegExp('\\b' + id + '\\b[^\\n]*from \'\\./workbench\\.js\''));
    }
    for (const id of ['promptPanel', 'queueRow']) {
      expect(ids, id).toContain(id);
      expect(kit, id).toMatch(new RegExp('\\b' + id + '\\b[^\\n]*from \'\\./workbench-parts\\.js\''));
    }
  });

  it('answers null for an id it does not have', () => {
    expect(atelierPiece(full, 'no-such-part', config.baseUrl)).toBeNull();
  });

  // The publish asks for a register only on `fine` (app-artifact-lint.ts, registerIsOwed). Both lines
  // read as a rule for every level until the instruction audit's second re-check (2026-11-08).
  it('scopes the genre fork and the register refusal to `fine` in the index line and in `start`', () => {
    const genre = ATELIER_PARTS.find(p => p.id === 'genre')!.what;
    expect(genre).toMatch(/`fine`/);
    expect(genre).toMatch(/`proto` or `plain`[^.]*shell-atelier/);
    const start = atelierPiece(full, 'start', config.baseUrl)!.text;
    const index = start.slice(start.indexOf('### This specification comes in parts'));
    expect(index).toMatch(/on `fine` an Atelier app is forked from a genre/);
    expect(index).toMatch(/`proto` or `plain` app starts from `shell-atelier`/);
  });
});
