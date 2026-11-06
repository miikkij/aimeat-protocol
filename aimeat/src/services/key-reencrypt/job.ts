/**
 * @file src/services/key-reencrypt/job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data key's re-encrypt job: the operator starts it after making the second data key
 *   current (AIMEAT_ENCRYPTION_KEY_1 and AIMEAT_ENCRYPTION_KEY_CURRENT, docs/operations/key-rotation.md),
 *   and it seals every stored secret again with the current key, so the old key can later be removed.
 *   Decision 4a of 2026-11-05 (codebase analysis 2026-11-03, security-architecture finding 10).
 *
 *   NOTHING CHANGES UNTIL THE OPERATOR ACTS. On a node with one data key the status is read from the
 *   configuration alone, nothing is written, and the job refuses to start. The boot step that resumes
 *   a job reads nothing on such a node.
 *
 *   HOW IT RUNS. In batches of REENCRYPT_BATCH rows of one source (sources.ts) at a time. Each value
 *   under another key is opened with the ring and sealed again with the current key; a memory record
 *   is written on its version (record-cas.ts updateMemoryRecord), a table column only over the value
 *   that was read (storage swapSealedColumn), so the job never undoes another writer's change. A value
 *   that opens with no key is UNREADABLE: never written over, never deleted, counted, and named in
 *   the status by its place (not its content). A value that changed between the read and the write
 *   is counted as changed meanwhile; a second run checks it.
 *
 *   RESUMABLE, AND ONE PROCESS AT A TIME. The job's state is one memory record of the node
 *   (`system@<node>`, key `key-rotation.reencrypt`): the source and the last row id finished, and the
 *   counts. It is written after every batch, on its version. A process runs batches only while it
 *   holds the lease `lease.key-reencrypt` (process-lease.ts), so two processes never run it at once;
 *   a restarted process takes the job up again at its next start, from the last batch it recorded.
 *
 *   WHEN THE OLD KEY MAY GO. The status says so only when a whole run finished for the key that is
 *   current now and left no value under another key: none unreadable and none changed meanwhile.
 *   Removing the key stays the operator's own step, in the environment.
 * @structure REENCRYPT_KEY · REENCRYPT_BATCH · ReencryptState · ReencryptStatus · reencryptStatus ·
 *   startReencrypt · runReencrypt · resumeReencryptAtBoot · ringOfConfig
 * @usage
 *   const status = await reencryptStatus(storage, config);
 *   const out = await startReencrypt(storage, config, 'alice@node');   // 202 started, or a refusal
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { getEncryptionKey, keyRingOf } from '../encryption.js';
import { updateMemoryRecord, UNCHANGED } from '../record-cas.js';
import { takeHeldLease, releaseHeldLease, PROCESS_LEASE_MS } from '../process-lease.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { REENCRYPT_SOURCES, type RowPlan, type SourceCtx } from './sources.js';
import { addTally, emptyTally, type Tally } from './reseal.js';

export const REENCRYPT_KEY = 'key-rotation.reencrypt';
const LEASE = 'key-reencrypt';
/** Rows of one source per batch; the state is written after each batch. */
export const REENCRYPT_BATCH = 100;
/** How many places of unreadable values the status names. */
const EXAMPLES = 20;

interface Counts extends Tally { checked: number; conflicts: number }

export interface ReencryptState {
  spec: 'aimeat.key-reencrypt/v1';
  state: 'running' | 'done' | 'failed';
  /** The key every value is moved to: the ring's current key when the run started. */
  target_key: number;
  started_at: string;
  started_by: string;
  updated_at: string;
  finished_at?: string;
  position: { source: number; after: string[] | null };
  counts: Counts;
  by_source: Record<string, Counts>;
  /** Where the unreadable values are (source and row id), the first few. */
  unreadable_at: Array<{ source: string; id: string[] }>;
  /** How many times a process took the job up after another stopped. */
  resumed: number;
  error?: string;
}

export interface ReencryptStatus {
  ring: { keys: number[]; current: number };
  job: ReencryptState | null;
  /** Values the last finished run left under another key (unreadable plus changed meanwhile); null before one. */
  old_key_values: number | null;
  old_key_removable: boolean;
  /** In plain words: what the operator can do now. */
  says: string;
}

const owner = (config: Pick<AimeatConfig, 'nodeId'>): string => `system@${config.nodeId}`;
const zero = (): Counts => ({ ...emptyTally(), checked: 0, conflicts: 0 });

/** The ring the configuration describes: its key ids and the current one. Reads nothing stored. */
export function ringOfConfig(config: AimeatConfig): { keys: number[]; current: number; key: Buffer | null } {
  const key = getEncryptionKey(config);
  if (!key) return { keys: [], current: 0, key: null };
  const ring = keyRingOf(key);
  return { keys: [...ring.keys.keys()].sort((a, b) => a - b), current: ring.current, key };
}

async function readState(storage: Storage, config: AimeatConfig): Promise<{ rec: MemoryRecord | null; state: ReencryptState | null }> {
  const rec = await storage.getMemory(owner(config), REENCRYPT_KEY);
  const v = rec?.value as Partial<ReencryptState> | undefined;
  return { rec, state: v && v.spec === 'aimeat.key-reencrypt/v1' ? v as ReencryptState : null };
}

async function writeState(storage: Storage, config: AimeatConfig, prior: MemoryRecord | null, state: ReencryptState): Promise<boolean> {
  const now = new Date().toISOString();
  const record: MemoryRecord = {
    key: REENCRYPT_KEY, ownerGaii: owner(config), value: state, visibility: 'private', tags: ['key-rotation'], ttlHours: null,
    version: (prior?.version ?? 0) + 1, createdAt: prior?.createdAt ?? now, updatedAt: now,
  };
  return prior ? !!await storage.setMemoryIfVersion(record, prior.version) : !!await storage.createMemoryIfAbsent(record);
}

/** What the operator sees: the ring, the last run, and whether the other key may be removed. */
export async function reencryptStatus(storage: Storage, config: AimeatConfig): Promise<ReencryptStatus> {
  const ring = ringOfConfig(config);
  const view = { keys: ring.keys, current: ring.current };
  if (ring.keys.length < 2) {
    return { ring: view, job: null, old_key_values: null, old_key_removable: false, says: ring.keys.length ? 'This node has one data key, so there is nothing to move. To replace it, set AIMEAT_ENCRYPTION_KEY_1 and AIMEAT_ENCRYPTION_KEY_CURRENT=1 on every process, restart them, and start this job.' : 'This node has no data key, so it stores no secret.' };
  }
  const other = ring.keys.find(k => k !== ring.current)!;
  const otherName = other === 0 ? 'AIMEAT_ENCRYPTION_KEY' : `AIMEAT_ENCRYPTION_KEY_${other}`;
  const { state } = await readState(storage, config);
  if (!state) {
    return { ring: view, job: null, old_key_values: null, old_key_removable: false, says: `New secrets are sealed with key ${ring.current}. Start the job to move the stored ones to it; keep ${otherName} until the job finishes with no value left under it.` };
  }
  const left = state.counts.unreadable + state.counts.conflicts;
  if (state.state === 'running') {
    return { ring: view, job: state, old_key_values: null, old_key_removable: false, says: `The job is moving the stored secrets to key ${state.target_key}. Every secret opens while it runs. Keep ${otherName}.` };
  }
  if (state.state === 'failed' || state.target_key !== ring.current) {
    return { ring: view, job: state, old_key_values: null, old_key_removable: false, says: state.state === 'failed' ? `The last run stopped: ${state.error ?? 'unknown error'}. Start it again; it begins from the first source. Keep ${otherName}.` : `The last run moved secrets to key ${state.target_key}, and key ${ring.current} is current now. Start the job again. Keep ${otherName}.` };
  }
  if (left > 0) {
    return { ring: view, job: state, old_key_values: left, old_key_removable: false, says: `${left} stored value(s) are not under key ${ring.current}: ${state.counts.unreadable} open with neither key and ${state.counts.conflicts} changed while the job ran. Start the job again to check them, and keep ${otherName} until it reports 0. The unreadable ones are listed by place under unreadable_at.` };
  }
  return { ring: view, job: state, old_key_values: 0, old_key_removable: true, says: `Every stored secret is under key ${ring.current}. You may now remove ${otherName} from the environment of every process and restart them. Keep a copy of it with the backups taken before this run: they still need it.` };
}

export type StartOutcome =
  | { ok: true; started: boolean; status: ReencryptStatus }
  | { ok: false; status: number; code: string; message: string };

/**
 * Start a run, or report the one that is running. Refused on a node with one data key, where there
 * is nothing to move, and nothing is written there.
 */
export async function startReencrypt(storage: Storage, config: AimeatConfig, by: string, opts: { run?: boolean } = {}): Promise<StartOutcome> {
  const run = opts.run !== false;
  const ring = ringOfConfig(config);
  if (ring.keys.length < 2) {
    return { ok: false, status: 409, code: 'ONE_DATA_KEY', message: 'This node has one data key, so there is nothing to move. Set AIMEAT_ENCRYPTION_KEY_1 and AIMEAT_ENCRYPTION_KEY_CURRENT=1 on every process of the node, restart them, and start the job again.' };
  }
  const { rec, state } = await readState(storage, config);
  if (state?.state === 'running') {
    if (run) void runReencrypt(storage, config).catch(err => logger.warn('key re-encrypt: a run did not continue', { error: String(err) }));
    return { ok: true, started: false, status: await reencryptStatus(storage, config) };
  }
  const now = new Date().toISOString();
  const fresh: ReencryptState = {
    spec: 'aimeat.key-reencrypt/v1', state: 'running', target_key: ring.current, started_at: now, started_by: by, updated_at: now,
    position: { source: 0, after: null }, counts: zero(), by_source: {}, unreadable_at: [], resumed: 0,
  };
  if (!await writeState(storage, config, rec, fresh)) {
    return { ok: true, started: false, status: await reencryptStatus(storage, config) };
  }
  logger.info('key re-encrypt: started', { by, target_key: ring.current });
  emitChange('key-reencrypt');
  // A test passes run: false and runs the batches itself, to stop a run in the middle.
  if (run) void runReencrypt(storage, config).catch(err => logger.warn('key re-encrypt: the run stopped on an error', { error: String(err) }));
  return { ok: true, started: true, status: await reencryptStatus(storage, config) };
}

// process-local: which nodes this process is running the job for now, so a second start in the same process does not run a second loop
const runningHere = new Set<string>();

/**
 * Run batches until the job is done, another process holds it, or `maxBatches` ran (a test stops a
 * run in the middle that way). Answers why it stopped.
 */
export async function runReencrypt(storage: Storage, config: AimeatConfig, opts: { maxBatches?: number; resumed?: boolean } = {}): Promise<'done' | 'paused' | 'not-holder' | 'not-running'> {
  if (runningHere.has(config.nodeId)) return 'not-holder';
  runningHere.add(config.nodeId);
  let lastEmit = 0;
  let firstWrite = true;
  try {
    for (let batches = 0; ; batches++) {
      if (opts.maxBatches !== undefined && batches >= opts.maxBatches) return 'paused';
      if (!await takeHeldLease(storage, config, LEASE)) return 'not-holder';
      const { rec, state } = await readState(storage, config);
      if (!rec || !state || state.state !== 'running') { await releaseHeldLease(storage, config, LEASE); return 'not-running'; }
      const ring = ringOfConfig(config);
      let next: ReencryptState;
      if (!ring.key || ring.current !== state.target_key) {
        next = { ...state, state: 'failed', error: `key ${state.target_key} is no longer the current key of this process`, updated_at: new Date().toISOString() };
      } else {
        try {
          next = await runBatch(storage, config, ring.key, state);
        } catch (err) {
          next = { ...state, state: 'failed', error: String((err as Error)?.message ?? err), updated_at: new Date().toISOString() };
        }
      }
      if (opts.resumed && firstWrite) next = { ...next, resumed: (state.resumed ?? 0) + 1 };
      if (!await writeState(storage, config, rec, next)) continue;
      firstWrite = false;
      if (next.state !== 'running') {
        logger.info(`key re-encrypt: ${next.state}`, { moved: next.counts.moved, current: next.counts.current, unreadable: next.counts.unreadable, conflicts: next.counts.conflicts });
        await releaseHeldLease(storage, config, LEASE);
        emitChange('key-reencrypt');
        return 'done';
      }
      if (Date.now() - lastEmit > 5000) { lastEmit = Date.now(); emitChange('key-reencrypt'); }
      await new Promise(r => setImmediate(r));
    }
  } finally {
    runningHere.delete(config.nodeId);
  }
}

/** One batch of the source at the state's position: the state after it. */
async function runBatch(storage: Storage, config: AimeatConfig, key: Buffer, state: ReencryptState): Promise<ReencryptState> {
  const source = REENCRYPT_SOURCES[state.position.source];
  const now = new Date().toISOString();
  if (!source) return { ...state, state: 'done', finished_at: now, updated_at: now };
  const ctx: SourceCtx = { storage, config, key };
  const rows = await storage.listSealedColumn(source.column, { after: state.position.after, limit: REENCRYPT_BATCH, ...(source.prefix ? { prefix: source.prefix } : {}) });
  const counts = { ...state.counts };
  const mine = { ...(state.by_source[source.id] ?? zero()) };
  const unreadableAt = [...state.unreadable_at];
  for (const row of rows) {
    let tally: Tally = emptyTally();
    let conflict = false;
    if (source.custom) {
      tally = await source.custom(row, ctx);
    } else if (source.column === 'memory') {
      const [key0, ownerGaii] = row.id;
      let plan: RowPlan | null = null;
      try {
        await updateMemoryRecord(storage, ownerGaii, key0, rec => {
          plan = rec ? source.planRecord!(rec, ctx) : null;
          return plan?.next !== undefined ? { value: plan.next } : UNCHANGED;
        });
      } catch (err) {
        // Written by someone else at every attempt: left for the next run to check.
        logger.warn('key re-encrypt: a record kept changing; left for the next run', { key: key0, error: String(err) });
        conflict = true;
      }
      if (plan) tally = (plan as RowPlan).tally;
    } else {
      const plan = source.planRow!(row, ctx);
      tally = plan.tally;
      if (plan.next !== undefined && !await storage.swapSealedColumn(source.column, row.id, row.value, plan.next)) {
        conflict = true;
        tally = { ...tally, moved: 0 };
      }
    }
    counts.checked++; mine.checked++;
    addTally(counts, tally); addTally(mine, tally);
    if (conflict) { counts.conflicts++; mine.conflicts++; }
    if (tally.unreadable > 0 && unreadableAt.length < EXAMPLES) unreadableAt.push({ source: source.id, id: row.id });
  }
  const position = rows.length < REENCRYPT_BATCH
    ? { source: state.position.source + 1, after: null }
    : { source: state.position.source, after: rows[rows.length - 1].id };
  return { ...state, counts, by_source: { ...state.by_source, [source.id]: mine }, unreadable_at: unreadableAt, position, updated_at: now };
}

/**
 * At start: take up a job a stopped process left running. On a node with one data key this reads
 * nothing. While another live process holds the job, it asks again after a process lease's time.
 */
export function resumeReencryptAtBoot(storage: Storage, config: AimeatConfig): void {
  // A second key that is set but not a key, or a current key that names no key, is said once here:
  // the node then seals with the first key as before, which every process can open.
  if (config.encryptionKey1 && !/^[0-9a-fA-F]{64}$/.test(config.encryptionKey1)) {
    logger.error('AIMEAT_ENCRYPTION_KEY_1 is set but is not 64 hexadecimal characters, so this node ignores it and keeps one data key.');
  } else if (config.encryptionKeyCurrent === 1 && !config.encryptionKey1) {
    logger.warn('AIMEAT_ENCRYPTION_KEY_CURRENT=1 names a second data key, and AIMEAT_ENCRYPTION_KEY_1 is not set, so new secrets are sealed with AIMEAT_ENCRYPTION_KEY.');
  }
  if (ringOfConfig(config).keys.length < 2) return;
  logger.info('Data key ring: two keys', { current: ringOfConfig(config).current });
  const attempt = async (): Promise<void> => {
    const { state } = await readState(storage, config);
    if (state?.state !== 'running') return;
    const out = await runReencrypt(storage, config, { resumed: true });
    if (out === 'not-holder') {
      const t = setTimeout(() => { void attempt().catch(err => logger.warn('key re-encrypt: resume failed', { error: String(err) })); }, PROCESS_LEASE_MS);
      t.unref?.();
    }
  };
  void attempt().catch(err => logger.warn('key re-encrypt: resume failed', { error: String(err) }));
}
