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
 *   WHOSE LEVEL PERSONAL CONTENT READS. An agent's memory lands under its own identity
 *   (`claude#alice@node`) and an ecosystem app's under its GEAI, but both act in their owner's name,
 *   so personal content of any of them reads the OWNER's switch and layer (ownerOfScope). Read from
 *   the agent's own namespace, nothing an agent wrote was classified in mode owner, and the owner's
 *   labels, rules and default never reached it in mode all (TARGET-082 review finding 1).
 *
 *   WHERE THE LEVELS ARE KEPT (V2). The node's whole policy and each organism's layer are records of
 *   `system@<node>`, which no account can register, so no principal writes them except through the
 *   classification service. The owner's layer is the owner's own record under the service-owned
 *   prefix `classification.policy.` (utils/reserved-keys.ts), which no memory route writes, restores
 *   or deletes for anyone. Each record is { policy, history, proposal }: the stored level, its last
 *   50 changes, and an AI's loosening that waits for a person. A node that never stored a policy
 *   reads the defaults (defaults.ts).
 *
 *   WHAT IS READ IS CHECKED. A stored layer is brought up to the current node (levels.ts
 *   normaliseLayer) and validated before it is merged; the node's policy is validated too. A record
 *   that still does not pass is ignored with a logged warning, keeping only an owner's or organism's
 *   own switch, so a bad record never throws in a reader and never turns classification off.
 * @structure OWNER_POLICY_KEY · NODE_POLICY_KEY · organismPolicyKey() · policyHome() · scopeOwner() ·
 *   ownerOfScope() · scopeOrganism() · StoredLevel · ReadLevel · readLevel() · readNodePolicy() ·
 *   classificationActiveFor() · policyFor()
 * @usage if (await classificationActiveFor(storage, config, scope)) { const p = await policyFor(...); }
 * @version-history
 *   v1.2.0 — 2026-09-29 — TARGET-082 review. Personal content of an owner's agents and ecosystem apps
 *     reads the owner's level (ownerOfScope, finding 1). readLevel normalises and validates what it
 *     reads and reports what the normalising dropped (findings 2 and 4).
 *   v1.1.0 — 2026-09-29 — V2: the node, owner and organism levels, merged by levels.ts.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { defaultPolicy, type ClassificationPolicy } from './defaults.js';
import {
  mergePolicy, normaliseLayer, normaliseStoredLabels, validateLayer, validateNodePolicy, type PolicyLayer,
} from './levels.js';

/** The owner's own classification record, under the service-owned prefix `classification.policy.`. */
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

/** The identity a personal scope names, exactly (an agent's GAII stays a GAII), or null for an organism. */
export function scopeOwner(scope: string): string | null {
  return scope.startsWith(ORGANISM_SCOPE) ? null : scope;
}

/**
 * The OWNER GHII behind a personal scope, or null for an organism one: `alice@node`,
 * `claude#alice@node` and `eco:drum#alice@node` all answer `alice@node`. Whose policy applies, whose
 * audit log a row belongs to and whose stream hears a change are all decided on this, so content an
 * agent or an app holds is the owner's in every one of them (TARGET-082 review finding 1).
 */
export function ownerOfScope(scope: string): string | null {
  const identity = scopeOwner(scope);
  return identity ? ownerGhiiOf(identity) : null;
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
  /** `supersede`: a person changed the level while an AI's proposal waited, so the proposal went. */
  action: 'set' | 'propose' | 'accept' | 'reject' | 'supersede';
  humanSaid?: string | null;
  /** What the change gave away, when it gave anything away. */
  loosens?: string[];
}

export interface StoredLevel<P> {
  policy: P | null;
  history: PolicyChange[];
  proposal: { policy: P; by: string; at: string; humanSaid: string | null; loosens: string[] } | null;
}

/** A level as read: the stored record, checked, and what checking it against the node dropped. */
export interface ReadLevel<P> extends StoredLevel<P> {
  dropped: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The record of one level as it is stored. A V1 owner record ({ enabled }) reads as a layer with its switch. */
async function readStored(storage: Storage, nodeId: string, level: PolicyLevel, subject: string): Promise<StoredLevel<unknown>> {
  const home = policyHome(nodeId, level, subject);
  const v = (await storage.getMemory(home.owner, home.key))?.value;
  if (!isObj(v)) return { policy: null, history: [], proposal: null };
  if (!('policy' in v) && 'enabled' in v) return { policy: { enabled: v.enabled === true }, history: [], proposal: null };
  return {
    policy: v.policy ?? null,
    history: Array.isArray(v.history) ? v.history as PolicyChange[] : [],
    proposal: isObj(v.proposal) ? v.proposal as StoredLevel<unknown>['proposal'] : null,
  };
}

/** The stored node policy over the defaults, validated; the defaults when it does not pass. */
function checkedNode(stored: unknown, nodeId: string): ClassificationPolicy | null {
  if (stored === null || stored === undefined) return null;
  try {
    if (!isObj(stored)) throw new Error('the stored node policy is not an object');
    const { labels } = normaliseStoredLabels(stored.labels ?? defaultPolicy().labels);
    return validateNodePolicy({ ...defaultPolicy(), ...stored, labels });
  } catch (err) {
    logger.warn('classification: the stored node policy does not pass validation; the defaults apply until an operator saves it again', { nodeId, error: String(err) });
    return null;
  }
}

/**
 * A stored layer against the current node: normalised, then validated. One that still does not pass
 * keeps only its own switch, so classification stays as on as it was and nothing the record says
 * beyond that is trusted.
 */
function checkedLayer(node: ClassificationPolicy, stored: unknown, where: string): { layer: PolicyLayer | null; dropped: string[] } {
  if (stored === null || stored === undefined) return { layer: null, dropped: [] };
  const { layer, dropped } = normaliseLayer(node, stored);
  try {
    return { layer: validateLayer(node, layer), dropped };
  } catch (err) {
    logger.warn('classification: a stored policy layer does not pass validation; only its switch is kept', { where, error: String(err) });
    const enabled = isObj(stored) && typeof stored.enabled === 'boolean' ? stored.enabled : undefined;
    return {
      layer: enabled === undefined ? null : { enabled },
      dropped: [...dropped, 'The stored policy could not be read in full, so only its on/off switch is kept. Save the policy again to set the rest.'],
    };
  }
}

/**
 * One level, read and checked. The node's policy is validated (null when none is stored or it does
 * not pass); an owner's or organism's layer is normalised against the current node and validated
 * (`dropped` says what that took away). `node` saves a read when the caller already holds it.
 */
export async function readLevel<P = PolicyLayer>(
  storage: Storage, nodeId: string, level: PolicyLevel, subject: string, node?: ClassificationPolicy,
): Promise<ReadLevel<P>> {
  const rec = await readStored(storage, nodeId, level, subject);
  if (level === 'node') {
    return { ...rec, policy: checkedNode(rec.policy, nodeId) as P | null, proposal: rec.proposal as StoredLevel<P>['proposal'], dropped: [] };
  }
  const current = node ?? await readNodePolicy(storage, nodeId);
  const { layer, dropped } = checkedLayer(current, rec.policy, `${level}:${subject}`);
  return { ...rec, policy: layer as P | null, proposal: rec.proposal as StoredLevel<P>['proposal'], dropped };
}

/** The node's policy: the stored one over the defaults, so a field added later reads its default. */
export async function readNodePolicy(storage: Storage, nodeId: string): Promise<ClassificationPolicy> {
  return checkedNode((await readStored(storage, nodeId, 'node', nodeId)).policy, nodeId) ?? defaultPolicy();
}

type Cfg = Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;

/** The level content in `scope` belongs to: the organism's, or the OWNER's for any personal scope. */
function levelOf(scope: string): { level: 'owner' | 'organism'; subject: string } {
  const org = scopeOrganism(scope);
  return org ? { level: 'organism', subject: org } : { level: 'owner', subject: ownerOfScope(scope) ?? scope };
}

/** Whether classification applies to content in `scope`. Off costs no read at all. */
export async function classificationActiveFor(storage: Storage, config: Cfg, scope: string): Promise<boolean> {
  const mode = config.classificationMode;
  if (mode === 'all') return true;
  if (mode !== 'owner') return false;
  // The switch alone: a boolean needs no node policy to be checked against.
  const { level, subject } = levelOf(scope);
  const policy = (await readStored(storage, config.nodeId, level, subject)).policy;
  return isObj(policy) && policy.enabled === true;
}

/** The policy that applies to content in `scope`: the node's, merged with the owner's or organism's. */
export async function policyFor(storage: Storage, config: Cfg, scope: string): Promise<ClassificationPolicy> {
  const node = await readNodePolicy(storage, config.nodeId);
  const { level, subject } = levelOf(scope);
  const layer = (await readLevel(storage, config.nodeId, level, subject, node)).policy;
  return mergePolicy(node, layer);
}
