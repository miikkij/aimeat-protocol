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
 *   writeDecideSettings · clearOwnDecideKey · decideSettingsView
 * @usage
 *   const policy = await readDecidePolicy(storage, gaii);
 *   const own = await readOwnDecideKey(storage, config, gaii); // string | null, never logged
 * @version-history
 *   v1.3.1 — 2026-09-24 — A provider that needs no key of the owner's is read by takesNoOwnerKey
 *     (providers.ts), in the view and in the availability answer alike: the built-in laya and von
 *     now name an optional variable, and still count as needing none.
 *   v1.3.0 — 2026-09-24 — writeDecideSettings is the settings door's one write, and it checks the
 *     key, the provider choice and the policy before it writes any of them (273435328c90): the door
 *     stored the key and the choice first, so a request refused for its policy left the key replaced.
 *   v1.2.0 — 2026-09-23 — The view carries the decision providers and who chose which; a provider
 *     that takes no key makes the model available without anyone's key.
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
import { planProviderChoice, providersView, selectProvider, takesNoOwnerKey, writeProviderChoice } from './providers.js';
import { logger } from '../../utils/logger.js';

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

type PolicyInput = { allow?: unknown; storeState?: unknown; allowPublicOptOut?: unknown };

/**
 * Check a policy input without writing it, or refuse. Validates rather than filters: an unknown
 * class is a typo the owner should hear about, not a line silently dropped from the thing that
 * decides what leaves their node.
 */
function checkDecidePolicy(input: PolicyInput): void {
  if (input.allow !== undefined) {
    if (!Array.isArray(input.allow) || input.allow.some(c => typeof c !== 'string' || !(PII_CLASSES as readonly string[]).includes(c))) {
      throw new DecideError('INVALID_BODY', 400, `allow must be a list drawn from: ${PII_CLASSES.join(', ')}.`);
    }
  }
  for (const f of ['storeState', 'allowPublicOptOut'] as const) {
    if (input[f] !== undefined && typeof input[f] !== 'boolean') {
      throw new DecideError('INVALID_BODY', 400, `${f} must be true or false.`);
    }
  }
}

/** Write the policy, checked first (checkDecidePolicy). */
export async function writeDecidePolicy(storage: Storage, gaii: string, input: PolicyInput): Promise<DecidePolicy> {
  checkDecidePolicy(input);
  const current = await readDecidePolicy(storage, gaii);
  const allow = input.allow !== undefined ? [...new Set(input.allow as PiiClass[])] : current.allow;
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

/** The key as it would be stored and the node key that would encrypt it, checked, or the refusal. */
function checkOwnDecideKey(config: AimeatConfig, apiKey: unknown): { key: string; encKey: Buffer } {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 512 || /\s/.test(apiKey.trim())) {
    throw new DecideError('INVALID_BODY', 400, 'api_key must be the TypeSafe key as issued: one token, no spaces.');
  }
  const encKey = getEncryptionKey(config);
  if (!encKey) {
    throw new DecideError('ENCRYPTION_NOT_CONFIGURED', 503,
      'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  }
  return { key: apiKey.trim(), encKey };
}

export async function writeOwnDecideKey(storage: Storage, config: AimeatConfig, gaii: string, apiKey: unknown): Promise<void> {
  const { key, encKey } = checkOwnDecideKey(config, apiKey);
  await upsert(storage, gaii, DECIDE_KEY_RECORD,
    { encrypted: encrypt(key, encKey), set_at: new Date().toISOString() }, ['decide', 'secret']);
}

/**
 * The settings door's one write: the owner's own key, their provider choice and their data policy,
 * any of them. EVERY FIELD IS CHECKED BEFORE ANY IS WRITTEN (invariant 14, 273435328c90): the door
 * stored the key and the choice and only then read the policy, so a request refused for its policy
 * had already replaced the owner's key.
 *
 * The choice is written first of the three, because it is the one write that reads the store again
 * (the providers this owner can use) and so the one that could still refuse.
 */
export async function writeDecideSettings(storage: Storage, config: AimeatConfig, gaii: string, body: Record<string, unknown>): Promise<void> {
  let policy: PolicyInput | undefined;
  if (body.policy !== undefined) {
    const p = body.policy;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new DecideError('INVALID_BODY', 400, 'policy must be an object: { allow, store_state, allow_public_opt_out }.');
    }
    const o = p as Record<string, unknown>;
    policy = { allow: o.allow, storeState: o.store_state, allowPublicOptOut: o.allow_public_opt_out };
    checkDecidePolicy(policy);
  }
  if (body.api_key !== undefined) checkOwnDecideKey(config, body.api_key);
  // The owner's default provider and the one each agent uses. `null` gives the choice back.
  const choice = body.provider !== undefined || body.agent_providers !== undefined
    ? {
      ...(body.provider !== undefined ? { default: body.provider } : {}),
      ...(body.agent_providers !== undefined ? { agents: body.agent_providers } : {}),
    }
    : undefined;
  if (choice) await planProviderChoice(storage, config, gaii, choice);

  if (choice) await writeProviderChoice(storage, config, gaii, choice);
  if (body.api_key !== undefined) await writeOwnDecideKey(storage, config, gaii, body.api_key);
  if (policy) await writeDecidePolicy(storage, gaii, policy);
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
export function decideAvailability(config: AimeatConfig, hasOwnKey: boolean, keylessProvider = false): { available: boolean; reason: string | null } {
  if (!config.decideEnabled) return { available: false, reason: 'The operator has turned the decision model off on this node.' };
  // A provider that takes no key (a local decision model) answers without anyone's key.
  if (keylessProvider || hasOwnKey || config.decideInstanceKey.trim()) return { available: true, reason: null };
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
  providers: Awaited<ReturnType<typeof providersView>>;
}> {
  const [keyRec, policy, mine, gate, providers] = await Promise.all([
    storage.getMemory(gaii, DECIDE_KEY_RECORD),
    readDecidePolicy(storage, gaii),
    agent ? agentAiView(storage, gaii, agent) : null,
    agent ? gateSettingOf(storage, gaii, agent) : null,
    providersView(storage, config, gaii, agent),
  ]);
  const hasOwnKey = typeof (keyRec?.value as { encrypted?: unknown } | undefined)?.encrypted === 'string';
  const effective = providers.providers.find(p => p.id === (providers.this_agent ?? providers.default));
  const keyless = takesNoOwnerKey(effective?.auth as { type?: unknown; optional?: unknown } | undefined);
  // An agent with a key of its own can ask even when the owner and the node have none.
  const { available, reason } = decideAvailability(config, hasOwnKey || !!mine?.decide.has_key, keyless);
  return {
    providers,
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
  const [keyRec, { provider }] = await Promise.all([
    storage.getMemory(gaii, DECIDE_KEY_RECORD),
    // A choice that names a vanished provider is refused at call time with its own message; here it
    // only means "cannot tell whether a keyless provider applies", so the key answer stands.
    selectProvider(storage, config, { ownerGhii: gaii, agent: null }).catch((err: unknown) => {
      logger.warn('[decide] the owner\'s provider choice does not resolve', { gaii, error: String(err) });
      return { provider: null };
    }),
  ]);
  return decideAvailability(config, typeof (keyRec?.value as { encrypted?: unknown } | undefined)?.encrypted === 'string',
    takesNoOwnerKey(provider?.auth));
}
