/**
 * @file ai-allowance.ts
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
 *   - resolveAiKey() — the order above, with the free starter grant applied lazily
 *   - debitAllowance() / grantAllowance() / readAllowance()
 * @usage
 *   const choice = await resolveAiKey(storage, config, gaii, prefs, apiKeyRecord?.value);
 *   if (choice.scope === 'node' && choice.exhausted) { … degrade or refuse … }
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial. Before this the node had no key of its own at all: every
 *     completion spent one individual owner's key, so a person with none simply had no AI.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { AiCompletionError, decryptOwnerKey } from './ai-completion.js';
import type { ProviderType } from './openrouter.js';
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

/** What is left to spend on the node's key. Never negative: a call may overshoot by its own cost. */
export function remainingOf(rec: AllowanceRecord): number {
  return Math.max(0, rec.granted_usd - rec.spent_usd);
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
): Promise<AiKeyChoice> {
  const hasOwn = !!(apiKeyRecordValue as { encrypted?: string } | undefined)?.encrypted;
  if (hasOwn) {
    return {
      key: decryptOwnerKey(config, apiKeyRecordValue, provider),
      scope: 'own', exhausted: false, remainingUsd: 0,
    };
  }

  const instanceKey = (config.openrouterInstanceKey || '').trim();
  if (instanceKey && provider === 'openrouter') {
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
    const next: AllowanceRecord = {
      ...rec,
      spent_usd: rec.spent_usd + costUsd,
      updated_at: new Date().toISOString(),
    };
    await writeAllowance(storage, gaii, next);
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
