/**
 * @file ai-allowance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose key pays for a completion, and how much of the node's key one person may use.
 *
 *   A node can hold one OpenRouter key of its own (AIMEAT_OPENROUTER_INSTANCE_KEY) so that a person
 *   who has not brought their own can still do something on the day they arrive. That key is shared
 *   by everyone on the node, so the node — not the provider — has to decide how much of it each
 *   person may spend. The allowance record here is that decision, and it is checked BEFORE the call
 *   rather than reconciled after: a gate, not a ledger entry.
 *
 *   This is deliberately not per-user provisioning of provider keys. OpenRouter's terms are respected
 *   as written: the node runs its own product on its own key and meters its own users, and nobody is
 *   handed raw API access. Someone who wants unmetered use brings their own key, which is the
 *   recommended path and bypasses every line of this file.
 *
 *   Selection order, one place, no exceptions: the person's own key, then the node's key if they have
 *   allowance left, then nothing.
 * @structure
 *   - AiKeyChoice — which key pays, and whether the allowance is spent
 *   - NodeKeyStanding / nodeKeyStanding() — may the node's key pay one more call: the allowance, then
 *     the operator's mode and daily limits once it is spent
 *   - resolveAiKey() — the order above, with the free starter grant applied lazily
 *   - isOpenRouterHost() — the one address the node's key may be sent to
 *   - debitAllowance() / grantAllowance() / readAllowance()
 * @usage
 *   const standing = await nodeKeyStanding(storage, config, gaii);
 *   if (!standing.mayPay) { … the free model for a call that named none, or refuse with standing.message … }
 * @version-history
 *   v1.3.0 — 2026-10-05 — nodeKeyStanding(): one answer to "may the node's key pay" for the AI planner
 *     and the decision service, with the operator's mode once an allowance is spent (refuse by
 *     default, or limits per account and per node per UTC day). debitAllowance counts the day's
 *     spend per account and for the node (secaudit 2026-10, AI-1).
 *   v1.2.0 — 2026-09-28 — resolveAiKey takes `nodeKey: false` for an operation the node's key does
 *     not pay for: an image or a transcription pays from the node's key only when the operator named
 *     a node default model for it (Jouni, 2026-09-28). Text is unchanged.
 *   v1.1.0 — 2026-09-16 — The node's key goes only to OpenRouter's host. resolveAiKey takes the
 *     call's baseUrl and refuses the node key for any other address: a person with no key saved
 *     their own address and received the node's key in the Authorization header.
 *   v1.0.0 — 2026-08-16 — Initial. Before this the node had no key of its own at all: every
 *     completion spent one individual owner's key, so a person with none simply had no AI.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { AiCompletionError, decryptOwnerKey } from './ai/completion.js';
import { DEFAULT_BASE_URLS, type ProviderType } from './openrouter.js';
import { readSystem, updateSystem } from './classification/system-record.js';
import { logger } from '../utils/logger.js';

/**
 * One person's standing on the node's key. Lives under the reserved `ai-usage.` prefix, so an
 * app-grant token cannot write it: the balance decides what the node pays for, and a principal that
 * could edit its own balance would be deciding that for itself.
 */
export interface AllowanceRecord {
  /** Total ever granted, in USD. Free starter plus everything bought. */
  granted_usd: number;
  /** Total ever spent against the node's key. */
  spent_usd: number;
  /** Whether the free starter grant has been applied, so it is applied once and not once per read. */
  free_granted: boolean;
  updated_at: string;
  /** The UTC day `day_spent_usd` counts, for the operator's daily limit per account (nodeKeyStanding). */
  day?: string;
  /** What this account's calls cost the node's key on `day`. */
  day_spent_usd?: number;
}

/**
 * Whether the node's key may pay one more call for a person (nodeKeyStanding). One answer for every
 * caller that spends the node's key: the AI planner (services/ai/route-plan.ts) and the decision
 * service (services/decide/service.ts).
 */
export interface NodeKeyStanding {
  /** What is left of the person's allowance, in USD. */
  remainingUsd: number;
  /** The node's key may pay. With an allowance left, always; once it is spent, by the operator's mode. */
  mayPay: boolean;
  /** Why it may not. */
  reason?: 'allowance-spent' | 'account-daily-limit' | 'node-daily-limit';
  /** The sentence the caller is told. */
  message?: string;
}

export interface AiKeyChoice {
  /** The key to call with. Undefined only for a provider that needs none (a local model server). */
  key: string | undefined;
  /** Which pocket it comes from. Mirrors the ledger dimension of the same name. */
  scope: 'own' | 'node';
  /** Node key only: the allowance is used up. The caller decides whether to degrade or refuse. */
  exhausted: boolean;
  /** Node key only: what is left, in USD. */
  remainingUsd: number;
}

const allowanceKey = (gaii: string) => `ai-usage.allowance.${gaii}`;

function empty(): AllowanceRecord {
  return { granted_usd: 0, spent_usd: 0, free_granted: false, updated_at: new Date().toISOString() };
}

/** Read the allowance, applying the node's free starter grant the first time it is asked for. */
export async function readAllowance(
  storage: Storage, config: AimeatConfig, gaii: string,
): Promise<AllowanceRecord> {
  const rec = (await storage.getMemory(gaii, allowanceKey(gaii)))?.value as AllowanceRecord | undefined;
  const current = rec ?? empty();

  const free = Number(config.chatFreeAllowanceUsd) || 0;
  if (free > 0 && !current.free_granted) {
    const seeded: AllowanceRecord = {
      ...current,
      granted_usd: current.granted_usd + free,
      free_granted: true,
      updated_at: new Date().toISOString(),
    };
    await writeAllowance(storage, gaii, seeded);
    logger.info(`[allowance] gaii=${gaii} free starter grant $${free.toFixed(2)}`);
    return seeded;
  }
  return current;
}

async function writeAllowance(storage: Storage, gaii: string, rec: AllowanceRecord): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(gaii, allowanceKey(gaii));
  await storage.setMemory({
    key: allowanceKey(gaii),
    ownerGaii: gaii,
    value: rec as unknown as Record<string, unknown>,
    visibility: 'private',
    tags: ['ai', 'allowance'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** True when a provider address points at OpenRouter's own host over https, the only place the
 *  node's key may go. Compared against DEFAULT_BASE_URLS so there is one spelling of that host. */
export function isOpenRouterHost(baseUrl: string): boolean {
  // An address that does not parse is not OpenRouter's: that is the answer, not a failure.
  if (typeof baseUrl !== 'string' || !URL.canParse(baseUrl)) return false;
  const target = new URL(baseUrl);
  const home = new URL(DEFAULT_BASE_URLS.openrouter);
  return target.protocol === 'https:' && target.hostname.toLowerCase() === home.hostname && target.port === home.port;
}

/** What is left to spend on the node's key. Never negative: a call may overshoot by its own cost. */
export function remainingOf(rec: AllowanceRecord): number {
  return Math.max(0, rec.granted_usd - rec.spent_usd);
}

/** The UTC day a spend counts toward. */
function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** What all accounts' calls cost the node's key on one UTC day, under system@<node>. */
const NODE_DAY_KEY = 'ai-usage.node-day';
interface NodeDay { day: string; spent_usd: number }
function parseNodeDay(v: unknown): NodeDay {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<NodeDay>;
  return { day: typeof o.day === 'string' ? o.day : '', spent_usd: typeof o.spent_usd === 'number' && o.spent_usd > 0 ? o.spent_usd : 0 };
}

/**
 * May the node's key pay one more call for `gaii`? While the person's allowance lasts, yes. Once it is
 * spent the operator's mode decides (config.aiNodeKeyWhenSpent): 'refuse' pays for nothing more,
 * whatever model the call names; 'limits' keeps paying while the account's spend today and all
 * accounts' spend today stay under the operator's two daily limits. Before 2026-10-05 a text call
 * that named its model kept spending the node's key with no limit but the person's own daily budget
 * (secaudit 2026-10, AI-1; Jouni: "let operator to decide ... if limits then set limits").
 *
 * The daily figures are counted after each call (debitAllowance), so calls running side by side can
 * pass the limit by what they cost together; the limit stops the next call, not one in flight.
 */
export async function nodeKeyStanding(storage: Storage, config: AimeatConfig, gaii: string): Promise<NodeKeyStanding> {
  const rec = await readAllowance(storage, config, gaii);
  const remaining = remainingOf(rec);
  if (remaining > 0) return { remainingUsd: remaining, mayPay: true };
  if (config.aiNodeKeyWhenSpent !== 'limits') {
    return { remainingUsd: 0, mayPay: false, reason: 'allowance-spent',
      message: 'Your allowance on this node is used up. Add more, or set your own key in your AI settings.' };
  }
  const today = utcDay();
  const mine = rec.day === today ? rec.day_spent_usd ?? 0 : 0;
  if (mine >= config.aiNodeKeyAccountDailyUsd) {
    return { remainingUsd: 0, mayPay: false, reason: 'account-daily-limit',
      message: `Your allowance on this node is used up, and your account has reached today's limit on the node's key ($${config.aiNodeKeyAccountDailyUsd.toFixed(2)}). It opens again tomorrow (UTC), or set your own key in your AI settings.` };
  }
  const node = parseNodeDay((await readSystem(storage, config.nodeId, NODE_DAY_KEY))?.value);
  if ((node.day === today ? node.spent_usd : 0) >= config.aiNodeKeyNodeDailyUsd) {
    return { remainingUsd: 0, mayPay: false, reason: 'node-daily-limit',
      message: 'Your allowance on this node is used up, and the node\'s shared key has reached today\'s limit. It opens again tomorrow (UTC), or set your own key in your AI settings.' };
  }
  return { remainingUsd: 0, mayPay: true };
}

/**
 * Decide which key pays.
 *
 * The person's own key always wins when they have one, and no allowance applies to it: it is their
 * money, their provider account and their rate limits, which is exactly why bringing one is the
 * recommended path.
 */
export async function resolveAiKey(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  provider: ProviderType,
  apiKeyRecordValue: unknown,
  baseUrl: string,
  opts: {
    /** False when the node's key may not pay for this operation at all (nodeKeyPaysFor in
     *  ai/completion.ts: an image or a transcription for which the operator named no default model). */
    nodeKey?: boolean;
  } = {},
): Promise<AiKeyChoice> {
  const hasOwn = !!(apiKeyRecordValue as { encrypted?: string } | undefined)?.encrypted;
  if (hasOwn) {
    return {
      key: decryptOwnerKey(config, apiKeyRecordValue, provider),
      scope: 'own', exhausted: false, remainingUsd: 0,
    };
  }

  const instanceKey = (config.openrouterInstanceKey || '').trim();
  if (instanceKey && provider === 'openrouter' && opts.nodeKey !== false) {
    // The node's key goes to OpenRouter's own host and nowhere else. The address comes from the
    // person's saved settings, and a person with no key of their own saved an address they
    // control: the node then sent its key there in the Authorization header. Their OWN key may
    // still go anywhere they point it (a local model server is the ordinary case); this one is
    // not theirs to point.
    if (!isOpenRouterHost(baseUrl)) {
      throw new AiCompletionError('NODE_KEY_HOST', 403,
        'This node\'s shared AI key is sent only to OpenRouter. To use another address, add your own API key in your AI settings.');
    }
    const rec = await readAllowance(storage, config, gaii);
    const remaining = remainingOf(rec);
    return { key: instanceKey, scope: 'node', exhausted: remaining <= 0, remainingUsd: remaining };
  }

  // No own key, no node key: the existing refusal, unchanged. decryptOwnerKey words it and throws
  // for openrouter, and returns undefined for a provider that legitimately needs no key.
  return {
    key: decryptOwnerKey(config, apiKeyRecordValue, provider),
    scope: 'own', exhausted: false, remainingUsd: 0,
  };
}

/**
 * Charge the node's key. Only ever called after a call that actually used it, so a person's own key
 * never touches the balance.
 *
 * Best-effort by design: the call has happened and the money is spent, so a failure to record must
 * not turn a served answer into an error. It is logged loudly, because an operator seeing this knows
 * spend is happening that the balance will not show.
 */
export async function debitAllowance(
  storage: Storage, config: AimeatConfig, gaii: string, costUsd: number,
): Promise<AllowanceRecord | null> {
  if (!(costUsd > 0)) return null;
  try {
    const rec = await readAllowance(storage, config, gaii);
    const today = utcDay();
    const next: AllowanceRecord = {
      ...rec,
      spent_usd: rec.spent_usd + costUsd,
      day: today,
      day_spent_usd: (rec.day === today ? rec.day_spent_usd ?? 0 : 0) + costUsd,
      updated_at: new Date().toISOString(),
    };
    await writeAllowance(storage, gaii, next);
    // All accounts together, for the node-wide daily limit. Compare-and-swap, because every account
    // writes this one record.
    await updateSystem(storage, config.nodeId, NODE_DAY_KEY, parseNodeDay,
      cur => ({ day: today, spent_usd: (cur.day === today ? cur.spent_usd : 0) + costUsd }), null, 'ai-allowance');
    return next;
  } catch (err) {
    logger.warn('[allowance] debit failed; the node key was used and the balance will not show it', {
      gaii, costUsd, error: String(err),
    });
    return null;
  }
}

/**
 * Add to someone's allowance. The one door a purchase, an operator gift or a refund comes through,
 * so there is a single place to look when a balance is wrong.
 */
export async function grantAllowance(
  storage: Storage, config: AimeatConfig, gaii: string, usd: number, source: string,
): Promise<AllowanceRecord> {
  if (!(usd > 0)) throw new AiCompletionError('INVALID_BODY', 400, 'A grant must be a positive amount.');
  const rec = await readAllowance(storage, config, gaii);
  const next: AllowanceRecord = {
    ...rec,
    granted_usd: rec.granted_usd + usd,
    updated_at: new Date().toISOString(),
  };
  await writeAllowance(storage, gaii, next);
  logger.info(`[allowance] gaii=${gaii} granted $${usd.toFixed(2)} (${source}); balance $${remainingOf(next).toFixed(2)}`);
  return next;
}
