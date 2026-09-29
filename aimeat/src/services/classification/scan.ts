/**
 * @file src/services/classification/scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classify on request (TARGET-082 V3, spec §7 (c)): a person or their AI names memory
 *   keys, or a key prefix, and the Content Classifier judges them. A few named personal keys are
 *   judged at once; a prefix, many keys, and organism content go to the queue, which the hourly job
 *   works through within the day's caps. Every key is authorized first exactly as reading its label
 *   is (readContentLabel), so nobody classifies what they could not label.
 * @structure ScanResult · scanContent()
 * @usage const out = await scanContent(deps, actor, { keys: ['notes.2026-09'] });
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { getOwnerScopeMemory, listOwnerScopeMemoryMeta } from '../owner-memory.js';
import { ClassificationError, memoryTarget, readContentLabel, type LabelActor } from './labels.js';
import { classifyText, enqueue, type ClassifyOutcome } from './classifier.js';
import { scopeOrganism } from './policy.js';

const NOW_MAX = 20;
const PREFIX_MAX = 500;

export interface ScanResult {
  classified: Array<{ key: string } & ClassifyOutcome>;
  queued: string[];
  missing: string[];
}

/** Judge named keys now (up to 20 personal ones) and queue the rest, or queue a whole prefix. */
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

  let keys: string[];
  if (typeof input.prefix === 'string' && input.prefix.trim()) {
    // Keys only: the prefix scan queues work and reads no value.
    const rows = await listOwnerScopeMemoryMeta(deps.storage, deps.config.nodeId, name, { prefix: input.prefix.trim() });
    keys = [...new Set(rows.map(r => r.key))].filter(k => !k.startsWith('classification.policy.')).slice(0, PREFIX_MAX);
  } else if (Array.isArray(input.keys) && input.keys.every(k => typeof k === 'string' && k)) {
    keys = [...new Set(input.keys as string[])].slice(0, PREFIX_MAX);
  } else {
    throw new ClassificationError('INVALID_INPUT', 400, 'Name keys (a list of memory keys) or a prefix.');
  }
  const now = keys.length <= NOW_MAX && typeof input.prefix !== 'string';
  for (const key of keys) {
    const target = memoryTarget(actor.ownerGhii, key);
    await readContentLabel(deps, actor, target);
    if (!now || scopeOrganism(target.scope)) {
      await enqueue(deps, target);
      out.queued.push(key);
      continue;
    }
    const rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, name, key);
    if (!rec) { out.missing.push(key); continue; }
    const text = typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value ?? '');
    out.classified.push({ key, ...(await classifyText(deps, memoryTarget(rec.ownerGaii, key), text)) });
  }
  return out;
}
