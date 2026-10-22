/**
 * @file src/services/classification/scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classify on request (TARGET-082 V3, spec §7 (c)): a person or their AI names memory
 *   keys, or a key prefix, and the Content Classifier judges them. At most NOW_MAX named personal
 *   keys are judged inside the request, because each can be a model call; the rest, a prefix, and
 *   organism content go to the queue in ONE batch (classifier.ts enqueue), which the hourly job works
 *   through within the day's caps. Every key is authorized first exactly as reading its label is
 *   (readContentLabel), so nobody classifies what they could not label; the check depends on the
 *   content's scope only, so it runs once per scope.
 *
 *   A prefix reads keys only, at most PREFIX_MAX of them, and queues each under the identity that
 *   holds it (the owner, or one of the owner's agents or apps), which is where the queue job reads
 *   its value.
 *
 *   WHAT A CALLER MAY JUDGE (secaudit 2026-10, v76). Only what it may read with owner_scope
 *   (services/owner-scope-read.ts): the owner in person, an app grant and a credential holding
 *   memory:read-as-owner judge the whole owner scope. Any other caller (an agent, an ecosystem app)
 *   judges its own records and the owner's and siblings' records whose visibility is owner, members
 *   or public. A named key whose record is hidden from it reads as its own copy, or as missing when
 *   it has none, exactly as GET /v1/memory/:key?owner_scope=true answers; a hidden key is queued, if
 *   at all, under the caller's own identity; a prefix leaves hidden keys out. Such an answer carries
 *   READ_AS_OWNER_NOTE in `note`: always when a prefix left something out, and for named keys
 *   whenever one is missing, so the note does not tell a hidden record from an absent one.
 * @structure ScanResult · scanContent()
 * @usage const out = await scanContent(deps, actor, { keys: ['notes.2026-09'] });
 * @version-history
 *   v1.3.0 — 2026-10-22 — The owner-scope read rule: a caller without memory:read-as-owner judges
 *     only the records it may read, and the answer names the permission (secaudit 2026-10, v76).
 *   v1.2.0 — 2026-09-30 — An organism item is authorized one by one, not once per scope: a member
 *     named a key of a workspace they cannot read after one they can, and it was queued for the
 *     classifier (TARGET-082 second review, S5).
 *   v1.1.0 — 2026-09-29 — Review fixes: at most 3 keys judged inside the request, the rest queued in
 *     one batch; authorization once per scope; a prefix queues each key under its holder.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { getOwnerScopeMemory, listOwnerScopeMemoryMeta } from '../owner-memory.js';
import { ClassificationError, memoryTarget, readContentLabel, type LabelActor } from './labels.js';
import { classifyText, enqueue, type ClassifyOutcome } from './classifier.js';
import { scopeOrganism } from './policy.js';
import { ownerScopeView, visibleToSameOwnerReader } from '../owner-scope-read.js';
import { labelActorReadsAll, READ_AS_OWNER_NOTE } from './owner-scope-labels.js';

/** Named personal keys judged inside the request; each may be a model call. */
const NOW_MAX = 3;
const PREFIX_MAX = 500;

export interface ScanResult {
  classified: Array<{ key: string } & ClassifyOutcome>;
  queued: string[];
  missing: string[];
  /** READ_AS_OWNER_NOTE, for a caller that does not read every record of its owner (see the header). */
  note?: string;
}

/** Judge up to 3 named personal keys now and queue the rest, or queue a whole prefix. */
export async function scanContent(
  deps: { storage: Storage; config: AimeatConfig }, actor: LabelActor,
  input: { keys?: unknown; prefix?: unknown },
): Promise<ScanResult> {
  if (deps.config.classificationMode === 'off') {
    throw new ClassificationError('CLASSIFICATION_OFF', 409, 'Classification is off on this server. The operator turns it on (AIMEAT_CLASSIFICATION).');
  }
  const out: ScanResult = { classified: [], queued: [], missing: [] };
  const name = actor.ownerName;
  if (!name) throw new ClassificationError('NOT_FOUND', 404, 'Only an account of this server scans its content.');

  // Does this caller read every record of its owner (owner-scope-labels.ts)? When not, it judges
  // only what GET /v1/memory?owner_scope=true would show it.
  const readsAll = labelActorReadsAll(actor);
  let targets: ContentLabelTarget[];
  const byPrefix = typeof input.prefix === 'string' && !!input.prefix.trim();
  if (byPrefix) {
    // Keys only: the prefix scan queues work and reads no value.
    const all = await listOwnerScopeMemoryMeta(deps.storage, deps.config.nodeId, name, { prefix: (input.prefix as string).trim() });
    const rows = ownerScopeView(all, actor.principal, readsAll);
    if (rows.length < all.length) out.note = READ_AS_OWNER_NOTE;
    const seen = new Set<string>();
    targets = [];
    for (const r of rows) {
      if (targets.length >= PREFIX_MAX) break;
      if (r.key.startsWith('classification.policy.') || seen.has(r.key)) continue;
      seen.add(r.key);
      targets.push(memoryTarget(r.ownerGaii, r.key));
    }
  } else if (Array.isArray(input.keys) && input.keys.every(k => typeof k === 'string' && k)) {
    targets = [...new Set(input.keys as string[])].slice(0, PREFIX_MAX).map(k => memoryTarget(actor.ownerGhii, k));
  } else {
    throw new ClassificationError('INVALID_INPUT', 400, 'Name keys (a list of memory keys) or a prefix.');
  }

  // Authorized once per personal scope, and once per item in an organism: there the answer depends
  // on the workspace and the item, so a key a member cannot read is refused rather than queued for
  // the classifier to read (TARGET-082 second review, S5).
  const checked = new Set<string>();
  for (const t of targets) {
    if (checked.has(t.scope)) continue;
    await readContentLabel(deps, actor, t);
    if (!scopeOrganism(t.scope)) checked.add(t.scope);
  }

  const toQueue: ContentLabelTarget[] = [];
  let inline = 0;
  for (const target of targets) {
    if (byPrefix || scopeOrganism(target.scope)) { toQueue.push(target); continue; }
    if (inline >= NOW_MAX) {
      // The queue job reads (scope, key) exactly. An owner record hidden from this caller is not
      // queued for it: the key is queued under the caller's own identity, its own copy or nothing.
      const owned = readsAll ? null : await deps.storage.getMemory(target.scope, target.key);
      toQueue.push(owned && !visibleToSameOwnerReader(owned, actor.principal) ? memoryTarget(actor.principal, target.key) : target);
      continue;
    }
    inline++;
    let rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, name, target.key);
    // A record hidden from this caller answers as an absent one; a hidden owner copy that shadowed
    // the caller's own record leaves the caller its own (routes/memory/key.ts does the same).
    if (rec && !ownerScopeView([rec], actor.principal, readsAll).length) {
      rec = await deps.storage.getMemory(actor.principal, target.key);
    }
    if (!rec) {
      out.missing.push(target.key);
      if (!readsAll) out.note = READ_AS_OWNER_NOTE;
      continue;
    }
    const text = typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value ?? '');
    out.classified.push({ key: target.key, ...(await classifyText(deps, memoryTarget(rec.ownerGaii, target.key), text)) });
  }
  if (toQueue.length) {
    await enqueue(deps, toQueue);
    out.queued.push(...toQueue.map(t => t.key));
  }
  return out;
}
