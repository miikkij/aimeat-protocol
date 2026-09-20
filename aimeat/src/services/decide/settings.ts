/**
 * @file src/services/decide/settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one owner has decided about the decision provider (TARGET-080): their own
 *   TypeSafe key, and which classes of their personal data may leave the node unscrubbed.
 *
 *   BOTH LIVE UNDER THE RESERVED `decide.` PREFIX (utils/reserved-keys.ts). The key is the
 *   `openrouter.apikey` case: an app that could write it could put in a key it controls and read
 *   every state the owner sends. The policy is the switch the scrubber obeys, so an app that could
 *   write it could turn off the cleaning of its own traffic. Only the owner's routes write either,
 *   server-side, past the memory gate.
 *
 *   THE POLICY IS ONE RECORD, AND SILENCE MEANS SCRUBBED. No record, an empty record and a record
 *   that fails to parse all read as "allow nothing through". A decision provider that shipped with
 *   an opt-in scrubber would have shipped without one.
 *
 *   THE KEY IS ENCRYPTED THE WAY THE OPENROUTER KEY IS (services/encryption.ts, the node master
 *   key), and no read in this file returns it: `hasOwnKey` is a boolean.
 * @structure
 *   DecidePolicy · readDecidePolicy · writeDecidePolicy · readOwnDecideKey · writeOwnDecideKey ·
 *   clearOwnDecideKey · decideSettingsView
 * @usage
 *   const policy = await readDecidePolicy(storage, gaii);
 *   const own = await readOwnDecideKey(storage, config, gaii); // string | null, never logged
 * @version-history
 *   v1.1.0 — 2026-09-20 — The view carries `setup_order`, and for an agent caller what the owner set
 *     for that agent (a key of its own, the name of its variable, cap, gate). Never a key.
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { PII_CLASSES, type PiiClass } from './scrub.js';
import { DecideError } from './errors.js';
import { agentAiView } from '../agent-ai-keys.js';
import { gateSettingOf, type GateSetting } from './gate.js';
import { DECIDE_SETUP_ORDER, type SetupStep } from './setup-order.js';

export const DECIDE_KEY_RECORD = 'decide.apikey';
export const DECIDE_POLICY_RECORD = 'decide.policy';

/** Which personal data may leave unscrubbed, and whether the scrubbed state is kept on the record. */
export interface DecidePolicy {
  /** Classes the scrubber lets through. Empty (the default) scrubs everything it recognises. */
  allow: PiiClass[];
  /** Keep the scrubbed state on every decision record. Off by default: a hash links without a copy. */
  storeState: boolean;
  /** Whether an app or agent may declare content public and skip the scrubber. The owner always may. */
  allowPublicOptOut: boolean;
  updatedAt: string | null;
}

const DEFAULT_POLICY: DecidePolicy = { allow: [], storeState: false, allowPublicOptOut: false, updatedAt: null };

function normalisePolicy(v: unknown): DecidePolicy {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_POLICY };
  const o = v as Record<string, unknown>;
  const allow = Array.isArray(o.allow)
    ? [...new Set(o.allow.filter((c): c is PiiClass => typeof c === 'string' && (PII_CLASSES as readonly string[]).includes(c)))]
    : [];
  return {
    allow,
    storeState: o.storeState === true,
    allowPublicOptOut: o.allowPublicOptOut === true,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
  };
}

/** Written server-side past the memory gate (the prefix is reserved), and announced to the open page. */
async function upsert(storage: Storage, gaii: string, key: string, value: Record<string, unknown>, tags: string[]): Promise<void> {
  await upsertPrivateRecord(storage, gaii, key, value, tags);
  emitChange('ai-decisions', gaii);
}

/** The owner's policy, or the default (scrub everything) when there is none. */
export async function readDecidePolicy(storage: Storage, gaii: string): Promise<DecidePolicy> {
  const rec = await storage.getMemory(gaii, DECIDE_POLICY_RECORD);
  return normalisePolicy(rec?.value);
}

/**
 * Write the policy. Validates rather than filters: an unknown class is a typo the owner should hear
 * about, not a line silently dropped from the thing that decides what leaves their node.
 */
export async function writeDecidePolicy(
  storage: Storage, gaii: string, input: { allow?: unknown; storeState?: unknown; allowPublicOptOut?: unknown },
): Promise<DecidePolicy> {
  const current = await readDecidePolicy(storage, gaii);
  let allow = current.allow;
  if (input.allow !== undefined) {
    if (!Array.isArray(input.allow) || input.allow.some(c => typeof c !== 'string' || !(PII_CLASSES as readonly string[]).includes(c))) {
      throw new DecideError('INVALID_BODY', 400, `allow must be a list drawn from: ${PII_CLASSES.join(', ')}.`);
    }
    allow = [...new Set(input.allow as PiiClass[])];
  }
  for (const f of ['storeState', 'allowPublicOptOut'] as const) {
    if (input[f] !== undefined && typeof input[f] !== 'boolean') {
      throw new DecideError('INVALID_BODY', 400, `${f} must be true or false.`);
    }
  }
  const next: DecidePolicy = {
    allow,
    storeState: typeof input.storeState === 'boolean' ? input.storeState : current.storeState,
    allowPublicOptOut: typeof input.allowPublicOptOut === 'boolean' ? input.allowPublicOptOut : current.allowPublicOptOut,
    updatedAt: new Date().toISOString(),
  };
  await upsert(storage, gaii, DECIDE_POLICY_RECORD, next as unknown as Record<string, unknown>, ['decide', 'policy']);
  return next;
}

/** The owner's own key, decrypted, or null. The caller never logs or returns it. */
export async function readOwnDecideKey(storage: Storage, config: AimeatConfig, gaii: string): Promise<string | null> {
  const rec = await storage.getMemory(gaii, DECIDE_KEY_RECORD);
  const encrypted = (rec?.value as { encrypted?: unknown } | undefined)?.encrypted;
  if (typeof encrypted !== 'string' || !encrypted) return null;
  const encKey = getEncryptionKey(config);
  if (!encKey) {
    throw new DecideError('ENCRYPTION_NOT_CONFIGURED', 503,
      'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  }
  return decrypt(encrypted, encKey);
}

export async function writeOwnDecideKey(storage: Storage, config: AimeatConfig, gaii: string, apiKey: unknown): Promise<void> {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 512 || /\s/.test(apiKey.trim())) {
    throw new DecideError('INVALID_BODY', 400, 'api_key must be the TypeSafe key as issued: one token, no spaces.');
  }
  const encKey = getEncryptionKey(config);
  if (!encKey) {
    throw new DecideError('ENCRYPTION_NOT_CONFIGURED', 503,
      'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  }
  await upsert(storage, gaii, DECIDE_KEY_RECORD,
    { encrypted: encrypt(apiKey.trim(), encKey), set_at: new Date().toISOString() }, ['decide', 'secret']);
}

export async function clearOwnDecideKey(storage: Storage, gaii: string): Promise<boolean> {
  const rec = await storage.getMemory(gaii, DECIDE_KEY_RECORD);
  if (!rec) return false;
  await storage.deleteMemory(gaii, DECIDE_KEY_RECORD);
  emitChange('ai-decisions', gaii);
  return true;
}

/**
 * Can this owner ask the decision model at all, and if not, why, in words a builder can pass on.
 * The one answer every surface gives (the settings door, the library's isAvailable(), the appdev
 * overview), so an app is not built for a model its owner cannot reach.
 */
export function decideAvailability(config: AimeatConfig, hasOwnKey: boolean): { available: boolean; reason: string | null } {
  if (!config.decideEnabled) return { available: false, reason: 'The operator has turned the decision model off on this node.' };
  if (hasOwnKey || config.decideInstanceKey.trim()) return { available: true, reason: null };
  // An instruction, not a bare error: what to set, where, and what comes next.
  return { available: false, reason: 'No TypeSafe key is set. The owner adds one under Settings, AI, Decision model (or one for a single agent on that agent\'s page under AI keys), presses Test, and then writes a decision rule.' };
}

/**
 * What the settings door shows: never the key, only whether one is set and who would pay. For an
 * agent caller, `agent` is its bare name, and the answer adds what the owner set for THAT agent.
 */
export async function decideSettingsView(storage: Storage, config: AimeatConfig, gaii: string, agent?: string | null): Promise<{
  enabled: boolean; available: boolean; unavailable_reason: string | null; model: string;
  has_own_key: boolean; node_key_available: boolean; policy: DecidePolicy; pii_classes: readonly PiiClass[];
  setup_order: readonly SetupStep[];
  agent?: { name: string; has_key: boolean; key_env: string | null; daily_usd: number | null; spent_today_usd: number; gate: GateSetting };
}> {
  const [keyRec, policy, mine, gate] = await Promise.all([
    storage.getMemory(gaii, DECIDE_KEY_RECORD),
    readDecidePolicy(storage, gaii),
    agent ? agentAiView(storage, gaii, agent) : null,
    agent ? gateSettingOf(storage, gaii, agent) : null,
  ]);
  const hasOwnKey = typeof (keyRec?.value as { encrypted?: unknown } | undefined)?.encrypted === 'string';
  // An agent with a key of its own can ask even when the owner and the node have none.
  const { available, reason } = decideAvailability(config, hasOwnKey || !!mine?.decide.has_key);
  return {
    setup_order: DECIDE_SETUP_ORDER,
    ...(agent && mine && gate ? { agent: {
      name: agent, has_key: mine.decide.has_key, key_env: mine.decide.key_env,
      daily_usd: mine.daily_usd, spent_today_usd: mine.spent_today_usd, gate,
    } } : {}),
    enabled: config.decideEnabled,
    available,
    unavailable_reason: reason,
    model: config.decideModel,
    has_own_key: hasOwnKey,
    node_key_available: !!config.decideInstanceKey.trim(),
    policy,
    pii_classes: PII_CLASSES,
  };
}

/** The same answer for a caller that only needs the yes/no (the appdev overview). */
export async function decideAvailableFor(storage: Storage, config: AimeatConfig, gaii: string): Promise<{ available: boolean; reason: string | null }> {
  const keyRec = await storage.getMemory(gaii, DECIDE_KEY_RECORD);
  return decideAvailability(config, typeof (keyRec?.value as { encrypted?: unknown } | undefined)?.encrypted === 'string');
}
