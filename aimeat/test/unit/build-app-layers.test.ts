/**
 * @file build-app-layers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layered build specification loses nothing and rewrites nothing.
 *
 *   Four promises, each of which a later edit to build-app-prompt.ts could break without anyone
 *   seeing it: the sections put back in order ARE the full text; every heading has been given a
 *   layer by a person (a new one fails here until somebody decides); an id names one section; and
 *   the core plus the on-demand sections cover the whole specification between them.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildAppPrompt, buildAppSpecToken } from '../../src/services/build-app-prompt.js';
import {
  SECTION_TABLE, SPEC_PARTS, MAX_PART_CHARS, splitBuildAppSpec, layeredBuildAppPrompt, buildAppPiece, buildAppPieceIds,
} from '../../src/services/build-app-layers.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-example' } as never;
const MODES = ['new', 'improve'] as const;
const fullFor = (mode: 'new' | 'improve') => buildAppPrompt(config, { mode, lang: 'en' }).full;

describe('the layered build specification', () => {
  for (const mode of MODES) {
    describe('mode ' + mode, () => {
      const full = fullFor(mode);
      const sections = splitBuildAppSpec(full);

      it('gives the full text back when the sections are put in order', () => {
        expect(sections.map(s => s.text).join('\n')).toBe(full);
      });

      it('has a decided layer for every heading', () => {
        const undecided = sections.filter(s => !(s.title in SECTION_TABLE)).map(s => s.title);
        expect(undecided).toEqual([]);
      });

      it('names one section per id', () => {
        const ids = sections.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('serves every core section in the core, whole, and no on-demand one', () => {
        const { prompt, sections: pointers } = layeredBuildAppPrompt(full, 'https://node.example/');
        for (const s of sections) {
          if (s.layer === 'core') expect(prompt.includes(s.text)).toBe(true);
          else expect(prompt.includes(s.text)).toBe(false);
        }
        expect(pointers.map(p => p.id)).toEqual(sections.filter(s => s.layer === 'on-demand').map(s => s.id));
      });

      it('names every on-demand section in the index, with both doors and no doubled slash', () => {
        const { prompt, sections: pointers } = layeredBuildAppPrompt(full, 'https://node.example/');
        expect(pointers.length).toBeGreaterThan(5);
        for (const p of pointers) {
          expect(prompt).toContain('- `' + p.id + '` — ' + p.when);
          expect(p.url).toBe('https://node.example/v1/prompts/build-app/sections/' + p.id);
        }
        expect(prompt).toContain('aimeat_handbook_get { tier: "build-app/<id>" }');
        expect(prompt).toContain('https://node.example/v1/prompts/build-app/sections/<id>?format=txt');
      });

      it('serves the core in four parts, each small enough to arrive as one tool result', () => {
        // Measured 2026-09-18 in the Claude client: 18 071 characters arrived whole, and 66 174
        // were written to a file the chat could not read. If this fails, a section grew: move it
        // to another part, or make a fifth, rather than raising the number.
        for (const p of SPEC_PARTS) {
          const piece = buildAppPiece(full, p.id, 'https://node.example');
          expect(piece?.kind, p.id).toBe('part');
          expect(piece!.text.length, p.id).toBeLessThan(MAX_PART_CHARS);
        }
      });

      it('puts every core section in exactly one part, whole, and no on-demand section in any', () => {
        const partTexts = SPEC_PARTS.map(p => buildAppPiece(full, p.id, 'https://node.example')!.text);
        for (const s of sections) {
          const holders = partTexts.filter(t => t.includes(s.text)).length;
          expect(holders, s.id).toBe(s.layer === 'core' ? 1 : 0);
        }
      });

      it('names the three other parts and every on-demand section in part start, and nowhere else', () => {
        const start = buildAppPiece(full, 'start', 'https://node.example')!.text;
        for (const p of SPEC_PARTS.filter(x => x.id !== 'start')) expect(start).toContain('- `' + p.id + '` — ' + p.what);
        for (const s of sections.filter(x => x.layer === 'on-demand')) expect(start).toContain('- `' + s.id + '` — ' + s.when);
        expect(buildAppPiece(full, 'data', 'https://node.example')!.text).not.toContain('comes in parts');
      });
    });
  }

  it('says when to read each on-demand section', () => {
    for (const [title, rule] of Object.entries(SECTION_TABLE)) {
      if (rule.layer === 'on-demand') expect(rule.when, title).toBeTruthy();
    }
  });

  it('carries the spec token the full specification carries', () => {
    const token = buildAppSpecToken(config);
    expect(fullFor('new')).toContain(token);
    expect(layeredBuildAppPrompt(fullFor('new'), 'https://node.example').prompt).toContain(token);
  });

  it('returns a section byte for byte, and null for an id that does not exist', () => {
    const full = fullFor('new');
    const group = buildAppPiece(full, 'group', 'https://node.example');
    expect(group?.kind).toBe('section');
    expect(group?.text.startsWith('### If several people share it: a GROUP application\n')).toBe(true);
    expect(full.includes(group!.text)).toBe(true);
    expect(buildAppPiece(full, 'no-such-section', 'https://node.example')).toBeNull();
    expect(buildAppPieceIds(full).slice(0, 4)).toEqual(['start', 'libraries', 'data', 'look']);
  });

  it('does not treat a heading inside a code fence as a section', () => {
    const text = 'intro\n## One\n```\n## not a heading\n```\n### Two\nbody';
    expect(splitBuildAppSpec(text).map(s => s.title)).toEqual(['', 'One', 'Two']);
  });
});
