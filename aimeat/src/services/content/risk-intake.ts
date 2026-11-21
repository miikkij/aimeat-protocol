/**
 * @file src/services/content/risk-intake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The intake and shared-write points of the content risk marks: one call each write path
 *   makes after it stored the content (docs/internal/content-risk-plan.md, "The three points").
 *
 *   OFF THE REQUEST PATH. contentRiskAfterWrite puts the item in an in-process list and returns; one
 *   worker started with setImmediate marks the items one at a time (intake.ts does the same for the
 *   content classes). The write never awaits it, and a failure logs a warning and never reaches the
 *   write. The list is bounded; an item past the bound is not marked now, and its read still carries
 *   the rules' marks (risk-read.ts). With content_risk.mode off the call returns before reading anything.
 *
 *   WHAT IS READ. The hook passes the text when it has it (a comment, a message, a post, a row). A memory
 *   record is read as its words (risk-text.ts riskTextOf); a stored file whose type is text is read
 *   whole up to MAX_TEXT_FILE_BYTES; any other file (a PDF, a picture with words) goes through the content
 *   pipeline's technical read with the `risk` stage, which marks the text that read took out of it.
 *
 *   A SHARED WRITE is marked only when the writer is not the home's owner (risk-core.ts decides the
 *   hold; this file decides whether it is a shared write at all): for a workspace item, a writer who is
 *   the workspace's creator or an organism admin is not "someone other than the owner".
 *
 *   A READ that marked an item with no entry for its words queues it too (contentRiskAfterRead), so the
 *   marks are kept and the item gets a ref a person can accept; the same list, the same bounds.
 * @structure contentRiskAfterWrite · contentRiskAfterRead · contentRiskTextOf · contentRiskMessageText · holdContentRiskForErasure · flushContentRisk · pendingContentRisk · MAX_TEXT_FILE_BYTES
 * @usage contentRiskAfterWrite(deps, { kind: 'comment', org, ws, key }, { point: 'shared-write', writer, text });
 * @version-history
 *   v1.1.0 — 2026-11-21 — contentRiskAfterRead: a read's marks are kept off the request path
 *     (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { callerFromAuth } from '../caller-context.js';
import { inspectSource } from './pipeline.js';
import { riskTextOf } from './risk-text.js';
import { markText, isApprover } from './risk-core.js';
import { homeOf, subjectIdOf, type RiskSubject } from './risk-store.js';
import type { ResolvedRisk, RiskPoint } from './risk-types.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** A stored text file larger than this is read through the pipeline's bounded reader instead. */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PENDING = 1000;
const MAX_PENDING_PER_HOME = 50;

interface Pending {
  deps: Deps; subject: RiskSubject; point: Exclude<RiskPoint, 'request'>; writer?: string; text?: string; expiresAt?: string;
  /** A read's: the hash of the words it read, and the rules in force for that reader. */
  hash?: string; resolved?: ResolvedRisk;
}
const pending: Pending[] = [];
// process-local: the queue of the process that took the write; its items are marked there, and the read still carries the rules' marks if that process stops before them.
const perHome = new Map<string, number>();
// process-local: the worker of this process's own queue.
let worker: Promise<void> | null = null;
// process-local: how many items this process left unmarked, for its log line only.
let dropped = 0;
/** The accounts whose erasure runs now: their items are not queued, and the one in progress is waited for. */
const erasing = new ErasureHolds();

/** Whether an item belongs to an account: its home is the person, or the person (or their agent) wrote it. */
const itemOf = (p: Pending, account: ErasedAccount): boolean => {
  const h = homeOf(p.subject);
  return (h.kind === 'person' && ErasureHolds.isOf(h.owner, account)) || ErasureHolds.isOf(p.writer, account);
};
const coveredItem = (p: Pending): boolean => {
  const h = homeOf(p.subject);
  return (h.kind === 'person' && erasing.covers(h.owner)) || erasing.covers(p.writer);
};

const homeId = (s: RiskSubject): string => { const h = homeOf(s); return h.kind === 'person' ? h.owner : `${h.org}/${h.ws}`; };

const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|ld\+json|x-ndjson|javascript)|message\/rfc822)/iu;

async function markOne(item: Pending): Promise<void> {
  const { deps, subject, point, writer } = item;
  // A write by the home's owner (or, in a workspace, its creator or an organism admin) is not shared.
  if (point === 'shared-write' && writer && await isApprover(deps, homeOf(subject), writer)) return;
  if (item.text !== undefined) {
    await markText(deps, {
      subject, text: item.text, point, ...(writer ? { writer } : {}), ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      ...(item.hash ? { hash: item.hash } : {}), ...(item.resolved ? { resolved: item.resolved } : {}),
    });
    return;
  }
  if (subject.kind === 'memory') {
    const rec = await deps.storage.getMemory(subject.owner, subject.key);
    if (!rec) return;
    const text = riskTextOf(rec.value);
    await markText(deps, { subject, text, point, ...(writer ? { writer } : {}), measure: { mimeType: typeof rec.value === 'string' ? 'text/plain' : 'application/json', size: Buffer.byteLength(text, 'utf8') } });
    return;
  }
  if (subject.kind !== 'file') return;
  const meta = await deps.storage.getStorageFileMeta(subject.owner, subject.key);
  if (!meta) return;
  if (TEXT_TYPES.test(meta.mimeType ?? '') && meta.size <= MAX_TEXT_FILE_BYTES) {
    const file = await deps.storage.getStorageFile(subject.owner, subject.key);
    if (!file?.data) return;
    const bytes = Buffer.from(file.data);
    await markText(deps, {
      subject, text: bytes.toString('utf8'), point, ...(writer ? { writer } : {}),
      hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, measure: { mimeType: meta.mimeType, size: meta.size },
    });
    return;
  }
  // A PDF or another file whose words need reading: the pipeline's technical read, then the risk stage.
  if (deps.config.contentClassMode === 'off') return;
  const name = localAccountName(ownerGhiiOf(subject.owner));
  const caller = callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, deps.config.nodeId, deps.storage);
  await inspectSource(deps, caller, { kind: 'file', owner: subject.owner, key: subject.key }, { stages: ['technical', 'risk'], riskPoint: point });
}

async function drain(): Promise<void> {
  for (let item = pending.shift(); item; item = pending.shift()) {
    const id = homeId(item.subject);
    const n = (perHome.get(id) ?? 1) - 1;
    if (n > 0) perHome.set(id, n); else perHome.delete(id);
    // Queued before an erasure began and reached after it: the erased person's item is not marked.
    if (coveredItem(item)) continue;
    try {
      await erasing.track(markOne(item));
    } catch (e) {
      logger.warn('contentrisk: marking an item failed; the write stands', { kind: item.subject.kind, point: item.point, error: String((e as Error)?.message ?? e) });
    }
  }
}

function startWorker(): void {
  worker = new Promise<void>((resolve) => setImmediate(resolve))
    .then(drain)
    .finally(() => {
      worker = null;
      if (pending.length) startWorker();
    });
}

/**
 * An item was written at the intake or shared-write point. Returns at once. `writer` is the principal
 * that wrote it (a shared write); `text` its words when the caller has them.
 */
export function contentRiskAfterWrite(
  deps: Deps, subject: RiskSubject, opts: { point: 'intake' | 'shared-write'; writer?: string; text?: string; expiresAt?: string },
): void {
  if (deps.config.contentRiskMode === 'off') return;
  if (opts.text !== undefined && !opts.text.trim()) return;
  if (coveredItem({ deps, subject, point: opts.point, ...(opts.writer ? { writer: opts.writer } : {}) })) return;
  const id = homeId(subject);
  if (pending.length >= MAX_PENDING || (perHome.get(id) ?? 0) >= MAX_PENDING_PER_HOME) {
    dropped += 1;
    if (dropped === 1 || dropped % 200 === 0) logger.info('contentrisk: too many items wait; this one is marked on read only', { kind: subject.kind, dropped });
    return;
  }
  pending.push({
    deps, subject, point: opts.point, ...(opts.writer ? { writer: opts.writer } : {}), ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  });
  perHome.set(id, (perHome.get(id) ?? 0) + 1);
  if (!worker) startWorker();
}

/**
 * A read marked an item that has no entry for these words: keep the marks, so the item has a ref a
 * person can accept (risk-read.ts). Returns at once; a read does not notify anybody (risk-core.ts).
 */
export function contentRiskAfterRead(deps: Deps, subject: RiskSubject, opts: { text: string; hash: string; resolved: ResolvedRisk }): void {
  if (deps.config.contentRiskMode === 'off' || subject.kind === 'external' || !opts.text.trim()) return;
  if (coveredItem({ deps, subject, point: 'read' })) return;
  const id = homeId(subject);
  if (pending.length >= MAX_PENDING || (perHome.get(id) ?? 0) >= MAX_PENDING_PER_HOME) return;
  if (pending.some((p) => p.point === 'read' && p.hash === opts.hash && subjectIdOf(p.subject) === subjectIdOf(subject))) return;
  pending.push({ deps, subject, point: 'read', text: opts.text, hash: opts.hash, resolved: opts.resolved });
  perHome.set(id, (perHome.get(id) ?? 0) + 1);
  if (!worker) startWorker();
}

/**
 * The words of a value as the marks read them (risk-text.ts): a string as it is, a document's title and
 * markdown, any other value as its string values. The read helper reads the same words, so the hash matches.
 */
export function contentRiskTextOf(value: unknown): string {
  return riskTextOf(value);
}

/** The words of a message (a direct message, a post, a message to an agent): its subject, then its body. */
export function contentRiskMessageText(subject: string | null | undefined, words: string | null | undefined): string {
  return [subject ?? '', words ?? ''].filter((s) => s.trim()).join('\n\n');
}

/** Resolves when every queued item has been marked. For tests and an orderly shutdown. */
export async function flushContentRisk(): Promise<void> {
  while (worker) await worker;
}

/**
 * An account erasure, before its cascade: no item of the account is queued from now on, its waiting
 * items are dropped, and the marking in progress answers first, so the cascade sees what it wrote.
 * The returned function ends the hold, after the cascade (intake.ts holdContentIntakeForErasure does
 * the same for the content classes).
 */
export async function holdContentRiskForErasure(account: ErasedAccount): Promise<() => void> {
  const release = erasing.hold(account);
  for (let i = pending.length - 1; i >= 0; i--) {
    const item = pending[i]!;
    if (!itemOf(item, account)) continue;
    pending.splice(i, 1);
    const id = homeId(item.subject);
    const n = (perHome.get(id) ?? 1) - 1;
    if (n > 0) perHome.set(id, n); else perHome.delete(id);
  }
  await erasing.currentWritesSettled();
  return release;
}

/** How many items wait, the one in progress included. */
export function pendingContentRisk(): number {
  return pending.length + (worker ? 1 : 0);
}
