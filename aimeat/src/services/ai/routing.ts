/**
 * @file routing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's routing: which providers serve each capability, in order, and the rules
 *   by which the node picks among them and moves to the next (docs/internal/llmproviderintegrations/
 *   11, section 5; Jouni's J9, 2026-09-28: only tested providers, move on when one fails, at most
 *   three attempts, never away from this machine when the first was local).
 *
 *   TWO RECORDS, under the reserved `ai.routing.` prefix: the owner's `ai.routing.owner` (defaults and
 *   rules) and `ai.routing.agent.<name>` (one agent's defaults, which replace the owner's for that
 *   agent). The rules are the owner's alone: an agent's record has none, so an agent cannot loosen
 *   them. By name rather than `ai.` as a whole, for the reason `ai.policy.` is (utils/reserved-keys.ts).
 *
 *   THE RULES ARE READ BY ONE FUNCTION, rulesFor(call). Today it returns the owner's rules for every
 *   call. The record carries `version: 1` so that conditional rule sets (for one app, one agent, one
 *   capability or some hours) can be added inside rulesFor later without any caller changing
 *   (Jouni, 2026-09-28: "pidetään tämä kuitenkin joustavana").
 * @structure
 *   ROUTING_KEY · agentRoutingKey · RoutingRules · DEFAULT_RULES · RoutingRecord · readRouting ·
 *   rulesFor · defaultsFor · normaliseRoutingInput · setRouting
 * @version-history
 *   v1.0.1 — 2026-10-05 — An agent name is checked with isValidAgentName, the grammar agents have (secaudit 2026-10, M2).
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 *   v1.0.1 — 2026-09-28 — Comments: what the model catalogue (V4) now prices and orders.
 */
import type { Storage } from '../../storage/interface.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../operator-confirm.js';
import { isObj } from '../ai-provider-common.js';
import { AiCompletionError } from './errors.js';
import { FALLBACK_CLASSES, type FailureClass } from './health.js';
import { isValidAgentName } from '../../utils/gaii.js';
import type { AiCapability } from './types.js';

export const ROUTING_KEY = 'ai.routing.owner';
export const agentRoutingKey = (agent: string): string => `ai.routing.agent.${agent}`;

const CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
const MAX_DEFAULTS = 10;

export interface RoutingRules {
  /** When the defaults are used up: try the owner's other providers marked for the pool. */
  extendToPool: boolean;
  /** The pool's order after the defaults. `cheapest` reads the model catalogue; `fastest` keeps priority, since the node measures no latency yet. */
  poolOrder: 'priority' | 'cheapest' | 'fastest';
  /** Pick by capability alone only a provider whose capability is tested and working. */
  onlyTested: boolean;
  /** Try the next provider when one fails. */
  fallback: boolean;
  /** At most this many providers for one call. */
  maxAttempts: number;
  /** Which failures move to the next provider. */
  fallbackOn: FailureClass[];
  /** Whether a fallback may send the data off this machine when the first provider was local. */
  fallbackMayLeaveMachine: boolean;
  /** Whether a speech fallback may use a different voice. */
  speechVoiceMayChange: boolean;
  /** A ceiling per call; a dearer candidate is skipped. Null: none. Priced from the catalogue (V4). */
  maxCostPerCallUsd: number | null;
}

/** Jouni's J9 defaults, approved 2026-09-28. */
export const DEFAULT_RULES: Readonly<RoutingRules> = Object.freeze({
  extendToPool: true,
  poolOrder: 'priority',
  onlyTested: true,
  fallback: true,
  maxAttempts: 3,
  fallbackOn: [...FALLBACK_CLASSES],
  fallbackMayLeaveMachine: false,
  speechVoiceMayChange: false,
  maxCostPerCallUsd: null,
});

export type RoutingDefaults = Partial<Record<AiCapability, string[]>>;

export interface RoutingRecord {
  version: 1;
  defaults: RoutingDefaults;
  rules: RoutingRules;
  updatedAt?: string;
}

export interface LoadedRouting {
  owner: RoutingRecord;
  /** The asking agent's own defaults, when it has a record. */
  agent?: RoutingDefaults;
}

function readDefaults(v: unknown): RoutingDefaults {
  const out: RoutingDefaults = {};
  if (!isObj(v)) return out;
  for (const c of CAPABILITIES) {
    const list = v[c];
    if (Array.isArray(list)) out[c] = list.filter((x): x is string => typeof x === 'string').slice(0, MAX_DEFAULTS);
  }
  return out;
}

/** A stored rules object read leniently: a field that does not read is its default, never an error. */
function readRules(v: unknown): RoutingRules {
  const r = isObj(v) ? v : {};
  const bool = (k: keyof RoutingRules) => typeof r[k] === 'boolean' ? r[k] as boolean : DEFAULT_RULES[k] as boolean;
  return {
    extendToPool: bool('extendToPool'),
    poolOrder: r.poolOrder === 'cheapest' || r.poolOrder === 'fastest' ? r.poolOrder : 'priority',
    onlyTested: bool('onlyTested'),
    fallback: bool('fallback'),
    maxAttempts: typeof r.maxAttempts === 'number' && Number.isInteger(r.maxAttempts) && r.maxAttempts >= 1 && r.maxAttempts <= 5 ? r.maxAttempts : DEFAULT_RULES.maxAttempts,
    fallbackOn: Array.isArray(r.fallbackOn) ? r.fallbackOn.filter((x): x is FailureClass => FALLBACK_CLASSES.includes(x as FailureClass)) : [...DEFAULT_RULES.fallbackOn],
    fallbackMayLeaveMachine: bool('fallbackMayLeaveMachine'),
    speechVoiceMayChange: bool('speechVoiceMayChange'),
    maxCostPerCallUsd: typeof r.maxCostPerCallUsd === 'number' && r.maxCostPerCallUsd >= 0 ? r.maxCostPerCallUsd : null,
  };
}

export async function readRouting(storage: Storage, gaii: string, agent?: string): Promise<LoadedRouting> {
  const [owner, agentRec] = await Promise.all([
    storage.getMemory(gaii, ROUTING_KEY),
    agent && isValidAgentName(agent) ? storage.getMemory(gaii, agentRoutingKey(agent)) : Promise.resolve(null),
  ]);
  const o = isObj(owner?.value) ? owner.value : {};
  return {
    owner: { version: 1, defaults: readDefaults(o.defaults), rules: readRules(o.rules), ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}) },
    ...(agentRec && isObj(agentRec.value) ? { agent: readDefaults(agentRec.value.defaults) } : {}),
  };
}

/** What a call is, for the rules. */
export interface RoutingCall { capability: AiCapability; agent?: string; app?: string }

/**
 * The rules this call runs under. THE one reader of the rules: a conditional rule set is added here,
 * and nothing else changes.
 */
export function rulesFor(_call: RoutingCall, routing: LoadedRouting): RoutingRules {
  return routing.owner.rules;
}

/** The ordered provider ids for a capability: the agent's own list, then the owner's. */
export function defaultsFor(capability: AiCapability, routing: LoadedRouting): { agent: string[]; owner: string[] } {
  return { agent: routing.agent?.[capability] ?? [], owner: routing.owner.defaults[capability] ?? [] };
}

export interface RoutingInput { defaults?: RoutingDefaults; rules?: Partial<RoutingRules>; agent?: string }

/**
 * Check what a caller asks to change, against the providers this owner can use. Every problem at
 * once, so an AI fixing its call gets them all in one answer.
 */
export function normaliseRoutingInput(input: unknown, knownIds: ReadonlySet<string>): { value: RoutingInput } | { problems: string[] } {
  const problems: string[] = [];
  if (!isObj(input)) return { problems: ['routing: an object with defaults, rules or both.'] };
  const out: RoutingInput = {};
  if (input.agent !== undefined) {
    if (typeof input.agent !== 'string' || !isValidAgentName(input.agent)) problems.push('agent: the bare name of one of your agents.');
    else out.agent = input.agent;
  }
  if (input.defaults !== undefined) {
    if (!isObj(input.defaults)) problems.push('defaults: { "<capability>": ["<provider id>", ...] }.');
    else {
      out.defaults = {};
      for (const [cap, list] of Object.entries(input.defaults)) {
        if (!(CAPABILITIES as readonly string[]).includes(cap)) { problems.push(`defaults.${cap}: not a capability. Known: ${CAPABILITIES.join(', ')}.`); continue; }
        if (!Array.isArray(list) || list.length > MAX_DEFAULTS || list.some(x => typeof x !== 'string')) {
          problems.push(`defaults.${cap}: a list of up to ${MAX_DEFAULTS} provider ids, first is the default.`); continue;
        }
        const unknown = (list as string[]).filter(id => !knownIds.has(id));
        if (unknown.length) problems.push(`defaults.${cap}: ${unknown.join(', ')} is not a provider you can use. Known: ${[...knownIds].join(', ') || 'none yet'}.`);
        if (new Set(list).size !== list.length) problems.push(`defaults.${cap}: a provider is listed twice.`);
        out.defaults[cap as AiCapability] = list as string[];
      }
    }
  }
  if (input.rules !== undefined) {
    if (out.agent) problems.push('rules: the rules are the owner\'s and apply to every agent; an agent\'s record holds defaults only.');
    else if (!isObj(input.rules)) problems.push('rules: an object.');
    else {
      const r = input.rules;
      const rules: Partial<RoutingRules> = {};
      for (const k of ['extendToPool', 'onlyTested', 'fallback', 'fallbackMayLeaveMachine', 'speechVoiceMayChange'] as const) {
        if (r[k] === undefined) continue;
        if (typeof r[k] !== 'boolean') problems.push(`rules.${k}: true or false.`); else rules[k] = r[k] as boolean;
      }
      if (r.poolOrder !== undefined) {
        if (!['priority', 'cheapest', 'fastest'].includes(String(r.poolOrder))) problems.push('rules.poolOrder: priority, cheapest or fastest.');
        else rules.poolOrder = r.poolOrder as RoutingRules['poolOrder'];
      }
      if (r.maxAttempts !== undefined) {
        if (typeof r.maxAttempts !== 'number' || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1 || r.maxAttempts > 5) problems.push('rules.maxAttempts: a whole number from 1 to 5.');
        else rules.maxAttempts = r.maxAttempts;
      }
      if (r.fallbackOn !== undefined) {
        if (!Array.isArray(r.fallbackOn) || r.fallbackOn.some(x => !FALLBACK_CLASSES.includes(x as FailureClass))) {
          problems.push(`rules.fallbackOn: a list of ${FALLBACK_CLASSES.join(', ')}. A bad request, a content refusal and a budget refusal never move on.`);
        } else rules.fallbackOn = r.fallbackOn as FailureClass[];
      }
      if (r.maxCostPerCallUsd !== undefined) {
        if (r.maxCostPerCallUsd !== null && (typeof r.maxCostPerCallUsd !== 'number' || !(r.maxCostPerCallUsd >= 0 && r.maxCostPerCallUsd <= 100))) {
          problems.push('rules.maxCostPerCallUsd: a number of US dollars from 0 to 100, or null for no ceiling.');
        } else rules.maxCostPerCallUsd = r.maxCostPerCallUsd as number | null;
      }
      out.rules = rules;
    }
  }
  if (out.defaults === undefined && out.rules === undefined) problems.push('routing: give defaults, rules or both.');
  return problems.length ? { problems } : { value: out };
}

/** Apply a checked change: merged into the record, a capability named replaces its list. */
async function writeRouting(storage: Storage, gaii: string, change: RoutingInput): Promise<LoadedRouting> {
  const current = await readRouting(storage, gaii, change.agent);
  const at = new Date().toISOString();
  if (change.agent) {
    const defaults = { ...(current.agent ?? {}), ...(change.defaults ?? {}) };
    await upsertPrivateRecord(storage, gaii, agentRoutingKey(change.agent), { version: 1, defaults, updatedAt: at }, ['ai', 'routing']);
  } else {
    const record: RoutingRecord = {
      version: 1,
      defaults: { ...current.owner.defaults, ...(change.defaults ?? {}) },
      rules: { ...current.owner.rules, ...(change.rules ?? {}) },
      updatedAt: at,
    };
    await upsertPrivateRecord(storage, gaii, ROUTING_KEY, record, ['ai', 'routing']);
  }
  emitChange('ai-providers', gaii);
  return readRouting(storage, gaii, change.agent);
}

export type RoutingActor = { kind: 'owner' } | { kind: 'agent'; principal: string; confirmToken?: string };
export type RoutingSetResult =
  | { mode: 'applied'; routing: LoadedRouting }
  | { mode: 'proposal'; current: LoadedRouting; proposed: RoutingInput; confirm_token: string; expires_in_seconds: number; instructions: string };

const ROUTING_ACTION = 'ai_routing';

/**
 * Change the routing. The owner in person writes at once; an agent proposes, shows the owner, and
 * applies with the token bound to the exact change within ten minutes (the model policy's pattern,
 * policy-store.ts setOwnerAiPolicy).
 */
export async function setRouting(
  storage: Storage, gaii: string, input: unknown, knownIds: ReadonlySet<string>, actor: RoutingActor,
): Promise<RoutingSetResult> {
  const r = normaliseRoutingInput(input, knownIds);
  if ('problems' in r) {
    throw new AiCompletionError('AI_ROUTING_INVALID', 400, `The routing was not saved: ${r.problems.join(' ')}`, { problems: r.problems });
  }
  if (actor.kind === 'owner') return { mode: 'applied', routing: await writeRouting(storage, gaii, r.value) };
  if (!actor.confirmToken) {
    return {
      mode: 'proposal',
      current: await readRouting(storage, gaii, r.value.agent),
      proposed: r.value,
      confirm_token: await mintConfirmToken(actor.principal, ROUTING_ACTION, r.value),
      expires_in_seconds: 600,
      instructions: 'Show this change to the owner. To apply EXACTLY this change, call again with the same routing plus confirm_token. Any change invalidates the token.',
    };
  }
  try {
    await verifyConfirmToken(actor.confirmToken, actor.principal, ROUTING_ACTION, r.value);
  } catch (e) {
    if (e instanceof ConfirmTokenError) throw new AiCompletionError(e.code, 403, e.message);
    throw e;
  }
  return { mode: 'applied', routing: await writeRouting(storage, gaii, r.value) };
}
