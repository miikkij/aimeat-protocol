/**
 * @file test/unit/build-atelier-layers.test.ts
 * @description The Atelier specification reaches a chat in parts. Three things must hold or the
 *   parts are worse than nothing: each one fits in a tool result (the client writes a larger one to
 *   a file a chat cannot read), nothing of the text is lost or changed between the whole and the
 *   parts, and a section somebody adds to the specification is PLACED by a person, because one
 *   that lands in `start` by default can push it over the limit without anybody deciding so.
 * @usage cd aimeat && pnpm vitest run test/unit/build-atelier-layers.test.ts
 * @version-history
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
    for (const id of ['genre', 'libraries', 'patterns', 'look']) expect(start).toContain('`' + id + '`');
    expect(start).toMatch(/Read `genre`, `libraries` and `patterns` BEFORE you write any code/);
    expect(start).toMatch(/aimeat_handbook_get \{ tier: "build-app-atelier\/<id>" \}/);
    expect(start).toMatch(/spec_token: atelier-[0-9a-f]{12}/);
  });

  it('answers null for an id it does not have', () => {
    expect(atelierPiece(full, 'no-such-part', config.baseUrl)).toBeNull();
  });
});
