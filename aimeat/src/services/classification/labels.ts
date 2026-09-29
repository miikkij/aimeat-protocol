/**
 * @file src/services/classification/labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place a classification label is set, reviewed and read (TARGET-082). Every
 *   surface calls these functions (REST, MCP and extensions from V5), so the rules below hold on
 *   every surface because they are written once.
 *
 *   THE RULES (decided 2026-09-29, spec §8; TARGET-081 brought them to the node):
 *   - A person's label is LOCKED. An AI or a detection rule never changes it; what they have to say
 *     becomes a suggestion the person accepts or rejects.
 *   - An AI never lowers a label, and a rule never lowers a label.
 *   - Lowering from a label marked lowerNeedsJustification needs a written reason.
 *   - An AI relaying a person's own words passes them in `humanSaid`, verbatim; the label then counts
 *     as the person's (source human-via-ai, locked) and the words stay on the record.
 *   - Who is an AI is decided from the credential (reader-kind.ts), never from what the caller says.
 *   - The policy's AI mode decides the rest: off refuses an AI's label, suggest keeps it waiting for
 *     a person, auto applies a raise at or above the confidence threshold.
 *
 *   WHO MAY LABEL WHAT: personal content only by its owner or the owner's own agents and apps;
 *   organism content only by an active member (an agent the organism does not admit is not one).
 *   V5 narrows organism content to the members who may write the workspace, when the surfaces land.
 * @structure ClassificationError · LabelActor · labelActorOf() · memoryTarget() · fileTarget() ·
 *   rowTarget() · setLabel() · reviewLabel() · labelsFor() · targetOf() · readContentLabel()
 * @usage
 *   const actor = labelActorOf(req.auth!, config.nodeId);
 *   await setLabel({ storage, config }, actor, memoryTarget(owner, key), { label: 'luottamuksellinen' });
 * @version-history
 *   v1.2.0 — 2026-09-29 — V4: a label change goes to the audit log, and nobody sets a label whose
 *     reader audience leaves them out (AUDIENCE_LOCKOUT).
 *   v1.1.0 — 2026-09-29 — V2: targetOf and readContentLabel, shared by the REST route and the MCP tool.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ContentLabelRow, ContentLabelTarget, ContentLabelKind } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isSameOwner, isForeignPrincipal, callerPrincipal, localAccountOf } from '../../utils/gaii.js';
import { agentBarred } from '../organism-agent-access.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './defaults.js';
import { policyFor, scopeOrganism, scopeOwner } from './policy.js';
import { readerKindOf } from './reader-kind.js';
import { audienceCheck } from './audience.js';
import { recordClassificationAudit } from './audit.js';

export class ClassificationError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'ClassificationError';
  }
}

export interface ClassificationDeps {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;
  /** ISO time; injectable for tests. */
  now?: () => string;
}

/** Who is labelling. `rule` is the node's own detection, never a caller. */
export interface LabelActor {
  principal: string;
  ownerGhii: string;
  ownerName: string | null;
  kind: 'human' | 'ai' | 'rule';
}

/** The actor behind a request. A visitor from another node labels nothing here. */
export function labelActorOf(
  auth: { sub: string; owner: string; roles: string[]; federated?: boolean; anonymous?: boolean; app_grant?: string; app?: string },
  nodeId: string,
): LabelActor {
  if (isForeignPrincipal(auth)) throw new ClassificationError('FOREIGN_VISITOR', 403, 'A visitor from another node labels nothing here.');
  const kind = readerKindOf(auth);
  if (kind === 'anonymous') throw new ClassificationError('AUTH_REQUIRED', 401, 'Sign in to label content.');
  const ownerGhii = auth.owner.includes('@') ? auth.owner : `${auth.owner}@${nodeId}`;
  return { principal: callerPrincipal(auth, nodeId), ownerGhii, ownerName: localAccountOf(ownerGhii), kind };
}

/** A memory key's label address: an organism key belongs to the organism, whoever wrote it. */
export function memoryTarget(ownerGaii: string, key: string): ContentLabelTarget {
  if (key.startsWith('organism.')) {
    const id = key.split('.')[1];
    if (id) return { kind: 'memory', scope: `organism:${id}`, key };
  }
  return { kind: 'memory', scope: ownerGaii, key };
}

export function fileTarget(ownerGaii: string, storageKey: string): ContentLabelTarget {
  return { kind: 'file', scope: ownerGaii, key: storageKey };
}

export function rowTarget(organismId: string, ws: string, space: string, rowId: string): ContentLabelTarget {
  return { kind: 'row', scope: `organism:${organismId}`, key: `${ws}/${space}/${rowId}` };
}

async function assertMayLabel(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget): Promise<void> {
  if (actor.kind === 'rule') return;
  const owner = scopeOwner(target.scope);
  if (owner) {
    if (isSameOwner(owner, actor.ownerGhii)) return;
    throw new ClassificationError('NOT_FOUND', 404, 'No such content, or it is not yours to label.');
  }
  const orgId = scopeOrganism(target.scope) as string;
  const organism = await deps.storage.getOrganism(orgId);
  if (organism && actor.ownerName && !agentBarred(organism, actor.principal)) {
    const m = await deps.storage.getMembership(orgId, actor.ownerName);
    if (m && m.status === 'active') return;
  }
  throw new ClassificationError('NOT_FOUND', 404, 'No such content, or you are not a member of the organism it belongs to.');
}

function activeLabel(policy: ClassificationPolicy, id: string): ClassificationLabel {
  const l = labelById(policy, id);
  if (!l || l.status !== 'active') {
    const names = policy.labels.filter(x => x.status === 'active').map(x => x.id).join(', ');
    throw new ClassificationError('LABEL_UNKNOWN', 400, `"${id}" is not an active label. Active labels: ${names}.`);
  }
  return l;
}

function trimmed(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ClassificationError('INVALID_INPUT', 400, `${field} is text.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw new ClassificationError('INVALID_INPUT', 400, `${field} is longer than ${max} characters.`);
  return s;
}

export interface SetLabelInput {
  label: string;
  justification?: string | null;
  /** A person's own words, verbatim, when an AI relays their instruction. */
  humanSaid?: string | null;
  /** An AI's or a rule's confidence, 0..1. */
  confidence?: number;
  /** Why an AI or a rule chose the label. */
  reason?: string | null;
}

export interface SetLabelResult {
  applied: boolean;
  label: string;
  from: string;
  source: ContentLabelRow['source'];
  locked: boolean;
  /** Set when the change waits for a person: HUMAN_LABEL, CANNOT_LOWER, AI_SUGGESTS, BELOW_THRESHOLD. */
  pending?: string;
}

function blankRow(target: ContentLabelTarget, policy: ClassificationPolicy, at: string, by: string): ContentLabelRow {
  return {
    ...target, id: randomUUID(), ownerGaii: scopeOwner(target.scope), label: policy.defaultLabel, source: 'default',
    locked: false, suggestion: null, justification: null, humanSaid: null, history: [], setBy: by, updatedAt: at,
  };
}

/** Set a label, or leave a suggestion when the rules say an AI or a rule may not set it. */
export async function setLabel(
  deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, input: SetLabelInput,
): Promise<SetLabelResult> {
  const justification = trimmed(input.justification, 'justification', 2000);
  const humanSaid = trimmed(input.humanSaid, 'humanSaid', 2000);
  const reason = trimmed(input.reason, 'reason', 1000);
  const confidence = typeof input.confidence === 'number' && isFinite(input.confidence)
    ? Math.min(Math.max(input.confidence, 0), 1) : undefined;
  if (actor.kind === 'rule' && humanSaid) throw new ClassificationError('INVALID_INPUT', 400, 'A detection rule has no person to quote.');

  await assertMayLabel(deps, actor, target);
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const next = activeLabel(policy, input.label);
  const prev = await deps.storage.getContentLabel(target);
  const fromId = prev?.label ?? policy.defaultLabel;
  const from = labelById(policy, fromId);
  const lowering = !!from && next.rank < from.rank;
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const row: ContentLabelRow = prev ? { ...prev, history: [...prev.history] } : blankRow(target, policy, at, actor.principal);
  // Whoever sets a label with a reader audience must be inside it (spec §4.1): nobody locks
  // themselves out of their own content. A rule is the policy's own and has no self to lock out.
  if (actor.kind !== 'rule' && next.audience
    && !(await audienceCheck(deps.storage, { owner: actor.ownerGhii, ownerName: actor.ownerName })(next.audience, target.scope))) {
    throw new ClassificationError('AUDIENCE_LOCKOUT', 400,
      `"${next.name.en}" limits who may read the content, and you are not among them, so this would lock you out. Add yourself to the label's audience first, or pick another label.`);
  }
  const changed = (source: ContentLabelRow['source']) => recordClassificationAudit({
    scope: target.scope, ownerGaii: scopeOwner(target.scope), kind: target.kind, key: target.key, label: next.id,
    reader: actor.principal, readerKind: actor.kind === 'rule' ? 'system' : actor.kind, action: 'changed', purpose: `${fromId} → ${next.id} (${source})`,
  });

  const asPerson = actor.kind === 'human' || (actor.kind === 'ai' && !!humanSaid);
  if (asPerson) {
    if (lowering && from?.lowerNeedsJustification && !justification) {
      throw new ClassificationError('JUSTIFICATION_REQUIRED', 400,
        `Lowering from "${from.name.en}" to "${next.name.en}" needs a justification: why this content is less sensitive than its label says.`);
    }
    const source = actor.kind === 'human' ? 'human' : 'human-via-ai';
    row.label = next.id; row.source = source; row.locked = true; row.suggestion = null;
    row.justification = justification; row.humanSaid = humanSaid; row.setBy = actor.principal; row.updatedAt = at;
    row.history.push({ at, by: actor.principal, source, action: 'set', from: fromId, to: next.id, justification, humanSaid });
    await deps.storage.putContentLabel(row);
    if (next.id !== fromId) changed(source);
    return { applied: true, label: next.id, from: fromId, source, locked: true };
  }

  if (actor.kind === 'ai' && policy.aiMode === 'off') {
    throw new ClassificationError('AI_LABELLING_OFF', 403, 'The classification policy does not let an AI label content. A person sets the label, or relays their own words in humanSaid.');
  }
  // Already the label: nothing to set and nothing to suggest. A waiting suggestion stays for the person.
  if (next.id === fromId) {
    return { applied: false, label: fromId, from: fromId, source: prev?.source ?? 'default', locked: !!prev?.locked };
  }
  // asPerson is false here, so the actor is an AI without a person's words, or a rule.
  const source: 'ai' | 'rule' = actor.kind === 'rule' ? 'rule' : 'ai';
  let pending: string | undefined;
  if (prev?.locked) pending = 'HUMAN_LABEL';
  else if (lowering) pending = 'CANNOT_LOWER';
  else if (source === 'ai' && policy.aiMode === 'suggest') pending = 'AI_SUGGESTS';
  else if (source === 'ai' && (confidence ?? 0) < policy.aiThreshold) pending = 'BELOW_THRESHOLD';

  if (!pending) {
    row.label = next.id; row.source = source; row.locked = false; row.suggestion = null;
    row.justification = null; row.humanSaid = null; row.setBy = actor.principal; row.updatedAt = at;
    row.history.push({ at, by: actor.principal, source, action: 'set', from: fromId, to: next.id, confidence, reason: reason ?? undefined });
    await deps.storage.putContentLabel(row);
    changed(source);
    return { applied: true, label: next.id, from: fromId, source, locked: false };
  }
  row.suggestion = { label: next.id, by: actor.principal, at, source, confidence, reason: reason ?? undefined, why: pending };
  row.updatedAt = at;
  row.history.push({ at, by: actor.principal, source, action: 'suggest', from: fromId, to: next.id, confidence, reason: reason ?? undefined });
  await deps.storage.putContentLabel(row);
  return { applied: false, label: fromId, from: fromId, source: row.source, locked: row.locked, pending };
}

/** A person accepts or rejects the waiting suggestion. Accepting is the person setting the label. */
export async function reviewLabel(
  deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget,
  input: { decision: 'accept' | 'reject'; justification?: string | null; humanSaid?: string | null },
): Promise<SetLabelResult> {
  const humanSaid = trimmed(input.humanSaid, 'humanSaid', 2000);
  if (actor.kind === 'rule' || (actor.kind === 'ai' && !humanSaid)) {
    throw new ClassificationError('PERSON_REQUIRED', 403, 'A person reviews a suggestion. An AI relays their decision with their own words in humanSaid.');
  }
  await assertMayLabel(deps, actor, target);
  const prev = await deps.storage.getContentLabel(target);
  if (!prev?.suggestion) throw new ClassificationError('NO_SUGGESTION', 404, 'Nothing is waiting for a review on this content.');
  if (input.decision === 'accept') {
    return setLabel(deps, actor, target, { label: prev.suggestion.label, justification: input.justification, humanSaid });
  }
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const source = actor.kind === 'human' ? 'human' : 'human-via-ai';
  const row: ContentLabelRow = { ...prev, suggestion: null, updatedAt: at, history: [...prev.history,
    { at, by: actor.principal, source, action: 'reject', from: prev.label, to: prev.suggestion.label, humanSaid }] };
  await deps.storage.putContentLabel(row);
  return { applied: false, label: prev.label, from: prev.label, source: prev.source, locked: prev.locked };
}

/** The effective label of each target: its row, or the policy's default. One query per kind+scope. */
export async function labelsFor(
  storage: Storage, policy: ClassificationPolicy, targets: ContentLabelTarget[],
): Promise<Map<string, { label: string; row: ContentLabelRow | null }>> {
  const groups = new Map<string, { kind: ContentLabelKind; scope: string; keys: string[] }>();
  for (const t of targets) {
    const g = `${t.kind}\u0000${t.scope}`;
    const cur = groups.get(g) ?? { kind: t.kind, scope: t.scope, keys: [] };
    cur.keys.push(t.key);
    groups.set(g, cur);
  }
  const out = new Map<string, { label: string; row: ContentLabelRow | null }>();
  for (const g of groups.values()) {
    const rows = await storage.getContentLabels(g.kind, g.scope, g.keys);
    const byKey = new Map(rows.map(r => [r.key, r]));
    for (const k of g.keys) {
      const row = byKey.get(k) ?? null;
      out.set(targetId({ kind: g.kind, scope: g.scope, key: k }), { label: row?.label ?? policy.defaultLabel, row });
    }
  }
  return out;
}

/** What a caller names as the content: a memory key, a stored file, or a row of a row space. */
export interface TargetInput {
  kind?: unknown;
  key?: unknown;
  organism_id?: unknown;
  ws?: unknown;
  space?: unknown;
  row_id?: unknown;
}

/** The label address of what the caller named. Personal content is always the caller's own. */
export function targetOf(actor: LabelActor, input: TargetInput): ContentLabelTarget {
  const s = (v: unknown, f: string) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 512) throw new ClassificationError('INVALID_INPUT', 400, `${f} is required.`);
    return v.trim();
  };
  const kind = input.kind ?? 'memory';
  if (kind === 'memory') return memoryTarget(actor.ownerGhii, s(input.key, 'key'));
  if (kind === 'file') return fileTarget(actor.ownerGhii, s(input.key, 'key'));
  if (kind === 'row') return rowTarget(s(input.organism_id, 'organism_id'), s(input.ws, 'ws'), s(input.space, 'space'), s(input.row_id, 'row_id'));
  throw new ClassificationError('INVALID_INPUT', 400, 'kind is memory, file or row.');
}

export interface LabelView {
  target: ContentLabelTarget;
  label: string;
  /** The label's own fields, from the policy that applies to this content. */
  labelDetail: ClassificationLabel | null;
  source: ContentLabelRow['source'];
  locked: boolean;
  suggestion: ContentLabelRow['suggestion'];
  history: ContentLabelRow['history'];
}

/** The label a piece of content carries, with its waiting suggestion and its last changes. */
export async function readContentLabel(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget): Promise<LabelView> {
  await assertMayLabel(deps, actor, target);
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const row = await deps.storage.getContentLabel(target);
  const label = row?.label ?? policy.defaultLabel;
  return {
    target, label, labelDetail: labelById(policy, label) ?? null, source: row?.source ?? 'default',
    locked: !!row?.locked, suggestion: row?.suggestion ?? null, history: (row?.history ?? []).slice(-10),
  };
}

/** The map key labelsFor answers under. */
export function targetId(t: ContentLabelTarget): string {
  return `${t.kind}\u0000${t.scope}\u0000${t.key}`;
}
