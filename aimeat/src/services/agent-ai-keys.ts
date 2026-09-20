/**
 * @file src/services/agent-ai-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A key per agent, for both models, and a daily cap beside it.
 *
 *   WHY. An owner who runs several agents could not say "this one spends on its own account": every
 *   call in their name paid with their one key, so one agent's bill could not be told from
 *   another's, and a research agent could not be given a small, separate purse. A key per agent pins
 *   the spend, and the record of every call says which key paid.
 *
 *   WHERE IT LIVES. `decide.apikey.agent.<name>` (TypeSafe) and `openrouter.apikey.agent.<name>`
 *   (OpenRouter), in the OWNER's namespace, encrypted the way the owner's own keys are
 *   (services/encryption.ts), under reserved prefixes (utils/reserved-keys.ts) and on the credential
 *   list (services/secret-records.ts): no generic memory door reads or writes them, search does not
 *   show them, and an export carries `{ configured: true }` in their place.
 *
 *   THE ORDER, STRONGEST FIRST: the agent's own key, the owner's own key, the node's key. The decision
 *   record and the usage ledger both say which one paid (`agent` | `own` | `node`).
 *
 *   THE NODE NEVER SENDS A KEY TO AN AGENT. No function here returns a key to a route: the two
 *   read functions are called by the one place that makes the outbound call. For an agent that makes
 *   its own calls elsewhere (a crew on the owner's machine), the record may NAME the environment
 *   variable that holds the key there (`env`), the way aimeat_crew_llm_set refuses a provider block
 *   that carries a key: the credential stays on the machine that runs the agent.
 *
 *   THE CAP has the shape of the per-app cap: `openrouter.settings.agent_quotas.<name>.daily_usd`,
 *   checked against today's `per_agent` spend before a call, so one call may overshoot by its own
 *   cost and the next is refused. No cap set means the owner's daily budget is the only limit.
 * @structure
 *   AgentAiModel · agentNameOf · agentKeyRecord · readAgentKey · writeAgentKey · clearAgentKey ·
 *   agentCapRefusal · addAgentSpend · writeAgentCap · agentAiView
 * @usage
 *   const agent = agentNameOf(caller.principal, caller.gaii);
 *   const key = agent ? await readAgentKey(storage, config, caller.gaii, agent, 'decide') : null;
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node, and a key per agent.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from './encryption.js';
import { upsertPrivateRecord } from './private-record.js';
import { emitChange } from './event-bus.js';
import { parseGAII } from '../utils/gaii.js';

/** The two models an agent may hold a key for. */
export type AgentAiModel = 'decide' | 'openrouter';

const RECORD_BASE: Record<AgentAiModel, string> = { decide: 'decide.apikey', openrouter: 'openrouter.apikey' };
const SETTINGS_RECORD = 'openrouter.settings';
const ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const AGENT_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** A refusal a route maps to a status. No throw type of its own, so this module imports no service. */
export class AgentAiKeyError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); this.name = 'AgentAiKeyError'; }
}

/**
 * The agent's bare name when `principal` is one of THIS owner's agents, else null. The owner, an app
 * and an ecosystem app have no agent key: they resolve from the owner's key downwards.
 */
export function agentNameOf(principal: string, ownerGhii: string): string | null {
  const p = parseGAII(principal);
  if (!p || `${p.owner}@${p.node}` !== ownerGhii) return null;
  return p.agent;
}

/**
 * For a text door, whose payer IS the principal: the agent's name and its owner's GHII when the
 * principal is an agent, else nothing. Spread into the completion options.
 */
export function agentOfPrincipal(principal: string): { agent?: string; agentOwner?: string } {
  const p = parseGAII(principal);
  return p ? { agent: p.agent, agentOwner: `${p.owner}@${p.node}` } : {};
}

export function agentKeyRecord(model: AgentAiModel, agent: string): string {
  return `${RECORD_BASE[model]}.agent.${agent}`;
}

function assertAgentName(agent: string): void {
  if (!AGENT_RE.test(agent)) throw new AgentAiKeyError('INVALID_AGENT', 400, 'Not an agent name.');
}

function encryptionKeyOf(config: AimeatConfig): Buffer {
  const k = getEncryptionKey(config);
  if (!k) {
    throw new AgentAiKeyError('ENCRYPTION_NOT_CONFIGURED', 503,
      'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  }
  return k;
}

/** The agent's own key, decrypted, or null. For the one caller that makes the outbound call. */
export async function readAgentKey(
  storage: Storage, config: AimeatConfig, ownerGhii: string, agent: string, model: AgentAiModel,
): Promise<string | null> {
  const rec = await storage.getMemory(ownerGhii, agentKeyRecord(model, agent));
  const encrypted = (rec?.value as { encrypted?: unknown } | undefined)?.encrypted;
  if (typeof encrypted !== 'string' || !encrypted) return null;
  return decrypt(encrypted, encryptionKeyOf(config));
}

/**
 * Set the agent's key, or the NAME of the environment variable that holds it where the agent runs,
 * or both. `apiKey: null` forgets the key and keeps the name; `env: null` forgets the name.
 */
export async function writeAgentKey(
  storage: Storage, config: AimeatConfig, ownerGhii: string, agent: string, model: AgentAiModel,
  input: { apiKey?: unknown; env?: unknown },
): Promise<void> {
  assertAgentName(agent);
  const key = agentKeyRecord(model, agent);
  const existing = (await storage.getMemory(ownerGhii, key))?.value as { encrypted?: string; env?: string; set_at?: string } | undefined;
  const next: { encrypted?: string; env?: string; set_at?: string } = { ...(existing ?? {}) };

  if (input.apiKey !== undefined) {
    if (input.apiKey === null || input.apiKey === '') { delete next.encrypted; delete next.set_at; }
    else {
      if (typeof input.apiKey !== 'string' || input.apiKey.trim().length < 8 || input.apiKey.length > 512 || /\s/.test(input.apiKey.trim())) {
        throw new AgentAiKeyError('INVALID_BODY', 400, 'api_key must be the key as issued: one token, no spaces.');
      }
      next.encrypted = encrypt(input.apiKey.trim(), encryptionKeyOf(config));
      next.set_at = new Date().toISOString();
    }
  }
  if (input.env !== undefined) {
    if (input.env === null || input.env === '') delete next.env;
    else {
      if (typeof input.env !== 'string' || !ENV_RE.test(input.env)) {
        throw new AgentAiKeyError('INVALID_BODY', 400, 'key_env is the NAME of an environment variable (for example TYPESAFE_API_KEY), never the key itself.');
      }
      next.env = input.env;
    }
  }

  if (!next.encrypted && !next.env) {
    if (existing) await storage.deleteMemory(ownerGhii, key);
  } else {
    await upsertPrivateRecord(storage, ownerGhii, key, next, ['ai', 'secret', 'agent']);
  }
  emitChange('agents', ownerGhii);
}

export async function clearAgentKey(storage: Storage, ownerGhii: string, agent: string, model: AgentAiModel): Promise<boolean> {
  const key = agentKeyRecord(model, agent);
  if (!(await storage.getMemory(ownerGhii, key))) return false;
  await storage.deleteMemory(ownerGhii, key);
  emitChange('agents', ownerGhii);
  return true;
}

type PerAgent = Record<string, { cost_usd: number; calls: number; tokens: number }>;

/**
 * Today's spend by one agent, over BOTH places a call in its name is metered. A decision is paid and
 * metered in the owner's namespace; a text completion an agent asks for is metered in the agent's
 * own (routes/ai.ts resolves the payer to the principal). One cap covers both, so both are read.
 */
async function agentSpentToday(storage: Storage, ownerGhii: string, agent: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const agentGaii = `${agent}#${ownerGhii}`;
  const [mine, theirs] = await Promise.all([
    storage.getMemory(ownerGhii, `ai-usage.${ownerGhii}.${day}`),
    storage.getMemory(agentGaii, `ai-usage.${agentGaii}.${day}`),
  ]);
  const of = (v: unknown): number => (v as { per_agent?: PerAgent } | undefined)?.per_agent?.[agent]?.cost_usd ?? 0;
  return of(mine?.value) + of(theirs?.value);
}

/** The agent's daily cap in USD, or null when the owner set none. */
function agentCapOf(prefs: Record<string, unknown>, agent: string): number | null {
  const q = (prefs.agent_quotas as Record<string, { daily_usd?: unknown }> | undefined)?.[agent]?.daily_usd;
  return typeof q === 'number' && Number.isFinite(q) && q >= 0 ? q : null;
}

/**
 * Why this agent may not spend right now, or null. A message rather than a throw, so the two callers
 * (the completion path and the decision path) raise it as their own error type. The cap is the
 * OWNER's setting, read from the owner's record whoever the payer is.
 */
export async function agentCapRefusal(
  storage: Storage, ownerGhii: string, agent: string | null | undefined,
): Promise<string | null> {
  if (!agent) return null;
  const prefs = ((await storage.getMemory(ownerGhii, SETTINGS_RECORD))?.value as Record<string, unknown>) ?? {};
  const cap = agentCapOf(prefs, agent);
  if (cap === null) return null;
  const spent = await agentSpentToday(storage, ownerGhii, agent);
  return spent >= cap
    ? `Daily AI cap for agent "${agent}" hit ($${spent.toFixed(4)} / $${cap}). The owner raises it on the agent's page.`
    : null;
}

/** The `per_agent` map with one call added. Pure: the usage writer stores what this returns. */
export function addAgentSpend(perAgent: PerAgent | undefined, agent: string | null | undefined, call: { costUsd: number; tokens: number }): PerAgent {
  const out: PerAgent = { ...(perAgent ?? {}) };
  if (!agent) return out;
  const e = out[agent] ?? { cost_usd: 0, calls: 0, tokens: 0 };
  out[agent] = { cost_usd: e.cost_usd + call.costUsd, calls: e.calls + 1, tokens: e.tokens + call.tokens };
  return out;
}

/** Set or clear (`null`) one agent's daily cap, inside the owner's AI settings record. */
export async function writeAgentCap(storage: Storage, ownerGhii: string, agent: string, dailyUsd: unknown): Promise<void> {
  assertAgentName(agent);
  if (dailyUsd !== null && (typeof dailyUsd !== 'number' || !Number.isFinite(dailyUsd) || dailyUsd < 0 || dailyUsd > 10_000)) {
    throw new AgentAiKeyError('INVALID_BODY', 400, 'daily_usd is a number from 0 to 10000, or null for no cap of its own.');
  }
  const rec = await storage.getMemory(ownerGhii, SETTINGS_RECORD);
  const prefs = { ...((rec?.value as Record<string, unknown>) ?? {}) };
  const quotas = { ...((prefs.agent_quotas as Record<string, unknown>) ?? {}) };
  if (dailyUsd === null) delete quotas[agent]; else quotas[agent] = { daily_usd: dailyUsd };
  prefs.agent_quotas = quotas;
  await upsertPrivateRecord(storage, ownerGhii, SETTINGS_RECORD, prefs, (rec?.tags as string[] | undefined) ?? ['ai', 'settings']);
  emitChange('agents', ownerGhii);
}

export interface AgentAiKeyView { has_key: boolean; key_env: string | null; set_at: string | null }

/** What the agent's page and the agent itself may see: never a key, only whether one is set. */
export async function agentAiView(
  storage: Storage, ownerGhii: string, agent: string,
): Promise<{ decide: AgentAiKeyView; openrouter: AgentAiKeyView; daily_usd: number | null; spent_today_usd: number }> {
  const [d, o, prefsRec] = await Promise.all([
    storage.getMemory(ownerGhii, agentKeyRecord('decide', agent)),
    storage.getMemory(ownerGhii, agentKeyRecord('openrouter', agent)),
    storage.getMemory(ownerGhii, SETTINGS_RECORD),
  ]);
  const view = (v: unknown): AgentAiKeyView => {
    const r = (v ?? {}) as { encrypted?: unknown; env?: unknown; set_at?: unknown };
    return {
      has_key: typeof r.encrypted === 'string' && !!r.encrypted,
      key_env: typeof r.env === 'string' ? r.env : null,
      set_at: typeof r.set_at === 'string' ? r.set_at : null,
    };
  };
  return {
    decide: view(d?.value), openrouter: view(o?.value),
    daily_usd: agentCapOf((prefsRec?.value as Record<string, unknown>) ?? {}, agent),
    spent_today_usd: await agentSpentToday(storage, ownerGhii, agent),
  };
}
