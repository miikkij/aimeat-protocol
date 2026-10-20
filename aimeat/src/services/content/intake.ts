/**
 * @file src/services/content/intake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class pipeline on arrival: when a file is stored, or a memory record or a
 *   workspace document is written, the item is inspected with the owner's settings
 *   (contentclass.settings: `onArrival`, `sources`, the stages). Jouni, 2026-10-20: "kun
 *   järjestelmään laitetaan se tieto", on or off, and the same pipeline on request for what is
 *   already there (scan.ts).
 *
 *   OFF THE REQUEST PATH. The hooks only put the item in an in-process list and return; one worker,
 *   started with setImmediate, works through the list one item at a time. The write never awaits
 *   it, and a failure logs a warning with the key and never reaches the write. The list is bounded
 *   (MAX_PENDING, MAX_PENDING_PER_OWNER); an item past the bound is not inspected on arrival, and the
 *   scan's "missing only" run picks it up later.
 *
 *   WHAT ARRIVES. A stored file: every upload route stores through writeStorageFile, which calls
 *   contentAfterStore. A memory record or a published workspace document: the memoryWritten event
 *   every central write path emits (event-bus.ts), read by the listener installContentIntake adds.
 *   A memory record is inspected only when it is words (a string, or a document's markdown; an app's
 *   JSON state is not) at least `minTextChars` long (a short note needs no facts), only once it has
 *   gone MEMORY_QUIET_MS without a new write (a note saved while it is typed is read once), and of a
 *   workspace document only its published `.latest`.
 *
 *   WHAT IS SKIPPED. The pipeline's own records (`contentclass.` keys, `contentclass-text/` files),
 *   the node's reserved and server-written keys, app icons and screenshots, the node's own and
 *   anonymous namespaces, and an extension's or ecosystem app's namespace.
 * @structure contentAfterStore · contentAfterRemove · installContentIntake · flushContentIntake ·
 *   pendingContentIntake
 * @usage contentAfterStore({ storage, config }, file.ownerGaii, file.key);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { isReservedServerKey, isServerWrittenKey } from '../../utils/reserved-keys.js';
import { onMemoryWrittenEvent, type MemoryWriteEvent } from '../event-bus.js';
import { callerFromAuth } from '../caller-context.js';
import { setStorageFileHooks } from '../storage-file-write.js';
import { inspectSource, memoryValueText } from './pipeline.js';
import { readSettings } from './settings.js';
import { getFacts, deleteFacts, deleteText, sourceIdOf } from './facts-store.js';
import type { ContentSource } from './types.js';

type Deps = { storage: Storage; config: AimeatConfig };

const MAX_PENDING = 1000;
const MAX_PENDING_PER_OWNER = 50;

interface Pending { deps: Deps; source: ContentSource }
const pending: Pending[] = [];
const pendingByOwner = new Map<string, number>();
let worker: Promise<void> | null = null;
let dropped = 0;
let installed = false;

const SKIP_FILE_PREFIXES = ['contentclass-text/', 'apps/icons/', 'apps/screenshots/', 'anonymous/'];

/** The account an identity belongs to, when it is a local person or one of their agents; else null. */
function ownerOf(identity: string, nodeId: string): string | null {
  if (!identity || identity.startsWith('system@') || identity.startsWith('ext:') || identity.startsWith('eco:')) return null;
  if (identity.startsWith('anonymous')) return null;
  const ghii = ownerGhiiOf(identity);
  return ghii.endsWith(`@${nodeId}`) && !ghii.startsWith('system@') ? ghii : null;
}

function enqueue(deps: Deps, source: ContentSource, ownerGhii: string): void {
  if (pending.length >= MAX_PENDING || (pendingByOwner.get(ownerGhii) ?? 0) >= MAX_PENDING_PER_OWNER) {
    dropped += 1;
    if (dropped === 1 || dropped % 200 === 0) {
      logger.info('contentclass: too many items wait; this one is left for a scan', { key: source.key, dropped });
    }
    return;
  }
  pending.push({ deps, source });
  pendingByOwner.set(ownerGhii, (pendingByOwner.get(ownerGhii) ?? 0) + 1);
  if (!worker) startWorker();
}

async function inspectOne(item: Pending): Promise<void> {
  const { deps, source } = item;
  const ownerGhii = ownerOf(source.owner, deps.config.nodeId);
  if (!ownerGhii) return;
  try {
    const settings = await readSettings(deps.storage, ownerGhii);
    if (!settings.onArrival) return;
    const isWs = source.kind === 'memory' && source.key.startsWith('organism.');
    if (source.kind === 'file' ? !settings.sources.files : isWs ? !settings.sources.workspace : !settings.sources.memory) return;
    if (source.kind === 'memory') {
      // Only words: a string, or a document's markdown. An app's own JSON state is not a text, and
      // reading it on every save would add a write to every write the app makes.
      const rec = await deps.storage.getMemory(source.owner, source.key);
      if (!rec || !isTextValue(rec.value) || memoryValueText(rec.value).length < settings.minTextChars) return;
    }
    const name = localAccountName(ownerGhii);
    const caller = callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, deps.config.nodeId, deps.storage);
    await inspectSource(deps, caller, source, { automatic: true });
  } catch (e) {
    logger.warn('contentclass: inspecting an arrived item failed; the write stands', { kind: source.kind, key: source.key, error: String((e as Error)?.message ?? e) });
  }
}

async function drain(): Promise<void> {
  for (let item = pending.shift(); item; item = pending.shift()) {
    const owner = ownerOf(item.source.owner, item.deps.config.nodeId) ?? '';
    const n = (pendingByOwner.get(owner) ?? 1) - 1;
    if (n > 0) pendingByOwner.set(owner, n); else pendingByOwner.delete(owner);
    await inspectOne(item);
  }
}

function startWorker(): void {
  worker = new Promise<void>(resolve => setImmediate(resolve))
    .then(drain)
    .finally(() => {
      worker = null;
      if (pending.length) startWorker();
    });
}

/** A file was stored under `ownerGaii`. Returns at once; with the pipeline off this does nothing. */
export function contentAfterStore(deps: Deps, ownerGaii: string, key: string): void {
  if (deps.config.contentClassMode === 'off') return;
  if (SKIP_FILE_PREFIXES.some((p) => key.startsWith(p))) return;
  const ownerGhii = ownerOf(ownerGaii, deps.config.nodeId);
  if (!ownerGhii) return;
  enqueue(deps, { kind: 'file', owner: ownerGaii, key }, ownerGhii);
}

/**
 * A file was removed: its facts and its kept text go with it. Awaited by nobody; a failure is logged.
 * This is the lifecycle's first half; the scan's prune removes facts whose memory record is gone.
 */
export function contentAfterRemove(deps: Deps, ownerGaii: string, key: string): void {
  if (key.startsWith('contentclass-text/')) return;
  const ownerGhii = ownerOf(ownerGaii, deps.config.nodeId);
  if (!ownerGhii) return;
  const sourceId = sourceIdOf({ kind: 'file', owner: ownerGaii, key });
  void (async () => {
    const facts = await getFacts(deps.storage, ownerGhii, sourceId);
    if (!facts) return;
    const writer = { principal: ownerGhii, ownerGhii, scopes: [] as string[], roles: ['owner'] };
    if (facts.textKey) await deleteText(deps, ownerGhii, facts.textKey);
    await deleteFacts(deps, writer, sourceId);
  })().catch((e: unknown) => logger.warn('contentclass: the facts of a removed file were not removed', { key, error: String((e as Error)?.message ?? e) }));
}

/** A memory value that is words: a string, or a document ({ title?, markdown }). */
function isTextValue(value: unknown): boolean {
  return typeof value === 'string' || (!!value && typeof value === 'object' && typeof (value as { markdown?: unknown }).markdown === 'string');
}

/**
 * How long a memory record must stay unwritten before it is read. A note saved every few seconds
 * while a person types is read once, after they stop, and not once per save: with the model steps on,
 * every read would be a paid call.
 */
export const MEMORY_QUIET_MS = 10_000;
const MAX_WAITING = 2000;
const waiting = new Map<string, ReturnType<typeof setTimeout>>();

function onMemoryWritten(deps: Deps, evt: MemoryWriteEvent): void {
  if (deps.config.contentClassMode === 'off') return;
  const { key, ownerGaii } = evt;
  if (key.startsWith('contentclass.') || isReservedServerKey(key) || isServerWrittenKey(key)) return;
  if (key.startsWith('organism.') && !key.endsWith('.latest')) return;
  const ownerGhii = ownerOf(ownerGaii, deps.config.nodeId);
  if (!ownerGhii) return;
  const id = `${ownerGaii}\u0000${key}`;
  const earlier = waiting.get(id);
  if (earlier) clearTimeout(earlier);
  else if (waiting.size >= MAX_WAITING) return;
  const timer = setTimeout(() => {
    waiting.delete(id);
    enqueue(deps, { kind: 'memory', owner: ownerGaii, key }, ownerGhii);
  }, MEMORY_QUIET_MS);
  timer.unref?.();
  waiting.set(id, timer);
}

/**
 * Listen for stored and removed files and for memory writes. Called once at boot; a second call is a
 * no-op. The file hooks go through setStorageFileHooks because facts-store.ts stores its text files
 * through storage-file-write.ts, which may therefore not import this file.
 */
export function installContentIntake(deps: Deps): void {
  if (installed) return;
  installed = true;
  setStorageFileHooks({ afterStore: contentAfterStore, afterRemove: contentAfterRemove });
  onMemoryWrittenEvent((evt) => onMemoryWritten(deps, evt));
}

/** Resolves when every arrived item has been inspected. For tests and an orderly shutdown. */
export async function flushContentIntake(): Promise<void> {
  while (worker) await worker;
}

/** How many arrived items wait, the one in progress and the memory records still settling included. */
export function pendingContentIntake(): number {
  return pending.length + (worker ? 1 : 0) + waiting.size;
}
