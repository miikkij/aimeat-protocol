/**
 * @file policy-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the model policy's inputs live and how they are read and written (System 2
 *   plan, V2): the owner's `ai.policy.models` memory record, the operator's recommended list
 *   (AIMEAT_AI_RECOMMENDED_MODELS, editable on the Config tab) and an app's own `models=` list from
 *   its published `<meta name="aimeat-ai">`. The decision itself is services/ai/policy.ts.
 *
 *   ONE WRITER. writeOwnerAiPolicy() is what the owner's route (PUT /v1/ai/policy) and the confirmed
 *   proposal of `aimeat_ai_policy_set` both call, so the validation and the record shape are written
 *   once. The key is under the reserved `ai.policy.` prefix, so no app and no delegated write reaches it
 *   through the memory API.
 * @structure
 *   - POLICY_KEY — the owner's record
 *   - recommendedModelsOf(config) — the operator's list, parsed once per value
 *   - readOwnerAiPolicy / writeOwnerAiPolicy — the owner's record
 *   - appModelsOf(storage, payer, appRef) — an app's own list, cached for a minute
 *   - setOwnerAiPolicy() — the owner writes; an agent proposes and confirms with a token
 *   - policyView() — what GET /v1/ai/policy and the MCP tool show
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
 *   v1.1.0 — 2026-09-28 — appAiMetaOf(): the app's prefer.* and local.* beside its models (V5).
 *   v1.2.0 — 2026-09-28 — appAiMetaOf(): the app's address and its declared AI roles (roles.ts).
 */
import type { AimeatConfig } from '../../config.js';
import type { AiCapability } from './types.js';
import type { AppAiRole } from '../app-ai-roles.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../operator-confirm.js';
import { AiCompletionError } from './errors.js';
import {
  normaliseOwnerPolicy, readOwnerPolicy, parseRecommendedModels, isModelRef,
  type OwnerAiPolicy, type RecommendedModels,
} from './policy.js';

/** The owner's model policy. Under the reserved `ai.policy.` prefix (utils/reserved-keys.ts). */
export const POLICY_KEY = 'ai.policy.models';

let recommendedCache: { raw: string; models: RecommendedModels } | null = null;

/**
 * The operator's recommended models. Parsed once per distinct value, because the Config tab can
 * change it while the node runs and every AI call reads it. A malformed entry is left out and
 * logged once; the node never fails a call over the operator's typo.
 */
export function recommendedModelsOf(config: AimeatConfig): RecommendedModels {
  const raw = config.aiRecommendedModels ?? '';
  if (recommendedCache?.raw === raw) return recommendedCache.models;
  const { models, problems } = parseRecommendedModels(raw);
  if (problems.length) logger.warn('[ai] AIMEAT_AI_RECOMMENDED_MODELS has entries the node left out', { problems });
  recommendedCache = { raw, models };
  return models;
}

export async function readOwnerAiPolicy(storage: Storage, gaii: string): Promise<OwnerAiPolicy> {
  return readOwnerPolicy((await storage.getMemory(gaii, POLICY_KEY))?.value);
}

/**
 * Validate and store the owner's policy. Throws AI_POLICY_INVALID with every problem at once, so an
 * AI fixing its call gets them all in one answer. Nothing is written when anything is wrong.
 */
export async function writeOwnerAiPolicy(storage: Storage, gaii: string, input: unknown): Promise<OwnerAiPolicy> {
  const r = normaliseOwnerPolicy(input);
  if ('problems' in r) {
    throw new AiCompletionError('AI_POLICY_INVALID', 400,
      `The model policy was not saved: ${r.problems.map(p => `${p.field} ${p.message}`).join('; ')}.`,
      { problems: r.problems });
  }
  const existing = await storage.getMemory(gaii, POLICY_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: POLICY_KEY,
    ownerGaii: gaii,
    value: r.policy as unknown as Record<string, unknown>,
    visibility: 'private',
    tags: ['ai', 'policy'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  emitChange('memory', gaii);
  return r.policy;
}

const APP_MODELS_TTL_MS = 60_000;
const appModelsCache = new Map<string, { at: number; meta: AppAiMeta | undefined }>();

/** `owner/file.html`, `file.html` or `file`, as the owner's account and the stored file name. */
function appAddress(payerGaii: string, appRef: string): { owner: string; filename: string } | null {
  const ref = appRef.trim();
  if (!ref || ref.length > 300 || /[\s:?#]/.test(ref)) return null;
  const slash = ref.indexOf('/');
  const owner = slash > 0 ? ref.slice(0, slash) : localAccountName(payerGaii);
  const file = slash > 0 ? ref.slice(slash + 1) : ref;
  if (!owner || !file || file.includes('/')) return null;
  return { owner, filename: file.endsWith('.html') ? file : `${file}.html` };
}

/**
 * The app's own `models=` list from its published meta, or undefined when the app declares none or
 * no such app is published. Read for a minute from memory: an app record carries the whole file, and
 * every AI call from an app would otherwise read it.
 */
export async function appModelsOf(storage: Storage, payerGaii: string, appRef: string | undefined): Promise<string[] | undefined> {
  return (await appAiMetaOf(storage, payerGaii, appRef))?.models;
}

/** What an app's aimeat-ai meta says about its AI calls: its own models, its order of preference per
 *  capability, and the capabilities it wants answered on this machine only (plan 11, section 9). */
export interface AppAiMeta {
  models?: string[];
  prefer?: Partial<Record<AiCapability, string[]>>;
  local?: AiCapability[];
  /** The app's address, `<owner>/<file>.html`: what an owner's binding of its roles is keyed by. */
  address?: string;
  /** The AI roles the app declares (app-ai-roles.ts). */
  roles?: AppAiRole[];
}

/** The app's meta for its AI calls, read for a minute from memory like appModelsOf. */
export async function appAiMetaOf(storage: Storage, payerGaii: string, appRef: string | undefined): Promise<AppAiMeta | undefined> {
  if (!appRef) return undefined;
  const addr = appAddress(payerGaii, appRef);
  if (!addr) return undefined;
  const key = `${addr.owner}/${addr.filename}`;
  const hit = appModelsCache.get(key);
  if (hit && Date.now() - hit.at < APP_MODELS_TTL_MS) return hit.meta;
  let meta: AppAiMeta | undefined;
  try {
    const app = await storage.getAppByOwnerName(addr.owner, addr.filename);
    const posture = app?.manifest?.aiPosture;
    const models = Array.isArray(posture?.models) ? posture.models.filter(isModelRef) : [];
    meta = {
      ...(models.length ? { models } : {}),
      ...(posture?.prefer && typeof posture.prefer === 'object' ? { prefer: posture.prefer } : {}),
      ...(Array.isArray(posture?.local) && posture.local.length ? { local: posture.local } : {}),
      ...(app ? { address: key } : {}),
      ...(Array.isArray(posture?.roles) && posture.roles.length ? { roles: posture.roles } : {}),
    };
  } catch (err) {
    // An unreadable app is an app with no list of its own; the owner's policy still applies.
    logger.warn('[ai] could not read an app\'s declared models', { app: key, error: String(err) });
    meta = undefined;
  }
  if (appModelsCache.size > 2000) appModelsCache.clear();
  appModelsCache.set(key, { at: Date.now(), meta });
  return meta;
}

/** Who changes the policy: the owner in person, or an agent of theirs proposing and confirming. */
export type PolicyActor = { kind: 'owner' } | { kind: 'agent'; principal: string; confirmToken?: string };

export type PolicySetResult =
  | { mode: 'applied'; policy: OwnerAiPolicy }
  | { mode: 'proposal'; current: OwnerAiPolicy; proposed: Omit<OwnerAiPolicy, 'updatedAt'>; confirm_token: string; expires_in_seconds: number; instructions: string };

const POLICY_ACTION = 'ai_policy';

/**
 * Change the owner's model policy. The owner in person writes at once. An agent proposes first and
 * gets a token bound to the exact change; the same call again with the token applies it, within ten
 * minutes (the pattern of aimeat_operator_ai_config, services/operator-confirm.ts). The AI shows the
 * proposal to the owner between the two calls, so a loosening or a tightening the owner never saw
 * does not happen by one tool call.
 */
export async function setOwnerAiPolicy(
  storage: Storage, gaii: string, input: unknown, actor: PolicyActor,
): Promise<PolicySetResult> {
  if (actor.kind === 'owner') return { mode: 'applied', policy: await writeOwnerAiPolicy(storage, gaii, input) };

  const r = normaliseOwnerPolicy(input);
  if ('problems' in r) {
    throw new AiCompletionError('AI_POLICY_INVALID', 400,
      `The model policy was not proposed: ${r.problems.map(p => `${p.field} ${p.message}`).join('; ')}.`,
      { problems: r.problems });
  }
  // The token binds to the policy itself, not to the moment it was normalised.
  const proposed: Omit<OwnerAiPolicy, 'updatedAt'> & { updatedAt?: string } = { ...r.policy };
  delete proposed.updatedAt;
  if (!actor.confirmToken) {
    return {
      mode: 'proposal',
      current: await readOwnerAiPolicy(storage, gaii),
      proposed,
      confirm_token: await mintConfirmToken(actor.principal, POLICY_ACTION, proposed),
      expires_in_seconds: 600,
      instructions: 'Show this change to the owner. To apply EXACTLY this policy, call again with the same policy plus confirm_token. Any change to the policy invalidates the token.',
    };
  }
  try {
    await verifyConfirmToken(actor.confirmToken, actor.principal, POLICY_ACTION, proposed);
  } catch (e) {
    if (e instanceof ConfirmTokenError) throw new AiCompletionError(e.code, 403, e.message);
    throw e;
  }
  return { mode: 'applied', policy: await writeOwnerAiPolicy(storage, gaii, input) };
}

/** What GET /v1/ai/policy and aimeat_ai_policy_set show: the owner's record and the node's list. */
export async function policyView(storage: Storage, config: AimeatConfig, gaii: string): Promise<{
  policy: OwnerAiPolicy; recommended: RecommendedModels;
}> {
  return { policy: await readOwnerAiPolicy(storage, gaii), recommended: recommendedModelsOf(config) };
}
