/**
 * @file test/unit/refusal-texts-name-the-fix.test.ts
 * @description Two refusals that left a builder guessing (pitfall round 2026-11-21, A8):
 *   - a skill component whose meta.skill.bindsTo names no app of its package
 *     (publish/hand-written-package-component-shapes): the refusal names the field, the id rule and
 *     the ids the package has;
 *   - a memory patch with ai_provenance (publish/skill-description-and-patch-limits): the refusal
 *     gave the group reason, which had nothing to do with it.
 *
 *   FIRST FAIL: before the change neither refusal named its fix.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { registerSkillComponent } from '../../src/services/packages/install/package-skill-component.js';
import { memoryWriteMode } from '../../src/utils/memory-write-mode.js';
import type { AimeatConfig } from '../../src/config.js';

const input = (bindsTo: unknown, apps: string[]) => ({
  config: { nodeId: 'n1' } as unknown as AimeatConfig,
  owner: 'alice', ownerGaii: 'alice@n1', publisher: 'alice@n1',
  content: JSON.stringify({ files: { 'SKILL.md': '---\nname: guide\ndescription: x\n---\n' } }),
  meta: { skill: { bindsTo } },
  packageContext: { groupId: 'g', instanceId: 'i', appNames: new Map(apps.map(a => [a, a])) },
});

describe('SKILL_UNBOUND', () => {
  it('names meta.skill.bindsTo, the id rule and the package\'s app ids', async () => {
    const out = await registerSkillComponent(null as never, input('Shop', ['shop.html', 'admin.html']));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/^SKILL_UNBOUND: the skill binds to "Shop", which is not an app this package installs\./);
    expect(out.error).toContain('meta.skill.bindsTo');
    expect(out.error).toContain('"shop.html", "admin.html"');
  });

  it('says none when the package installs no app', async () => {
    const out = await registerSkillComponent(null as never, input(undefined, []));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('app components: none.');
  });
});

describe('a memory patch with a field it takes no', () => {
  it('gives ai_provenance its own reason and not the group one', () => {
    const r = memoryWriteMode({ patch: { a: 1 }, ai_provenance: { level: 'ai-generated' } });
    expect('error' in r && r.error.message).toMatch(/^A patch takes no ai_provenance: the node stamps/);
    expect('error' in r && r.error.message).not.toContain('group');
  });

  it('gives group_id the group reason, and both reasons for both fields', () => {
    const g = memoryWriteMode({ patch: { a: 1 }, group_id: 'g1' });
    expect('error' in g && g.error.message).toContain('a record at a group keeps its group');
    const both = memoryWriteMode({ patch: { a: 1 }, group_id: 'g1', ai_provenance_id: 'p' });
    expect('error' in both && both.error.message).toMatch(/group.*provenance/);
  });

  it('takes a plain patch', () => {
    expect(memoryWriteMode({ patch: { a: 1 } })).toEqual({ mode: 'patch' });
  });
});
