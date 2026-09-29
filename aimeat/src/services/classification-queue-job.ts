/**
 * @file src/services/classification-queue-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hourly core job `core:classification-queue` (TARGET-082 V3, spec §7): works
 *   through the Content Classifier's queues (one per owner or organism under system@<node>, see
 *   classifier.ts) within the day's caps. Items wait there when a cap was reached, when a model call
 *   failed, when a scan queued a prefix, many keys or organism content (services/classification/
 *   scan.ts), or when the write hook had more writes than it holds in process.
 *
 *   OFF. With config.classificationMode 'off' the job returns before it reads anything.
 *
 *   WHAT IT LOADS. The item's current text, read by the node for the node's own classifier, which
 *   checks the label's useForAi itself before any model reads it:
 *   - memory in a personal scope: the record at (scope, key);
 *   - memory in an organism scope `organism:<id>`: the freshest record at the exact key, whichever
 *     member identity holds it (services/workspace-write.ts findWorkspaceRecord), and only when the
 *     key is under `organism.<id>.`;
 *   - a stored file or a workspace row: not loaded yet. The loader answers null, and drainQueue
 *     drops such an item from the queue. File and row text comes with V5.
 *   A record that is gone also answers null and leaves the queue.
 *
 *   It also sets the write hook's classifier and its overflow queue at boot (installWriteClassifier),
 *   because both are the classifier's scheduled entry points and this file may import the
 *   classifier without a cycle.
 * @structure QUEUE_BATCH · installWriteClassifier() · queuedItemText() · runClassificationQueueJob()
 * @usage
 *   installWriteClassifier();
 *   scheduler.registerCoreHandler('classification-queue', () => runClassificationQueueJob(config, storage));
 * @version-history
 *   v1.1.0 — 2026-09-29 — The write hook also gets enqueue, for the writes past its in-process limit.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { classifyText, drainQueue, enqueue, type QueuedItem } from './classification/classifier.js';
import { scopeOrganism } from './classification/policy.js';
import { contentText, setWriteClassifier } from './classify-on-write.js';
import { findWorkspaceRecord } from './workspace-write.js';

/** How many queued items one run judges at most. */
export const QUEUE_BATCH = 200;

/**
 * Give the write hook (classify-on-write.ts) the classifier. At boot, from registerCoreHandlers:
 * the hook cannot import the classifier itself without closing an import cycle.
 */
export function installWriteClassifier(): void {
  setWriteClassifier(classifyText, enqueue);
}

/** The current text of a queued item, or null when it cannot be loaded (gone, a file or a row). */
export async function queuedItemText(storage: Storage, item: QueuedItem): Promise<string | null> {
  if (item.kind !== 'memory') return null;
  const orgId = scopeOrganism(item.scope);
  if (orgId) {
    if (!item.key.startsWith(`organism.${orgId}.`)) return null;
    const rec = await findWorkspaceRecord(storage, item.key);
    return rec ? contentText(rec.value) : null;
  }
  const rec = await storage.getMemory(item.scope, item.key);
  return rec ? contentText(rec.value) : null;
}

/** One run of the queue job. Answers null when classification is off and nothing was read. */
export async function runClassificationQueueJob(
  config: AimeatConfig, storage: Storage,
): Promise<{ done: number; waiting: number } | null> {
  if (config.classificationMode === 'off') return null;
  const out = await drainQueue({ storage, config }, item => queuedItemText(storage, item), QUEUE_BATCH);
  if (out.done > 0 || out.waiting > 0) {
    logger.info(`Classification queue: ${out.done} judged, ${out.waiting} still waiting`);
  }
  return out;
}
