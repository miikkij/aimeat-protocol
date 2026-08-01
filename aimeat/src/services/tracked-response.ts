/**
 * @file tracked-response.ts
 * @description Tracked Response — the reference implementation of the Memory Contract pattern
 *   (docs/coding-guidelines/memory-contracts.md; shape in docs/specs/tracked-response-contract.md).
 *   A Tracked Response is one self-describing owner-memory record binding an inbound message ↔ a
 *   watched memory key ↔ a completion condition ↔ a reply policy ↔ delivery state. When the watched
 *   key satisfies the condition, the system sends (auto) or drafts-for-approval (approve) a reply back
 *   to the original message — across federation if needed — reusing services/message-send.ts.
 *   Firing is reactive (the memory-write hook calls evaluateTrackedKey); the reconciler is the safety
 *   net that retriggers errored / missed / stale-in-flight contracts so nothing fails silently.
 * @structure
 *   - createTrackedResponse(ctx, ownerGaii, input) — build + persist + register + initial evaluate
 *   - evaluateTrackedKey(ctx, key) — reactive: evaluate active contracts watching `key`
 *   - reconcileTrackedResponses(ctx) — safety-net sweep
 *   - startTrackedResponseReconciler(config, storage, peers) — periodic sweep (setInterval)
 *   - markReplied(storage, ownerGaii, id, sentMessageId) / cancelTrackedResponse(...) — state ops
 *   - TRACKED_RESPONSE_SPEC — served inline spec for self-description
 * @usage import { createTrackedResponse, evaluateTrackedKey } from '../services/tracked-response.js';
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4: an AUTO-sent reply carries a provenance record —
 *     `assisted` (a person wrote the template, the node filled a slot) with humanInvolvement
 *     `none`, because configuring a trigger once is not reading this message. The `approve`
 *     branch returns earlier and is untouched: there, a person is about to read it.
 *   v1.0.0 — 2026-06-21 — Initial implementation (first Memory Contract instance).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { logger } from '../utils/logger.js';
import { notify } from './notify.js';
import { sendDirectMessage } from './message-send.js';
import { trackKey, untrackKey } from './track-registry.js';
import type { DeliveryCtx } from './message-delivery.js';
import { stampAutonomousOutput } from './ai-provenance.js';

// ── Types ───────────────────────────────────────────────────────────────────
export type TrackedResponseState =
  | 'watching' | 'sent' | 'replied' | 'awaiting-approval' | 'error' | 'cancelled';

export interface TrackedResponseSource {
  kind: 'message';
  messageId: string;
  conversationId: string;
  peerGhii: string;     // reply recipient
  ownerGhii: string;    // reply sender
  originNodeId: string;
  preview?: string;
}
export interface TrackedResponseWatch {
  key: string;
  condition: { field: string; equals: unknown };
}
export interface TrackedResponseResponse {
  channel: 'message.reply';
  mode: 'auto' | 'approve';
  template?: string;
  inject?: { from?: string; field: string };
}
export interface TrackedResponse {
  type: 'tracked-response';
  spec: string;
  specVersion: number;
  id: string;
  ownerGaii: string;
  title: string;
  state: TrackedResponseState;
  tier?: string;
  source: TrackedResponseSource;
  watch: TrackedResponseWatch;
  references?: Record<string, unknown>;
  response: TrackedResponseResponse;
  tracking: { lastUpdatedAt: string | null; lastTriggeredAt: string | null; attempts: number; lastError: string | null };
  delivery: { sentMessageId: string | null; sentAt: string | null; draftKey: string | null };
  ledger: Array<{ at: string; event: string; [k: string]: unknown }>;
  createdAt: string;
  updatedAt: string;
}

const SPEC_REF = '/v1/tracked-responses/spec';
const CONTRACT_PREFIX = 'tracked-response.';
const DRAFT_PREFIX = 'tracked-response-draft.';
const MAX_PER_SCAN = 100;       // safety cap per reconciler tick
const MAX_ATTEMPTS = 5;         // give up auto-retry after this many failed sends
const STALE_INFLIGHT_MS = 5 * 60_000;   // a 'sent' marker older than this with no sentMessageId → retry
const RECONCILE_INTERVAL_MS = 10 * 60_000;
const LEDGER_CAP = 50;

const contractKey = (id: string) => `${CONTRACT_PREFIX}${id}.latest`;
const draftKey = (id: string) => `${DRAFT_PREFIX}${id}.latest`;

/** Synchronous in-process lock: prevents the reactive hook and the reconciler from double-firing the
 *  same contract. Set before any await, so single-threaded JS guarantees mutual exclusion. */
const inFlight = new Set<string>();

async function upsert(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key, ownerGaii, value, visibility: 'private', tags: [],
    ttlHours: null, version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

async function persist(storage: Storage, c: TrackedResponse): Promise<void> {
  c.updatedAt = new Date().toISOString();
  if (c.ledger.length > LEDGER_CAP) c.ledger = c.ledger.slice(-LEDGER_CAP);
  await upsert(storage, c.ownerGaii, contractKey(c.id), c);
}

function ledger(c: TrackedResponse, event: string, extra?: Record<string, unknown>): void {
  c.ledger.push({ at: new Date().toISOString(), event, ...(extra || {}) });
}

/** Read the current value of an arbitrary watched memory key without knowing its owner GAII. The
 *  memory key is unique per (owner, key); a prefix scan on the exact key resolves it cross-owner. */
async function readWatchedValue(storage: Storage, key: string): Promise<unknown | undefined> {
  const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
  return items.find(i => i.key === key)?.value;
}

function conditionMet(value: unknown, cond: TrackedResponseWatch['condition']): boolean {
  if (value == null || typeof value !== 'object') return false;
  return (value as Record<string, unknown>)[cond.field] === cond.equals;
}

function injectResult(value: unknown, inject?: TrackedResponseResponse['inject']): string {
  if (!inject?.field || value == null || typeof value !== 'object') return '';
  const v = (value as Record<string, unknown>)[inject.field];
  return v == null ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
}

function renderTemplate(c: TrackedResponse, result: string): string {
  const tpl = c.response.template || 'Done — {{title}}. {{result}}';
  return tpl
    .replaceAll('{{title}}', c.title || '')
    .replaceAll('{{result}}', result || '')
    .replaceAll('{{sourcePreview}}', c.source.preview || '');
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface CreateTrackedResponseInput {
  title: string;
  tier?: string;
  source: TrackedResponseSource;
  watch: TrackedResponseWatch;
  references?: Record<string, unknown>;
  response: TrackedResponseResponse;
}

export async function createTrackedResponse(
  ctx: DeliveryCtx, ownerGaii: string, input: CreateTrackedResponseInput,
): Promise<TrackedResponse> {
  const now = new Date().toISOString();
  const id = 'tr_' + randomUUID().replace(/-/g, '').slice(0, 12);
  const c: TrackedResponse = {
    type: 'tracked-response',
    spec: SPEC_REF,
    specVersion: 1,
    id,
    ownerGaii,
    title: input.title,
    state: 'watching',
    tier: input.tier || 'tracked',
    source: input.source,
    watch: input.watch,
    references: input.references || {},
    response: input.response,
    tracking: { lastUpdatedAt: null, lastTriggeredAt: null, attempts: 0, lastError: null },
    delivery: { sentMessageId: null, sentAt: null, draftKey: null },
    ledger: [{ at: now, event: 'created' }],
    createdAt: now,
    updatedAt: now,
  };
  await persist(ctx.storage, c);
  trackKey(c.watch.key);
  // The condition may already hold (work done before the contract was created) — evaluate immediately.
  await evaluateContract(ctx, c).catch(err =>
    logger.warn(`tracked-response initial evaluate failed for ${id}: ${String((err as Error).message || err)}`));
  return c;
}

// ── Evaluate + fire ───────────────────────────────────────────────────────────
/** Evaluate one contract: if its watched condition is met, fire the reply (auto) or draft it (approve).
 *  Idempotent + locked. Mutates + persists the passed contract object. */
async function evaluateContract(ctx: DeliveryCtx, c: TrackedResponse): Promise<void> {
  if (c.state !== 'watching' && c.state !== 'error') return;
  if (c.state === 'error' && c.tracking.attempts >= MAX_ATTEMPTS) return;   // gave up
  if (inFlight.has(c.id)) return;
  inFlight.add(c.id);
  try {
    const { storage } = ctx;
    const watchedValue = await readWatchedValue(storage, c.watch.key);
    if (watchedValue !== undefined) c.tracking.lastUpdatedAt = new Date().toISOString();
    if (!conditionMet(watchedValue, c.watch.condition)) return;   // not yet — stay watching

    const result = injectResult(watchedValue, c.response.inject);
    const body = renderTemplate(c, result);
    c.tracking.lastTriggeredAt = new Date().toISOString();

    if (c.response.mode === 'approve') {
      // Draft the suggested reply for the owner to approve/edit; do NOT send.
      await upsert(storage, c.ownerGaii, draftKey(c.id), { body, result, builtAt: c.tracking.lastTriggeredAt });
      c.delivery.draftKey = draftKey(c.id);
      c.state = 'awaiting-approval';
      ledger(c, 'awaiting-approval');
      await persist(storage, c);
      await notify(storage, c.ownerGaii, {
        type: 'tracked_response_ready',
        title: 'Reply ready to send',
        body: `"${c.title}" — the linked work is done; a suggested reply is ready.`,
        link: `/v1/profile#inbox/${c.source.conversationId}`,
      }).catch(err => { logger.warn('evaluateContract: notify best-effort', { error: String(err) }); });
      return;
    }

    // Auto: mark in-flight (persisted) before the send so a crash/retry won't double-send.
    c.state = 'sent';
    await persist(storage, c);
    // TARGET-058. This is an automated reply DELIVERED to a person, and it goes out with nobody
    // having read it — the owner wrote the template once and configured the trigger, which is not
    // the same as reading this message. So `humanInvolvement` stays `none`; the `approve` branch
    // above returns before here precisely because a person is about to read that one.
    //
    // `assisted` rather than `ai-generated`: a human wrote the template and the node filled a slot
    // in it. Claiming a model wrote the whole thing would be as false as claiming a person did.
    const aiProvenanceId = await stampAutonomousOutput(storage, {
      principal: c.source.ownerGhii,
      content: body,
      level: 'assisted',
      method: 'rewritten',
      pipeline: `tracked-response:${c.id}`,
      surface: { visibility: 'private', humanAudience: true },
      labelPolicy: ctx.config.aiLabelPublic,
      nodeId: ctx.config.nodeId,
      baseUrl: ctx.config.baseUrl,
      enabled: ctx.config.aiProvenance,
    });
    const sent = await sendDirectMessage(ctx, {
      senderGhii: c.source.ownerGhii,
      recipientGhii: c.source.peerGhii,
      body,
      replyToId: c.source.messageId,
      aiProvenanceId,
    });
    if (sent.ok) {
      c.delivery.sentMessageId = sent.message.id;
      c.delivery.sentAt = new Date().toISOString();
      c.state = 'replied';
      c.tracking.lastError = null;
      ledger(c, 'replied', { messageId: sent.message.id, status: sent.message.status });
      untrackKey(c.watch.key);
    } else {
      c.tracking.attempts += 1;
      c.tracking.lastError = sent.code;
      c.state = 'error';
      ledger(c, 'reply-failed', { code: sent.code, attempts: c.tracking.attempts });
    }
    await persist(storage, c);
  } finally {
    inFlight.delete(c.id);
  }
}

/** Reactive entrypoint: a watched key was written — evaluate the active contracts watching it. */
export async function evaluateTrackedKey(ctx: DeliveryCtx, key: string): Promise<void> {
  const { items } = await ctx.storage.listAllMemory({ prefix: CONTRACT_PREFIX, limit: 10_000 });
  for (const rec of items) {
    const c = rec.value as TrackedResponse | null;
    if (!c || c.type !== 'tracked-response' || c.watch?.key !== key) continue;
    if (c.state !== 'watching' && c.state !== 'error') continue;
    try { await evaluateContract(ctx, c); }
    catch (err) { logger.warn(`tracked-response evaluate failed for ${c.id}: ${String((err as Error).message || err)}`); }
  }
}

/** Safety-net sweep: retrigger errored, missed (condition already true but never fired), or
 *  stale-in-flight contracts. Idempotent — relies on evaluateContract's lock + state guards. */
export async function reconcileTrackedResponses(ctx: DeliveryCtx): Promise<{ evaluated: number }> {
  const { storage } = ctx;
  const { items } = await storage.listAllMemory({ prefix: CONTRACT_PREFIX, limit: 10_000 });
  let evaluated = 0;
  for (const rec of items) {
    if (evaluated >= MAX_PER_SCAN) break;
    const c = rec.value as TrackedResponse | null;
    if (!c || c.type !== 'tracked-response') continue;

    // Recover a stale in-flight 'sent' marker (process died between marker + send result).
    if (c.state === 'sent' && !c.delivery.sentMessageId) {
      const trig = c.tracking.lastTriggeredAt ? new Date(c.tracking.lastTriggeredAt).getTime() : 0;
      if (Date.now() - trig > STALE_INFLIGHT_MS) { c.state = 'watching'; await persist(storage, c); }
    }

    if (c.state === 'watching' || c.state === 'error') {
      if (c.state === 'error' && c.tracking.attempts >= MAX_ATTEMPTS) continue;
      try { await evaluateContract(ctx, c); evaluated++; }
      catch (err) { logger.warn(`tracked-response reconcile failed for ${c.id}: ${String((err as Error).message || err)}`); }
    }
  }
  return { evaluated };
}

/** Evaluate the caller's OWN due contracts now (manual trigger / test hook). */
export async function evaluateOwnerTrackedResponses(ctx: DeliveryCtx, ownerGaii: string): Promise<{ evaluated: number }> {
  const items = await ctx.storage.listMemory(ownerGaii);
  let evaluated = 0;
  for (const rec of items) {
    const c = rec.value as TrackedResponse | null;
    if (!c || c.type !== 'tracked-response') continue;
    if (c.state !== 'watching' && c.state !== 'error') continue;
    try { await evaluateContract(ctx, c); evaluated++; }
    catch (err) { logger.warn(`tracked-response owner-eval failed for ${c.id}: ${String((err as Error).message || err)}`); }
  }
  return { evaluated };
}

// ── State ops ─────────────────────────────────────────────────────────────────
export async function getTrackedResponse(storage: Storage, ownerGaii: string, id: string): Promise<TrackedResponse | null> {
  const rec = await storage.getMemory(ownerGaii, contractKey(id));
  return (rec?.value as TrackedResponse) ?? null;
}

export async function listTrackedResponses(storage: Storage, ownerGaii: string, state?: TrackedResponseState): Promise<TrackedResponse[]> {
  const items = await storage.listMemory(ownerGaii);
  return items
    .map(i => i.value as TrackedResponse | null)
    .filter((c): c is TrackedResponse => !!c && c.type === 'tracked-response' && (!state || c.state === state))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** Mark a contract replied after the owner sent the (possibly edited) draft via the normal composer. */
export async function markReplied(storage: Storage, ownerGaii: string, id: string, sentMessageId?: string): Promise<TrackedResponse | null> {
  const c = await getTrackedResponse(storage, ownerGaii, id);
  if (!c) return null;
  c.state = 'replied';
  c.delivery.sentMessageId = sentMessageId || c.delivery.sentMessageId;
  c.delivery.sentAt = new Date().toISOString();
  ledger(c, 'replied', { messageId: c.delivery.sentMessageId, via: 'manual' });
  untrackKey(c.watch.key);
  await persist(storage, c);
  return c;
}

export async function cancelTrackedResponse(storage: Storage, ownerGaii: string, id: string): Promise<TrackedResponse | null> {
  const c = await getTrackedResponse(storage, ownerGaii, id);
  if (!c) return null;
  c.state = 'cancelled';
  ledger(c, 'cancelled');
  untrackKey(c.watch.key);
  await persist(storage, c);
  return c;
}

// ── Reconciler job ────────────────────────────────────────────────────────────
/** Periodic safety-net sweep (mirrors startMessageRetryJob — runs where `peers` is available). */
export function startTrackedResponseReconciler(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): ReturnType<typeof setInterval> {
  const ctx: DeliveryCtx = { config, storage, peers };
  return setInterval(() => {
    reconcileTrackedResponses(ctx).catch(err =>
      logger.error('tracked-response reconcile sweep failed', { error: (err as Error).message }));
  }, RECONCILE_INTERVAL_MS);
}

// ── Served spec (self-description for AIs) ──────────────────────────────────────
export const TRACKED_RESPONSE_SPEC = {
  type: 'tracked-response',
  version: 1,
  oneLine: 'An important inbox message owed a response once a linked follow-up has been completed.',
  doc: 'docs/specs/tracked-response-contract.md',
  rules: [
    'Never delete the source message — it is the reply target.',
    'Only watch.key + watch.condition drive firing; advance the watched record to fulfil.',
    'The reply carries response.inject.field from the watched value verbatim.',
    'A contract with delivery.sentMessageId already replied — never re-send.',
    'Any field may be edited as long as the shape is preserved and type stays tracked-response.',
  ],
  states: ['watching', 'sent', 'replied', 'awaiting-approval', 'error', 'cancelled'],
} as const;
