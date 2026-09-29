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
 *   BOUNDED. The list holds at most MAX_PENDING writes; past that a write is not classified on write
 *   and a warning says how many were dropped. The value is held, not its text, so the text is made
 *   only when the item is judged.
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
 * @structure WriteClassifier · MAX_TEXT · contentText() · setWriteClassifier() · classifyAfterWrite() ·
 *   flushWriteClassification() · pendingWriteClassifications()
 * @usage classifyAfterWrite({ storage, config }, record.ownerGaii, record.key, record.value);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ContentLabelTarget } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { memoryTarget } from './classification/labels.js';
import { classificationActiveFor, policyFor } from './classification/policy.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The shape of services/classification/classifier.ts classifyText, as far as this file uses it. */
export type WriteClassifier = (
  deps: Deps, target: ContentLabelTarget, text: string, opts: { useModel?: boolean },
) => Promise<unknown>;

/** The most text the classifier is given from one value. */
export const MAX_TEXT = 200_000;
const MAX_PENDING = 2000;
// The reserved prefix only (utils/reserved-keys.ts): an app's own `classification.*` data is user
// data and is classified like any other.
const RESERVED_PREFIX = 'classification.policy.';

interface PendingWrite { deps: Deps; ownerGaii: string; key: string; value: unknown }

const pending: PendingWrite[] = [];
let worker: Promise<void> | null = null;
let classifier: WriteClassifier | null = null;
let dropped = 0;
let saidUnset = false;

/** Set the classifier the write hook calls. Called once at boot. */
export function setWriteClassifier(fn: WriteClassifier | null): void {
  classifier = fn;
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
    if (!(await classificationActiveFor(deps.storage, deps.config, target.scope))) return;
    const text = contentText(value);
    if (!text) return;
    const policy = await policyFor(deps.storage, deps.config, target.scope);
    await fn(deps, target, text, { useModel: policy.classifier.onWrite.includes('memory') });
  } catch (e) {
    logger.warn('classification: classifying a memory write failed; the write stands', { key, error: String(e) });
  }
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
    dropped += 1;
    if (dropped === 1 || dropped % 500 === 0) {
      logger.warn('classification: too many writes wait for the classifier; this one is not classified on write', { key, dropped });
    }
    return;
  }
  pending.push({ deps, ownerGaii, key, value });
  if (!worker) startWorker();
}

/** Resolves when every scheduled write has been judged. For tests and an orderly shutdown. */
export async function flushWriteClassification(): Promise<void> {
  while (worker) await worker;
}

/** How many writes wait for the classifier, the one in progress included. */
export function pendingWriteClassifications(): number {
  return pending.length + (worker ? 1 : 0);
}
