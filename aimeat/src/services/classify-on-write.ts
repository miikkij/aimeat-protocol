/**
 * @file src/services/classify-on-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Write-time classification of memory records (TARGET-082 V3, spec §7 (a)). After a
 *   content write lands, the Content Classifier judges the stored value: the detection rules always
 *   (they cost no model call), the model only when the policy lists `memory` in classifier.onWrite.
 *
 *   OFF THE REQUEST PATH. classifyAfterWrite() only puts the write in an in-process list and returns;
 *   one worker, started with setImmediate, works through the list one item at a time. The write
 *   never awaits it, and a failure logs a warning with the key and never reaches the write.
 *
 *   ZERO COST WHEN OFF. With config.classificationMode 'off' the call returns before it schedules
 *   anything, so nothing is read. The mode is read synchronously from the config.
 *
 *   WHAT IS SKIPPED. Keys under `classification.` (the classifier's own records and the owner's
 *   policy), writes into the node's own `system@` namespace, and a value that holds no content
 *   (undefined, null, an empty string).
 *
 *   BOUNDED. The list holds at most MAX_PENDING writes. Past that a write is not judged in process:
 *   its address goes to the classifier's persistent queue instead (classifier.ts enqueue, origin
 *   'write', so the model runs there only where classifier.onWrite says), in batches of up to
 *   OVERFLOW_BATCH, and the hourly queue job judges it from the value stored then. Only when that
 *   buffer too is full (storage down) is a write dropped, with a warning. The value is held, not its
 *   text, so the text is made only when the item is judged.
 *
 *   ONE POLICY READ PER WRITE. The worker reads the switch and the policy once
 *   (reader.ts activePolicies) and hands the policy to the classifier, which then reads neither again.
 *
 *   THE CLASSIFIER IS SET AT BOOT (setWriteClassifier), as the workflow engine and the AI job service
 *   are. A static import would close an import cycle: the classifier reaches the decision service,
 *   which reaches the data map, which writes through memory-write.ts, which imports this file.
 *   services/core-jobs.ts registerCoreHandlers() sets it through classification-queue-job.ts. A
 *   process that never sets it (a CLI tool) classifies nothing on write and says so once.
 *
 *   The callers: services/memory-write.ts writeMemoryRecord, services/workspace-write.ts
 *   writeWorkspaceRecord, services/memory-batch-write.ts writeMemoryBatch, PUT and PATCH
 *   /v1/memory/:key, POST /v1/memory/copy, and the organism publish paths in routes/organisms/shared.ts.
 * @structure WriteClassifier · WriteQueue · MAX_TEXT · contentText() · setWriteClassifier() ·
 *   classifyAfterWrite() · flushWriteClassification() · pendingWriteClassifications()
 * @usage classifyAfterWrite({ storage, config }, record.ownerGaii, record.key, record.value);
 * @version-history
 *   v1.1.0 — 2026-09-29 — Review fixes: past MAX_PENDING a write goes to the persistent queue in
 *     batches instead of being dropped; the policy is read once and passed to the classifier.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ContentLabelTarget } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { ClassificationPolicy } from './classification/defaults.js';
import { memoryTarget } from './classification/labels.js';
import { activePolicies } from './classification/reader.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The shape of services/classification/classifier.ts classifyText, as far as this file uses it. */
export type WriteClassifier = (
  deps: Deps, target: ContentLabelTarget, text: string, opts: { useModel?: boolean; policy?: ClassificationPolicy },
) => Promise<unknown>;

/** The shape of services/classification/classifier.ts enqueue, as far as this file uses it. */
export type WriteQueue = (deps: Deps, targets: readonly ContentLabelTarget[], opts: { origin: 'write' }) => Promise<void>;

/** The most text the classifier is given from one value. */
export const MAX_TEXT = 200_000;
const MAX_PENDING = 2000;
/** Writes past MAX_PENDING wait here for the persistent queue, at most this many per enqueue. */
const OVERFLOW_BATCH = 500;
const MAX_OVERFLOW = 20_000;
// The reserved prefix only (utils/reserved-keys.ts): an app's own `classification.*` data is user
// data and is classified like any other.
const RESERVED_PREFIX = 'classification.policy.';

interface PendingWrite { deps: Deps; ownerGaii: string; key: string; value: unknown }

const pending: PendingWrite[] = [];
let worker: Promise<void> | null = null;
let classifier: WriteClassifier | null = null;
let writeQueue: WriteQueue | null = null;
const overflow: Array<{ deps: Deps; target: ContentLabelTarget }> = [];
let overflowFlush: Promise<void> | null = null;
let dropped = 0;
let saidUnset = false;

/** Set the classifier the write hook calls, and the queue it hands overflow to. Called once at boot. */
export function setWriteClassifier(fn: WriteClassifier | null, queue: WriteQueue | null = null): void {
  classifier = fn;
  writeQueue = queue;
}

/** A stored value as the text the classifier reads: a string as it is, anything else as JSON. */
export function contentText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string' || !text) return null;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function isContentWrite(ownerGaii: string, key: string, value: unknown): boolean {
  if (key.startsWith(RESERVED_PREFIX)) return false;
  if (ownerGaii.startsWith('system@')) return false;
  if (value === undefined || value === null || value === '') return false;
  return true;
}

async function classifyOne(fn: WriteClassifier, item: PendingWrite): Promise<void> {
  const { deps, ownerGaii, key, value } = item;
  const target = memoryTarget(ownerGaii, key);
  try {
    const text = contentText(value);
    if (!text) return;
    // The switch and the policy, once; the classifier reads neither again.
    const policy = (await activePolicies(deps, [target.scope])).get(target.scope);
    if (!policy) return;
    await fn(deps, target, text, { useModel: policy.classifier.onWrite.includes('memory'), policy });
  } catch (e) {
    logger.warn('classification: classifying a memory write failed; the write stands', { key, error: String(e) });
  }
}

/** Hand the overflow to the persistent queue, a batch per storage at a time, until it is empty. */
async function flushOverflow(): Promise<void> {
  while (overflow.length && writeQueue) {
    const first = overflow[0]!.deps;
    const batch: ContentLabelTarget[] = [];
    for (let i = 0; i < overflow.length && batch.length < OVERFLOW_BATCH;) {
      if (overflow[i]!.deps === first) batch.push(overflow.splice(i, 1)[0]!.target);
      else i++;
    }
    try {
      await writeQueue(first, batch, { origin: 'write' });
    } catch (e) {
      dropped += batch.length;
      logger.warn('classification: writes past the in-process limit could not be queued; they are not classified on write', { count: batch.length, dropped, error: String(e) });
    }
  }
}

function startOverflowFlush(): void {
  if (overflowFlush) return;
  overflowFlush = new Promise<void>(resolve => setImmediate(resolve))
    .then(flushOverflow)
    .finally(() => {
      overflowFlush = null;
      if (overflow.length && writeQueue) startOverflowFlush();
    });
}

async function drain(): Promise<void> {
  for (let item = pending.shift(); item; item = pending.shift()) {
    if (classifier) await classifyOne(classifier, item);
  }
}

function startWorker(): void {
  worker = new Promise<void>(resolve => setImmediate(resolve))
    .then(drain)
    .finally(() => {
      worker = null;
      // A write that arrived after the loop ended and before this ran still gets a worker.
      if (pending.length) startWorker();
    });
}

/**
 * Schedule the classification of one content write that has landed. Returns at once; the work runs
 * after the current request work, one item at a time. With classification off this does nothing.
 */
export function classifyAfterWrite(deps: Deps, ownerGaii: string, key: string, value: unknown): void {
  if (deps.config.classificationMode === 'off') return;
  if (!isContentWrite(ownerGaii, key, value)) return;
  if (!classifier) {
    if (!saidUnset) {
      saidUnset = true;
      logger.warn('classification: no classifier is set in this process, so writes are not classified on write', { key });
    }
    return;
  }
  if (pending.length >= MAX_PENDING) {
    // Past the in-process limit the write waits in the persistent queue, which reads the value again.
    if (writeQueue && overflow.length < MAX_OVERFLOW) {
      overflow.push({ deps, target: memoryTarget(ownerGaii, key) });
      startOverflowFlush();
      return;
    }
    dropped += 1;
    if (dropped === 1 || dropped % 500 === 0) {
      logger.warn('classification: too many writes wait for the classifier; this one is not classified on write', { key, dropped });
    }
    return;
  }
  pending.push({ deps, ownerGaii, key, value });
  if (!worker) startWorker();
}

/** Resolves when every scheduled write has been judged or queued. For tests and an orderly shutdown. */
export async function flushWriteClassification(): Promise<void> {
  while (worker || overflowFlush) {
    if (worker) await worker;
    if (overflowFlush) await overflowFlush;
  }
}

/** How many writes wait for the classifier, the one in progress included, and those on their way to the queue. */
export function pendingWriteClassifications(): number {
  return pending.length + (worker ? 1 : 0) + overflow.length;
}
