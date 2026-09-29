/**
 * @file src/services/classification/policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether classification is on for a piece of content, and which policy applies to it
 *   (TARGET-082). Every check asks here, so the switch and the policy are decided in one place.
 *
 *   THE SWITCH (spec §2, decided 2026-09-29): the node's `classificationMode` is off, owner or all.
 *   Off answers false without reading anything, which is what makes "off changes nothing" hold at
 *   zero cost. All answers true. Owner reads the level the content belongs to: the owner's record
 *   for personal content, the organism's for organism content, and its `enabled`.
 *
 *   WHERE THE LEVELS ARE KEPT (V2). The node's whole policy and each organism's layer are records of
 *   `system@<node>`, which no account can register, so no principal writes them except through the
 *   classification service. The owner's layer is the owner's own record under the reserved prefix
 *   `classification.policy.` (utils/reserved-keys.ts). Each record is { policy, history, proposal }:
 *   the stored level, its last 50 changes, and an AI's loosening that waits for a person.
 *   A node that never stored a policy reads the defaults (defaults.ts).
 * @structure OWNER_POLICY_KEY · NODE_POLICY_KEY · organismPolicyKey() · policyHome() · scopeOwner() ·
 *   scopeOrganism() · StoredLevel · readLevel() · readNodePolicy() · classificationActiveFor() ·
 *   policyFor()
 * @usage if (await classificationActiveFor(storage, config, scope)) { const p = await policyFor(...); }
 * @version-history
 *   v1.1.0 — 2026-09-29 — V2: the node, owner and organism levels, merged by levels.ts.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { defaultPolicy, type ClassificationPolicy } from './defaults.js';
import { mergePolicy, type PolicyLayer } from './levels.js';

/** The owner's own classification record, under the reserved prefix `classification.policy.`. */
export const OWNER_POLICY_KEY = 'classification.policy.owner';
/** The node's whole policy, a record of system@<node>. */
export const NODE_POLICY_KEY = 'classification.policy.node';

export function organismPolicyKey(organismId: string): string {
  return `classification.policy.organism.${organismId}`;
}

const ORGANISM_SCOPE = 'organism:';

/** The organism id of an organism scope, or null for a personal one. */
export function scopeOrganism(scope: string): string | null {
  return scope.startsWith(ORGANISM_SCOPE) ? scope.slice(ORGANISM_SCOPE.length) : null;
}

/** The owner identity of a personal scope, or null for an organism one. */
export function scopeOwner(scope: string): string | null {
  return scope.startsWith(ORGANISM_SCOPE) ? null : scope;
}

export type PolicyLevel = 'node' | 'owner' | 'organism';

/** Which record holds a level: its principal and key. */
export function policyHome(nodeId: string, level: PolicyLevel, subject: string): { owner: string; key: string } {
  if (level === 'owner') return { owner: subject, key: OWNER_POLICY_KEY };
  return { owner: `system@${nodeId}`, key: level === 'node' ? NODE_POLICY_KEY : organismPolicyKey(subject) };
}

export interface PolicyChange {
  at: string;
  by: string;
  source: 'human' | 'human-via-ai' | 'ai';
  action: 'set' | 'propose' | 'accept' | 'reject';
  humanSaid?: string | null;
  /** What the change gave away, when it gave anything away. */
  loosens?: string[];
}

export interface StoredLevel<P> {
  policy: P | null;
  history: PolicyChange[];
  proposal: { policy: P; by: string; at: string; humanSaid: string | null; loosens: string[] } | null;
}

/** The stored record of one level. A V1 owner record ({ enabled }) reads as a layer with its switch. */
export async function readLevel<P = PolicyLayer>(
  storage: Storage, nodeId: string, level: PolicyLevel, subject: string,
): Promise<StoredLevel<P>> {
  const home = policyHome(nodeId, level, subject);
  const v = (await storage.getMemory(home.owner, home.key))?.value as Record<string, unknown> | undefined;
  if (!v || typeof v !== 'object') return { policy: null, history: [], proposal: null };
  if (!('policy' in v) && 'enabled' in v) return { policy: { enabled: v.enabled === true } as P, history: [], proposal: null };
  return {
    policy: (v.policy ?? null) as P | null,
    history: Array.isArray(v.history) ? v.history as PolicyChange[] : [],
    proposal: (v.proposal ?? null) as StoredLevel<P>['proposal'],
  };
}

/** The node's policy: the stored one over the defaults, so a field added later reads its default. */
export async function readNodePolicy(storage: Storage, nodeId: string): Promise<ClassificationPolicy> {
  const stored = (await readLevel<ClassificationPolicy>(storage, nodeId, 'node', nodeId)).policy;
  return stored ? { ...defaultPolicy(), ...stored } : defaultPolicy();
}

type Cfg = Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;

async function layerFor(storage: Storage, nodeId: string, scope: string): Promise<PolicyLayer | null> {
  const org = scopeOrganism(scope);
  return (await readLevel(storage, nodeId, org ? 'organism' : 'owner', org ?? scope)).policy;
}

/** Whether classification applies to content in `scope`. Off costs no read at all. */
export async function classificationActiveFor(storage: Storage, config: Cfg, scope: string): Promise<boolean> {
  const mode = config.classificationMode;
  if (mode === 'all') return true;
  if (mode !== 'owner') return false;
  return (await layerFor(storage, config.nodeId, scope))?.enabled === true;
}

/** The policy that applies to content in `scope`: the node's, merged with the owner's or organism's. */
export async function policyFor(storage: Storage, config: Cfg, scope: string): Promise<ClassificationPolicy> {
  const [node, layer] = await Promise.all([readNodePolicy(storage, config.nodeId), layerFor(storage, config.nodeId, scope)]);
  return mergePolicy(node, layer);
}
