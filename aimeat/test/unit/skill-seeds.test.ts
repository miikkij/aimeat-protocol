/**
 * @file test/unit/skill-seeds.test.ts
 * @description Does a change made in this repo reach a node that already has the skill, and does a
 *   change made ON that node survive the next restart?
 *
 *   Both of those failed silently until 2026-08-25, on the same skill, inside ten days: seeding was
 *   create-if-missing, so the repo's edit never landed and the node's edit never came home. The four
 *   cases below are the four ways a skill and its node copy can stand relative to each other, and
 *   the two that must NOT move are asserted as hard as the two that must.
 *
 *   Driven through the real seeder against a real (in-memory) store rather than through the decision
 *   function alone: the decision was never the hard part, the wiring was.
 * @usage cd aimeat && pnpm vitest run test/unit/skill-seeds.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial, with the seeder that follows the repo on an unedited node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { decideSeedAction, skillFingerprint, seedStampKey } from '../../src/services/skill-seeds.js';
import { publishSkill, readNodeSkillBody } from '../../src/services/skills.js';

const NODE = 'node-test';
const config = { nodeId: NODE } as unknown as AimeatConfig;
const SYSTEM = `system@${NODE}`;

/** A minimal valid SKILL.md; the body is what we compare. */
const skillMd = (body: string) => `---
name: probe-skill
description: A skill used by the seeder test to stand in for a built-in one, so the test never depends on the wording of a real skill.
license: MIT
---

# Probe

${body}
`;

const REPO_V1 = skillMd('first version, as shipped');
const REPO_V2 = skillMd('second version, as shipped later');
const EDITED_ON_NODE = skillMd('the operator improved this here');

/** Stand in for BUILTIN_SKILLS with one entry we control. */
vi.mock('../../src/data/builtin-skills.js', () => ({
  BUILTIN_SKILLS: [{ name: 'probe-skill', visibility: 'public', skillMd: '' }],
}));

async function seedWith(storage: Storage, text: string) {
  const mod = await import('../../src/data/builtin-skills.js');
  (mod.BUILTIN_SKILLS as { skillMd: string }[])[0]!.skillMd = text;
  const { seedBuiltinSkills } = await import('../../src/services/skill-seeds.js');
  return seedBuiltinSkills(storage, config);
}

let storage: Storage;
beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });
afterEach(() => { vi.restoreAllMocks(); });

describe('the four ways a skill and its node copy can stand', () => {
  it('creates what the node does not have, and writes down what it wrote', async () => {
    const r = await seedWith(storage, REPO_V1);
    expect(r.created).toBe(1);
    expect(await readNodeSkillBody(storage, config, 'probe-skill')).toBe(REPO_V1);

    const stamp = await storage.getMemory(SYSTEM, seedStampKey('probe-skill'));
    expect((stamp?.value as { fingerprint: string }).fingerprint).toBe(skillFingerprint(REPO_V1));
  });

  it('does nothing on a second start with the same text', async () => {
    await seedWith(storage, REPO_V1);
    const r = await seedWith(storage, REPO_V1);
    expect(r.unchanged).toBe(1);
    expect(r.updated).toBe(0);
  });

  it('follows the repo when nobody has touched the node copy — the case that used to be impossible', async () => {
    await seedWith(storage, REPO_V1);
    const r = await seedWith(storage, REPO_V2);
    expect(r.updated).toBe(1);
    expect(await readNodeSkillBody(storage, config, 'probe-skill')).toBe(REPO_V2);
    const stamp = await storage.getMemory(SYSTEM, seedStampKey('probe-skill'));
    expect((stamp?.value as { fingerprint: string }).fingerprint).toBe(skillFingerprint(REPO_V2));
  });

  it('keeps an edit made on the node, and names it rather than swallowing it', async () => {
    await seedWith(storage, REPO_V1);
    // The operator republishes on the node itself, which is what the whole rule protects.
    await publishSkill(storage, config, {
      scope: 'node', publisher: SYSTEM,
      files: new Map([['SKILL.md', EDITED_ON_NODE]]), visibility: 'public',
    });

    const r = await seedWith(storage, REPO_V2);
    expect(r.diverged).toEqual(['probe-skill']);
    expect(r.updated).toBe(0);
    expect(await readNodeSkillBody(storage, config, 'probe-skill')).toBe(EDITED_ON_NODE);
  });
});

describe('a node seeded before any of this existed', () => {
  it('adopts a copy that already matches the repo', async () => {
    await publishSkill(storage, config, {
      scope: 'node', publisher: SYSTEM,
      files: new Map([['SKILL.md', REPO_V1]]), visibility: 'public',
    });
    const r = await seedWith(storage, REPO_V1);
    expect(r.adopted).toBe(1);
    // ...and from here on it can be updated like any other.
    const next = await seedWith(storage, REPO_V2);
    expect(next.updated).toBe(1);
  });

  it('leaves a copy it cannot account for, rather than guessing', async () => {
    await publishSkill(storage, config, {
      scope: 'node', publisher: SYSTEM,
      files: new Map([['SKILL.md', EDITED_ON_NODE]]), visibility: 'public',
    });
    const r = await seedWith(storage, REPO_V1);
    expect(r.diverged).toEqual(['probe-skill']);
    expect(await readNodeSkillBody(storage, config, 'probe-skill')).toBe(EDITED_ON_NODE);
  });
});

describe('the decision on its own', () => {
  const stampV1 = skillFingerprint(REPO_V1);
  it('reads the same as the wiring', () => {
    expect(decideSeedAction(null, null, REPO_V1)).toBe('create');
    expect(decideSeedAction(REPO_V1, stampV1, REPO_V1)).toBe('current');
    expect(decideSeedAction(REPO_V1, stampV1, REPO_V2)).toBe('update');
    expect(decideSeedAction(EDITED_ON_NODE, stampV1, REPO_V2)).toBe('keep-edited');
    expect(decideSeedAction(REPO_V1, null, REPO_V1)).toBe('adopt');
    expect(decideSeedAction(EDITED_ON_NODE, null, REPO_V1)).toBe('keep-unknown');
  });
});
