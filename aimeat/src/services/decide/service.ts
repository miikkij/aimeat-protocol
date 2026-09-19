/**
 * @file src/services/decide/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE path to the decision model (TARGET-080, AIMEAT.decide). Every door calls
 *   decideForOwner(): the REST route, the MCP tool and a run over many records. There is no second way
 *   to reach TypeSafe, because a second way is where the scrubber or the record gets skipped.
 *
 *   WHAT JEV IS. A model that takes a `state` and a map of typed questions (yes/no probability, pick
 *   one, score on a scale) and returns typed answers with probabilities. It writes no text. It is not
 *   a chat model, so it is not in the model picker and it does not share the completion path; it
 *   shares the MONEY: the same daily budget, the same per-app quota, the same per-person allowance on
 *   the node's key, the same ledger.
 *
 *   THE ORDER, AND WHY IT IS THIS ORDER. Every refusal happens before anything leaves the node:
 *     1. the operator switch, the request shape and limits (nothing read yet);
 *     2. an app caller must have declared TypeSafe in its data map's "what leaves the house";
 *     3. the owner's AI allowlist and daily budget;
 *     4. SCRUB — state, instructions and criteria, choice option NAMES included, because an option
 *        called "Call Anna Virtanen" is personal data in the one place a builder would not look;
 *     5. the cache (the record table itself): an identical scrubbed question already answered;
 *     6. the key: the owner's own, then the node's if they have allowance left, which goes to the
 *        configured endpoint only; then the per-key minute window;
 *     7. the call, retried the way TypeSafe's SDKs retry;
 *     8. put real option names back into the answers, meter, record.
 *   A decision that happened is always recorded; a record that failed to write is logged loudly and
 *   the answer is still returned, because the owner has paid for it.
 *
 *   ENGLISH. What we write for Jev (instructions, criteria) must be English; that is the app's design
 *   requirement, documented in the lib and the skill and not enforced here. Sending another language
 *   on purpose, to see what the model does, is allowed.
 * @structure
 *   DecideInput · DecideCaller · DecideResult · decideForOwner · listDecisions · getDecision ·
 *   reviewDecision · canonicalJson
 * @usage
 *   const r = await decideForOwner(storage, config, { gaii, principal, appId, isOwner }, { state, questions });
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage, AiDecisionRow, AiDecisionAnswer, AiDecisionQuestion, AiDecisionReview,
} from '../../storage/interface.js';
import { assertAppAllowed, assertWithinBudget, getTodayUsage, recordAiUsage, AiCompletionError } from '../ai-completion.js';
import { readAllowance, remainingOf, debitAllowance } from '../ai-allowance.js';
import { readProgramMap } from '../data-map/data-map-access.js';
import { logger } from '../../utils/logger.js';
import { createScrubber } from './scrub.js';
import { checkDecideRequest, DEFAULT_DECIDE_LIMITS, type JevQuestion } from './limits.js';
import { callJev, JevError, type JevAnswer } from './jev-client.js';
import { takeSlot } from './pacer.js';
import { readDecidePolicy, readOwnDecideKey } from './settings.js';
import { DecideError } from './errors.js';

export interface DecideCaller {
  /** The resolved identity whose account pays and owns the record. */
  gaii: string;
  /** Who asked: the owner, their agent, or their app. Recorded as given. */
  principal: string;
  /** The app's own reference ("owner/filename.html") when an app-grant token asked. */
  appRef?: string;
  /** Attribution for the budget and the ledger. An app's filename, or a caller-named id. */
  appId?: string;
  /** The human owner acting directly. Only they may skip the scrubber without a policy saying so. */
  isOwner: boolean;
}

export interface DecideInput {
  state: unknown;
  questions: Record<string, JevQuestion>;
  /** What the decision is about: a memory key, a record id. Lets the owner ask "what was decided about X". */
  subject?: string;
  /** What the answer gates, in the caller's words ("send the reply", "archive the thread"). */
  gates?: string;
  /** The thresholds in force, exactly as the caller will apply them. A 0.72 means nothing without them. */
  thresholds?: Record<string, unknown>;
  /** Extra person names to scrub, beyond the node's contacts (a CRM record's own contact list). */
  names?: string[];
  /** The caller says this content is public and needs no scrubbing. Honoured per DecidePolicy. */
  publicContent?: boolean;
  /** Reuse an identical earlier decision. Default true. */
  cache?: boolean;
}

export interface DecideResult {
  decision_id: string;
  model: string;
  answers: Record<string, AiDecisionAnswer>;
  cached: boolean;
  scrub: { removed: Record<string, number>; total: number; skipped: boolean };
  usage: { input_tokens: number; cost_usd: number };
  key_source: 'own' | 'node';
  request_id: string | null;
}

/** JSON with object keys sorted at every depth, so equal values hash equally. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const sha256 = (s: string): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;

/** The person names this node knows for the owner: their accepted contacts' display names. */
async function knownNamesFor(storage: Storage, gaii: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const contacts = (await storage.listContacts(gaii, { state: 'accepted' })).slice(0, 500);
    const records = await Promise.all(contacts.map(c => storage.getGHII(c.contactId).catch((err: unknown) => {
      logger.warn('[decide] one contact could not be read for the scrubber', { contact: c.contactId, error: String(err) });
      return null;
    })));
    for (const r of records) {
      const n = r?.displayName?.trim();
      if (n && n.length >= 3) names.push(n);
    }
  } catch (err) {
    // The pattern detectors still run; only the contact names are missing, and the log says so.
    logger.warn('[decide] could not read contact names for the scrubber', { gaii, error: String(err) });
  }
  return names;
}

/** An app must have said, in its data map, that data goes to TypeSafe. Refused otherwise. */
async function assertDeclaredInDataMap(storage: Storage, config: AimeatConfig, appRef: string): Promise<void> {
  const result = await readProgramMap(storage, config, null, appRef, new Date().toISOString());
  if ('refusal' in result) {
    throw new DecideError('DATAMAP_REQUIRED', 403,
      `This app has no data map this node can read, so it may not send data to the decision model. ${result.refusal.message}`);
  }
  const leaves = result.dataMap?.leaves ?? [];
  const declared = leaves.some(l => /typesafe|\bjev\b/i.test(`${l.to} ${l.what}`));
  if (!declared) {
    throw new DecideError('DATAMAP_REQUIRED', 403,
      'Before this app can ask the decision model, its data map must say what goes to TypeSafe: add a "leaves" row whose "to" names TypeSafe (for example { what: "scrubbed text of the record being judged", to: "TypeSafe (decision model, USA)", recallable: false }).');
  }
}

/** Build the scrubbed question map and the reverse map for choice option names. */
function scrubQuestions(
  questions: Record<string, JevQuestion>, scrub: ReturnType<typeof createScrubber> | null,
): { sent: Record<string, JevQuestion>; optionBack: Map<string, Map<string, string>> } {
  const sent: Record<string, JevQuestion> = {};
  const optionBack = new Map<string, Map<string, string>>();
  for (const [id, q] of Object.entries(questions)) {
    const instructions = scrub ? scrub.value(q.instructions) : q.instructions;
    if (q.type === 'choice' && q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria)) {
      const back = new Map<string, string>();
      const criteria: Record<string, unknown> = {};
      for (const [opt, desc] of Object.entries(q.criteria as Record<string, unknown>)) {
        const s = scrub ? scrub.text(opt) : opt;
        if (back.has(s)) {
          throw new DecideError('INVALID_REQUEST', 400,
            `Choice question '${id}' has two options that are the same once personal data is removed. Name the options by role, not by person.`);
        }
        back.set(s, opt);
        criteria[s] = scrub ? scrub.value(desc) : desc;
      }
      optionBack.set(id, back);
      sent[id] = { type: q.type, instructions, criteria };
    } else {
      sent[id] = {
        type: q.type, instructions,
        ...(q.criteria !== undefined ? { criteria: scrub ? scrub.value(q.criteria) : q.criteria } : {}),
      };
    }
  }
  return { sent, optionBack };
}

/** One answer in the record's shape, with the real option names put back. */
function toRecordAnswer(a: JevAnswer, back: Map<string, string> | undefined): AiDecisionAnswer {
  const name = (k: string): string => back?.get(k) ?? k;
  if (a.type === 'noul') return { type: 'noul', value: a.noul ?? 0 };
  const probabilities = a.probabilities
    ? Object.fromEntries(Object.entries(a.probabilities).map(([k, p]) => [a.type === 'choice' ? name(k) : k, p]))
    : undefined;
  return {
    type: a.type,
    value: a.type === 'choice' ? name(a.choice ?? '') : (a.score ?? 0),
    ...(probabilities ? { probabilities } : {}),
    ...(typeof a.confidence === 'number' ? { confidence: a.confidence } : {}),
    ...(a.legend ? { legend: a.legend } : {}),
  };
}

/** Which key pays: the owner's own, then the node's while their allowance lasts. */
async function resolveDecideKey(
  storage: Storage, config: AimeatConfig, gaii: string,
): Promise<{ key: string; scope: 'own' | 'node' }> {
  const own = await readOwnDecideKey(storage, config, gaii);
  if (own) return { key: own, scope: 'own' };
  const nodeKey = config.decideInstanceKey.trim();
  if (!nodeKey) {
    throw new DecideError('NO_API_KEY', 400,
      'No TypeSafe key is set. Add your own in AI settings, or ask the operator to give the node one.');
  }
  if (remainingOf(await readAllowance(storage, config, gaii)) <= 0) {
    throw new DecideError('QUOTA_EXHAUSTED', 402,
      'Your allowance on this node is used up. Add more, or set your own TypeSafe key in AI settings.');
  }
  return { key: nodeKey, scope: 'node' };
}

function mapJevError(e: JevError, scope: 'own' | 'node'): DecideError {
  const details = { provider_status: e.status, request_id: e.requestId, ...(e.code === 'JEV_INVALID' ? { provider_detail: e.detail } : {}) };
  switch (e.code) {
    case 'JEV_UNAUTHORIZED':
    case 'JEV_FORBIDDEN':
      return scope === 'own'
        ? new DecideError('INVALID_API_KEY', 401, 'TypeSafe refused your key. Check it in AI settings.', details)
        : new DecideError('PROVIDER_ERROR', 502, "TypeSafe refused this node's key. The operator has been told in the log.", details);
    case 'JEV_RATE_LIMITED':
      return new DecideError('RATE_LIMITED', 429, 'TypeSafe is limiting requests right now. Try again shortly.', details);
    case 'JEV_INVALID':
    case 'JEV_BAD_REQUEST':
      return new DecideError('PROVIDER_REJECTED', 422, `TypeSafe refused the request: ${e.message}`, details);
    default:
      return new DecideError('PROVIDER_ERROR', 502, `The decision model did not answer: ${e.message}`, details);
  }
}

/**
 * Ask the decision model, on behalf of one owner. Throws DecideError (or AiCompletionError from the
 * shared budget checks) before anything is sent when the call may not happen.
 */
export async function decideForOwner(
  storage: Storage, config: AimeatConfig, caller: DecideCaller, input: DecideInput,
): Promise<DecideResult> {
  // 1 ── switch, shape, limits
  if (!config.decideEnabled) {
    throw new DecideError('DECIDE_DISABLED', 503, 'The operator has turned the decision model off on this node.');
  }
  const limits = {
    ...DEFAULT_DECIDE_LIMITS,
    maxRequestTokens: config.decideMaxRequestTokens,
    maxChoiceOptions: config.decideMaxChoiceOptions,
  };
  const violations = checkDecideRequest(input.state, input.questions, limits);
  if (violations.length) {
    throw new DecideError('INVALID_REQUEST', 400, violations.map(v => v.message).join(' '), { violations });
  }

  // 2 ── an app must have declared where its data goes
  if (caller.appRef) await assertDeclaredInDataMap(storage, config, caller.appRef);

  // 3 ── the owner's allowlist and budget, the same money as a completion
  const prefsRec = await storage.getMemory(caller.gaii, 'openrouter.settings');
  const prefs = (prefsRec?.value as Record<string, unknown>) ?? {};
  assertAppAllowed(prefs, caller.appId);
  const usageToday = await getTodayUsage(storage, caller.gaii);
  assertWithinBudget(usageToday, prefs, caller.appId);

  // 4 ── scrub
  const policy = await readDecidePolicy(storage, caller.gaii);
  const skipScrub = input.publicContent === true && (caller.isOwner || policy.allowPublicOptOut);
  const scrubber = skipScrub ? null : createScrubber({
    knownNames: [...(await knownNamesFor(storage, caller.gaii)), ...(input.names ?? []).filter(n => typeof n === 'string')],
    allow: policy.allow,
  });
  const state = scrubber ? scrubber.value(input.state) : input.state;
  const { sent, optionBack } = scrubQuestions(input.questions, scrubber);
  const scrubReport = scrubber ? scrubber.report() : { removed: {}, total: 0 };

  const model = config.decideModel;
  const stateJson = canonicalJson(state);
  const cacheKey = sha256(`${model}\n${stateJson}\n${canonicalJson(sent)}`);
  const stateHash = sha256(stateJson);
  const base = {
    id: randomUUID(), ownerGhii: caller.gaii, principal: caller.principal,
    appId: caller.appId ?? null, subject: input.subject ?? null, cacheKey,
    createdAt: new Date().toISOString(),
  };
  const recordCommon = {
    spec: 'aimeat.decision/v1' as const, provider: 'typesafe' as const,
    questions: sent as Record<string, AiDecisionQuestion>,
    thresholds: input.thresholds ?? null, gates: input.gates ?? null, subject: input.subject ?? null,
    stateHash, scrub: { removed: scrubReport.removed as Record<string, number>, total: scrubReport.total },
    ...(policy.storeState ? { scrubbedState: state } : {}),
  };

  // 5 ── the cache is the record table
  if (input.cache !== false && config.decideCacheHours > 0) {
    const since = new Date(Date.now() - config.decideCacheHours * 3_600_000).toISOString();
    const hit = await storage.findCachedAiDecision(caller.gaii, cacheKey, since);
    if (hit) {
      const row: AiDecisionRow = {
        ...base, model: hit.model,
        record: {
          ...recordCommon, model: hit.model, answers: hit.record.answers,
          usage: { inputTokens: 0, costUsd: 0 }, requestId: hit.record.requestId,
          keyScope: hit.record.keyScope, cachedFrom: hit.id,
        },
      };
      await writeRecord(storage, row);
      return {
        decision_id: row.id, model: hit.model, answers: hit.record.answers, cached: true,
        scrub: { ...recordCommon.scrub, skipped: skipScrub },
        usage: { input_tokens: 0, cost_usd: 0 }, key_source: hit.record.keyScope, request_id: hit.record.requestId,
      };
    }
  }

  // 6 ── the key, and the minute window for that key
  const { key, scope } = await resolveDecideKey(storage, config, caller.gaii);
  const wait = takeSlot(sha256(key), config.decideRequestsPerMinute);
  if (wait > 0) {
    throw new DecideError('RATE_LIMITED', 429,
      `This node has sent its minute's worth of decisions on this key. Try again in ${Math.ceil(wait / 1000)} s.`,
      { retry_after_ms: wait });
  }

  // 7 ── the call
  let res;
  try {
    res = await callJev({ url: config.decideBaseUrl, key, request: { model, state, questions: sent } });
  } catch (e) {
    if (e instanceof JevError) {
      if (scope === 'node' && (e.code === 'JEV_UNAUTHORIZED' || e.code === 'JEV_FORBIDDEN')) {
        logger.error('[decide] TypeSafe refused the node key (AIMEAT_TYPESAFE_INSTANCE_KEY)', { requestId: e.requestId });
      }
      throw mapJevError(e, scope);
    }
    throw e;
  }

  // 8 ── real names back, meter, record
  const answers: Record<string, AiDecisionAnswer> = {};
  for (const [id, a] of Object.entries(res.answers)) answers[id] = toRecordAnswer(a, optionBack.get(id));
  const inputTokens = res.usage.input_tokens;
  const costUsd = (inputTokens / 1_000_000) * config.decidePricePerMtok;

  try {
    await recordAiUsage(storage, caller.gaii, usageToday, {
      costUsd, tokens: inputTokens, appId: caller.appId, model: res.model, provider: 'typesafe',
      promptTokens: inputTokens, completionTokens: res.usage.output_tokens, source: 'ai-decide', apiKeyScope: scope,
    }, config);
  } catch (err) {
    logger.warn('[decide] usage record failed; the decision was made and paid for', { gaii: caller.gaii, error: String(err) });
  }
  if (scope === 'node') await debitAllowance(storage, config, caller.gaii, costUsd);

  const row: AiDecisionRow = {
    ...base, model: res.model,
    record: {
      ...recordCommon, model: res.model, answers,
      usage: { inputTokens, costUsd }, requestId: res.requestId, keyScope: scope,
    },
  };
  await writeRecord(storage, row);

  return {
    decision_id: row.id, model: res.model, answers, cached: false,
    scrub: { ...recordCommon.scrub, skipped: skipScrub },
    usage: { input_tokens: inputTokens, cost_usd: costUsd }, key_source: scope, request_id: res.requestId,
  };
}

/** A decision that happened is recorded; a failure to record is logged, never thrown at the payer. */
async function writeRecord(storage: Storage, row: AiDecisionRow): Promise<void> {
  try {
    await storage.createAiDecision(row);
  } catch (err) {
    logger.error('[decide] decision record failed to write: a decision was made and is not on the register', {
      id: row.id, gaii: row.ownerGhii, requestId: row.record.requestId, error: String(err),
    });
  }
}

/** The owner's own decisions, newest first. */
export async function listDecisions(
  storage: Storage, gaii: string, q: { subject?: string; appId?: string; limit?: number; before?: string },
): Promise<{ items: AiDecisionRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, Math.floor(q.limit ?? 50)));
  return storage.listAiDecisions({ ownerGhii: gaii, subject: q.subject, appId: q.appId, limit, before: q.before });
}

/** One decision, or null for "absent" and "not yours" alike. */
export async function getDecision(storage: Storage, gaii: string, id: string): Promise<AiDecisionRow | null> {
  const row = await storage.getAiDecision(id);
  return row && row.ownerGhii === gaii ? row : null;
}

/** A person confirmed or overrode what the model decided. The one change a decision record accepts. */
export async function reviewDecision(
  storage: Storage, gaii: string, reviewer: string, id: string,
  input: { outcome?: unknown; note?: unknown; override?: unknown },
): Promise<AiDecisionRow | null> {
  if (input.outcome !== 'confirmed' && input.outcome !== 'overridden') {
    throw new DecideError('INVALID_BODY', 400, "outcome must be 'confirmed' or 'overridden'.");
  }
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 2000)) {
    throw new DecideError('INVALID_BODY', 400, 'note must be text of at most 2000 characters.');
  }
  const review: AiDecisionReview = {
    outcome: input.outcome, by: reviewer, at: new Date().toISOString(),
    ...(typeof input.note === 'string' ? { note: input.note } : {}),
    ...(input.override !== undefined ? { override: input.override } : {}),
  };
  const ok = await storage.setAiDecisionReview(id, gaii, review);
  return ok ? getDecision(storage, gaii, id) : null;
}

export { DecideError, AiCompletionError };
