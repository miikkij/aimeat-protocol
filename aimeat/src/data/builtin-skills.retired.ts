/**
 * @file src/data/builtin-skills.retired.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in skills this repo once shipped and no longer does. The seeder
 *   (services/skill-seeds.ts) reads this list at startup and takes each one off the node.
 *
 *   WHY A LIST. Dropping a skill from BUILTIN_SKILLS removes it from a NEW node only. A node that
 *   was seeded earlier keeps its copy for ever, because the seeder walks the skills that exist and
 *   never asks about the ones that stopped existing. A name written here is the one way a running
 *   node learns that a skill is gone.
 *
 *   WHAT IS REMOVED AND WHAT IS NOT. Only a copy the seeder itself wrote and nobody has changed
 *   since: the node's text must still match the fingerprint recorded when it was seeded. A copy an
 *   operator edited, or one from before fingerprints existed, stays and is named in the log. That is
 *   the same rule the seeder follows for an update, for the same reason.
 *
 *   A name stays on this list. Removing it later saves nothing, and a node that was switched off
 *   for a year still needs to be told.
 * @structure RETIRED_BUILTIN_SKILLS
 * @usage import { RETIRED_BUILTIN_SKILLS } from '../data/builtin-skills.retired.js';
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial, with hatchery-agent-requests.
 */

export interface RetiredBuiltinSkill {
  name: string;
  /** Why it is gone, for whoever reads the list. */
  reason: string;
}

export const RETIRED_BUILTIN_SKILLS: RetiredBuiltinSkill[] = [
  {
    name: 'hatchery-agent-requests',
    reason: 'There is no agent hatchery. What the skill taught lives on as aimeat-recurring-work; agents are made with aimeat_agent_propose and a crew definition (2026-09-19).',
  },
];
