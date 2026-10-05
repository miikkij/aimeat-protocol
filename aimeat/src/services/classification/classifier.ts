/**
 * @file src/services/classification/classifier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Content Classifier (TARGET-082 V3, spec §7): judges how sensitive a piece of
 *   content is and labels it by the policy's rules.
 *
 *   ORDER. The detection rules run first, with no model (detect.ts), and a match is set as a rule
 *   label. The model runs after, only when the policy lets an AI label (aiMode not off), only when
 *   the content's current label lets an AI read it (reader.useForAi as the node's own reader), and
 *   only within the day's caps. What the model says goes through setLabel as an AI: it never lowers a
 *   label and never changes a person's; the policy's AI mode and confidence threshold decide whether
 *   it applies or waits as a suggestion. When setLabel refuses the model's label (a label whose
 *   reader audience leaves the classifier out, say), the outcome is LABEL_REFUSED, not an error.
 *
 *   TWO KINDS OF MODEL (decided 2026-09-29). jev: the decision model picks one label, with the
 *   label descriptions as the options' meanings and its probability as the confidence (the answer's
 *   confidence, else the chosen option's probability). llm: the owner's text model answers
 *   { label, confidence, reason } in JSON; the first balanced JSON object of the answer is read, code
 *   fences or prose around it are ignored. Both scrub personal data from the content before it
 *   leaves, whatever the owner allows elsewhere (strictScrub), because content judged for its
 *   sensitivity is the content that must not leave as it is.
 *
 *   WHO PAYS. Personal content: its owner (an agent's or app's content: the person behind it).
 *   Organism content: the organism's first owner.
 *
 *   CAPS. A counter per day under system@<node> counts calls per owner (or organism) and for the node.
 *   Past a cap nothing is left unclassified in silence: the item keeps the default label and waits in
 *   the queue, which drainQueue works through when the day turns.
 *
 *   THE QUEUE (review of 2026-09-29). One record per owner or organism under system@<node>
 *   (`classification.queue.of.<owner>`, at most QUEUE_MAX items each, the oldest dropped past it), so
 *   one owner cannot push another's items out, and an index record (`classification.queue.index`)
 *   that lists the queues with items and where the next run starts. Every write to the queues, the
 *   index and the day's counter is a compare-and-swap with retry (storage setMemoryIfVersion and
 *   createMemoryIfAbsent), so an enqueue during a drain is not lost and two calls cannot both take
 *   the last call under a cap. enqueue() takes a batch and writes each owner's queue once.
 *   drainQueue() walks the queues in turn, one item from each per round, starting where the last run
 *   stopped. An item that fails (a provider error, a storage error, anything thrown) is kept with its
 *   try count and reason, and dropped after MAX_TRIES; the node's cap stops the whole run and an
 *   owner's cap stops that owner's queue; what was judged is written back in `finally`, so a failure
 *   never makes the next run pay again for what this one did.
 * @structure ClassifyOutcome · QueuedItem · classifyText() · enqueue() · drainQueue() · readQueue() ·
 *   firstJsonObject()
 * @usage const out = await classifyText(deps, target, text);
 * @version-history
 *   v2.0.2 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     The classifier's decisions pass `limit: 'exempt'`: it is node-internal work drained from a queue.
 *   v2.0.1 — 2026-09-30 — readSystem, UNCHANGED and updateSystem moved unchanged to system-record.ts,
 *     which the exceptions list writes through too.
 *   v2.0.0 — 2026-09-29 — Review fixes: a queue per owner with an index, compare-and-swap writes for
 *     the queues and the counter, batch enqueue, per-item failure handling with a try count, the
 *     node's cap stops a drain, LABEL_REFUSED, an optional policy from the caller, the jev confidence
 *     from the option's probability, and a tolerant JSON read of the llm answer.
 *   v1.1.0 — 2026-09-29 — A null daily cap is no cap: the call is counted and never queued for it.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { localAccountOf } from '../../utils/gaii.js';
import { decideForOwner } from '../decide/service.js';
import { completeForOwner } from '../ai-completion.js';
import { createScrubber } from '../decide/scrub.js';
import { organismOwners } from '../organism-ownership.js';
import type { ClassificationLabel, ClassificationPolicy } from './defaults.js';
import { matchRules } from './detect.js';
import { ownerOfScope, scopeOrganism } from './policy.js';
import { ClassificationError, setLabel, type LabelActor, type SetLabelResult } from './labels.js';
import { activePolicies, systemReader } from './reader.js';
import { readSystem, UNCHANGED, updateSystem } from './system-record.js';
import { OWNER_CALLER } from '../ai/caller-context.js';

type Deps = { storage: Storage; config: AimeatConfig };

export interface ClassifyOutcome {
  /** What set or suggested a label: a rule, the model, both, or nothing yet. */
  by: 'rule' | 'jev' | 'llm' | 'none';
  rule?: { label: string; rules: string[]; result: SetLabelResult };
  model?: { label: string; confidence: number; reason: string; result: SetLabelResult };
  /** Why the model did not run or did not label: OFF, AI_LABELLING_OFF, HIDDEN_FROM_AI, CAPPED
   *  (queued), FAILED, LABEL_REFUSED (setLabel refused the model's label; `message` says why). */
  skipped?: string;
  /** With CAPPED: whose cap, the node's or the owner's. */
  cap?: 'node' | 'owner';
  /** With FAILED: the model call itself failed, so trying again later may work. */
  retry?: boolean;
  message?: string;
}

/** A piece of content waiting for the classifier. */
export interface QueuedItem {
  scope: string;
  kind: ContentLabelTarget['kind'];
  key: string;
  at: string;
  /** 'write': queued by the write hook, so the model runs only where classifier.onWrite says. */
  origin?: 'write';
  /** How many runs failed on it, and the last reason. Dropped at MAX_TRIES. */
  tries?: number;
  reason?: string;
}

const INDEX_KEY = 'classification.queue.index';
/** The single queue of V3, read once by drainQueue and folded into the per-owner queues. */
const LEGACY_QUEUE_KEY = 'classification.queue';
const queueKey = (owner: string) => `classification.queue.of.${owner}`;
/** Items per owner's queue. */
export const QUEUE_MAX = 2000;
const MAX_TRIES = 3;
const MAX_CONTENT = 6000;
const usageKey = (day: string) => `classification.classifier.usage.${day}`;
const today = () => new Date().toISOString().slice(0, 10);

/** The owner a scope's queue and caps belong to: the organism, or the person behind an identity. */
function queueOwnerOf(scope: string): string {
  return ownerOfScope(scope) ?? scope;
}

function nodeActor(config: AimeatConfig, target: ContentLabelTarget, kind: 'rule' | 'ai'): LabelActor {
  const personal = !scopeOrganism(target.scope);
  const owner = personal ? queueOwnerOf(target.scope) : `system@${config.nodeId}`;
  return { principal: `classifier@${config.nodeId}`, ownerGhii: owner, ownerName: personal ? localAccountOf(owner) : null, kind, nodeOwn: true };
}

async function payerOf(deps: Deps, scope: string): Promise<string | null> {
  const orgId = scopeOrganism(scope);
  if (!orgId) return queueOwnerOf(scope);
  const org = await deps.storage.getOrganism(orgId);
  const first = org ? organismOwners(org)[0] : null;
  return first ? `${first}@${deps.config.nodeId}` : null;
}

// ─── The node's own records, written by compare-and-swap (system-record.ts) ─────────────────────

type Usage = { node: number; by: Record<string, number> };
const parseUsage = (v: unknown): Usage => {
  const u = v as Partial<Usage> | undefined;
  return { node: typeof u?.node === 'number' ? u.node : 0, by: u?.by && typeof u.by === 'object' ? { ...u.by } : {} };
};

/** Take one call from today's caps: 'ok', or whose cap is reached. */
async function takeCall(deps: Deps, policy: ClassificationPolicy, owner: string): Promise<'ok' | 'node' | 'owner'> {
  const c = policy.classifier;
  // A null cap is no cap. Compared explicitly: `0 >= null` is true in JavaScript, so a bare
  // comparison would read "no cap" as "a cap of zero" and queue everything.
  const over = (count: number, cap: number | null) => cap !== null && count >= cap;
  let verdict: 'ok' | 'node' | 'owner' = 'ok';
  // A day's counter is read only on its day, so it may expire a few days later.
  await updateSystem(deps.storage, deps.config.nodeId, usageKey(today()), parseUsage, cur => {
    if (over(cur.node, c.dailyNode)) { verdict = 'node'; return UNCHANGED; }
    if (over(cur.by[owner] ?? 0, c.dailyPerOwner)) { verdict = 'owner'; return UNCHANGED; }
    verdict = 'ok';
    return { node: cur.node + 1, by: { ...cur.by, [owner]: (cur.by[owner] ?? 0) + 1 } };
  }, 72);
  return verdict;
}

// ─── The queue ──────────────────────────────────────────────────────────────────────────────────

type QueueIndex = { queues: Array<{ id: string; n: number }>; next: string | null };
const parseIndex = (v: unknown): QueueIndex => {
  const x = v as Partial<QueueIndex> | undefined;
  const queues = Array.isArray(x?.queues)
    ? x.queues.filter(q => q && typeof q.id === 'string').map(q => ({ id: q.id, n: typeof q.n === 'number' ? q.n : 0 }))
    : [];
  return { queues, next: typeof x?.next === 'string' ? x.next : null };
};
const parseQueue = (v: unknown): QueuedItem[] =>
  Array.isArray(v) ? (v as QueuedItem[]).filter(i => i && typeof i.scope === 'string' && typeof i.key === 'string') : [];
const idOf = (i: { scope: string; kind: string; key: string }) => `${i.kind}\u0000${i.scope}\u0000${i.key}`;
/** An item as it was when a run took it: a newer enqueue of the same content is another version. */
const versionOf = (i: QueuedItem) => `${idOf(i)}\u0000${i.at}`;

async function readQueueOf(storage: Storage, nodeId: string, owner: string): Promise<QueuedItem[]> {
  return parseQueue((await readSystem(storage, nodeId, queueKey(owner)))?.value);
}

/** Everything waiting, every owner's queue in the index's order. For tests and a status view. */
export async function readQueue(storage: Storage, nodeId: string): Promise<QueuedItem[]> {
  const index = parseIndex((await readSystem(storage, nodeId, INDEX_KEY))?.value);
  const out: QueuedItem[] = [];
  for (const q of index.queues) out.push(...await readQueueOf(storage, nodeId, q.id));
  return out;
}

/**
 * Put content in the queue for the classifier, once each: one write per owner's queue and one for
 * the index, however many targets. Content already waiting gets a fresh time and a fresh try count,
 * because it was written again. Past QUEUE_MAX an owner's oldest items drop off, and only theirs.
 */
export async function enqueue(
  deps: Deps, targets: ContentLabelTarget | readonly ContentLabelTarget[], opts: { origin?: 'write' } = {},
): Promise<void> {
  const list = Array.isArray(targets) ? targets as readonly ContentLabelTarget[] : [targets as ContentLabelTarget];
  if (!list.length) return;
  const nodeId = deps.config.nodeId;
  const byOwner = new Map<string, ContentLabelTarget[]>();
  for (const t of list) byOwner.set(queueOwnerOf(t.scope), [...(byOwner.get(queueOwnerOf(t.scope)) ?? []), t]);
  const at = new Date().toISOString();
  const counts = new Map<string, number>();
  for (const [owner, ts] of byOwner) {
    let trimmed = 0;
    const stored = await updateSystem(deps.storage, nodeId, queueKey(owner), parseQueue, cur => {
      const next = [...cur];
      const pos = new Map(next.map((i, n) => [idOf(i), n]));
      for (const t of ts) {
        const n = pos.get(idOf(t));
        if (n === undefined) {
          pos.set(idOf(t), next.length);
          next.push({ scope: t.scope, kind: t.kind, key: t.key, at, ...(opts.origin ? { origin: opts.origin } : {}) });
          continue;
        }
        const had = next[n]!;
        // Waiting for the model already wins over waiting for the rules only.
        const origin = had.origin && opts.origin ? had.origin : undefined;
        next[n] = { scope: had.scope, kind: had.kind, key: had.key, at, ...(origin ? { origin } : {}) };
      }
      trimmed = Math.max(0, next.length - QUEUE_MAX);
      return trimmed ? next.slice(-QUEUE_MAX) : next;
    });
    if (trimmed) logger.warn('classification: an owner\'s classifier queue is full; its oldest items drop off', { owner, dropped: trimmed, max: QUEUE_MAX });
    counts.set(owner, stored.length);
  }
  // Always written, even when every owner is listed already: the version change is what makes a
  // drain that is about to remove an owner from the index read that owner's queue again.
  await updateSystem(deps.storage, nodeId, INDEX_KEY, parseIndex, idx => {
    const queues = idx.queues.map(q => (counts.has(q.id) ? { id: q.id, n: counts.get(q.id)! } : q));
    for (const [id, n] of counts) if (!queues.some(q => q.id === id)) queues.push({ id, n });
    return { queues, next: idx.next };
  });
}

/** Folds the V3 single queue into the per-owner queues, once. */
async function foldLegacyQueue(deps: Deps): Promise<void> {
  const legacy = parseQueue((await readSystem(deps.storage, deps.config.nodeId, LEGACY_QUEUE_KEY))?.value);
  if (!legacy.length) return;
  await enqueue(deps, legacy.map(i => ({ kind: i.kind, scope: i.scope, key: i.key })));
  await updateSystem(deps.storage, deps.config.nodeId, LEGACY_QUEUE_KEY, parseQueue, () => []);
}

function criteriaOf(policy: ClassificationPolicy): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of policy.labels) if (l.status === 'active') out[l.id] = `${l.name.en}: ${l.description || 'no description'}`;
  return out;
}

async function askJev(deps: Deps, payer: string, policy: ClassificationPolicy, target: ContentLabelTarget, content: string) {
  const r = await decideForOwner(deps.storage, deps.config,
    { gaii: payer, principal: `classifier@${deps.config.nodeId}`, appId: 'classification', isOwner: false, limit: 'exempt' },
    {
      state: { content },
      questions: { label: { type: 'choice', instructions: 'Which classification fits this content? Pick the most sensitive one the content calls for.', criteria: criteriaOf(policy) } } as never,
      subject: `${target.kind}:${target.key}`,
      gates: 'the classification label of a piece of content',
      ...(policy.classifier.provider ? { provider: policy.classifier.provider } : {}),
      strictScrub: true,
    });
  const ans = (r.answers?.label ?? {}) as unknown as { value?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> };
  const label = String(ans.value ?? '');
  // The answer's own confidence, else the probability the model gave the option it chose.
  const p = ans.probabilities && typeof ans.probabilities === 'object' ? ans.probabilities[label] : undefined;
  const confidence = typeof ans.confidence === 'number' ? ans.confidence : typeof p === 'number' ? p : 0;
  return { label, confidence, reason: `decision ${r.decision_id}` };
}

/**
 * The first balanced JSON object in a model's answer, or null. Code fences and prose around it are
 * ignored, and braces inside strings do not count; an object that does not parse is skipped for
 * the next one.
 */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1)) as unknown;
          if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        // eslint-disable-next-line aimeat/no-silent-catch -- not JSON after all: the next opening brace is tried
        } catch { /* the next opening brace is tried */ }
        break;
      }
    }
  }
  return null;
}

async function askLlm(deps: Deps, payer: string, policy: ClassificationPolicy, content: string) {
  const labels = policy.labels.filter(l => l.status === 'active')
    .map(l => `- ${l.id} (rank ${l.rank}): ${l.name.en}. ${l.description}`).join('\n');
  const rules = policy.rules.filter(r => r.enabled && r.kind === 'classifier').map(r => `- ${r.name}: at least ${r.minLabel}`).join('\n');
  const prompt = `You classify how sensitive a piece of content is. Pick exactly one label id from this list; `
    + `when two could fit, pick the more sensitive one.\n${labels}\n${rules ? `Rules the owner wrote:\n${rules}\n` : ''}`
    + `Personal data in the content has been replaced by placeholders such as [EMAIL_1]; a placeholder is evidence that such data was there.\n`
    + `Answer with one JSON object and nothing else: {"label": "<id>", "confidence": <0..1>, "reason": "<one sentence>"}.\n\nCONTENT:\n${content}`;
  const out = await completeForOwner(deps.storage, deps.config, payer, {
    prompt, capability: 'text', appId: 'classification',
    // The node classifies for the owner with nobody else asking (services/ai/caller-context.ts).
    caller: OWNER_CALLER.caller,
    ...(policy.classifier.provider ? { provider: policy.classifier.provider } : {}),
  });
  const j = firstJsonObject(out.content) ?? {};
  return {
    label: typeof j.label === 'string' ? j.label.trim() : '',
    confidence: typeof j.confidence === 'number' ? j.confidence : 0,
    reason: typeof j.reason === 'string' ? j.reason.slice(0, 500) : '',
  };
}

/**
 * Classify one piece of content from its text. With classification off for its scope, nothing is
 * read and nothing is set. `useModel` false runs the rules alone (the free part, on every write).
 * `policy` is the policy the caller already read for this scope (and found classification on);
 * without it the switch and the policy are read here.
 */
export async function classifyText(
  deps: Deps, target: ContentLabelTarget, text: string,
  opts: { useModel?: boolean; queueWhenCapped?: boolean; policy?: ClassificationPolicy } = {},
): Promise<ClassifyOutcome> {
  const policy = opts.policy ?? (await activePolicies(deps, [target.scope])).get(target.scope);
  if (!policy) return { by: 'none', skipped: 'OFF' };
  const out: ClassifyOutcome = { by: 'none' };

  const hit = matchRules(policy, target, text);
  if (hit) {
    const result = await setLabel(deps, nodeActor(deps.config, target, 'rule'), target, { label: hit.label, reason: `detection rule ${hit.rules.join(', ')}` });
    out.by = 'rule';
    out.rule = { label: hit.label, rules: hit.rules, result };
  }
  if (opts.useModel === false) return out;
  if (policy.aiMode === 'off') return { ...out, skipped: 'AI_LABELLING_OFF' };

  // The model reads the content only when its current label lets an AI read it (spec §7).
  try {
    await systemReader(deps, target.scope).useForAi([target], { capability: 'classify' });
  } catch (e) {
    if (e instanceof ClassificationError) return { ...out, skipped: 'HIDDEN_FROM_AI', message: e.message };
    throw e;
  }
  const payer = await payerOf(deps, target.scope);
  if (!payer) return { ...out, skipped: 'FAILED', message: 'Nobody holds this organism, so nobody pays for its classifier.' };
  const cap = await takeCall(deps, policy, queueOwnerOf(target.scope));
  if (cap !== 'ok') {
    if (opts.queueWhenCapped !== false) await enqueue(deps, target);
    return { ...out, skipped: 'CAPPED', cap, message: "Today's classifier calls are used up; the item waits in the queue with its current label." };
  }

  const scrubbed = createScrubber().text(text.slice(0, MAX_CONTENT));
  let answer: { label: string; confidence: number; reason: string };
  try {
    answer = policy.classifier.type === 'llm'
      ? await askLlm(deps, payer, policy, scrubbed)
      : await askJev(deps, payer, policy, target, scrubbed);
  } catch (e) {
    logger.warn(`[classification] classifier failed for ${target.kind}:${target.key}: ${(e as Error).message}`);
    // A provider error is usually passing: the item waits in the queue for another try.
    if (opts.queueWhenCapped !== false) await enqueue(deps, target);
    return { ...out, skipped: 'FAILED', retry: true, message: (e as Error).message };
  }
  const label: ClassificationLabel | undefined = policy.labels.find(l => l.id === answer.label && l.status === 'active');
  if (!label) return { ...out, skipped: 'FAILED', message: `The classifier answered "${answer.label}", which is not an active label.` };
  let result: SetLabelResult;
  try {
    result = await setLabel(deps, nodeActor(deps.config, target, 'ai'), target, {
      label: label.id, confidence: answer.confidence, reason: answer.reason || `${policy.classifier.type} classifier`,
    });
  } catch (e) {
    if (!(e instanceof ClassificationError)) throw e;
    return { ...out, skipped: 'LABEL_REFUSED', message: `${e.code}: ${e.message}` };
  }
  return { ...out, by: out.by === 'rule' ? 'rule' : policy.classifier.type, model: { label: label.id, confidence: answer.confidence, reason: answer.reason, result } };
}

// ─── Working through the queue ──────────────────────────────────────────────────────────────────

type Verdict = { kind: 'done'; judged: boolean } | { kind: 'retry'; reason: string } | { kind: 'capped'; cap: 'node' | 'owner' };

/** One queued item, whatever happens: an error becomes a retry with its reason, never a throw. */
async function judge(deps: Deps, textOf: (item: QueuedItem) => Promise<string | null>, item: QueuedItem): Promise<Verdict> {
  try {
    const text = await textOf(item);
    if (text === null) return { kind: 'done', judged: false };
    const target: ContentLabelTarget = { kind: item.kind, scope: item.scope, key: item.key };
    const policy = (await activePolicies(deps, [target.scope])).get(target.scope);
    if (!policy) return { kind: 'done', judged: false };
    const useModel = item.origin === 'write' ? policy.classifier.onWrite.includes(item.kind) : true;
    const out = await classifyText(deps, target, text, { queueWhenCapped: false, policy, useModel });
    if (out.skipped === 'CAPPED') return { kind: 'capped', cap: out.cap ?? 'owner' };
    if (out.skipped === 'FAILED' && out.retry) return { kind: 'retry', reason: out.message ?? 'the model call failed' };
    return { kind: 'done', judged: true };
  } catch (e) {
    return { kind: 'retry', reason: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

interface QueueRun { items: QueuedItem[]; pos: number; stopped: boolean; remove: Set<string>; retry: Map<string, { tries: number; reason: string }> }

let draining = false;

/**
 * Work through the queues within today's caps, at most `max` items. `textOf` loads an item's text
 * (null when it is gone). Answers how many were judged and how many are still waiting. A second
 * call while one runs does nothing.
 */
export async function drainQueue(
  deps: Deps, textOf: (item: QueuedItem) => Promise<string | null>, max = 200,
): Promise<{ done: number; waiting: number }> {
  if (draining) return { done: 0, waiting: 0 };
  draining = true;
  const nodeId = deps.config.nodeId;
  const runs = new Map<string, QueueRun>();
  let order: string[] = [];
  let firstRound = 0;
  let done = 0;
  let waiting: number;
  try {
    await foldLegacyQueue(deps);
    const index = parseIndex((await readSystem(deps.storage, nodeId, INDEX_KEY))?.value);
    const ids = index.queues.map(q => q.id);
    const start = Math.max(0, index.next ? ids.indexOf(index.next) : 0);
    order = [...ids.slice(start), ...ids.slice(0, start)];
    let tried = 0;
    let stopAll = false;
    for (let round = 0; order.length && !stopAll && tried < max; round++) {
      let progressed = false;
      for (const owner of order) {
        if (tried >= max || stopAll) break;
        let run = runs.get(owner);
        if (!run) {
          run = { items: await readQueueOf(deps.storage, nodeId, owner), pos: 0, stopped: false, remove: new Set(), retry: new Map() };
          runs.set(owner, run);
        }
        if (run.stopped || run.pos >= run.items.length) continue;
        const item = run.items[run.pos++]!;
        progressed = true;
        tried++;
        if (round === 0) firstRound++;
        const v = await judge(deps, textOf, item);
        if (v.kind === 'done') { run.remove.add(versionOf(item)); if (v.judged) done++; }
        else if (v.kind === 'capped') { run.pos--; if (v.cap === 'node') stopAll = true; else run.stopped = true; }
        else {
          const tries = (item.tries ?? 0) + 1;
          if (tries >= MAX_TRIES) {
            run.remove.add(versionOf(item));
            logger.warn('classification: a queued item failed three times and leaves the queue', { key: item.key, scope: item.scope, reason: v.reason });
          } else run.retry.set(versionOf(item), { tries, reason: v.reason });
        }
      }
      if (!progressed) break;
    }
  } finally {
    // Written whatever happened above, so what this run did is never paid for again.
    try {
      waiting = await writeBack(deps, runs, order, firstRound);
    } finally {
      draining = false;
    }
  }
  return { done, waiting };
}

/** Write each touched queue and the index back; answers how many items still wait. */
async function writeBack(deps: Deps, runs: Map<string, QueueRun>, order: string[], firstRound: number): Promise<number> {
  const nodeId = deps.config.nodeId;
  for (const [owner, run] of runs) {
    if (!run.remove.size && !run.retry.size) continue;
    await updateSystem(deps.storage, nodeId, queueKey(owner), parseQueue, cur => cur
      .filter(i => !run.remove.has(versionOf(i)))
      .map(i => {
        const r = run.retry.get(versionOf(i));
        return r ? { ...i, tries: r.tries, reason: r.reason } : i;
      }));
  }
  // The next run starts at the first queue this one did not reach in its first round, or, when it
  // reached them all, one further along than this one started.
  const next = order.length ? order[firstRound < order.length ? firstRound : 1 % order.length]! : null;
  const index = await updateSystem(deps.storage, nodeId, INDEX_KEY, parseIndex, async idx => {
    const queues: QueueIndex['queues'] = [];
    for (const q of idx.queues) {
      if (!runs.has(q.id)) { queues.push(q); continue; }
      // Read again inside the swap: an enqueue meanwhile changes the index version and lands here.
      const n = (await readQueueOf(deps.storage, nodeId, q.id)).length;
      if (n > 0) queues.push({ id: q.id, n });
    }
    return { queues, next: next && queues.some(q => q.id === next) ? next : null };
  });
  return index.queues.reduce((s, q) => s + q.n, 0);
}
