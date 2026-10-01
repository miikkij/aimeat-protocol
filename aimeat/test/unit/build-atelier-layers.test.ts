/**
 * @file test/unit/build-atelier-layers.test.ts
 * @description The Atelier specification reaches a chat in parts. Three things must hold or the
 *   parts are worse than nothing: each one fits in a tool result (the client writes a larger one to
 *   a file a chat cannot read), nothing of the text is lost or changed between the whole and the
 *   parts, and a section somebody adds to the specification is PLACED by a person, because one
 *   that lands in `start` by default can push it over the limit without anybody deciding so.
 * @usage cd aimeat && pnpm vitest run test/unit/build-atelier-layers.test.ts
 * @version-history
 *   v1.3.0 — 2026-10-01 — The interview tells the person, before its questions, that Claude Opus or Fable builds the better app.
 *   v1.2.0 — 2026-09-28 — The rules name the workbench pieces, and every piece is in the catalogue and exported by the kit.
 *   v1.1.0 — 2026-09-28 — The layout rules for a settings page and a queue page land in one part with their numbers.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
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
    for (const id of ['genre', 'libraries', 'book', 'patterns', 'look']) expect(start).toContain('`' + id + '`');
    expect(start).toMatch(/Read `genre`, `libraries`, `book` and `patterns` BEFORE you write any code/);
    expect(start).toMatch(/aimeat_handbook_get \{ tier: "build-app-atelier\/<id>" \}/);
    expect(start).toMatch(/spec_token: atelier-[0-9a-f]{12}/);
  });

  it('the interview first tells the person which models build the better app', () => {
    // Measured 2026-10-01: Sonnet 5.5 built the asked app on this track in 1 of 3 runs, Opus 5.5
    // in 3 of 3. The person decides which model builds, so the interview says so before the questions.
    const start = atelierPiece(full, 'start', config.baseUrl)!.text;
    const interview = start.slice(start.indexOf('## First, a short interview'), start.indexOf('1. What should the app do'));
    expect(interview).toMatch(/Claude Opus or Claude Fable/);
    expect(interview).toMatch(/turn out (noticeably )?better/);
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
});
