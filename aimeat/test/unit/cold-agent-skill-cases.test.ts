/**
 * @file cold-agent-skill-cases.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The skill-triggering cases name skills the node ships, and a load is matched by
 *   its whole name.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SKILL_CASES, namesSkill } from '../../scripts/cold-agent/skill-cases.js';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';

describe('skill-triggering cases', () => {
  it('expects only skills a fresh node ships', () => {
    const shipped = new Set(BUILTIN_SKILLS.map(s => s.name));
    const named = new Set(SKILL_CASES.flatMap(c => c.expect === null ? [] : Array.isArray(c.expect) ? c.expect : [c.expect]));
    expect([...named].filter(n => !shipped.has(n))).toEqual([]);
  });

  it('has at least two sentences for every skill it names, and some that need none', () => {
    const count = new Map<string, number>();
    for (const c of SKILL_CASES) {
      const key = c.expect === null ? 'none' : Array.isArray(c.expect) ? c.expect[0] : c.expect;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    for (const [name, n] of count) expect(n, name).toBeGreaterThanOrEqual(2);
    expect(count.get('none')).toBeGreaterThanOrEqual(5);
  });

  it('matches a whole skill name, in the three ways an agent writes one', () => {
    expect(namesSkill('aimeat-app-builder ', ['aimeat-app-builder'])).toBe(true);
    expect(namesSkill(' node:aimeat-app-builder', ['aimeat-app-builder'])).toBe(true);
    expect(namesSkill(' node:aimeat-app-builder@1.2.0', ['aimeat-app-builder'])).toBe(true);
    expect(namesSkill(' node:aimeat-app-builder-atelier', ['aimeat-app-builder'])).toBe(false);
    expect(namesSkill(' node:aimeat-phaser', ['aimeat-game-apps', 'aimeat-phaser'])).toBe(true);
  });
});
