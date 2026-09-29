/**
 * @file src/services/classification/policy-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading and changing a classification policy at one of its three levels (TARGET-082
 *   V2). REST and MCP call these functions, so who may change what, and what waits for a person, is
 *   decided once.
 *
 *   WHO: the node's policy by an operator (or the operator's own AI); an owner's by that owner (or
 *   their AI); an organism's by its creator or an admin (or their AI, when the organism admits it).
 *   Anyone signed in here reads the node's policy, because labelling needs the list of labels.
 *
 *   WHAT WAITS (decided 2026-09-29): a person's change applies at once. An AI's change applies at
 *   once when it only tightens. When it gives anything away (levels.ts loosenings), it is kept as a
 *   proposal, and a person accepts or rejects it in their own session; an AI cannot accept it, even
 *   with the person's words, which are kept on the proposal as its reason. Every change is kept in
 *   the level's history (the last 50). A person's own change supersedes a waiting proposal.
 * @structure PolicyView · readPolicy() · writePolicy() · reviewPolicy() · readAuditLog()
 * @usage
 *   const out = await writePolicy(deps, actor, 'owner', null, { enabled: true });
 * @version-history
 *   v1.3.0 — 2026-09-29 — TARGET-082 review. The view carries `dropped`, what reading the stored
 *     layer against the current node took away, and `stored` is that normalised layer (finding 4). A
 *     person's change drops the AI's waiting proposal and says so in the history (`supersede`), and
 *     an accept measures what it gives away against the level as it stands (finding 5). The owner's
 *     audit log covers the owner's agents and ecosystem apps (finding 1).
 *   v1.2.0 — 2026-09-29 — V5: every stored change (a set, a proposal, an accept, a reject) emits the
 *     change domain `classification`, so REST, MCP, the connector and extensions announce it from here.
 *   v1.1.0 — 2026-09-29 — V4: readAuditLog, the audit log per level.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import type { Storage, ClassificationAuditRow } from '../../storage/interface.js';
import { emitChange } from '../event-bus.js';
import { listClassificationAuditMerged } from './audit.js';
import { agentBarred } from '../organism-agent-access.js';
import { isOrgManager } from '../workspace-access.js';
import type { ClassificationPolicy } from './defaults.js';
import { ClassificationError, type ClassificationDeps, type LabelActor } from './labels.js';
import { loosenings, mergePolicy, PolicyError, validateLayer, validateNodePolicy, type PolicyLayer } from './levels.js';
import {
  policyHome, readLevel, readNodePolicy, type PolicyChange, type PolicyLevel, type StoredLevel,
} from './policy.js';

const HISTORY = 50;

export interface PolicyView {
  level: PolicyLevel;
  subject: string;
  /** The node's switch: off, owner or all. */
  mode: string;
  /** Whether classification is on for this level's content now. */
  active: boolean;
  /** What this level stores itself. For the node, the whole policy. */
  stored: PolicyLayer | ClassificationPolicy | null;
  /** What applies to this level's content: the node's policy merged with the layer. */
  effective: ClassificationPolicy;
  proposal: StoredLevel<unknown>['proposal'];
  history: PolicyChange[];
  /**
   * What reading the stored layer against the current node dropped or raised, one sentence each
   * (levels.ts normaliseLayer). Empty when the stored layer still fits the node. `stored` is already
   * the normalised layer, so sending it back with a change saves.
   */
  dropped: string[];
}

function subjectOf(level: PolicyLevel, actor: LabelActor, organismId: string | null | undefined, nodeId: string): string {
  if (level === 'node') return nodeId;
  if (level === 'owner') return actor.ownerGhii;
  if (!organismId) throw new ClassificationError('INVALID_INPUT', 400, 'organism_id names the organism whose policy this is.');
  return organismId;
}

async function mayRead(deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, subject: string): Promise<void> {
  if (level !== 'organism') return;
  const organism = await deps.storage.getOrganism(subject);
  const m = organism && actor.ownerName && !agentBarred(organism, actor.principal)
    ? await deps.storage.getMembership(subject, actor.ownerName) : null;
  if (!m || m.status !== 'active') throw new ClassificationError('NOT_FOUND', 404, 'No such organism, or you are not a member of it.');
}

async function mayWrite(deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, subject: string): Promise<void> {
  if (actor.kind === 'rule') throw new ClassificationError('PERSON_REQUIRED', 403, 'A detection rule changes no policy.');
  if (level === 'owner') return;
  if (level === 'node') {
    const owner = actor.ownerName ? await deps.storage.getOwner(actor.ownerName) : null;
    if (owner?.roles.includes('operator')) return;
    throw new ClassificationError('OPERATOR_REQUIRED', 403, "Only an operator of this server changes the node's classification policy.");
  }
  const organism = await deps.storage.getOrganism(subject);
  if (organism && !agentBarred(organism, actor.principal) && await isOrgManager(deps.storage, subject, actor.ownerName ?? undefined)) return;
  throw new ClassificationError('NOT_FOUND', 404, "No such organism, or you are not its creator or an admin, who set the organism's policy.");
}

/**
 * Store a level and say so on the change bus, `classification`: an owner's policy tells only that
 * owner's streams, the node's and an organism's tell every stream (the admin view and the Data
 * Wallet listen on it).
 */
async function store(storage: Storage, level: PolicyLevel, owner: string, key: string, value: StoredLevel<unknown>, at: string): Promise<void> {
  const existing = await storage.getMemory(owner, key);
  await storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: ['classification-policy'], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? at, updatedAt: at,
  });
  emitChange('classification', level === 'owner' ? owner : undefined);
}

async function view(deps: ClassificationDeps, level: PolicyLevel, subject: string): Promise<PolicyView> {
  const { storage, config } = deps;
  const node = await readNodePolicy(storage, config.nodeId);
  const rec = await readLevel<PolicyLayer | ClassificationPolicy>(storage, config.nodeId, level, subject, node);
  const layer = level === 'node' ? null : rec.policy as PolicyLayer | null;
  const mode = config.classificationMode;
  const active = mode === 'all' || (mode === 'owner' && level !== 'node' && layer?.enabled === true);
  return {
    level, subject, mode, active, stored: rec.policy, effective: mergePolicy(node, layer),
    proposal: rec.proposal, history: rec.history.slice(-10), dropped: rec.dropped,
  };
}

export async function readPolicy(
  deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, organismId?: string | null,
): Promise<PolicyView> {
  const subject = subjectOf(level, actor, organismId, deps.config.nodeId);
  await mayRead(deps, actor, level, subject);
  return view(deps, level, subject);
}

function trimmedSaid(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > 2000) throw new ClassificationError('INVALID_INPUT', 400, 'humanSaid is text of at most 2000 characters.');
  return v.trim() || null;
}

function asClassificationError(err: unknown): never {
  if (err instanceof PolicyError) throw new ClassificationError(err.code, 400, err.message);
  throw err;
}

/** What `input` would make of the level, validated, and what it gives away against what is stored. */
async function prepare(deps: ClassificationDeps, level: PolicyLevel, subject: string, input: unknown) {
  const { storage, config } = deps;
  const node = await readNodePolicy(storage, config.nodeId);
  // The stored level as it applies NOW (normalised and validated), so `loosens` is measured against
  // the current state, whatever changed since a proposal was made.
  const rec = await readLevel<PolicyLayer | ClassificationPolicy>(storage, config.nodeId, level, subject, node);
  try {
    if (level === 'node') {
      const next = validateNodePolicy(input);
      return { rec, next, loosens: loosenings(node, next) };
    }
    const next = validateLayer(node, input);
    const before = rec.policy as PolicyLayer | null;
    const loosens = loosenings(mergePolicy(node, before), mergePolicy(node, next),
      { before: before?.enabled === true, after: next.enabled === true });
    return { rec, next, loosens };
  } catch (err) { return asClassificationError(err); }
}

export interface PolicyWriteResult {
  applied: boolean;
  /** PERSON_APPROVES when an AI's change gives something away and waits for a person. */
  pending?: 'PERSON_APPROVES';
  loosens: string[];
  view: PolicyView;
}

/** Replace a level's stored policy. The whole level is sent: read it first and send it back changed. */
export async function writePolicy(
  deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, organismId: string | null | undefined,
  input: unknown, opts: { humanSaid?: unknown } = {},
): Promise<PolicyWriteResult> {
  const subject = subjectOf(level, actor, organismId, deps.config.nodeId);
  await mayWrite(deps, actor, level, subject);
  const humanSaid = trimmedSaid(opts.humanSaid);
  const { rec, next, loosens } = await prepare(deps, level, subject, input);
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const home = policyHome(deps.config.nodeId, level, subject);
  const source: PolicyChange['source'] = actor.kind === 'human' ? 'human' : humanSaid ? 'human-via-ai' : 'ai';

  if (actor.kind === 'ai' && loosens.length) {
    const history = [...rec.history, { at, by: actor.principal, source, action: 'propose' as const, humanSaid, loosens }].slice(-HISTORY);
    await store(deps.storage, level, home.owner, home.key, { policy: rec.policy, history, proposal: { policy: next, by: actor.principal, at, humanSaid, loosens } }, at);
    return { applied: false, pending: 'PERSON_APPROVES', loosens, view: await view(deps, level, subject) };
  }
  // A person changing the level supersedes an AI's waiting proposal: it was a whole level written
  // against what stood before, and accepting it later would overwrite the person's newer change
  // (TARGET-082 review finding 5). The history says it went, and why.
  const superseded = actor.kind === 'human' && rec.proposal
    ? [{ at, by: actor.principal, source: 'human' as const, action: 'supersede' as const, loosens: rec.proposal.loosens }] : [];
  const history = [...rec.history, ...superseded, { at, by: actor.principal, source, action: 'set' as const, humanSaid, loosens: loosens.length ? loosens : undefined }].slice(-HISTORY);
  await store(deps.storage, level, home.owner, home.key, { policy: next, history, proposal: superseded.length ? null : rec.proposal }, at);
  return { applied: true, loosens, view: await view(deps, level, subject) };
}

/**
 * The audit log of one level: an owner's own content, an organism's content (its creator or an
 * admin), or the whole node (an operator). Newest first, waiting rows included.
 */
export async function readAuditLog(
  deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, organismId: string | null | undefined,
  filter: { since?: string; action?: string; limit?: number } = {},
): Promise<{ level: PolicyLevel; subject: string; rows: ClassificationAuditRow[] }> {
  const subject = subjectOf(level, actor, organismId, deps.config.nodeId);
  if (level === 'owner') {
    if (actor.kind === 'rule') throw new ClassificationError('PERSON_REQUIRED', 403, 'A detection rule reads no log.');
  } else {
    await mayWrite(deps, actor, level, subject);
  }
  const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
  const common = { since: filter.since, action: filter.action, limit };
  if (level !== 'owner') {
    const rows = await listClassificationAuditMerged(deps.storage, { ...(level === 'organism' ? { scope: `organism:${subject}` } : {}), ...common });
    return { level, subject, rows };
  }
  // The owner's log covers what their agents and ecosystem apps hold too (finding 1). A row names
  // the owner GHII (policy.ts ownerOfScope); one recorded before that names the agent or the app,
  // so those identities are asked as well, and the answers are merged newest first.
  const holders = [subject];
  if (actor.ownerName) {
    const [agents, apps] = await Promise.all([
      deps.storage.getAgentsByOwner(actor.ownerName), deps.storage.getEcosystemAppsByOwner(actor.ownerName),
    ]);
    holders.push(...agents.map(a => a.gaii), ...apps.map(a => a.geai));
  }
  const lists = await Promise.all([...new Set(holders)].map(ownerGaii => listClassificationAuditMerged(deps.storage, { ownerGaii, ...common })));
  const rows = lists.flat()
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
    .slice(0, limit);
  return { level, subject, rows };
}

/** A person accepts or rejects the AI's waiting proposal, in their own session. */
export async function reviewPolicy(
  deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, organismId: string | null | undefined,
  decision: 'accept' | 'reject',
): Promise<PolicyWriteResult> {
  if (actor.kind !== 'human') {
    throw new ClassificationError('PERSON_REQUIRED', 403, 'A person accepts or rejects a proposal to loosen the policy, signed in themselves. Ask them to open it.');
  }
  const subject = subjectOf(level, actor, organismId, deps.config.nodeId);
  await mayWrite(deps, actor, level, subject);
  const home = policyHome(deps.config.nodeId, level, subject);
  const rec = await readLevel<PolicyLayer | ClassificationPolicy>(deps.storage, deps.config.nodeId, level, subject);
  if (!rec.proposal) throw new ClassificationError('NO_PROPOSAL', 404, 'Nothing is waiting for a review on this policy.');
  const at = (deps.now ?? (() => new Date().toISOString()))();
  if (decision === 'reject') {
    const history = [...rec.history, { at, by: actor.principal, source: 'human' as const, action: 'reject' as const, loosens: rec.proposal.loosens }].slice(-HISTORY);
    await store(deps.storage, level, home.owner, home.key, { policy: rec.policy, history, proposal: null }, at);
    return { applied: false, loosens: [], view: await view(deps, level, subject) };
  }
  // Validated again, and what it gives away measured against the level as it stands now: the
  // node's policy may have changed since the AI proposed this. A person's own change in between
  // has already removed the proposal (writePolicy).
  const { next, loosens } = await prepare(deps, level, subject, rec.proposal.policy);
  const history = [...rec.history, { at, by: actor.principal, source: 'human' as const, action: 'accept' as const, humanSaid: rec.proposal.humanSaid, loosens }].slice(-HISTORY);
  await store(deps.storage, level, home.owner, home.key, { policy: next, history, proposal: null }, at);
  return { applied: true, loosens, view: await view(deps, level, subject) };
}
