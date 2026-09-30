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
 *   - An AI relaying a person's own words passes them in `humanSaid`, verbatim. A raise (a label at
 *     least as strict on every field) then counts as the person's (source human-via-ai, locked) and
 *     the words stay on the record, whatever the AI mode, also over a label a person set. A lowering
 *     waits as a suggestion with why PERSON_APPROVES and the words on it, and only the person in
 *     their own session accepts it (decided 2026-09-30).
 *   - Who is an AI is decided from the credential (reader-kind.ts), never from what the caller says.
 *   - The policy's AI mode decides the rest: off refuses an AI's label, suggest keeps it waiting for
 *     a person, auto applies a raise at or above the confidence threshold.
 *
 *   ONE LABEL PER DOCUMENT (decided 2026-09-30). A workspace document or an organism record is
 *   stored under several keys (bare, `.draft`, `.latest`, `.version.N`); memoryTarget gives them all
 *   the document's address (documentKeyOf), so a label on any copy is the document's. A label a copy
 *   carried under its own key before this reads into the document's label, the strictest one wins,
 *   and the next write folds those rows into the document's row (currentRow).
 *
 *   WHO MAY LABEL WHAT: personal content only by its owner or the owner's own agents and apps, and
 *   the owner names an agent's or app's namespace to label what it holds (targetOf `owner`).
 *   Organism content by whoever the organism namespace rule lets read it (to read the label) or
 *   write it (to set or review one): a workspace's content needs the workspace read decision, the
 *   organism's meta namespace its creator or an admin, an ecosystem app its data-area grant. And
 *   nobody outside the reader audience of the label content carries now reads or moves it.
 *   AN APP DOES WHAT IT IS BUILT FOR (decided 2026-09-30). An app credential lowers a label without a
 *   justification being demanded, and accepts a suggestion that lowers one; each such lowering is
 *   recorded in the exceptions list (exceptions.ts) with the app and the act as its reason. An AI
 *   credential keeps every refusal it had.
 * @structure ClassificationError · LabelActor · labelActorOf() · isOwnerPerson() · isAppActor() ·
 *   appNameOf() · documentKeyOf() · memoryTarget() · labelAddressOf() · documentContentKeys() ·
 *   fileTarget() · rowTarget() · setLabel() · reviewLabel() · labelsFor() · targetOf() ·
 *   readContentLabel() · labelForException()
 * @usage
 *   const actor = labelActorOf(req.auth!, config.nodeId);
 *   await setLabel({ storage, config }, actor, memoryTarget(owner, key), { label: 'luottamuksellinen' });
 * @version-history
 *   v1.7.0 — 2026-09-30 — TARGET-082 second review. An AI does not reject a suggestion that would
 *     protect the content more, even with relayed words (S6); the accept refusal names the Data
 *     Wallet; LabelActor carries the credential's scopes for the node level (S1).
 *   v1.6.0 — 2026-09-30 — Decided by Jouni 2026-09-30. An app's lowering (set or an accepted
 *     suggestion) is not refused for a missing justification and is recorded as an automatic
 *     exception; LabelActor carries the app id; labelForException() for a person's exception.
 *   v1.5.0 — 2026-09-30 — Decided by Jouni 2026-09-30. humanSaid from an AI raises at once and
 *     otherwise waits for the person (PERSON_APPROVES), which an AI cannot accept even with the
 *     person's words. One label per document: every copy's key maps to the document's address, a
 *     copy's own older label reads into it (strictest wins) and is folded away on the next write.
 *   v1.4.0 — 2026-09-29 — TARGET-082 review. A row, its audit row and its change event name the
 *     owner GHII even for content an agent or an app holds, and targetOf takes `owner` for such a
 *     namespace (finding 1). "Lower" compares what the labels do, field by field, not the rank alone
 *     (finding 3). A row keeps its last 50 changes, and the same waiting suggestion is not written
 *     again (finding 7). Organism content follows the workspace read and write rules and the
 *     current label's reader audience (finding 8).
 *   v1.3.0 — 2026-09-29 — V5: every label write emits the change domain `classification` (the
 *     owner's own for personal content, every stream for an organism's), so REST, MCP, the connector
 *     and extensions announce it from this one place.
 *   v1.2.0 — 2026-09-29 — V4: a label change goes to the audit log, and nobody sets a label whose
 *     reader audience leaves them out (AUDIENCE_LOCKOUT).
 *   v1.1.0 — 2026-09-29 — V2: targetOf and readContentLabel, shared by the REST route and the MCP tool.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ContentLabelRow, ContentLabelTarget, ContentLabelKind } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isSameOwner, isForeignPrincipal, callerPrincipal, localAccountOf, isGEAI, ownerGhiiOf } from '../../utils/gaii.js';
import { agentBarred } from '../organism-agent-access.js';
import { decideWorkspaceRead } from '../workspace-access.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { ecoMayReadKey, ecoMayWriteKey } from '../ecosystem-access.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './defaults.js';
import { weakerFields } from './levels.js';
import { ownerOfScope, policyFor, scopeOrganism, scopeOwner } from './policy.js';
import { readerKindOf } from './reader-kind.js';
import { audienceCheck } from './audience.js';
import { recordClassificationAudit } from './audit.js';
import { emitChange } from '../event-bus.js';
import { recordAutoException } from './exceptions.js';

/** How many changes a label row keeps; the oldest go first (TARGET-082 review finding 7). */
const HISTORY_MAX = 50;

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
  /** The node's own classifier (classifier.ts): it labels any scope, as a rule does, but an AI's
   *  label still follows the AI rules. No request can set it. */
  nodeOwn?: boolean;
  /** The credential's roles, for the organism namespace rule. Absent: read from `kind`. */
  roles?: string[];
  /** An app credential's app id (`owner/file.html`), named in the exceptions it records. */
  app?: string;
  /** The credential's granted words, for the node level: something acting for the operator passes
   *  only on "operator:admin" (askOperator in services/operator-principal.ts). */
  scopes?: string[];
}

/** The actor behind a request. A visitor from another node labels nothing here. */
export function labelActorOf(
  auth: { sub: string; owner: string; roles: string[]; scopes?: string[]; federated?: boolean; anonymous?: boolean; app_grant?: string; app?: string },
  nodeId: string,
): LabelActor {
  if (isForeignPrincipal(auth)) throw new ClassificationError('FOREIGN_VISITOR', 403, 'A visitor from another node labels nothing here.');
  const kind = readerKindOf(auth);
  if (kind === 'anonymous') throw new ClassificationError('AUTH_REQUIRED', 401, 'Sign in to label content.');
  const ownerGhii = auth.owner.includes('@') ? auth.owner : `${auth.owner}@${nodeId}`;
  return {
    principal: callerPrincipal(auth, nodeId), ownerGhii, ownerName: localAccountOf(ownerGhii), kind, roles: [...auth.roles],
    scopes: [...(auth.scopes ?? [])],
    ...(auth.roles.includes('app') && auth.app ? { app: auth.app } : {}),
  };
}

/** The suffixes a workspace document or an organism record is stored under besides its bare key. */
const COPY_SUFFIX = /^(organism\.[^.]+\.(.+))\.(?:draft|latest|version\.\d+)$/;
const COPY_ROLE = /^(?:draft|latest|version\.\d+)$/;

/**
 * The one label address of a workspace document or an organism record (decided 2026-09-30): its key
 * without the `.draft`, `.latest` or `.version.N` suffix the workspace stores its copies under
 * (services/workspace-write.ts deleteWorkspaceInstance names the same family). A label set on any
 * copy is the document's, so publishing never makes an unlabelled copy. The address needs a
 * namespace and an instance before the suffix: `organism.<id>.w.<ws>.<ns>.<instance>` in a
 * workspace, `organism.<id>.<ns>.<instance>` outside one. Any other key is its own address.
 */
export function documentKeyOf(key: string): string {
  const m = COPY_SUFFIX.exec(key);
  if (!m) return key;
  const rest = m[2]!.split('.');
  return rest.length >= (rest[0] === 'w' ? 4 : 2) ? m[1]! : key;
}

/** A memory key's label address: an organism key belongs to the organism, whoever wrote it, and a
 *  document's copies share the document's address (documentKeyOf). */
export function memoryTarget(ownerGaii: string, key: string): ContentLabelTarget {
  if (key.startsWith('organism.')) {
    const id = key.split('.')[1];
    if (id) return { kind: 'memory', scope: `organism:${id}`, key: documentKeyOf(key) };
  }
  return { kind: 'memory', scope: ownerGaii, key };
}

/**
 * A target as its label address: an organism memory key named by one of its copies' keys (a queued
 * item or a caller that built the target itself) is moved to the document's address.
 */
export function labelAddressOf(t: ContentLabelTarget): ContentLabelTarget {
  if (t.kind !== 'memory' || !scopeOrganism(t.scope)) return t;
  const key = documentKeyOf(t.key);
  return key === t.key ? t : { ...t, key };
}

/**
 * The memory keys a document's current content is stored under (the bare key, `.latest`, `.draft`),
 * for a reader of its text such as the classifier's queue; any other key is only itself.
 */
export function documentContentKeys(key: string): string[] {
  const doc = documentKeyOf(key);
  if (!doc.startsWith('organism.') || documentKeyOf(`${doc}.latest`) !== doc) return [key];
  return [doc, `${doc}.latest`, `${doc}.draft`];
}

/**
 * The key prefix under which a document address's copies carried labels of their own before a
 * document had one address, or null when the target is not a document address.
 */
function copyPrefixOf(t: ContentLabelTarget): string | null {
  if (t.kind !== 'memory' || !scopeOrganism(t.scope)) return null;
  return documentKeyOf(`${t.key}.latest`) === t.key ? `${t.key}.` : null;
}

/** Is this stored row a label a copy of the document at `prefix` carried under its own key? */
const isCopyRow = (row: ContentLabelRow, prefix: string) => row.key.startsWith(prefix) && COPY_ROLE.test(row.key.slice(prefix.length));

/** The strictest of a document's rows: the highest rank in the policy, a person's label on a tie. */
function strictestRow(policy: ClassificationPolicy, rows: ContentLabelRow[]): ContentLabelRow | null {
  let best: ContentLabelRow | null = null;
  const rank = (r: ContentLabelRow) => labelById(policy, r.label)?.rank ?? -1;
  for (const r of rows) {
    if (!best || rank(r) > rank(best) || (rank(r) === rank(best) && r.locked && !best.locked)) best = r;
  }
  return best;
}

/**
 * The row a target's label is read from and written over. For a document address it is the
 * strictest of the document's own row and the rows its copies carried under their own keys before
 * (so nothing already labelled reads weaker), moved to the document address; `stale` names the copy
 * rows, which the next write folds away so the document keeps one row.
 */
async function currentRow(storage: Storage, policy: ClassificationPolicy, target: ContentLabelTarget): Promise<{ row: ContentLabelRow | undefined; stale: ContentLabelTarget[] }> {
  const own = await storage.getContentLabel(target);
  const prefix = copyPrefixOf(target);
  if (!prefix) return { row: own, stale: [] };
  const copies = (await storage.getContentLabelsUnder(target.kind, target.scope, [prefix])).filter(r => isCopyRow(r, prefix));
  if (!copies.length) return { row: own, stale: [] };
  const best = strictestRow(policy, own ? [own, ...copies] : copies)!;
  const suggestion = best.suggestion ?? [own, ...copies].find(r => r?.suggestion)?.suggestion ?? null;
  const row: ContentLabelRow = { ...best, id: own?.id ?? randomUUID(), key: target.key, suggestion, history: [...best.history] };
  return { row, stale: copies.map(r => ({ kind: r.kind, scope: r.scope, key: r.key })) };
}

export function fileTarget(ownerGaii: string, storageKey: string): ContentLabelTarget {
  return { kind: 'file', scope: ownerGaii, key: storageKey };
}

export function rowTarget(organismId: string, ws: string, space: string, rowId: string): ContentLabelTarget {
  return { kind: 'row', scope: `organism:${organismId}`, key: `${ws}/${space}/${rowId}` };
}

/** The credential's roles, or the ones its kind implies when the actor was built without them. */
function rolesOf(actor: LabelActor): string[] {
  return actor.roles ?? (actor.kind === 'human' ? ['owner'] : ['agent']);
}

/** Is this the account holder in their own session (not an agent, an app or an ecosystem app)? */
export function isOwnerPerson(actor: LabelActor): boolean {
  const roles = rolesOf(actor);
  return actor.kind === 'human' && roles.includes('owner') && !roles.some(r => r === 'agent' || r === 'ecosystem' || r === 'app');
}

/**
 * Is this an app credential (a hosted app's grant, read as the person's screen)? An app does what it
 * is built for, and an act against a label is recorded as an exception rather than refused (decided
 * 2026-09-30). An AI credential (agent, ecosystem app, PAT, unattended run) never is one.
 */
export function isAppActor(actor: LabelActor): boolean {
  return actor.kind === 'human' && rolesOf(actor).includes('app');
}

/** How an app is named in the exceptions it records. */
export const appNameOf = (actor: LabelActor): string => actor.app ?? actor.principal;

/**
 * The memory key the organism namespace rule reads for a target, and its workspace. A row lives in
 * its workspace's row space (`ws/space/rowId`), so its key is the one a memory record there has.
 */
function organismKeyOf(target: ContentLabelTarget, orgId: string): { key: string; ws: string | null } {
  if (target.kind === 'row') {
    const [ws, ...rest] = target.key.split('/');
    return { key: [`organism.${orgId}.w.${ws}`, ...rest.filter(Boolean)].join('.'), ws: ws || null };
  }
  const m = /^organism\.[^.]+\.w\.([^.]+)\./.exec(target.key);
  return { key: target.key, ws: m ? m[1] : null };
}

const NOT_YOURS = 'No such content, or it is not yours to label.';
const NOT_A_READER = 'No such content, or you may not read the workspace or the part of the organism it belongs to.';

/**
 * May this actor read (`read`) or set and review (`write`) the label of this content?
 *
 * Personal content: its owner and the owner's own agents and apps. Organism content (TARGET-082
 * review finding 8): the organism namespace rule decides, as it does for the content itself. A
 * workspace's content needs the workspace READ decision (decideWorkspaceRead) to read its label, and
 * that plus the namespace rule's WRITE answer to change it; content outside a workspace needs the
 * rule's read or write answer (the organism's meta namespace is written by its creator and admins).
 * An ecosystem app also needs its owner-granted data area for the key (ecoMayReadKey, ecoMayWriteKey).
 * Every refusal is the same 404, so it does not say whether the content exists.
 */
async function assertMayLabel(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, mode: 'read' | 'write'): Promise<void> {
  if (actor.kind === 'rule' || actor.nodeOwn) return;
  const owner = scopeOwner(target.scope);
  if (owner) {
    if (isSameOwner(owner, actor.ownerGhii)) return;
    throw new ClassificationError('NOT_FOUND', 404, NOT_YOURS);
  }
  const orgId = scopeOrganism(target.scope) as string;
  const organism = await deps.storage.getOrganism(orgId);
  if (!organism || !actor.ownerName || agentBarred(organism, actor.principal)) throw new ClassificationError('NOT_FOUND', 404, NOT_A_READER);
  const roles = rolesOf(actor);
  // The identity the content is stored and decided under: a hosted app's grant acts in its owner's
  // namespace (resolveIdentity), whatever principal it is recorded as.
  const accessId = roles.includes('app') ? actor.ownerGhii : actor.principal;
  // The access functions read `consentEnabled` from the full node config the routes pass; a caller
  // holding less reads it as off, which refuses rather than admits.
  const config = deps.config as AimeatConfig;
  const { key, ws } = organismKeyOf(target, orgId);
  if (ws) {
    // An organism's creator or admin manages every workspace in it, one without a manifest too
    // (where the read decision says no to everyone); an ecosystem app still needs its grant below.
    const read = await decideWorkspaceRead(deps.storage, config, organism, accessId, actor.ownerName, accessId, ws);
    if (!read.canRead && !read.manager) throw new ClassificationError('NOT_FOUND', 404, NOT_A_READER);
  }
  const caller = { principal: accessId, owner: actor.ownerName, roles };
  if ((!ws || mode === 'write') && await checkOrganismNamespaceAccess({ storage: deps.storage, config }, caller, key, mode)) {
    throw new ClassificationError('NOT_FOUND', 404, NOT_A_READER);
  }
  // By the role, or by the principal whatever roles the caller built the actor with (the MCP tool
  // names every caller an agent). A hosted app's grant is recorded as a GEAI too, but it is not an
  // AI (reader-kind.ts) and holds no data-area grant.
  const ecosystem = roles.includes('ecosystem') || (actor.kind === 'ai' && isGEAI(actor.principal));
  if (ecosystem && !(await (mode === 'write' ? ecoMayWriteKey : ecoMayReadKey)(deps.storage, actor.principal, key))) {
    throw new ClassificationError('NOT_FOUND', 404, NOT_A_READER);
  }
}

/**
 * The actor must be inside the reader audience of the label content carries NOW to read or change
 * that label (finding 8): someone the label hides the content from does not learn or move its label.
 * The owner of personal content is always inside (audience.ts). A rule and the node's own classifier
 * have no reader to check.
 */
async function assertInsideCurrent(deps: ClassificationDeps, actor: LabelActor, target: ContentLabelTarget, current: ClassificationLabel | undefined): Promise<void> {
  if (actor.kind === 'rule' || actor.nodeOwn || !current?.audience) return;
  if (await audienceCheck(deps.storage, { owner: actor.ownerGhii, ownerName: actor.ownerName })(current.audience, target.scope)) return;
  throw new ClassificationError('NOT_FOUND', 404, NOT_A_READER);
}

/** Add one change to a row's history, keeping the last HISTORY_MAX. */
function pushHistory(row: ContentLabelRow, event: ContentLabelRow['history'][number]): void {
  row.history.push(event);
  if (row.history.length > HISTORY_MAX) row.history = row.history.slice(-HISTORY_MAX);
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
  /** Set when the change waits for a person: HUMAN_LABEL, CANNOT_LOWER, AI_SUGGESTS, BELOW_THRESHOLD,
   *  PERSON_APPROVES (an AI relayed a person's words that lower the label or change a person's). */
  pending?: string;
}

function blankRow(target: ContentLabelTarget, policy: ClassificationPolicy, at: string, by: string): ContentLabelRow {
  return {
    ...target, id: randomUUID(), ownerGaii: ownerOfScope(target.scope), label: policy.defaultLabel, source: 'default',
    locked: false, suggestion: null, justification: null, humanSaid: null, history: [], setBy: by, updatedAt: at,
  };
}

/**
 * Store a label row and say so on the change bus: the Data Wallet and the admin view listen on
 * `classification`. Personal content tells only its owner's streams; an organism's tells every
 * stream, as the organism views are told.
 */
async function putLabel(storage: Storage, row: ContentLabelRow, stale: readonly ContentLabelTarget[] = []): Promise<void> {
  await storage.putContentLabel(row);
  // The rows a document's copies carried under their own keys are folded into the document's row
  // (currentRow), so they go once it is stored: the document keeps one row, and its label.
  for (const t of stale) await storage.deleteContentLabel(t);
  emitChange('classification', ownerOfScope(row.scope) ?? undefined);
}

/**
 * Set a label, or leave a suggestion when the rules say an AI or a rule may not set it. `opts.via`
 * says the call is reviewLabel accepting a suggestion, which an app's exception names as a review.
 */
export async function setLabel(
  deps: ClassificationDeps, actor: LabelActor, named: ContentLabelTarget, input: SetLabelInput,
  opts: { via?: 'review' } = {},
): Promise<SetLabelResult> {
  const target = labelAddressOf(named);
  const justification = trimmed(input.justification, 'justification', 2000);
  const humanSaid = trimmed(input.humanSaid, 'humanSaid', 2000);
  const reason = trimmed(input.reason, 'reason', 1000);
  const confidence = typeof input.confidence === 'number' && isFinite(input.confidence)
    ? Math.min(Math.max(input.confidence, 0), 1) : undefined;
  if (actor.kind === 'rule' && humanSaid) throw new ClassificationError('INVALID_INPUT', 400, 'A detection rule has no person to quote.');

  await assertMayLabel(deps, actor, target, 'write');
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const next = activeLabel(policy, input.label);
  const { row: prev, stale } = await currentRow(deps.storage, policy, target);
  const fromId = prev?.label ?? policy.defaultLabel;
  const from = labelById(policy, fromId);
  await assertInsideCurrent(deps, actor, target, from);
  // Lower is what content GETS, not the rank alone (TARGET-082 review finding 3): a label of a
  // higher rank that protects the content less on any field is a lowering too, so an AI or a rule
  // only suggests it, and a person moving from a label that asks for a reason gives one.
  const lowering = !!from && (next.rank < from.rank || weakerFields(next, from).length > 0);
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const row: ContentLabelRow = prev ? { ...prev, history: [...prev.history] } : blankRow(target, policy, at, actor.principal);
  // Whoever sets a label with a reader audience must be inside it (spec §4.1): nobody locks
  // themselves out of their own content. A rule is the policy's own and has no self to lock out.
  // The node's own classifier (nodeOwn) has no self either: its label waits as a suggestion.
  if (actor.kind !== 'rule' && !actor.nodeOwn && next.audience
    && !(await audienceCheck(deps.storage, { owner: actor.ownerGhii, ownerName: actor.ownerName })(next.audience, target.scope))) {
    throw new ClassificationError('AUDIENCE_LOCKOUT', 400,
      `"${next.name.en}" limits who may read the content, and you are not among them, so this would lock you out. Add yourself to the label's audience first, or pick another label.`);
  }
  const changed = (source: ContentLabelRow['source']) => recordClassificationAudit({
    scope: target.scope, ownerGaii: ownerOfScope(target.scope), kind: target.kind, key: target.key, label: next.id,
    reader: actor.principal, readerKind: actor.kind === 'rule' ? 'system' : actor.kind, action: 'changed', purpose: `${fromId} → ${next.id} (${source})`,
  });

  // An AI relaying a person's words (decided 2026-09-30, "humanSaid saa nostaa luokitusta"): a raise
  // applies as theirs, also over a label a person set, since tightening gives nothing away; a
  // lowering waits for the person in their own session (PERSON_APPROVES).
  if (actor.kind === 'ai' && humanSaid && lowering) {
    if (next.id === fromId) {
      return { applied: false, label: fromId, from: fromId, source: prev?.source ?? 'default', locked: !!prev?.locked };
    }
    const pending = 'PERSON_APPROVES';
    const s = prev?.suggestion;
    if (s && s.why === pending && s.label === next.id && s.humanSaid === humanSaid && (s.justification ?? null) === justification) {
      return { applied: false, label: fromId, from: fromId, source: prev!.source, locked: prev!.locked, pending };
    }
    row.suggestion = {
      label: next.id, by: actor.principal, at, source: 'ai', reason: humanSaid, why: pending, humanSaid,
      ...(justification ? { justification } : {}),
    };
    row.updatedAt = at;
    pushHistory(row, { at, by: actor.principal, source: 'human-via-ai', action: 'suggest', from: fromId, to: next.id, justification, humanSaid });
    await putLabel(deps.storage, row, stale);
    return { applied: false, label: fromId, from: fromId, source: row.source, locked: row.locked, pending };
  }

  const asPerson = actor.kind === 'human' || (actor.kind === 'ai' && !!humanSaid);
  // An app lowers without being refused, and the lowering is recorded as an exception (decided
  // 2026-09-30: "jos se tekee jotain classificationin 'vastaisesti' niin siitä vain merkataan exception").
  const app = isAppActor(actor);
  if (asPerson) {
    if (lowering && from?.lowerNeedsJustification && !justification && !app) {
      throw new ClassificationError('JUSTIFICATION_REQUIRED', 400,
        `Lowering from "${from.name.en}" to "${next.name.en}" needs a justification: why this content is less sensitive than its label says.`);
    }
    const source = actor.kind === 'human' ? 'human' : 'human-via-ai';
    row.label = next.id; row.source = source; row.locked = true; row.suggestion = null;
    row.justification = justification; row.humanSaid = humanSaid; row.setBy = actor.principal; row.updatedAt = at;
    pushHistory(row, { at, by: actor.principal, source, action: 'set', from: fromId, to: next.id, justification, humanSaid });
    await putLabel(deps.storage, row, stale);
    if (next.id !== fromId) changed(source);
    if (app && lowering && next.id !== fromId) {
      const act = opts.via === 'review' ? `accepted the suggestion lowering ${fromId} → ${next.id}` : `lowered ${fromId} → ${next.id}`;
      await recordAutoException(deps, {
        by: actor.principal, app: actor.app ?? null, scope: target.scope, target: { kind: target.kind, key: target.key }, label: next.id,
        action: opts.via === 'review' ? 'review' : 'lower', reason: `app ${appNameOf(actor)} ${act}${justification ? `: ${justification}` : ''}`,
      });
    }
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
    pushHistory(row, { at, by: actor.principal, source, action: 'set', from: fromId, to: next.id, confidence, reason: reason ?? undefined });
    await putLabel(deps.storage, row, stale);
    changed(source);
    return { applied: true, label: next.id, from: fromId, source, locked: false };
  }
  // The same suggestion from the same kind of source already waits: nothing new to say, so nothing
  // is written. A rule matching a locked label on every write used to add a row write and a
  // history entry each time (finding 7).
  if (prev?.suggestion && prev.suggestion.label === next.id && prev.suggestion.source === source) {
    return { applied: false, label: fromId, from: fromId, source: prev.source, locked: prev.locked, pending };
  }
  row.suggestion = { label: next.id, by: actor.principal, at, source, confidence, reason: reason ?? undefined, why: pending };
  row.updatedAt = at;
  pushHistory(row, { at, by: actor.principal, source, action: 'suggest', from: fromId, to: next.id, confidence, reason: reason ?? undefined });
  await putLabel(deps.storage, row, stale);
  return { applied: false, label: fromId, from: fromId, source: row.source, locked: row.locked, pending };
}

/** A person accepts or rejects the waiting suggestion. Accepting is the person setting the label. */
export async function reviewLabel(
  deps: ClassificationDeps, actor: LabelActor, named: ContentLabelTarget,
  input: { decision: 'accept' | 'reject'; justification?: string | null; humanSaid?: string | null },
): Promise<SetLabelResult> {
  const target = labelAddressOf(named);
  const humanSaid = trimmed(input.humanSaid, 'humanSaid', 2000);
  if (actor.kind === 'rule' || (actor.kind === 'ai' && !humanSaid)) {
    throw new ClassificationError('PERSON_REQUIRED', 403, 'A person reviews a suggestion. An AI relays their decision with their own words in humanSaid.');
  }
  await assertMayLabel(deps, actor, target, 'write');
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const { row: prev, stale } = await currentRow(deps.storage, policy, target);
  if (prev) await assertInsideCurrent(deps, actor, target, labelById(policy, prev.label));
  if (!prev?.suggestion) throw new ClassificationError('NO_SUGGESTION', 404, 'Nothing is waiting for a review on this content.');
  if (input.decision === 'accept') {
    // A lowering that an AI relayed waits for the person in their own session: an AI accepting it,
    // even with their words, is the same relay again.
    if (prev.suggestion.why === 'PERSON_APPROVES' && actor.kind !== 'human') {
      throw new ClassificationError('PERSON_REQUIRED', 403,
        'This change lowers the classification, so the person accepts it signed in themselves. Ask them to accept it in their Data Wallet, under the suggestions that wait for them.');
    }
    return setLabel(deps, actor, target, {
      label: prev.suggestion.label, justification: input.justification ?? prev.suggestion.justification ?? null, humanSaid,
    }, { via: 'review' });
  }
  // Rejecting a suggestion that would protect the content more gives that protection away, so an AI
  // does not do it with relayed words; the person rejects it signed in themselves (TARGET-082 second
  // review, S6). A suggestion to lower may be rejected through an AI: that gives nothing away.
  const now = labelById(policy, prev.label);
  const suggested = labelById(policy, prev.suggestion.label);
  const raises = !!now && !!suggested && (suggested.rank > now.rank || weakerFields(now, suggested).length > 0);
  if (raises && actor.kind !== 'human') {
    throw new ClassificationError('PERSON_REQUIRED', 403,
      'This suggestion would protect the content more, so the person rejects it signed in themselves. Ask them to review it in their Data Wallet, under the suggestions that wait for them.');
  }
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const source = actor.kind === 'human' ? 'human' : 'human-via-ai';
  const row: ContentLabelRow = { ...prev, suggestion: null, updatedAt: at, history: [...prev.history] };
  pushHistory(row, { at, by: actor.principal, source, action: 'reject', from: prev.label, to: prev.suggestion.label, humanSaid });
  await putLabel(deps.storage, row, stale);
  return { applied: false, label: prev.label, from: prev.label, source: prev.source, locked: prev.locked };
}

/**
 * The effective label of each target: its row, or the policy's default. One query per kind+scope,
 * and one more for an organism's document addresses: a document reads as the strictest of its own
 * row and the rows its copies carried under their own keys before (currentRow).
 */
export async function labelsFor(
  storage: Storage, policy: ClassificationPolicy, targets: ContentLabelTarget[],
): Promise<Map<string, { label: string; row: ContentLabelRow | null }>> {
  // `keys` are the caller's keys; each is read at its label address (labelAddressOf) and answered
  // under the caller's own target id.
  const groups = new Map<string, { kind: ContentLabelKind; scope: string; keys: string[] }>();
  for (const t of targets) {
    const g = `${t.kind}\u0000${t.scope}`;
    const cur = groups.get(g) ?? { kind: t.kind, scope: t.scope, keys: [] };
    cur.keys.push(t.key);
    groups.set(g, cur);
  }
  const out = new Map<string, { label: string; row: ContentLabelRow | null }>();
  for (const g of groups.values()) {
    const addr = (k: string) => labelAddressOf({ kind: g.kind, scope: g.scope, key: k });
    const rows = await storage.getContentLabels(g.kind, g.scope, g.keys.map(k => addr(k).key));
    const byKey = new Map(rows.map(r => [r.key, r]));
    const prefixes = new Map<string, string>();
    for (const k of g.keys) {
      const p = copyPrefixOf(addr(k));
      if (p) prefixes.set(k, p);
    }
    const copyRows = prefixes.size ? await storage.getContentLabelsUnder(g.kind, g.scope, [...new Set(prefixes.values())]) : [];
    for (const k of g.keys) {
      const own = byKey.get(addr(k).key) ?? null;
      const p = prefixes.get(k);
      const copies = p ? copyRows.filter(r => isCopyRow(r, p)) : [];
      const row = copies.length ? strictestRow(policy, own ? [own, ...copies] : copies) : own;
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
  /**
   * For memory and files: whose namespace holds it, when that is not the owner's own. The owner
   * names one of their agents (`claude#alice@node`) or ecosystem apps (`eco:drum#alice@node`) to
   * label what it holds; an agent or an app names only itself.
   */
  owner?: unknown;
}

/**
 * The namespace a memory key or a file is held in: the owner's own, or one the input names that
 * belongs to the same owner (finding 1). Anything else is refused as absent content.
 */
function holderOf(actor: LabelActor, owner: unknown): string {
  if (owner === undefined || owner === null || owner === '') return actor.ownerGhii;
  const named = typeof owner === 'string' ? owner.trim() : '';
  const sameOwner = !!named && named.length <= 512 && !/\s/.test(named) && !named.startsWith('organism:')
    && isSameOwner(named, actor.ownerGhii) && ownerGhiiOf(named) === actor.ownerGhii;
  // The account holder reaches every namespace of theirs; an agent or an app reaches its own and
  // the owner's, never a sibling's (the owner sees what their agents hold, not the other way round).
  if (sameOwner && (isOwnerPerson(actor) || named === actor.principal || named === actor.ownerGhii)) return named;
  throw new ClassificationError('NOT_FOUND', 404, NOT_YOURS);
}

/** The label address of what the caller named. Personal content is the caller's owner's, or one of theirs. */
export function targetOf(actor: LabelActor, input: TargetInput): ContentLabelTarget {
  const s = (v: unknown, f: string) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 512) throw new ClassificationError('INVALID_INPUT', 400, `${f} is required.`);
    return v.trim();
  };
  const kind = input.kind ?? 'memory';
  if (kind === 'memory') return memoryTarget(holderOf(actor, input.owner), s(input.key, 'key'));
  if (kind === 'file') return fileTarget(holderOf(actor, input.owner), s(input.key, 'key'));
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
export async function readContentLabel(deps: ClassificationDeps, actor: LabelActor, named: ContentLabelTarget): Promise<LabelView> {
  const target = labelAddressOf(named);
  await assertMayLabel(deps, actor, target, 'read');
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const { row } = await currentRow(deps.storage, policy, target);
  const label = row?.label ?? policy.defaultLabel;
  await assertInsideCurrent(deps, actor, target, labelById(policy, label));
  return {
    target, label, labelDetail: labelById(policy, label) ?? null, source: row?.source ?? 'default',
    locked: !!row?.locked, suggestion: row?.suggestion ?? null, history: (row?.history ?? []).slice(-10),
  };
}

/**
 * The label address and current label of content an exception is made for. Whoever makes one must be
 * allowed to change the label (the same test as setLabel) and inside the reader audience of the label
 * the content carries now: an exception moves content past its label, as a lowering would.
 */
export async function labelForException(
  deps: ClassificationDeps, actor: LabelActor, named: ContentLabelTarget,
): Promise<{ target: ContentLabelTarget; label: string; labelDetail: ClassificationLabel | null }> {
  const target = labelAddressOf(named);
  await assertMayLabel(deps, actor, target, 'write');
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const { row } = await currentRow(deps.storage, policy, target);
  const label = row?.label ?? policy.defaultLabel;
  const labelDetail = labelById(policy, label) ?? null;
  await assertInsideCurrent(deps, actor, target, labelDetail ?? undefined);
  return { target, label, labelDetail };
}

/** The map key labelsFor answers under. */
export function targetId(t: ContentLabelTarget): string {
  return `${t.kind}\u0000${t.scope}\u0000${t.key}`;
}
