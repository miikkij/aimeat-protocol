/**
 * @file provider-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an owner's AI providers and their keys live, and the one migration from the
 *   setting every owner had before providers existed (System 2 plan, V3; plan file 04, sections 3
 *   and 6). The records' shape and checks are services/ai/providers.ts.
 *
 *   KEYS. The owner's key for a provider is `ai.apikey.provider.<id>`, an agent's is
 *   `ai.apikey.agent.<agent>.<id>`, both encrypted (services/encryption.ts), both under the reserved
 *   `ai.apikey.` prefix and on the credential list (services/secret-records.ts), so no general memory
 *   endpoint reads or writes them. A key is set on the web page, in the owner's own session, never
 *   over MCP: a key given in a chat stays in that chat's history on a service the node does not
 *   control. An agent's legacy OpenRouter key (`openrouter.apikey.agent.<name>`) is still read.
 *
 *   THE LAZY MIGRATION (plan 04, section 6). The first time an owner's providers are read, the
 *   legacy `openrouter.settings` + `openrouter.apikey` become a provider record `ai.providers.<id>`
 *   (`openrouter`, `lmstudio` or `custom`) and its key record. Nothing is deleted: the legacy records
 *   stay and the budget fields stay in them. Until the new settings page lands, the legacy page is
 *   what owners edit, so the migrated record FOLLOWS the legacy records: it remembers the versions it
 *   was written from and is written again when either changes. An owner who edits the provider
 *   through PUT /v1/ai/providers/:id takes it over, and the legacy records no longer touch it.
 *   An owner on the node's key with no setting of their own gets no record: they have no provider.
 *   What cannot be decided (an owner's loopback address on a public node) is kept with a `problem`
 *   the owner sees, and never throws.
 * @structure
 *   PROVIDER_KEY_PREFIX · agentProviderKeyRecord · readOwnerProviderKey · readAgentProviderKey ·
 *   providersForOwner · syncLegacyProvider · putOwnerAiProvider · deleteOwnerAiProvider ·
 *   setOwnerProviderKey · deleteOwnerProviderKey · ownerKeyIds · setAgentProviderKey ·
 *   agentProviderKeys · aiProvidersView · knownProviderIds · persistHealth
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 *   v1.1.0 — 2026-09-28 — catalogCheck and model_status from the model catalogue (V4); an extension
 *     provider is checked against its extension when saved (assertOwnExtensionProvider, V6).
 *   v1.2.0 — 2026-09-28 — The migrated provider carries the legacy page's fine-tuning as its text and
 *     vision `params`, where the AI page shows it (AI roles).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { recordAccountEvent } from '../account-events.js';
import { readAgentKey } from '../agent-ai-keys.js';
import { resolveModelFor, type ModelRole } from '../ai-model-defaults.js';
import { logger } from '../../utils/logger.js';
import { isObj, isLoopbackHost, providerIdOf, PROVIDER_ID_PROBLEM } from '../ai-provider-common.js';
import { AiCompletionError } from './errors.js';
import { clearHealth } from './health.js';
import {
  parseAiProvider, nodeAiProviders, ownerProviderRecords, fixedBaseUrlOf, typeAllowed, providerView,
  PROVIDER_PREFIX, MAX_OWNER_PROVIDERS, TYPE_CAPABILITIES, NODE_OPENROUTER_ID, readProviderParams,
  type AiProvider, type CapabilityHealth, type ProviderCapabilityConfig,
} from './providers.js';
import { readRouting, type RoutingDefaults, type RoutingRules } from './routing.js';
import { catalogModel, catalogModels } from './catalog/store.js';
import { servesCapability } from './catalog/price.js';
import { assertOwnExtensionProvider } from './extension-provider.js';
import { aiProviderDeclarationOf } from '../extension-ai-provider-declaration.js';
import { FIXED_BASE_URLS, isFixedType, type AiCapability } from './types.js';

export const PROVIDER_KEY_PREFIX = 'ai.apikey.provider.';
const AGENT_KEY_PREFIX = 'ai.apikey.agent.';
const LEGACY_SETTINGS = 'openrouter.settings';
const LEGACY_KEY = 'openrouter.apikey';
const SPEC = 'aimeat.ai-provider/v1';
const AGENT_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const agentProviderKeyRecord = (agent: string, providerId: string): string => `${AGENT_KEY_PREFIX}${agent}.${providerId}`;

function encKeyOf(config: AimeatConfig): Buffer {
  const k = getEncryptionKey(config);
  if (!k) throw new AiCompletionError('ENCRYPTION_NOT_CONFIGURED', 503, 'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  return k;
}

function decryptRecord(config: AimeatConfig, value: unknown): string | null {
  const enc = isObj(value) ? value.encrypted : undefined;
  return typeof enc === 'string' && enc ? decrypt(enc, encKeyOf(config)) : null;
}

/** The owner's key for one of their providers, decrypted, or null. Never logged, never returned by an endpoint. */
export async function readOwnerProviderKey(storage: Storage, config: AimeatConfig, ownerGhii: string, id: string): Promise<string | null> {
  return decryptRecord(config, (await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`))?.value);
}

/**
 * An agent's own key for this provider, or null. Its record for the provider's id first. The legacy
 * OpenRouter key an agent may hold (`openrouter.apikey.agent.<name>`) and an agent key for the id
 * `openrouter` apply to an OpenRouter provider at OpenRouter's fixed address, and to the owner's
 * migrated provider, which is where that key went before providers existed. Nowhere else.
 */
export async function readAgentProviderKey(
  storage: Storage, config: AimeatConfig, ownerGhii: string, agent: string, p: AiProvider,
): Promise<string | null> {
  if (!AGENT_RE.test(agent)) return null;
  const own = decryptRecord(config, (await storage.getMemory(ownerGhii, agentProviderKeyRecord(agent, p.id)))?.value);
  if (own) return own;
  const atOpenRouter = p.type === 'openrouter' && p.baseUrl === fixedBaseUrlOf(config, 'openrouter');
  if (!atOpenRouter && !p.legacy) return null;
  if (p.id !== 'openrouter') {
    const byType = decryptRecord(config, (await storage.getMemory(ownerGhii, agentProviderKeyRecord(agent, 'openrouter')))?.value);
    if (byType) return byType;
  }
  return readAgentKey(storage, config, ownerGhii, agent, 'openrouter');
}

/** The ids of the owner's providers that have a key set. */
export async function ownerKeyIds(storage: Storage, ownerGhii: string): Promise<Set<string>> {
  const meta = await storage.listMemoryMeta(ownerGhii, { prefix: PROVIDER_KEY_PREFIX });
  return new Set(meta.map(m => m.key.slice(PROVIDER_KEY_PREFIX.length)));
}

// ── the migration ─────────────────────────────────────────────────────────────────────────────────

type LegacyName = 'openrouter' | 'lmstudio' | 'custom';
const LEGACY_DEFAULT_URL: Record<LegacyName, string> = {
  openrouter: FIXED_BASE_URLS.openrouter, lmstudio: 'http://localhost:1234/v1', custom: '',
};
const ROLE_OF: Partial<Record<AiCapability, ModelRole>> = { text: 'chat', vision: 'vision', image: 'image', transcription: 'stt' };

/** The provider record the legacy records describe, or null when they describe no provider of the owner's own. */
function legacyRecord(
  config: AimeatConfig, settings: MemoryRecord | null, key: MemoryRecord | null, existing?: AiProvider,
): Record<string, unknown> | null {
  const prefs = isObj(settings?.value) ? settings.value : {};
  const name: LegacyName = prefs.provider === 'lmstudio' || prefs.provider === 'custom' ? prefs.provider : 'openrouter';
  const baseUrl = (typeof prefs.baseUrl === 'string' && prefs.baseUrl.trim() ? prefs.baseUrl.trim() : LEGACY_DEFAULT_URL[name]).replace(/\/+$/, '');
  const hasKey = isObj(key?.value) && typeof key.value.encrypted === 'string' && !!key.value.encrypted;
  const atOpenRouter = baseUrl === FIXED_BASE_URLS.openrouter;
  // On the node's key with nothing of their own: no provider. They use the node's.
  if (name === 'openrouter' && atOpenRouter && !hasKey) return null;

  const host = URL.canParse(baseUrl) ? new URL(baseUrl).hostname.toLowerCase() : '';
  // The types the node already gave these settings (services/ai/types.ts adapterTypeOf): LM Studio on
  // this machine is `local`; a custom address is `openai-compatible` wherever it is, because nothing
  // in the setting said its data stays here.
  const type = name === 'openrouter' && atOpenRouter ? 'openrouter'
    : name === 'lmstudio' && isLoopbackHost(host) ? 'local' : 'openai-compatible';
  let problem: string | undefined;
  if (!baseUrl || !URL.canParse(baseUrl)) problem = 'The saved AI provider has no usable address. Set one on the AI settings page.';
  else if (isLoopbackHost(host) && config.securityProfile === 'public') {
    problem = 'Your saved AI provider is on this public node\'s own machine, which an owner\'s provider cannot be. Your own computer connects through the desktop app.';
  } else if (!isLoopbackHost(host) && new URL(baseUrl).protocol !== 'https:') {
    // The legacy page accepted http only on this machine (routes/openrouter.ts validateProviderUrl).
    problem = 'The saved AI provider is outside this machine and not on https.';
  }
  const capabilities: Partial<Record<AiCapability, ProviderCapabilityConfig>> = {};
  // The fine-tuning the legacy page set for every call is this provider's default for text now, where
  // the AI page shows it (AI roles, 2026-09-28).
  const params = readProviderParams({
    temperature: prefs.temperature, top_p: prefs.top_p, max_tokens: prefs.max_tokens,
    reasoning: isObj(prefs.reasoning) ? (prefs.reasoning.enabled === false ? 'off' : prefs.reasoning.effort) : undefined,
  }, 'params', []);
  for (const c of TYPE_CAPABILITIES[type]) {
    if (c === 'files' || c === 'embed') continue;
    const role = ROLE_OF[c];
    const model = role ? resolveModelFor(config, prefs, role) : undefined;
    capabilities[c] = { enabled: true, pool: false, ...(model ? { model } : {}), ...(params && (c === 'text' || c === 'vision') ? { params } : {}) };
  }
  // A migrated provider worked before the migration, so it starts as tested. Its health is kept
  // when the record is written again.
  const at = new Date().toISOString();
  const health = existing?.health ?? {
    byCapability: Object.fromEntries(Object.keys(capabilities).map(c => [c, { status: 'ok', lastOkAt: at } as CapabilityHealth])),
  };
  return {
    spec: SPEC, id: name,
    title: name === 'openrouter' ? 'OpenRouter' : name === 'lmstudio' ? 'LM Studio' : 'Custom provider',
    type, ...(type === 'openrouter' ? {} : { baseUrl }),
    // OpenRouter always needed a key; the other two worked without one.
    auth: { type: hasKey || name === 'openrouter' ? 'key' : 'none' },
    capabilities, health,
    legacy: { settingsVersion: settings?.version ?? null, keyVersion: key?.version ?? null, provider: name },
    ...(problem ? { problem } : {}),
    updatedAt: at,
  };
}

async function removeProvider(storage: Storage, ownerGhii: string, id: string, onlyLegacyKey: boolean): Promise<void> {
  await storage.deleteMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`);
  const k = await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`);
  if (k && (!onlyLegacyKey || (isObj(k.value) && k.value.legacy === true))) await storage.deleteMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`);
}

/**
 * Keep the migrated provider in step with the legacy records. Returns the owner's providers as they
 * are after it. Writes only when something changed, so a call pays for one list read.
 */
export async function syncLegacyProvider(
  storage: Storage, config: AimeatConfig, ownerGhii: string,
  legacy: { settings: MemoryRecord | null; key: MemoryRecord | null }, owned: AiProvider[],
): Promise<AiProvider[]> {
  const linked = owned.find(p => p.legacy);
  const next = legacyRecord(config, legacy.settings, legacy.key, linked);
  const nextId = next ? String(next.id) : null;
  if (linked && linked.id !== nextId) {
    await removeProvider(storage, ownerGhii, linked.id, true);
    owned = owned.filter(p => p !== linked);
  } else if (linked && linked.legacy?.settingsVersion === (legacy.settings?.version ?? null)
    && linked.legacy?.keyVersion === (legacy.key?.version ?? null)) {
    return owned;
  }
  if (!next || !nextId) return owned;
  // The owner made or took over a provider with this id: it is theirs, and the legacy records no longer write it.
  if (owned.some(p => p.id === nextId && !p.legacy)) return owned;
  if (!linked && owned.length >= MAX_OWNER_PROVIDERS) return owned;

  const encrypted = isObj(legacy.key?.value) ? legacy.key.value.encrypted : undefined;
  if (typeof encrypted === 'string' && encrypted) {
    // The same ciphertext under the same node key: copied, never decrypted here.
    await upsertPrivateRecord(storage, ownerGhii, `${PROVIDER_KEY_PREFIX}${nextId}`,
      { encrypted, set_at: new Date().toISOString(), legacy: true }, ['ai', 'secret']);
  } else {
    const k = await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${nextId}`);
    if (k && isObj(k.value) && k.value.legacy === true) await storage.deleteMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${nextId}`);
  }
  await upsertPrivateRecord(storage, ownerGhii, `${PROVIDER_PREFIX}${nextId}`, next, ['ai', 'provider']);
  logger.info('[ai] the owner\'s legacy AI setting was written as a provider record', { owner: ownerGhii, provider: nextId, first: !linked });
  const parsed = parseAiProvider(next, 'owner', config, { allowEnv: false, stored: true }).provider;
  return parsed ? [...owned.filter(p => p.id !== nextId), parsed] : owned;
}

/**
 * Every provider this owner may use: the node's first, then their own, with the legacy setting
 * migrated on the way. `legacy` is passed by a caller that has already read the two records.
 */
export async function providersForOwner(
  storage: Storage, config: AimeatConfig, ownerGhii: string,
  legacy?: { settings: MemoryRecord | null; key: MemoryRecord | null },
): Promise<{ node: AiProvider[]; owner: AiProvider[] }> {
  // Each read inside its own async function, so a storage that throws before returning a promise
  // rejects this call rather than leaving a sibling's rejection unhandled.
  const [owned, settings, key] = await Promise.all([
    ownerProviderRecords(storage, config, ownerGhii),
    (async () => legacy ? legacy.settings : storage.getMemory(ownerGhii, LEGACY_SETTINGS))(),
    (async () => legacy ? legacy.key : storage.getMemory(ownerGhii, LEGACY_KEY))(),
  ]);
  return { node: nodeAiProviders(config), owner: await syncLegacyProvider(storage, config, ownerGhii, { settings, key }, owned) };
}

// ── the owner's writes ────────────────────────────────────────────────────────────────────────────

/** The host allowlist for an address that is not a fixed type's. */
function assertHostAllowed(config: AimeatConfig, p: AiProvider): void {
  // An extension provider has no address; its manifest's hosts are checked by assertOwnExtensionProvider.
  if (isFixedType(p.type) || p.type === 'extension' || config.aiProviderAllowlist.length === 0) return;
  const host = new URL(p.baseUrl).hostname.toLowerCase();
  if (!config.aiProviderAllowlist.includes(host)) {
    throw new AiCompletionError('PROVIDER_NOT_ALLOWED', 403, `AI provider host "${host}" is not in this node's allowlist. Ask the operator to allow it.`);
  }
}

/**
 * Each capability's model against the model catalogue (plan 11, section 4). A model the catalogue
 * knows and that lacks the capability is a problem, named with models of that type that have it; a
 * model the catalogue does not know yet is a warning only, because a new model is often offered
 * before the next refresh lists it. A local or openai-compatible provider's models are not catalogued.
 */
export function catalogCheck(p: AiProvider): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const [c, cfg] of Object.entries(p.capabilities) as [AiCapability, ProviderCapabilityConfig][]) {
    if (!cfg?.enabled || !cfg.model || !isFixedType(p.type)) continue;
    const known = catalogModels([p.type]);
    if (!known.length) continue;
    const m = catalogModel(p.type, cfg.model);
    if (!m) { warnings.push(`capabilities.${c}.model: ${p.type}:${cfg.model} is not in the model catalogue yet; the provider decides whether it serves ${c}.`); continue; }
    if (!servesCapability(m, c)) {
      const can = known.filter(x => x.status !== 'retired' && servesCapability(x, c)).slice(0, 8).map(x => x.id);
      problems.push(`capabilities.${c}.model: ${p.type}:${cfg.model} does not serve ${c}.${can.length ? ` These ${p.type} models do: ${can.join(', ')}.` : ''}`);
    } else if (m.status === 'retired') {
      warnings.push(`capabilities.${c}.model: ${p.type}:${cfg.model} is retired in the model catalogue.`);
    }
  }
  return { problems, warnings };
}

/**
 * The owner adds or replaces a provider of their own. An id the node uses is refused, so a name
 * means one provider. Writing takes over a migrated provider: the legacy records stop writing it.
 */
export async function putOwnerAiProvider(
  storage: Storage, config: AimeatConfig, ownerGhii: string, rawId: string, body: unknown,
): Promise<AiProvider> {
  const id = providerIdOf(rawId);
  if (!id) throw new AiCompletionError('INVALID_PROVIDER', 400, PROVIDER_ID_PROBLEM, { problems: [PROVIDER_ID_PROBLEM] });
  if (nodeAiProviders(config).some(n => n.id === id) || id === NODE_OPENROUTER_ID) {
    throw new AiCompletionError('PROVIDER_ID_TAKEN', 409, `'${id}' is one of this node's providers. Give yours another id.`);
  }
  const raw = isObj(body) ? { ...body, id } : body;
  if (isObj(raw)) { delete raw.health; delete raw.legacy; delete raw.problem; }
  const p = parseAiProvider(raw, 'owner', config, { allowEnv: false });
  if (!p.provider) throw new AiCompletionError('INVALID_PROVIDER', 400, p.problems.join(' '), { problems: p.problems });
  if (!typeAllowed(config, p.provider.type)) {
    throw new AiCompletionError('AI_PROVIDER_TYPE_NOT_ALLOWED', 403, `This node does not allow ${p.provider.type} providers. Ask the operator (AIMEAT_AI_PROVIDER_TYPES).`);
  }
  // An extension provider (V6): the owner's own extension, declaring the ops its capabilities need,
  // with hosts the operator's allowlist covers. Its models are the manifest's; catalogCheck reads
  // only the fixed types.
  if (p.provider.type === 'extension') await assertOwnExtensionProvider(storage, config, ownerGhii, p.provider);
  const checked = catalogCheck(p.provider);
  if (checked.problems.length) {
    throw new AiCompletionError('INVALID_PROVIDER', 400, checked.problems.join(' '), { problems: checked.problems });
  }
  assertHostAllowed(config, p.provider);
  const key = `${PROVIDER_PREFIX}${id}`;
  const existing = await storage.getMemory(ownerGhii, key);
  if (!existing && (await storage.listMemoryMeta(ownerGhii, { prefix: PROVIDER_PREFIX })).length >= MAX_OWNER_PROVIDERS) {
    throw new AiCompletionError('TOO_MANY_PROVIDERS', 409, `An account holds at most ${MAX_OWNER_PROVIDERS} AI providers of its own.`);
  }
  // The health of what the owner had tested stays; a capability whose model changed is untested again.
  const before = existing ? parseAiProvider(existing.value, 'owner', config, { allowEnv: false, stored: true }).provider : null;
  const byCapability: AiProvider['health']['byCapability'] = {};
  for (const [c, cfg] of Object.entries(p.provider.capabilities) as [AiCapability, ProviderCapabilityConfig][]) {
    const old = before?.health.byCapability[c];
    if (old && before?.capabilities[c]?.model === cfg.model) byCapability[c] = old;
  }
  const { source: _s, dataStatement: _d, leaves: _l, ...stored } = p.provider;
  void _s; void _d; void _l;
  await upsertPrivateRecord(storage, ownerGhii, key, {
    spec: SPEC, ...stored, ...(isFixedType(p.provider.type) ? { baseUrl: undefined } : {}),
    health: { byCapability }, updatedAt: new Date().toISOString(),
  }, ['ai', 'provider']);
  clearHealth(ownerGhii, id);
  emitChange('ai-providers', ownerGhii);
  return { ...p.provider, health: { byCapability } };
}

/**
 * Remove an owner's provider, its key and its agents' keys for it. A migrated provider is removed at
 * its source as well (the legacy key, and the legacy address set back to the default), or the next
 * read would migrate it again.
 */
export async function deleteOwnerAiProvider(storage: Storage, config: AimeatConfig, ownerGhii: string, rawId: string): Promise<boolean> {
  const id = providerIdOf(rawId);
  const rec = id ? await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`) : null;
  if (!id || !rec) return false;
  const wasLegacy = isObj(rec.value) && isObj(rec.value.legacy);
  await removeProvider(storage, ownerGhii, id, false);
  for (const m of await storage.listMemoryMeta(ownerGhii, { prefix: AGENT_KEY_PREFIX })) {
    if (m.key.endsWith(`.${id}`)) await storage.deleteMemory(ownerGhii, m.key);
  }
  if (wasLegacy) {
    if (await storage.getMemory(ownerGhii, LEGACY_KEY)) await storage.deleteMemory(ownerGhii, LEGACY_KEY);
    const s = await storage.getMemory(ownerGhii, LEGACY_SETTINGS);
    if (s && isObj(s.value)) {
      await upsertPrivateRecord(storage, ownerGhii, LEGACY_SETTINGS, { ...s.value, provider: 'openrouter', baseUrl: '' }, s.tags ?? ['openrouter', 'settings']);
    }
  }
  clearHealth(ownerGhii, id);
  emitChange('ai-providers', ownerGhii);
  return true;
}

/** Set the key of one of the owner's providers. On the web page, in the owner's own session only. */
export async function setOwnerProviderKey(
  storage: Storage, config: AimeatConfig, ownerGhii: string, rawId: string, apiKey: unknown,
): Promise<void> {
  const id = providerIdOf(rawId);
  if (!id || !(await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`))) {
    throw new AiCompletionError('NOT_FOUND', 404, 'No provider of yours has that id.');
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length < 4 || apiKey.length > 512 || /\s/.test(apiKey.trim())) {
    throw new AiCompletionError('INVALID_BODY', 400, 'api_key: one token as the provider issued it, no spaces.');
  }
  await upsertPrivateRecord(storage, ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`,
    { encrypted: encrypt(apiKey.trim(), encKeyOf(config)), set_at: new Date().toISOString() }, ['ai', 'secret']);
  clearHealth(ownerGhii, id);
  void recordAccountEvent(storage, {
    ownerGhii, kind: 'ai_key_changed', actorGaii: ownerGhii, link: '/v1/profile?tab=ai', data: { action: 'set', provider: id },
  }, config);
  emitChange('ai-providers', ownerGhii);
}

export async function deleteOwnerProviderKey(storage: Storage, config: AimeatConfig, ownerGhii: string, rawId: string): Promise<boolean> {
  const id = providerIdOf(rawId);
  if (!id || !(await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`))) return false;
  await storage.deleteMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`);
  clearHealth(ownerGhii, id);
  void recordAccountEvent(storage, {
    ownerGhii, kind: 'ai_key_changed', actorGaii: ownerGhii, link: '/v1/profile?tab=ai', data: { action: 'removed', provider: id },
  }, config);
  emitChange('ai-providers', ownerGhii);
  return true;
}

/**
 * Set (a string) or forget (null) an agent's own key for one of the providers its owner can use.
 * The agent's page, the owner in person (routes/agent-ai-keys.ts). The key pays for that agent's
 * calls to that provider before the owner's own key.
 */
export async function setAgentProviderKey(
  storage: Storage, config: AimeatConfig, ownerGhii: string, agent: string, rawId: string, apiKey: unknown,
): Promise<void> {
  const id = providerIdOf(rawId);
  if (!AGENT_RE.test(agent)) throw new AiCompletionError('INVALID_AGENT', 400, 'Not an agent name.');
  const known = id && (nodeAiProviders(config).some(p => p.id === id) || !!(await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`)));
  if (!id || !known) throw new AiCompletionError('UNKNOWN_PROVIDER', 400, `providers.${rawId}: not a provider you can use. GET /v1/ai/providers lists them.`);
  const record = agentProviderKeyRecord(agent, id);
  if (apiKey === null || apiKey === '') {
    if (await storage.getMemory(ownerGhii, record)) await storage.deleteMemory(ownerGhii, record);
  } else {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 512 || /\s/.test(apiKey.trim())) {
      throw new AiCompletionError('INVALID_BODY', 400, `providers.${id}.api_key must be the key as issued: one token, no spaces.`);
    }
    await upsertPrivateRecord(storage, ownerGhii, record,
      { encrypted: encrypt(apiKey.trim(), encKeyOf(config)), set_at: new Date().toISOString() }, ['ai', 'secret', 'agent']);
  }
  clearHealth(ownerGhii, id);
  emitChange('agents', ownerGhii);
}

/** The providers an agent holds a key of its own for: never a key, only which ones and when. */
export async function agentProviderKeys(storage: Storage, ownerGhii: string, agent: string): Promise<Record<string, { set_at: string | null }>> {
  if (!AGENT_RE.test(agent)) return {};
  const prefix = `${AGENT_KEY_PREFIX}${agent}.`;
  const out: Record<string, { set_at: string | null }> = {};
  for (const r of await storage.listMemory(ownerGhii, { prefix })) {
    const id = r.key.slice(prefix.length);
    if (providerIdOf(id)) out[id] = { set_at: isObj(r.value) && typeof r.value.set_at === 'string' ? r.value.set_at : null };
  }
  return out;
}

/**
 * What GET /v1/ai/providers and aimeat_ai_providers show: every provider the owner can use with
 * whether a key is set (never the key), and the routing. `agent` adds that agent's own list.
 */
export async function aiProvidersView(storage: Storage, config: AimeatConfig, ownerGhii: string, agent?: string): Promise<{
  providers: Record<string, unknown>[];
  routing: { defaults: RoutingDefaults; rules: RoutingRules; agent_defaults?: RoutingDefaults };
  limits: { max_owner_providers: number };
}> {
  const [{ node, owner }, keys, routing] = await Promise.all([
    providersForOwner(storage, config, ownerGhii), ownerKeyIds(storage, ownerGhii), readRouting(storage, ownerGhii, agent),
  ]);
  // Each capability's model with its catalogue status, so an owner sees a model that is retiring or
  // retired where it is used (plan 06, section 6). A model the catalogue does not know says nothing.
  const withStatus = (p: AiProvider): Record<string, unknown> => {
    const v = providerView(p, keys.has(p.id));
    const caps: Record<string, unknown> = {};
    for (const [c, cfg] of Object.entries(p.capabilities)) {
      const m = cfg?.model ? catalogModel(p.type, cfg.model) : undefined;
      caps[c] = m ? { ...cfg, model_status: m.status, ...(m.retiresAt ? { model_retires_at: m.retiresAt } : {}) } : cfg;
    }
    return { ...v, capabilities: caps };
  };
  // An extension provider shows its manifest's own statement of where the data goes, its hosts, its
  // ops and its models (plan 08, section 5): the owner reads them before relying on it.
  const views = await Promise.all([...owner, ...node].map(async (p) => {
    const v = withStatus(p);
    if (p.type !== 'extension' || !p.extension) return v;
    const ext = await storage.getExtension(p.extension);
    const decl = ext ? aiProviderDeclarationOf(ext) : null;
    return decl
      ? { ...v, data_statement: decl.dataStatement, extension_provider: { hosts: decl.hosts, ops: decl.ops, models: decl.models } }
      : { ...v, problem: `The extension '${p.extension}' is not installed or no longer declares provides.ai_provider.` };
  }));
  return {
    providers: views,
    routing: { defaults: routing.owner.defaults, rules: routing.owner.rules, ...(routing.agent ? { agent_defaults: routing.agent } : {}) },
    limits: { max_owner_providers: MAX_OWNER_PROVIDERS },
  };
}

/** The ids of every provider the owner can use, for checking a routing change. */
export async function knownProviderIds(storage: Storage, config: AimeatConfig, ownerGhii: string): Promise<Set<string>> {
  const { node, owner } = await providersForOwner(storage, config, ownerGhii);
  return new Set([...owner, ...node].map(p => p.id));
}

/** Write one capability's health into the owner's record, when its status changed. Best effort. */
export async function persistHealth(
  storage: Storage, ownerGhii: string, id: string, capability: AiCapability, health: CapabilityHealth,
): Promise<void> {
  try {
    const rec = await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`);
    if (!rec || !isObj(rec.value)) return;
    const h = isObj(rec.value.health) && isObj(rec.value.health.byCapability) ? rec.value.health.byCapability : {};
    await upsertPrivateRecord(storage, ownerGhii, `${PROVIDER_PREFIX}${id}`,
      { ...rec.value, health: { byCapability: { ...h, [capability]: health } } }, rec.tags ?? ['ai', 'provider']);
  } catch (err) {
    logger.warn('[ai] a provider\'s health could not be written; the process still knows it', { owner: ownerGhii, provider: id, error: String(err) });
  }
}
