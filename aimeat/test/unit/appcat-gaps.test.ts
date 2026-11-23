/**
 * @file test/unit/appcat-gaps.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fix prompt the app catalogue composes for an own app that is missing something
 *   (public/views/appcat/gap-prompt.js), and the three things it has to stay true to:
 *   - every condition the catalogue counts (model.js KUNTO_KEYS) has a fix sentence, and an
 *     explanation in English, Finnish and Spanish (locales `explain.appGap.<key>.*`), so no row of
 *     the index is left without its question mark or its prompt;
 *   - every MCP tool a fix sentence names is a tool of the catalog (src/tool-catalog/definitions/),
 *     so a renamed tool fails here and not in a person's chat;
 *   - the prompt names each app by its reference, and a long list is cut and counted.
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAP_FIX, NAMED_APPS, gapPrompt } from '../../public/views/appcat/gap-prompt.js';

const ROOT = join(import.meta.dirname, '../..');

/** model.js KUNTO_KEYS, read from the source: the module imports the browser's i18n. */
function kuntoKeys(): string[] {
  const src = readFileSync(join(ROOT, 'public/views/appcat/model.js'), 'utf-8');
  const m = /export const KUNTO_KEYS = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error('KUNTO_KEYS not found in model.js');
  return [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]);
}

/** Every key path of a locale file, nested objects joined with a dot, as the i18n reader flattens them. */
function flatKeys(tag: string): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown, prefix: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
    } else out.add(prefix);
  };
  walk(JSON.parse(readFileSync(join(ROOT, `locales/${tag}.json`), 'utf-8')), '');
  return out;
}

describe('every condition the catalogue counts can be explained and fixed', () => {
  const keys = kuntoKeys();

  it('reads the seven conditions from model.js', () => {
    expect(keys).toHaveLength(7);
  });

  it('has a fix sentence for each condition and for nothing else', () => {
    expect(Object.keys(GAP_FIX).sort()).toEqual([...keys].sort());
  });

  it.each(['en', 'fi', 'es'])('explains the group and each condition in %s', (tag) => {
    const have = flatKeys(tag);
    const missing: string[] = [];
    for (const part of ['title', 'short', 'what', 'ex1', 'tipLabel', 'tip']) {
      if (!have.has(`explain.concept.appGaps.${part}`)) missing.push(`explain.concept.appGaps.${part}`);
      for (const k of keys) if (!have.has(`explain.appGap.${k}.${part}`)) missing.push(`explain.appGap.${k}.${part}`);
    }
    for (const k of ['rowLead', 'copyOne', 'copyAll', 'copyAll_one', 'copied', 'copiedNotice']) {
      if (!have.has(`appcat.gaps.${k}`)) missing.push(`appcat.gaps.${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('names only MCP tools the catalog defines', () => {
    const dir = join(ROOT, 'src/tool-catalog/definitions');
    const defs = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n');
    const named = new Set<string>();
    for (const text of [...Object.values(GAP_FIX), gapPrompt([{ name: 'A', ref: 'alice/a.html', gaps: keys }]),
      gapPrompt(Array.from({ length: NAMED_APPS + 1 }, (_, i) => ({ name: `A${i}`, ref: `alice/a${i}.html`, gaps: ['noMap'] })))]) {
      for (const m of text.matchAll(/aimeat_[a-z_]+/g)) named.add(m[0]);
    }
    expect(named.size).toBeGreaterThan(5);
    const unknown = [...named].filter((tool) => !defs.includes(`name: '${tool}'`));
    expect(unknown).toEqual([]);
  });
});

describe('the prompt', () => {
  it('for one app numbers everything the app lacks, in the order given', () => {
    const p = gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: ['noMap', 'noShot'] }]);
    expect(p).toContain('"Shop" (alice/shop.html)');
    expect(p).toContain(`1. ${GAP_FIX.noMap}`);
    expect(p).toContain(`2. ${GAP_FIX.noShot}`);
    expect(p).not.toContain(GAP_FIX.noSkill);
  });

  it('for one app binds the skill to that app by its reference', () => {
    const p = gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: ['noSkill'] }]);
    expect(p).toContain('metadata.binding "app:alice/shop.html"');
    expect(p).not.toContain('<owner>');
  });

  it('for several apps says the shared condition once and names each app', () => {
    const p = gapPrompt([
      { name: 'Shop', ref: 'alice/shop.html', gaps: ['noMap'] },
      { name: 'Notes', ref: 'alice/notes.html', gaps: ['noMap'] },
    ]);
    expect(p).toContain('2 of my AIMEAT apps');
    expect(p.split(GAP_FIX.noMap)).toHaveLength(2);
    expect(p).toContain('- Shop (alice/shop.html)');
    expect(p).toContain('- Notes (alice/notes.html)');
  });

  it('cuts a long list at NAMED_APPS and counts the rest', () => {
    const apps = Array.from({ length: NAMED_APPS + 76 }, (_, i) => ({ name: `App ${i}`, ref: `alice/app-${i}.html`, gaps: ['noSkill'] }));
    const p = gapPrompt(apps);
    expect(p).toContain(`${NAMED_APPS + 76} of my AIMEAT apps`);
    expect(p.match(/^- /gm)).toHaveLength(NAMED_APPS);
    expect(p).toContain('and 76 more');
  });

  it('asks before a publish and before a change of who can find an app', () => {
    const p = gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: ['specOff'] }]);
    expect(p).toContain('wait for my yes');
  });

  it('is empty when no app has a condition it knows', () => {
    expect(gapPrompt([])).toBe('');
    expect(gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: [] }])).toBe('');
    expect(gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: ['notACondition'] }])).toBe('');
    expect(gapPrompt([{ name: 'Shop', ref: '', gaps: ['noMap'] }])).toBe('');
  });
});
