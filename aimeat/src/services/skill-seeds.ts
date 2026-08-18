/**
 * @file skill-seeds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Seeds the built-in node-scope skills (data/builtin-skills.ts) into the
 *   skills registry at startup. Create-if-missing ONLY: a skill whose manifest already
 *   exists under system@{nodeId} is left untouched, so operator edits and deliberate
 *   deletions-then-recreations survive restarts and upgrades (an operator-deleted skill
 *   WILL reappear on restart — parking a built-in means editing it, not deleting it).
 * @structure seedBuiltinSkills(storage, config) -> number seeded
 * @usage
 *   import { seedBuiltinSkills } from '../services/skill-seeds.js';
 *   seedBuiltinSkills(storage, config).then(n => ...);
 * @version-history
 *   v1.1.0 -- 2026-07-14 -- Honor per-skill visibility (aimeat-node-guide seeds 'public' so the
 *     Agent Skills discovery index is never empty); default stays 'members'
 *   v1.0.0 -- 2026-07-05 -- Initial (Skills feature Phase 2b)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { BUILTIN_SKILLS } from '../data/builtin-skills.js';
import { publishSkill, scopeOwnerGhii } from './skills.js';
import { logger } from '../utils/logger.js';

/** Seed missing built-in skills into the node registry. Returns how many were created. */
export async function seedBuiltinSkills(storage: Storage, config: AimeatConfig): Promise<number> {
  const systemGhii = scopeOwnerGhii(config, 'node');
  let seeded = 0;
  for (const builtin of BUILTIN_SKILLS) {
    const existing = await storage.getMemory(systemGhii, `skills.${builtin.name}.manifest`);
    if (existing) continue;
    try {
      await publishSkill(storage, config, {
        scope: 'node',
        publisher: systemGhii,
        files: new Map([['SKILL.md', builtin.skillMd]]),
        visibility: builtin.visibility ?? 'members',
      });
      seeded++;
    } catch (err) {
      logger.error(`Failed to seed built-in skill ${builtin.name}`, { error: (err as Error).message });
    }
  }
  return seeded;
}
