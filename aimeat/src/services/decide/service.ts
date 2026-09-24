/**
 * @file src/services/decide/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE path to the decision model (TARGET-080, AIMEAT.decide). Every door calls
 *   decideForOwner(): the REST route, the MCP tool and a run over many records. There is no second way
 *   to reach a decision provider, because a second way is where the scrubber or the record gets skipped.
 *
 *   THE PROVIDER (services/decide/providers.ts). TypeSafe's Jev is the node's configured provider and
 *   answers when nobody chose another. The rule's (or the call's) choice, the agent's, the owner's
 *   default and the node's are read in that order at step 1b, and what the chosen provider cannot
 *   carry is refused there, by name. A LOCAL provider costs nothing and skips the budget, the agent's
 *   cap, the ledger and the allowance; it sends only the key its model was started with, when the
 *   operator set one, and the scrubber runs for it all the same.
 *
 *   WHAT JEV IS. A model that takes a `state` and a map of typed questions (yes/no probability, pick
 *   one, score on a scale) and returns typed answers with probabilities. It writes no text. It is not
 *   a chat model, so it is not in the model picker and it does not share the completion path; it
 *   shares the MONEY: the same daily budget, the same per-app quota, the same per-person allowance on
 *   the node's key, the same ledger.
 *
 *   THE ORDER, AND WHY IT IS THIS ORDER. Every refusal happens before anything leaves the node:
 *     1. the operator switch, the request shape and limits (nothing read yet);
 *    1b. the provider, and what it can carry;
 *     2. an app caller must have declared the provider in its data map's "what leaves the house",
 *        unless it is local and nothing leaves;
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
 *
 *   A DECISION RULE (services/decide/rules.ts). A call that names `rule` takes its questions,
 *   thresholds and bands from the owner's record and sends only the state: a caller that also sends
 *   questions, thresholds or bands is refused, because a rule somebody can override at call time is
 *   not a rule. The `use` lock and the rule's `sends` list are checked at step 1, before anything
 *   is read. The answers are then cut by the rule's thresholds and bands into an OUTCOME (act, ask,
 *   stop), and for an agent whose gate is on, an outcome under `act` becomes an item on the owner's
 *   list and `proceed: false` (services/decide/gate.ts).
 *
 *   THE KEY, STRONGEST FIRST: the agent's own (services/agent-ai-keys.ts), the owner's own, the
 *   node's. `key_source` and the record's keyScope say which one paid.
 * @structure
 *   DecideInput · DecideCaller · DecideResult · decideForOwner · listDecisions · getDecision ·
 *   reviewDecision · decisionStats · canonicalJson
 * @usage
 *   const r = await decideForOwner(storage, config, { gaii, principal, appId, isOwner }, { state, questions });
 *   const g = await decideForOwner(storage, config, caller, { state, rule: 'send-reply' });
 * @version-history
 *   v1.3.2 — 2026-09-24 — A provider's variable is read by envKeyOf (providers.ts): an optional one
 *     left unset sends no key, as the built-in laya and von expect; a required one is still refused.
 *   v1.3.1 — 2026-09-23 — The call carries the operator's listed origin for this provider, so a node's
 *     own local model is reached without opening private egress to every fetch.
 *   v1.3.0 — 2026-09-23 — Decision providers: the provider is chosen per call and checked for what
 *     it can carry before anything is read; the record, the result and the stats name it; a local
 *     provider needs no key and touches no money.
 *   v1.2.0 — 2026-09-20 — Decision rules: `rule` on the input, the outcome and the gate on the
 *     result and the record; a key per agent and a daily cap per agent; the list filters by rule and
 *     by principal; decisionStats for the quality view.
 *   v1.1.0 — 2026-09-19 — The app is named once (services/ai-app-id.ts) before the checks, the
 *     record and the list filter: Päätöspaja was recorded as both `paatospaja` and `paatospaja.html`.
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage, AiDecisionRow, AiDecisionAnswer, AiDecisionQuestion, AiDecisionReview,
  AiDecisionKeyScope, AiDecisionOutcome, AiDecisionStatsGroup, AiDecisionStatsGroupBy,
} from '../../storage/interface.js';
import { assertAppAllowed, assertWithinBudget, getTodayUsage, recordAiUsage, AiCompletionError } from '../ai-completion.js';
import { readAllowance, remainingOf, debitAllowance } from '../ai-allowance.js';
import { readProgramMap } from '../data-map/data-map-access.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { canonicalAiAppId } from '../ai-app-id.js';
import { createScrubber } from './scrub.js';
import { checkDecideRequest, DEFAULT_DECIDE_LIMITS, type JevQuestion } from './limits.js';
import { callSystemOne, SystemOneError, type SystemOneAnswer } from './systemone-client.js';
import {
  selectProvider, providerViolations, assertProviderReachable, providerAllowOrigins, readOwnerProviderKey, envKeyOf,
  type DecisionProvider, type ProviderChosenBy,
} from './providers.js';
import { takeSlot } from './pacer.js';
import { readDecidePolicy, readOwnDecideKey } from './settings.js';
import { DecideError } from './errors.js';
import { agentNameOf, readAgentKey, agentCapRefusal } from '../agent-ai-keys.js';
import { ruleForCaller, type RuleCallerKind } from './rules.js';
import { evaluateRule, fieldsOutside, type DecisionRule } from './rule-validate.js';
import { gateSettingOf, gateApplies, openGateItem } from './gate.js';

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
  /** The questions, unless `rule` names the owner's decision rule that holds them. */
  questions?: Record<string, JevQuestion>;
  /** The id of one of the owner's decision rules. With it, the caller sends only the state. */
  rule?: string;
  /**
   * The decision provider to ask (services/decide/providers.ts). Beside a rule that names its own,
   * it is refused. Without it: the agent's, the owner's default, the node's.
   */
  provider?: string;
  /** Set only so that a caller who sends bands beside a rule is refused rather than ignored. */
  bands?: unknown;
  /**
   * The owner trying a rule on its sample. A try is a real, paid, recorded decision, but it is not
   * one of the RULE's decisions: counted among them it would flatter or spoil the quality numbers
   * with a state the owner wrote to get a known answer. No door takes this from a request body.
   */
  trial?: boolean;
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
  key_source: AiDecisionKeyScope;
  request_id: string | null;
  /** Which provider answered, where it ran, and which choice picked it. */
  provider: { id: string; kind: 'hosted' | 'local'; chosen_by: ProviderChosenBy };
  /** Present when a decision rule ran. */
  rule?: { id: string; version: number };
  /** What the rule's thresholds and bands made of the answers. */
  outcome?: AiDecisionOutcome;
  /** The weakest certainty among the thresholded answers, which the bands cut. Null when the model
   *  gave no certainty at all: the bands have nothing to cut, so the outcome is `ask`. */
  result?: number | null;
  /** Per thresholded question: did its answer reach its floor. */
  passed?: Record<string, boolean>;
  bands?: { act: number; ask: number };
  /** Whether the agent's gate held it to this rule, and the owner's item when it stopped the action. */
  gate?: { on: boolean; stopped: boolean; task?: string };
  /**
   * May the caller go ahead with what the rule decides. False only when the gate is on and the
   * outcome is under the act band; an ungated caller reads `outcome` and decides for itself.
   */
  proceed?: boolean;
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

/**
 * An app must have said, in its data map, where the data goes when it leaves the machine: a row
 * naming the provider. A local provider sends nothing off the machine, so there is nothing to declare.
 */
async function assertDeclaredInDataMap(storage: Storage, config: AimeatConfig, appRef: string, provider: DecisionProvider): Promise<void> {
  if (!provider.leaves) return;
  const result = await readProgramMap(storage, config, null, appRef, new Date().toISOString());
  if ('refusal' in result) {
    throw new DecideError('DATAMAP_REQUIRED', 403,
      `This app has no data map this node can read, so it may not send data to the decision model. ${result.refusal.message}`);
  }
  const leaves = result.dataMap?.leaves ?? [];
  const typesafe = provider.id === 'typesafe';
  const host = URL.canParse(provider.url) ? new URL(provider.url).host.toLowerCase() : '';
  const names = (s: string): boolean => typesafe
    ? /typesafe|\bjev\b/i.test(s)
    : s.toLowerCase().includes(provider.id) || s.toLowerCase().includes(provider.title.toLowerCase()) || (!!host && s.toLowerCase().includes(host));
  if (!leaves.some(l => names(`${l.to} ${l.what}`))) {
    throw new DecideError('DATAMAP_REQUIRED', 403, typesafe
      ? 'Before this app can ask the decision model, its data map must say what goes to TypeSafe: add a "leaves" row whose "to" names TypeSafe (for example { what: "scrubbed text of the record being judged", to: "TypeSafe (decision model, USA)", recallable: false }).'
      : `Before this app can ask the decision provider '${provider.id}', its data map must say what goes there: add a "leaves" row whose "to" names '${provider.title}' or ${host}.`);
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
function toRecordAnswer(a: SystemOneAnswer, back: Map<string, string> | undefined): AiDecisionAnswer {
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

/**
 * Which key pays, strongest first: the agent's own, the owner's own, then the node's while the
 * owner's allowance lasts. With none of the three, the answer is an instruction, not a bare error.
 */
async function resolveDecideKey(
  storage: Storage, config: AimeatConfig, gaii: string, agent: string | null,
): Promise<{ key: string; scope: AiDecisionKeyScope }> {
  const agentKey = agent ? await readAgentKey(storage, config, gaii, agent, 'decide') : null;
  if (agentKey) return { key: agentKey, scope: 'agent' };
  const own = await readOwnDecideKey(storage, config, gaii);
  if (own) return { key: own, scope: 'own' };
  const nodeKey = config.decideInstanceKey.trim();
  if (!nodeKey) {
    throw new DecideError('NO_API_KEY', 400, agent
      ? `No TypeSafe key is set for this call. The owner sets one for the agent "${agent}" on the agent's page (Profile, Agents, ${agent}, AI keys), or their own under Settings, AI, Decision model, and tests it there. Then run this again.`
      : 'No TypeSafe key is set. Add your own under Settings, AI, Decision model and press Test, or ask the operator to give the node one.');
  }
  if (remainingOf(await readAllowance(storage, config, gaii)) <= 0) {
    throw new DecideError('QUOTA_EXHAUSTED', 402,
      'Your allowance on this node is used up. Add more, or set your own TypeSafe key in AI settings.');
  }
  return { key: nodeKey, scope: 'node' };
}

/**
 * The key for this provider. The key chain above belongs to the node's configured provider; an
 * owner's provider has its own key; an operator's names a variable; a local one needs none.
 */
async function resolveProviderKey(
  storage: Storage, config: AimeatConfig, gaii: string, agent: string | null, provider: DecisionProvider,
): Promise<{ key: string | null; scope: AiDecisionKeyScope }> {
  if (provider.auth.type === 'none') return { key: null, scope: 'none' };
  if (provider.auth.type === 'env') {
    // The operator's variable. An optional one left unset sends no key; a required one is refused.
    const key = envKeyOf(provider);
    return key ? { key, scope: 'node' } : { key: null, scope: 'none' };
  }
  if (provider.source === 'owner') {
    const key = await readOwnerProviderKey(storage, config, gaii, provider.id);
    if (!key) throw new DecideError('NO_API_KEY', 400, `Your decision provider '${provider.id}' has no key. The owner adds it with PUT /v1/ai/decide/providers/${provider.id} and an api_key.`);
    return { key, scope: 'own' };
  }
  return resolveDecideKey(storage, config, gaii, agent);
}

function mapProviderError(e: SystemOneError, scope: AiDecisionKeyScope, provider: DecisionProvider): DecideError {
  const details = {
    provider: provider.id, provider_status: e.status, request_id: e.requestId,
    ...(e.code === 'JEV_INVALID' ? { provider_detail: e.detail } : {}),
  };
  const name = provider.id === 'typesafe' ? 'TypeSafe' : provider.title;
  switch (e.code) {
    case 'JEV_UNAUTHORIZED':
    case 'JEV_FORBIDDEN':
      if (scope === 'agent') return new DecideError('INVALID_API_KEY', 401, `${name} refused this agent's key. The owner checks it on the agent's page.`, details);
      return scope === 'own'
        ? new DecideError('INVALID_API_KEY', 401, `${name} refused your key. Check it in AI settings.`, details)
        : new DecideError('PROVIDER_ERROR', 502, `${name} refused this node's key. The operator has been told in the log.`, details);
    case 'JEV_RATE_LIMITED':
      return new DecideError('RATE_LIMITED', 429, `${name} is limiting requests right now. Try again shortly.`, details);
    case 'JEV_INVALID':
    case 'JEV_BAD_REQUEST':
      return new DecideError('PROVIDER_REJECTED', 422, `${name} refused the request: ${e.message}`, details);
    default:
      return new DecideError('PROVIDER_ERROR', 502, `The decision model did not answer: ${e.message}`, details);
  }
}

/**
 * Ask the decision model, on behalf of one owner. Throws DecideError (or AiCompletionError from the
 * shared budget checks) before anything is sent when the call may not happen.
 */
export async function decideForOwner(
  storage: Storage, config: AimeatConfig, callerIn: DecideCaller, inputIn: DecideInput,
): Promise<DecideResult> {
  // One name per app, whichever door asked (services/ai-app-id.ts): an app token's `app.html` and
  // the `app` an app names itself are the same app, with one cap and one row in the register.
  const caller: DecideCaller = { ...callerIn, appId: canonicalAiAppId(callerIn.appId, callerIn.gaii) };
  // 1 ── switch, shape, limits
  if (!config.decideEnabled) {
    throw new DecideError('DECIDE_DISABLED', 503, 'The operator has turned the decision model off on this node.');
  }
  const limits = {
    ...DEFAULT_DECIDE_LIMITS,
    maxRequestTokens: config.decideMaxRequestTokens,
    maxChoiceOptions: config.decideMaxChoiceOptions,
  };
  // A named rule brings the questions, the thresholds and what it gates. The caller brings the state.
  const agent = agentNameOf(caller.principal, caller.gaii);
  const rule = inputIn.rule !== undefined ? await loadRule(storage, caller, agent, inputIn) : null;
  const input: DecideInput = rule
    ? { ...inputIn, questions: rule.questions, thresholds: rule.thresholds, gates: rule.decides }
    : inputIn;
  const questions = input.questions as Record<string, JevQuestion>;
  const violations = checkDecideRequest(input.state, questions, limits);
  if (violations.length) {
    throw new DecideError('INVALID_REQUEST', 400, violations.map(v => v.message).join(' '), { violations });
  }

  // 1b ── the provider, strongest choice first, and what it can carry, before anything is read
  const { provider, chosenBy } = await selectProvider(storage, config, {
    ownerGhii: caller.gaii, agent,
    named: rule?.provider ?? inputIn.provider ?? null,
    namedBy: rule?.provider ? 'rule' : 'call',
  });
  const cannot = providerViolations(provider, input.state, questions);
  if (cannot.length) {
    throw new DecideError('PROVIDER_CANNOT_CARRY', 400, cannot.map(v => v.message).join(' '), { provider: provider.id, violations: cannot });
  }
  const local = provider.kind === 'local';

  // 2 ── an app must have declared where its data goes
  if (caller.appRef) await assertDeclaredInDataMap(storage, config, caller.appRef, provider);

  // 3 ── the owner's allowlist and budget, the same money as a completion. A local provider costs
  //      nothing, so neither the budget nor the agent's cap has anything to say about it.
  const prefsRec = await storage.getMemory(caller.gaii, 'openrouter.settings');
  const prefs = (prefsRec?.value as Record<string, unknown>) ?? {};
  assertAppAllowed(prefs, caller.appId, caller.gaii);
  const usageToday = await getTodayUsage(storage, caller.gaii);
  if (!local) {
    assertWithinBudget(usageToday, prefs, caller.appId, caller.gaii);
    const overCap = await agentCapRefusal(storage, caller.gaii, agent);
    if (overCap) throw new DecideError('AGENT_QUOTA_EXHAUSTED', 402, overCap);
  }

  // 4 ── scrub
  const policy = await readDecidePolicy(storage, caller.gaii);
  const skipScrub = input.publicContent === true && (caller.isOwner || policy.allowPublicOptOut);
  const scrubber = skipScrub ? null : createScrubber({
    knownNames: [...(await knownNamesFor(storage, caller.gaii)), ...(input.names ?? []).filter(n => typeof n === 'string')],
    allow: policy.allow,
  });
  const state = scrubber ? scrubber.value(input.state) : input.state;
  const { sent, optionBack } = scrubQuestions(questions, scrubber);
  const scrubReport = scrubber ? scrubber.report() : { removed: {}, total: 0 };

  const model = provider.model;
  const stateJson = canonicalJson(state);
  // The configured provider keeps the cache key it always had, so an owner who changed nothing
  // keeps their cache; any other provider's answers are cached apart from it.
  const cacheScope = provider.source === 'node' && provider.id === config.decideProviderId ? model : `${provider.id}\n${model}`;
  const cacheKey = sha256(`${cacheScope}\n${stateJson}\n${canonicalJson(sent)}`);
  const stateHash = sha256(stateJson);
  const base = {
    id: randomUUID(), ownerGhii: caller.gaii, principal: caller.principal,
    appId: caller.appId ?? null, subject: input.subject ?? null, cacheKey,
    createdAt: new Date().toISOString(),
  };
  const recordCommon = {
    spec: 'aimeat.decision/v1' as const, provider: provider.id, providerKind: provider.kind,
    questions: sent as Record<string, AiDecisionQuestion>,
    thresholds: input.thresholds ?? null, gates: input.gates ?? null, subject: input.subject ?? null,
    stateHash, scrub: { removed: scrubReport.removed as Record<string, number>, total: scrubReport.total },
    ...(policy.storeState ? { scrubbedState: state } : {}),
    ...(rule ? { bands: rule.bands } : {}),
  };
  // What the rule makes of a set of answers, a cached set included: the thresholds may have been
  // tuned since the answers were first given, and the outcome is always today's rule's.
  const judge = (answers: Record<string, AiDecisionAnswer>) =>
    judgeByRule(storage, caller, agent, rule, { decisionId: base.id, subject: base.subject, answers, trial: input.trial === true });

  // 5 ── the cache is the record table
  if (input.cache !== false && config.decideCacheHours > 0) {
    const since = new Date(Date.now() - config.decideCacheHours * 3_600_000).toISOString();
    const hit = await storage.findCachedAiDecision(caller.gaii, cacheKey, since);
    if (hit) {
      const j = await judge(hit.record.answers);
      const row: AiDecisionRow = {
        ...base, model: hit.model, ...j.columns, keyScope: hit.keyScope, provider: provider.id, providerKind: provider.kind,
        record: {
          ...recordCommon, model: hit.model, answers: hit.record.answers,
          usage: { inputTokens: 0, costUsd: 0 }, requestId: hit.record.requestId,
          keyScope: hit.keyScope, cachedFrom: hit.id, ...j.record,
        },
      };
      await writeRecord(storage, row);
      return {
        decision_id: row.id, model: hit.model, answers: hit.record.answers, cached: true,
        scrub: { ...recordCommon.scrub, skipped: skipScrub },
        usage: { input_tokens: 0, cost_usd: 0 }, key_source: hit.keyScope, request_id: hit.record.requestId,
        provider: { id: provider.id, kind: provider.kind, chosen_by: chosenBy },
        ...j.result,
      };
    }
  }

  // 6 ── the key, and the minute window for that key (a keyless provider's window is its address)
  assertProviderReachable(provider, config);
  const { key, scope } = await resolveProviderKey(storage, config, caller.gaii, agent, provider);
  const wait = takeSlot(sha256(key ?? `${provider.id}\n${provider.url}`), config.decideRequestsPerMinute);
  if (wait > 0) {
    throw new DecideError('RATE_LIMITED', 429,
      `This node has sent its minute's worth of decisions on this key. Try again in ${Math.ceil(wait / 1000)} s.`,
      { retry_after_ms: wait });
  }

  // 7 ── the call
  let res;
  try {
    res = await callSystemOne({
      url: provider.url, key, request: { model, state, questions: sent },
      allowOrigins: providerAllowOrigins(provider, config),
      providerName: provider.id === 'typesafe' ? 'TypeSafe' : provider.title,
      ...(provider.adapter ? { adapter: provider.adapter } : {}),
    });
  } catch (e) {
    if (e instanceof SystemOneError) {
      if (scope === 'node' && (e.code === 'JEV_UNAUTHORIZED' || e.code === 'JEV_FORBIDDEN')) {
        logger.error('[decide] a provider refused the node key', { provider: provider.id, requestId: e.requestId });
      }
      throw mapProviderError(e, scope, provider);
    }
    throw e;
  }

  // 8 ── real names back, meter, record. A local provider is free and touches no ledger.
  const answers: Record<string, AiDecisionAnswer> = {};
  for (const [id, a] of Object.entries(res.answers)) answers[id] = toRecordAnswer(a, optionBack.get(id));
  const inputTokens = res.usage.input_tokens;
  const costUsd = local ? 0 : (inputTokens / 1_000_000) * provider.pricePerMtok;

  if (!local && scope !== 'none') {
    try {
      await recordAiUsage(storage, caller.gaii, usageToday, {
        costUsd, tokens: inputTokens, appId: caller.appId, model: res.model, provider: provider.id,
        promptTokens: inputTokens, completionTokens: res.usage.output_tokens, source: 'ai-decide', apiKeyScope: scope,
        ...(agent ? { agent } : {}),
      }, config);
    } catch (err) {
      logger.warn('[decide] usage record failed; the decision was made and paid for', { gaii: caller.gaii, error: String(err) });
    }
    if (scope === 'node') await debitAllowance(storage, config, caller.gaii, costUsd);
  }

  const j = await judge(answers);
  const row: AiDecisionRow = {
    ...base, model: res.model, ...j.columns, keyScope: scope, provider: provider.id, providerKind: provider.kind,
    record: {
      ...recordCommon, model: res.model, answers,
      usage: { inputTokens, costUsd }, requestId: res.requestId, keyScope: scope, ...j.record,
    },
  };
  await writeRecord(storage, row);

  return {
    decision_id: row.id, model: res.model, answers, cached: false,
    scrub: { ...recordCommon.scrub, skipped: skipScrub },
    usage: { input_tokens: inputTokens, cost_usd: costUsd }, key_source: scope, request_id: res.requestId,
    provider: { id: provider.id, kind: provider.kind, chosen_by: chosenBy },
    ...j.result,
  };
}

/** Who is asking, for the rule's `use` lock: the owner in person, one of their agents, or an app. */
function callerKindOf(caller: DecideCaller, agent: string | null): RuleCallerKind {
  if (caller.isOwner) return 'owner';
  return agent && !caller.appRef ? 'agent' : 'app';
}

/** The same answer for a door that holds only the caller (a run, the rules list). */
export function ruleCallerKind(caller: DecideCaller): RuleCallerKind {
  return callerKindOf(caller, agentNameOf(caller.principal, caller.gaii));
}

/**
 * The rule a call named, after the three refusals that need nothing but the request: the rule is not
 * there or not for this kind of caller, the caller sent what the rule fixes, the state carries a
 * field the rule does not list.
 */
async function loadRule(storage: Storage, caller: DecideCaller, agent: string | null, input: DecideInput): Promise<DecisionRule> {
  if (typeof input.rule !== 'string' || !input.rule) {
    throw new DecideError('INVALID_REQUEST', 400, 'rule is the id of one of the owner\'s decision rules.');
  }
  const fixed = (['questions', 'thresholds', 'bands', 'gates'] as const).filter(f => input[f] !== undefined);
  if (fixed.length) {
    throw new DecideError('RULE_FIXES_QUESTIONS', 400,
      `A call that names a rule sends only the state: the rule holds the ${fixed.join(', ')}. Leave ${fixed.length === 1 ? 'it' : 'them'} out, or ask without a rule.`);
  }
  const rule = await ruleForCaller(storage, caller.gaii, input.rule, callerKindOf(caller, agent));
  // A rule that names its provider fixes it, the way it fixes its questions. One that names none
  // leaves the choice to the call, the agent, the owner and the node, in that order.
  if (rule.provider && input.provider !== undefined && input.provider !== rule.provider) {
    throw new DecideError('RULE_FIXES_QUESTIONS', 400,
      `The rule '${rule.id}' runs on the decision provider '${rule.provider}'. Leave provider out, or ask without a rule.`);
  }
  const extra = fieldsOutside(rule.sends, input.state);
  if (extra.length) {
    throw new DecideError('STATE_OUTSIDE_RULE', 400,
      `The rule '${rule.id}' takes a state with these fields only: ${rule.sends.join(', ')}. Not allowed: ${extra.join(', ')}.`);
  }
  return rule;
}

/**
 * The rule's verdict on a set of answers, and the gate. Without a rule every part is empty, so the
 * two call sites spread it without asking.
 */
async function judgeByRule(
  storage: Storage, caller: DecideCaller, agent: string | null, rule: DecisionRule | null,
  d: { decisionId: string; subject: string | null; answers: Record<string, AiDecisionAnswer>; trial: boolean },
): Promise<{
  columns: Pick<AiDecisionRow, 'rule' | 'ruleVersion' | 'outcome'>;
  record: { gate?: { on: true; stopped: boolean; task?: string } };
  result: Pick<DecideResult, 'rule' | 'outcome' | 'result' | 'passed' | 'bands' | 'gate' | 'proceed'>;
}> {
  if (!rule) return { columns: { rule: null, ruleVersion: null, outcome: null }, record: {}, result: {} };
  const e = evaluateRule(rule, d.answers);
  // Only an agent is gated: an app's own code reads the outcome, and the owner is who a gate asks.
  const on = callerKindOf(caller, agent) === 'agent' && gateApplies(await gateSettingOf(storage, caller.gaii, agent as string), rule);
  const stopped = on && e.outcome !== 'act';
  const task = stopped
    ? await openGateItem(storage, caller.gaii, { rule, agentGaii: caller.principal, outcome: e.outcome, decisionId: d.decisionId, subject: d.subject, answers: d.answers })
    : undefined;
  return {
    columns: d.trial ? { rule: null, ruleVersion: null, outcome: null } : { rule: rule.id, ruleVersion: rule.version, outcome: e.outcome },
    record: on ? { gate: { on: true, stopped, ...(task ? { task } : {}) } } : {},
    result: {
      rule: { id: rule.id, version: rule.version }, outcome: e.outcome, result: e.result, passed: e.passed,
      bands: rule.bands, gate: { on, stopped, ...(task ? { task } : {}) }, proceed: !stopped,
    },
  };
}

/** A decision that happened is recorded; a failure to record is logged, never thrown at the payer. */
async function writeRecord(storage: Storage, row: AiDecisionRow): Promise<void> {
  try {
    await storage.createAiDecision(row);
    // The owner's open page lists recent decisions; it hears about this one without polling.
    emitChange('ai-decisions', row.ownerGhii);
  } catch (err) {
    logger.error('[decide] decision record failed to write: a decision was made and is not on the register', {
      id: row.id, gaii: row.ownerGhii, requestId: row.record.requestId, error: String(err),
    });
  }
}

/** The owner's own decisions, newest first. */
export async function listDecisions(
  storage: Storage, gaii: string,
  q: { subject?: string; appId?: string; rule?: string; principal?: string; provider?: string; limit?: number; before?: string },
): Promise<{ items: AiDecisionRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, Math.floor(q.limit ?? 50)));
  return storage.listAiDecisions({
    ownerGhii: gaii, subject: q.subject, appId: canonicalAiAppId(q.appId, gaii), limit, before: q.before,
    ...(q.rule ? { rule: q.rule } : {}), ...(q.principal ? { principal: q.principal } : {}),
    ...(q.provider ? { provider: q.provider } : {}),
  });
}

/**
 * The quality numbers, counted in the store: per rule (all of them, or one agent's share of each),
 * for one principal as a whole, or per provider. The owner's own rows only.
 */
export async function decisionStats(
  storage: Storage, gaii: string,
  q: { rule?: string; principal?: string; provider?: string; groupBy: AiDecisionStatsGroupBy },
): Promise<AiDecisionStatsGroup[]> {
  return storage.aiDecisionStats({
    ownerGhii: gaii, ...(q.rule ? { rule: q.rule } : {}), ...(q.principal ? { principal: q.principal } : {}),
    ...(q.provider ? { provider: q.provider } : {}),
  }, q.groupBy);
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
  if (!ok) return null;
  emitChange('ai-decisions', gaii);
  // A gate stop put this decision on the owner's open items. They have now answered it, so the row
  // goes: here, so that the web, MCP and REST reviews all behave the same. Best-effort — the review
  // is recorded either way, and a list that would not update must not undo it.
  try {
    const { closeItemsForDecision } = await import('../open-items.js');
    if (await closeItemsForDecision(storage, gaii, id)) emitChange('open-items', gaii);
  } catch (err) {
    logger.warn('[decide] the review was recorded and its open item could not be closed', {
      owner: gaii, decision: id, error: String(err),
    });
  }
  return getDecision(storage, gaii, id);
}

export { DecideError, AiCompletionError };
