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
 * @structure ScanResult · scanContent()
 * @usage const out = await scanContent(deps, actor, { keys: ['notes.2026-09'] });
 * @version-history
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

/** Named personal keys judged inside the request; each may be a model call. */
const NOW_MAX = 3;
const PREFIX_MAX = 500;

export interface ScanResult {
  classified: Array<{ key: string } & ClassifyOutcome>;
  queued: string[];
  missing: string[];
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

  let targets: ContentLabelTarget[];
  const byPrefix = typeof input.prefix === 'string' && !!input.prefix.trim();
  if (byPrefix) {
    // Keys only: the prefix scan queues work and reads no value.
    const rows = await listOwnerScopeMemoryMeta(deps.storage, deps.config.nodeId, name, { prefix: (input.prefix as string).trim() });
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
    if (byPrefix || scopeOrganism(target.scope) || inline >= NOW_MAX) { toQueue.push(target); continue; }
    inline++;
    const rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, name, target.key);
    if (!rec) { out.missing.push(target.key); continue; }
    const text = typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value ?? '');
    out.classified.push({ key: target.key, ...(await classifyText(deps, memoryTarget(rec.ownerGaii, target.key), text)) });
  }
  if (toQueue.length) {
    await enqueue(deps, toQueue);
    out.queued.push(...toQueue.map(t => t.key));
  }
  return out;
}
