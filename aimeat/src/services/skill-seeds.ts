/**
 * @file skill-seeds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the built-in node-scope skills (data/builtin-skills.ts) and the node's copy of
 *   them in step, at every startup.
 *
 *   WHAT WENT WRONG WITH CREATE-IF-MISSING. The rule was "create it if it is not there, never touch
 *   it if it is", and it protected the right thing: an operator who improves a skill on their own
 *   node must not have it overwritten by the next restart. What it could not do is tell an operator
 *   edit apart from an untouched copy, so it treated every existing skill as edited and a change
 *   made in this repo never reached a node that already had the skill.
 *
 *   Both halves of that silence happened to aimeat-app-builder inside ten days. The node's copy
 *   gained a 2.9 kB section on 2026-08-16 that never came back here; this repo gained a pointer on
 *   2026-08-25 that the node never saw. Neither side knew, and a republish either way would have
 *   deleted the other side's work.
 *
 *   WHAT REPLACES IT. When this file writes a skill it also writes down a fingerprint of the exact
 *   text it wrote. At the next startup it reads the node's copy and compares:
 *
 *     the node's text still matches the fingerprint → nobody has edited it here, so a newer text
 *       from the repo can be published over it safely
 *     the node's text does NOT match              → somebody edited it on this node; leave it
 *       alone and say so in the log, with the skill's name
 *     no fingerprint at all (a node seeded before this existed) → adopt it if the two texts already
 *       agree, otherwise leave it alone and say so; we cannot tell what was seeded
 *
 *   So an unedited node follows the repo, an edited one keeps its edit, and a divergence stops being
 *   invisible. The decision is a pure function so it can be read and tested without a database.
 *
 *   THE FINGERPRINT IS NOT A SECURITY BOUNDARY. It answers "has this text changed since we wrote
 *   it", nothing else. It lives under the node's own system identity, which no owner-scoped
 *   principal can address, next to the skill it describes.
 * @structure
 *   - decideSeedAction(live, stamp, repo) — the pure decision
 *   - seedBuiltinSkills(storage, config) — apply it to every built-in skill, return the counts
 * @usage
 *   import { seedBuiltinSkills } from '../services/skill-seeds.js';
 *   seedBuiltinSkills(storage, config).then(r => ...);
 * @version-history
 *   v2.0.0 -- 2026-08-25 -- Follows the repo on an unedited node instead of never updating. Returns
 *     counts per outcome rather than one number.
 *   v1.1.0 -- 2026-07-14 -- Honor per-skill visibility (aimeat-node-guide seeds 'public' so the
 *     Agent Skills discovery index is never empty); default stays 'members'
 *   v1.0.0 -- 2026-07-05 -- Initial (Skills feature Phase 2b)
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { BUILTIN_SKILLS } from '../data/builtin-skills.js';
import { publishSkill, readNodeSkillBody, scopeOwnerGhii } from './skills.js';
import { logger } from '../utils/logger.js';

/** What to do with one built-in skill this startup. */
export type SeedAction =
  /** Not on this node yet. Publish it. */
  | 'create'
  /** On this node, unedited, and the repo has moved. Publish the newer text over it. */
  | 'update'
  /** On this node from before fingerprints existed, and identical to the repo. Record it. */
  | 'adopt'
  /** On this node, unedited, already the repo's text. Nothing to do. */
  | 'current'
  /** Edited on this node. Leave it alone; the operator's text wins. */
  | 'keep-edited'
  /** From before fingerprints existed AND different from the repo. We cannot tell who is right. */
  | 'keep-unknown';

/** Where the fingerprint of what we last wrote is kept, beside the skill it describes. */
export const seedStampKey = (name: string): string => `skills.${name}.seeded-from-repo`;

/** Fingerprint of one skill text. Not a secret and not a signature: an equality check that fits in a record. */
export const skillFingerprint = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Decide what happens to one skill, from three texts and nothing else.
 *
 *   live  — what the node holds now, or null if it holds nothing
 *   stamp — the fingerprint of what we wrote last time, or null if we never wrote one
 *   repo  — what this build ships
 */
export function decideSeedAction(live: string | null, stamp: string | null, repo: string): SeedAction {
  if (live === null) return 'create';
  if (stamp === null) return live === repo ? 'adopt' : 'keep-unknown';
  if (skillFingerprint(live) !== stamp) return 'keep-edited';
  return live === repo ? 'current' : 'update';
}

export interface SeedResult {
  created: number;
  updated: number;
  adopted: number;
  unchanged: number;
  /** Names of the skills this node has edited, or whose provenance is unknown. Left untouched. */
  diverged: string[];
}

/** Bring every built-in skill into step with this build, without overwriting an edit made here. */
export async function seedBuiltinSkills(storage: Storage, config: AimeatConfig): Promise<SeedResult> {
  const systemGhii = scopeOwnerGhii(config, 'node');
  const result: SeedResult = { created: 0, updated: 0, adopted: 0, unchanged: 0, diverged: [] };

  for (const builtin of BUILTIN_SKILLS) {
    try {
      const live = await readNodeSkillBody(storage, config, builtin.name);
      const stampRecord = await storage.getMemory(systemGhii, seedStampKey(builtin.name));
      const stamp = stampRecord ? String((stampRecord.value as { fingerprint?: unknown })?.fingerprint ?? '') || null : null;
      const action = decideSeedAction(live, stamp, builtin.skillMd);

      if (action === 'keep-edited' || action === 'keep-unknown') {
        result.diverged.push(builtin.name);
        logger.info(
          action === 'keep-edited'
            ? `Built-in skill ${builtin.name} has been edited on this node — keeping the local text. Bring the change back to data/builtin-skills.ts if it should ship.`
            : `Built-in skill ${builtin.name} differs from this build and was seeded before this node tracked what it seeded — keeping the local text.`,
        );
        continue;
      }
      if (action === 'current') { result.unchanged++; continue; }

      if (action === 'create' || action === 'update') {
        await publishSkill(storage, config, {
          scope: 'node',
          publisher: systemGhii,
          files: new Map([['SKILL.md', builtin.skillMd]]),
          visibility: builtin.visibility ?? 'members',
        });
        if (action === 'create') result.created++; else result.updated++;
      } else {
        result.adopted++;
      }

      // Written for both the publish and the adopt: from here on this node knows what it holds.
      const now = new Date().toISOString();
      await storage.setMemory({
        key: seedStampKey(builtin.name),
        ownerGaii: systemGhii,
        value: { fingerprint: skillFingerprint(builtin.skillMd), at: now, action },
        visibility: 'private',
        tags: ['skill-seed'],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      logger.error(`Failed to seed built-in skill ${builtin.name}`, { error: (err as Error).message });
    }
  }
  return result;
}
