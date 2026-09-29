/**
 * @file src/services/classification/policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether classification is on for a piece of content, and which policy applies to it
 *   (TARGET-082). Every check asks here, so the switch and the policy are decided in one place.
 *
 *   THE SWITCH (spec §2, decided 2026-09-29): the node's `classificationMode` is off, owner or all.
 *   Off answers false without reading anything, which is what makes "off changes nothing" hold at
 *   zero cost. All answers true. Owner reads the owner's own record `classification.policy.owner`
 *   (a reserved key: only the owner in person, through the classification service, writes it).
 *   Organism content follows the organism's own switch, which arrives with the three policy levels
 *   in V2; until then an organism's content is classified only when the node says `all`.
 *
 *   THE POLICY: V1 answers the node's defaults (defaults.ts). V2 merges the node, owner and organism
 *   levels in one function that returns the strictest.
 * @structure OWNER_POLICY_KEY · scopeOwner(scope) · scopeOrganism(scope) · classificationActiveFor() ·
 *   policyFor()
 * @usage if (await classificationActiveFor(storage, config, scope)) { const p = await policyFor(...); }
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { defaultPolicy, type ClassificationPolicy } from './defaults.js';

/** The owner's own classification record, under the reserved prefix `classification.policy.`. */
export const OWNER_POLICY_KEY = 'classification.policy.owner';

const ORGANISM_SCOPE = 'organism:';

/** The organism id of an organism scope, or null for a personal one. */
export function scopeOrganism(scope: string): string | null {
  return scope.startsWith(ORGANISM_SCOPE) ? scope.slice(ORGANISM_SCOPE.length) : null;
}

/** The owner identity of a personal scope, or null for an organism one. */
export function scopeOwner(scope: string): string | null {
  return scope.startsWith(ORGANISM_SCOPE) ? null : scope;
}

/** Whether classification applies to content in `scope`. Off costs no read at all. */
export async function classificationActiveFor(
  storage: Storage, config: Pick<AimeatConfig, 'classificationMode'>, scope: string,
): Promise<boolean> {
  const mode = config.classificationMode;
  if (mode === 'all') return true;
  if (mode !== 'owner') return false;
  const owner = scopeOwner(scope);
  if (!owner) return false;
  const rec = await storage.getMemory(owner, OWNER_POLICY_KEY);
  const v = rec?.value as { enabled?: unknown } | undefined;
  return v?.enabled === true;
}

/** The policy that applies to content in `scope`. V1: the node's defaults. */
export async function policyFor(
  _storage: Storage, _config: Pick<AimeatConfig, 'classificationMode'>, _scope: string,
): Promise<ClassificationPolicy> {
  return defaultPolicy();
}
