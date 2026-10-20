/**
 * @file src/services/content/scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A scan: the content class pipeline over many items at once, for what is already on
 *   the node or what arrived while the pipeline was off (Jouni, 2026-10-20: "sen voi myös tehdä jo
 *   olemassa olevalle sisällölle jolle ei löydy tätä tietoa entuudestaan joko yksitellen tai sitten
 *   käydä jotkut tietyt läpi kerralla").
 *
 *   WHAT IT GOES THROUGH. The owner's files and their agents' (the owner sees what their agents
 *   hold), or exactly the keys named; filtered by kind; by default only the items without facts.
 *   Memory records are scanned only under a named prefix, because a whole account holds thousands
 *   of records and nearly all of them are short. `prune` also removes the facts of items that are
 *   gone, which is how facts of a deleted memory record leave.
 *
 *   ONE SCAN PER OWNER AT A TIME. A second start while one runs answers with the one running. A run
 *   lives in this process for an hour after it finishes; what lasts is the facts it wrote. Progress
 *   is announced as a `contentclass` change on the owner's event stream, at most once a second, so a
 *   page follows it without polling.
 * @structure ScanOptions · ScanState · startScan · getScan · runningScanOf · MAX_SCAN_ITEMS
 * @usage const { scan } = startScan(deps, caller, { kinds: ['image'], stages: ['describe'] });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import { randomBytes } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { inspectSource, ContentError } from './pipeline.js';
import { contentKindOf } from './kind.js';
import { listFacts, getFacts, deleteFacts, deleteText, sourceIdOf } from './facts-store.js';
import type { ContentKind, ContentSource, StageName } from './types.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The most items one scan goes through. */
export const MAX_SCAN_ITEMS = 2000;
const KEEP_MS = 60 * 60 * 1000;
const STALL_MS = 6 * 60 * 60 * 1000;
const SKIP_FILE_PREFIXES = ['contentclass-text/', 'apps/icons/', 'apps/screenshots/'];

export interface ScanOptions {
  /** Exactly these stored files of the caller (keys). */
  keys?: string[];
  kinds?: ContentKind[];
  /** Memory records under this prefix of the owner's own namespace. */
  memoryPrefix?: string;
  /** Only items with no facts yet, or without the asked stages done. Default true. */
  missingOnly?: boolean;
  stages?: StageName[];
  force?: boolean;
  limit?: number;
  /** Remove the facts of items that no longer exist. */
  prune?: boolean;
}

export interface ScanState {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  /** Items chosen, and how many are behind us. */
  n: number;
  i: number;
  current: string;
  counts: { inspected: number; skipped: number; failed: number; pruned: number };
  /** The last few failures, newest first. */
  failures: Array<{ key: string; error: string }>;
  stages: StageName[] | 'settings';
  by: string;
  error?: string;
}

const scans = new Map<string, { owner: string; state: ScanState; finished?: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [id, r] of scans) if (r.finished && now - r.finished > KEEP_MS) scans.delete(id);
}

/** The scan of this owner that is still working, if one is. A stalled one is marked failed. */
export function runningScanOf(ownerGhii: string): ScanState | null {
  for (const r of scans.values()) {
    if (r.owner !== ownerGhii || r.state.status !== 'running') continue;
    if (Date.now() - Date.parse(r.state.startedAt) > STALL_MS) {
      r.state.status = 'failed'; r.state.error = 'stalled'; r.finished = Date.now();
      continue;
    }
    return r.state;
  }
  return null;
}

export function getScan(id: string, ownerGhii: string): ScanState | null {
  sweep();
  const r = scans.get(id);
  return r && r.owner === ownerGhii ? r.state : null;
}

/** The items a scan goes through, in the order it takes them. */
async function chooseItems(deps: Deps, caller: CallerContext, opts: ScanOptions): Promise<ContentSource[]> {
  const limit = Math.max(1, Math.min(MAX_SCAN_ITEMS, opts.limit ?? 200));
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const out: ContentSource[] = [];
  if (opts.keys?.length) {
    for (const key of opts.keys.slice(0, limit)) out.push({ kind: 'file', owner: caller.principal, key });
  } else if (!opts.memoryPrefix) {
    // The owner's own files and, for the account holder, their agents' too.
    const identities = [caller.principal];
    if (caller.inPerson) for (const a of await deps.storage.getAgentsByOwner(localAccountName(caller.ownerGhii))) identities.push(a.gaii);
    const byOwner = await deps.storage.listStorageFilesForOwners(identities);
    const files = Object.entries(byOwner).flatMap(([owner, fs]) => fs.map((f) => ({ owner, f })))
      .filter(({ f }) => !SKIP_FILE_PREFIXES.some((p) => f.key.startsWith(p)))
      .filter(({ f }) => !kinds || kinds.has(contentKindOf(f.mimeType ?? '', f.key)))
      .sort((a, b) => String(b.f.createdAt ?? '').localeCompare(String(a.f.createdAt ?? '')));
    for (const { owner, f } of files) out.push({ kind: 'file', owner, key: f.key });
  }
  if (opts.memoryPrefix) {
    const recs = await deps.storage.listMemory(caller.principal, { prefix: opts.memoryPrefix });
    for (const r of recs) if (!r.key.startsWith('contentclass.')) out.push({ kind: 'memory', owner: caller.principal, key: r.key });
  }
  if (opts.missingOnly === false || opts.force) return out.slice(0, limit);
  const kept: ContentSource[] = [];
  for (const s of out) {
    if (kept.length >= limit) break;
    const f = await getFacts(deps.storage, caller.ownerGhii, sourceIdOf(s));
    const done = f && (opts.stages ?? []).every((st) => f.stages[st]?.ok);
    if (!done) kept.push(s);
  }
  return kept;
}

/** Remove the facts of items that are gone. Answers how many were removed. */
async function prune(deps: Deps, caller: CallerContext): Promise<number> {
  const writer = { principal: caller.ownerGhii, ownerGhii: caller.ownerGhii, scopes: [] as string[], roles: ['owner'] };
  let removed = 0;
  let after: string | undefined;
  for (;;) {
    const page = await listFacts(deps.storage, caller.ownerGhii, { limit: 500, ...(after ? { after } : {}) });
    for (const f of page.items) {
      const s = f.source;
      const exists = s.kind === 'file'
        ? !!(await deps.storage.getStorageFileMeta(s.owner, s.key))
        : !!(await deps.storage.getMemory(s.owner, s.key));
      if (exists) continue;
      if (f.textKey) await deleteText(deps, caller.ownerGhii, f.textKey);
      await deleteFacts(deps, writer, f.sourceId);
      removed += 1;
    }
    if (!page.next) break;
    after = page.next;
  }
  return removed;
}

/**
 * Start a scan for the caller's account; answers at once with its state. With one already running
 * for this owner, answers with that one and `already: true`.
 */
export function startScan(deps: Deps, caller: CallerContext, opts: ScanOptions): { scan: ScanState; already: boolean } {
  if (deps.config.contentClassMode === 'off') throw new ContentError('NOT_FOUND', 404, 'Content classes are off on this node.');
  sweep();
  const running = runningScanOf(caller.ownerGhii);
  if (running) return { scan: running, already: true };
  const state: ScanState = {
    id: `scan_${randomBytes(8).toString('hex')}`, status: 'running', startedAt: new Date().toISOString(), n: 0, i: 0, current: '',
    counts: { inspected: 0, skipped: 0, failed: 0, pruned: 0 }, failures: [], stages: opts.stages ?? 'settings', by: caller.principal,
  };
  const entry: { owner: string; state: ScanState; finished?: number } = { owner: caller.ownerGhii, state };
  scans.set(state.id, entry);
  let last = 0;
  const tick = (force = false) => {
    const now = Date.now();
    if (force || now - last >= 1000) { last = now; emitChange('contentclass', caller.ownerGhii); }
  };
  void (async () => {
    if (opts.prune) state.counts.pruned = await prune(deps, caller);
    const items = await chooseItems(deps, caller, opts);
    state.n = items.length; tick(true);
    for (const s of items) {
      state.i += 1; state.current = s.key; tick();
      try {
        const r = await inspectSource(deps, caller, s, { ...(opts.stages ? { stages: opts.stages } : {}), ...(opts.force ? { force: true } : {}) });
        if (r.ran.length) state.counts.inspected += 1; else state.counts.skipped += 1;
      } catch (err) {
        state.counts.failed += 1;
        state.failures.unshift({ key: s.key, error: String((err as Error)?.message ?? err).slice(0, 300) });
        state.failures.length = Math.min(state.failures.length, 20);
      }
      if (state.status !== 'running') return;
    }
    state.status = 'done';
  })().catch((err: unknown) => {
    state.status = 'failed';
    state.error = String((err as Error)?.message ?? err);
    logger.warn('contentclass: a scan failed', { scan: state.id, error: state.error });
  }).finally(() => {
    state.current = '';
    state.finishedAt = new Date().toISOString();
    entry.finished = Date.now();
    tick(true);
  });
  return { scan: state, already: false };
}
