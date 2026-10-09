/**
 * @file providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description System 2's AI PROVIDERS are records, not constants (System 2 plan, V3; the precedent is
 *   System 1's services/decide/providers.ts). A provider record says where the provider is, which
 *   capabilities it serves with which model, whether the node may pick it by capability alone, and
 *   where the data goes. The node picks candidates per call from these (services/ai/route-plan.ts).
 *
 *   THREE SOURCES:
 *   - `node`: the operator's. `node-openrouter` when the node has a key of its own
 *     (AIMEAT_OPENROUTER_INSTANCE_KEY), and any record in AIMEAT_AI_PROVIDERS.
 *   - `builtin`: local servers the operator switches on (AIMEAT_AI_BUILTIN_PROVIDERS): lmstudio,
 *     ollama, llamacpp on their usual loopback ports.
 *   - `owner`: the owner's own, a memory record `ai.providers.<id>` under a reserved prefix, written by
 *     the owner in person (services/ai/provider-store.ts). Its key sits in a record of its own,
 *     `ai.apikey.provider.<id>`, on the credential list.
 *
 *   THE NODE'S KEY BELONGS TO ONE PROVIDER. `node-openrouter` is the only record with `auth: node`,
 *   no parser accepts that value, and the provider's address is OpenRouter's fixed one. So the node's
 *   key cannot reach an address an owner or an app named: there is no record that pairs the two.
 *   An image or a transcription is enabled on it only when the operator named a node default model
 *   for it (Jouni's ruling J4, 2026-09-28).
 *
 *   A FIXED TYPE MEANS ITS VENDOR. openrouter, openai, anthropic, mistral and xai are reached only at
 *   FIXED_BASE_URLS, whatever a record says, and AIMEAT_AI_PROVIDER_TYPES may narrow which of them
 *   this node allows. Any other address is `openai-compatible`. AIMEAT_AI_FIXED_BASEURL_OVERRIDES
 *   points a fixed type at a stub, on a node that is not public only.
 *
 *   `local` IS CHECKED. It means the data does not leave this machine, so it is accepted only at a
 *   loopback address, or, for the operator's own, at an origin in AIMEAT_AI_PROVIDER_EGRESS. On a
 *   public node an owner's provider is never on the node's own machine: loopback there is the
 *   server, not the person's computer.
 * @structure
 *   AiProvider · ProviderAuth · ProviderCapabilityConfig · CapabilityHealth · TYPE_CAPABILITIES ·
 *   PROVIDER_PREFIX · fixedBaseUrlOf · typeAllowed · parseAiProvider · nodeAiProviders ·
 *   ownerProviderRecords · providerTarget · providerView
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 *   v1.0.1 — 2026-09-28 — ownerProviderRecords answers in id order, the same on every backend (V5).
 *   v1.1.0 — 2026-09-28 — Type `extension` (V6): a record names the owner's extension instead of an
 *     address (baseUrl `extension://<name>`), is the owner's only, and states where the data goes.
 *   v1.1.1 — 2026-09-28 — A base URL loses its trailing slashes through stripTrailingSlashes, one
 *     pass, instead of `replace(/\/+$/, '')`, which takes quadratic time on an address ending in
 *     many slashes and another character (CodeQL js/polynomial-redos, alert 1673).
 *   v1.2.0 — 2026-09-28 — A text, vision or files capability carries `params`, the provider's default
 *     fine-tuning, which the call and the app's role override (AI roles).
 *   v1.4.0 — 2026-10-09 — An operator's `env` auth names only a provider key variable
 *     (ai-provider-common.ts isProviderKeyEnvName): AIMEAT_AI_KEY_<NAME>, a vendor-style _API_KEY
 *     name, or a decision-model key. Any upper-case name was taken, DATABASE_URL included (secrets
 *     audit 2026-10-09, S1).
 *   v1.3.0 — 2026-10-08 — A speech capability may state the PCM its server sends (sampleRate,
 *     channels, sampleFormat), which the speech answer's `audio` block reports (aiprov plan, A4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { stripTrailingSlashes } from '../../utils/url-validator.js';
import {
  isObj, isLoopbackHost, providerIdOf, PROVIDER_ID_PROBLEM, egressOriginsOf,
  isProviderKeyEnvName, PROVIDER_KEY_ENV_RULE, PROVIDER_KEY_ENV_PREFIX,
} from '../ai-provider-common.js';
import {
  FIXED_BASE_URLS, FIXED_PROVIDER_TYPES, isFixedType,
  type AiAdapterType, type AiCapability, type AiTarget, type FixedProviderType,
} from './types.js';

export type AiProviderSource = 'node' | 'builtin' | 'owner';

/**
 * How a provider is authorised. `key`: the owner's key stored beside the record (an owner's
 * provider only). `env`: the NAME of a variable on this node (the operator's only). `none`: nothing
 * is sent. `node`: the node's own key, and only `node-openrouter` has it.
 */
export interface ProviderAuth { type: 'key' | 'env' | 'none' | 'node'; env?: string; optional?: boolean }

/** How one provider serves one capability (docs/internal/llmproviderintegrations/11, section 4). */
export interface ProviderCapabilityConfig {
  enabled: boolean;
  /** The model for this capability when a call names none. Required when `pool` is on. */
  model?: string;
  /** Whether the node may pick this provider when a call names only the capability. */
  pool: boolean;
  /** Speech only: the voice. */
  voice?: string;
  /**
   * Speech only: the PCM the provider sends, for a local or OpenAI-compatible server whose answer
   * does not say it. The speech answer's `audio` block reports them (services/ai-voice-audio.ts);
   * OpenAI and OpenRouter need none (24000 Hz, mono, s16le).
   */
  sampleRate?: number;
  channels?: number;
  sampleFormat?: 's16le' | 's16be' | 'f32le';
  /** Transcription only: the language hint. */
  language?: string;
  /** OpenRouter's files capability only: who converts a PDF for a model that cannot read one. */
  parser?: 'native' | 'mistral-ocr' | 'cloudflare-ai';
  /**
   * Text, vision and files only: the fine-tuning this provider uses when neither the call nor the
   * app's role says (Jouni, 2026-09-28: the app's fine-tuning overrides the provider's default, and an
   * empty one leaves the model's own).
   */
  params?: ProviderParams;
}

export interface ProviderParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  reasoning?: 'off' | 'low' | 'medium' | 'high';
}

/** The capabilities whose calls take fine-tuning. */
export const PARAM_CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files'];

/** Fine-tuning read from a record or a request; what does not read is a problem, named. */
export function readProviderParams(v: unknown, where: string, problems: string[]): ProviderParams | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) { problems.push(`${where}: { temperature?, top_p?, max_tokens?, reasoning? }.`); return undefined; }
  const out: ProviderParams = {};
  const num = (k: 'temperature' | 'top_p' | 'max_tokens', min: number, max: number) => {
    const x = v[k];
    if (x === undefined || x === null || x === '') return;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) { problems.push(`${where}.${k}: a number from ${min} to ${max}.`); return; }
    out[k] = k === 'max_tokens' ? Math.round(x) : x;
  };
  num('temperature', 0, 2);
  num('top_p', 0, 1);
  num('max_tokens', 1, 1_000_000);
  if (v.reasoning !== undefined && v.reasoning !== null && v.reasoning !== '') {
    if (v.reasoning === 'off' || v.reasoning === 'low' || v.reasoning === 'medium' || v.reasoning === 'high') out.reasoning = v.reasoning;
    else problems.push(`${where}.reasoning: off, low, medium or high.`);
  }
  return Object.keys(out).length ? out : undefined;
}

export type HealthStatus = 'untested' | 'ok' | 'degraded' | 'failing';

export interface CapabilityHealth {
  status: HealthStatus;
  /** The owner's own test. */
  lastTestAt?: string;
  /** The last call or test that worked. */
  lastOkAt?: string;
  lastError?: { code: string; at: string; message: string };
}

export interface AiProvider {
  id: string;
  title: string;
  type: AiAdapterType;
  source: AiProviderSource;
  /** The API root. For a fixed type always FIXED_BASE_URLS (or the override on a node that is not public).
   *  For an extension provider `extension://<name>`, which no request is ever sent to. */
  baseUrl: string;
  /** An extension provider only: the name of the owner's installed extension that serves it (V6). */
  extension?: string;
  auth: ProviderAuth;
  /** Whether the data leaves this machine. False only for a checked `local` provider. */
  leaves: boolean;
  /** Where the data goes, in one sentence a settings page and a data map can repeat. */
  dataStatement: string;
  capabilities: Partial<Record<AiCapability, ProviderCapabilityConfig>>;
  health: { byCapability: Partial<Record<AiCapability, CapabilityHealth>> };
  /**
   * Set while the record follows the owner's legacy `openrouter.settings` and `openrouter.apikey`
   * (the lazy migration, provider-store.ts): the versions it was written from and the legacy
   * provider name. Editing the provider through PUT /v1/ai/providers/:id removes it.
   */
  legacy?: { settingsVersion: number | null; keyVersion: number | null; provider: 'openrouter' | 'lmstudio' | 'custom' };
  /** Why a stored record cannot be used as it is (an ambiguous migration, a type the node no longer
   *  allows). The record stays and the owner sees this sentence; nothing throws on data. */
  problem?: string;
}

/**
 * What each type can do on this node now. The model's own capabilities come from the catalogue (V4);
 * this is the adapter's side. `speech` needs an OpenAI-style /audio/speech (services/ai-voice.ts);
 * `embed` and `files` are configurable now and called from V5.
 */
export const TYPE_CAPABILITIES: Readonly<Record<AiAdapterType, readonly AiCapability[]>> = {
  openrouter: ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'],
  openai: ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'],
  anthropic: ['text', 'vision', 'files'],
  mistral: ['text', 'vision', 'files', 'transcription', 'embed'],
  xai: ['text', 'vision', 'image', 'transcription'],
  local: ['text', 'vision', 'image', 'speech', 'transcription', 'embed'],
  'openai-compatible': ['text', 'vision', 'image', 'speech', 'transcription', 'embed'],
  // Every capability; which ones this extension serves is its manifest's answer (V6), checked when
  // the owner saves the provider.
  extension: ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'],
};

/** A speech capability's PCM layout (sampleRate, channels, sampleFormat), each optional; what does not read is a problem. */
function readSpeechPcm(v: Record<string, unknown>, c: AiCapability, entry: ProviderCapabilityConfig, problems: string[]): void {
  const given = (k: string) => v[k] !== undefined && v[k] !== null && v[k] !== '';
  if (!given('sampleRate') && !given('channels') && !given('sampleFormat')) return;
  if (c !== 'speech') { problems.push(`capabilities.${c}: sampleRate, channels and sampleFormat are for speech only.`); return; }
  const int = (k: 'sampleRate' | 'channels', min: number, max: number) => {
    if (!given(k)) return;
    const x = v[k];
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) problems.push(`capabilities.speech.${k}: a whole number from ${min} to ${max}.`);
    else entry[k] = x;
  };
  int('sampleRate', 8000, 192000);
  int('channels', 1, 8);
  if (given('sampleFormat')) {
    if (v.sampleFormat === 's16le' || v.sampleFormat === 's16be' || v.sampleFormat === 'f32le') entry.sampleFormat = v.sampleFormat;
    else problems.push('capabilities.speech.sampleFormat: s16le, s16be or f32le.');
  }
}

/** An extension's name, as the extension manifest allows it (services/extension-manifest.ts). */
const EXTENSION_NAME_RE = /^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/;

const PROVIDER_TYPES = Object.keys(TYPE_CAPABILITIES) as AiAdapterType[];
const ALL_CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
const VENDOR_NAMES: Record<FixedProviderType, string> = {
  openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic', mistral: 'Mistral AI', xai: 'xAI',
};

export const PROVIDER_PREFIX = 'ai.providers.';
/** The id of the provider that holds the node's own key. */
export const NODE_OPENROUTER_ID = 'node-openrouter';
export const MAX_OWNER_PROVIDERS = 20;

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const LOCAL_STATEMENT = 'The prompt goes to a model on this machine and does not leave it.';

/** The local servers an operator may switch on, at the ports they listen on by default. */
const BUILTIN: Readonly<Record<string, { title: string; baseUrl: string }>> = {
  lmstudio: { title: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1' },
  ollama: { title: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1' },
  llamacpp: { title: 'llama.cpp server (local)', baseUrl: 'http://127.0.0.1:8080/v1' },
};

/** The operator's overrides of the fixed addresses, read once per value. Empty on a public node. */
let overrideCache: { raw: string; profile: string; map: Partial<Record<FixedProviderType, string>> } | null = null;
function fixedOverrides(config: AimeatConfig): Partial<Record<FixedProviderType, string>> {
  const raw = config.aiFixedBaseUrlOverrides ?? '';
  if (overrideCache && overrideCache.raw === raw && overrideCache.profile === config.securityProfile) return overrideCache.map;
  const map: Partial<Record<FixedProviderType, string>> = {};
  if (raw.trim() && config.securityProfile !== 'public') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      for (const [type, url] of Object.entries(isObj(parsed) ? parsed : {})) {
        if (isFixedType(type) && typeof url === 'string' && URL.canParse(url)) map[type] = stripTrailingSlashes(url);
        else logger.error('[ai] an AIMEAT_AI_FIXED_BASEURL_OVERRIDES entry was refused', { type, fix: 'a fixed type and an http(s) address' });
      }
      if (Object.keys(map).length) logger.warn('[ai] fixed provider addresses are overridden on this node', { types: Object.keys(map) });
    } catch (err) {
      logger.error('[ai] AIMEAT_AI_FIXED_BASEURL_OVERRIDES is not JSON; no override applies', { error: String(err) });
    }
  }
  overrideCache = { raw, profile: config.securityProfile, map };
  return map;
}

/** The address of a fixed type on this node. */
export function fixedBaseUrlOf(config: AimeatConfig, type: FixedProviderType): string {
  return fixedOverrides(config)[type] ?? FIXED_BASE_URLS[type];
}

/** Whether this node allows a fixed type (AIMEAT_AI_PROVIDER_TYPES; empty allows all five). */
export function typeAllowed(config: AimeatConfig, type: AiAdapterType): boolean {
  if (!isFixedType(type)) return true;
  const list = (config.aiProviderTypes ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(type);
}

/** Where the data goes, for a record's type and address. */
function statementOf(type: AiAdapterType, baseUrl: string): string {
  if (type === 'local') return LOCAL_STATEMENT;
  if (type === 'extension') {
    return `The prompt goes to the extension ${baseUrl.replace(/^extension:\/\//, '')}, which sends it only to the hosts its manifest names, outside this machine.`;
  }
  const host = URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl;
  return isFixedType(type)
    ? `The prompt goes to ${VENDOR_NAMES[type]} (${host}), outside this machine.`
    : `The prompt goes to ${host}, outside this machine.`;
}

function parseCapabilities(
  raw: unknown, type: AiAdapterType, problems: string[],
): Partial<Record<AiCapability, ProviderCapabilityConfig>> {
  const out: Partial<Record<AiCapability, ProviderCapabilityConfig>> = {};
  if (raw === undefined) return out;
  if (!isObj(raw)) { problems.push('capabilities: an object with one entry per capability.'); return out; }
  for (const [cap, v] of Object.entries(raw)) {
    if (!(ALL_CAPABILITIES as readonly string[]).includes(cap)) {
      problems.push(`capabilities.${cap}: not a capability. Known: ${ALL_CAPABILITIES.join(', ')}.`);
      continue;
    }
    const c = cap as AiCapability;
    if (!isObj(v)) { problems.push(`capabilities.${c}: { enabled, model?, pool? }.`); continue; }
    const enabled = v.enabled !== false;
    if (enabled && !TYPE_CAPABILITIES[type].includes(c)) {
      const can = PROVIDER_TYPES.filter(t => TYPE_CAPABILITIES[t].includes(c));
      problems.push(`capabilities.${c}: a ${type} provider does not serve ${c} on this node. These types do: ${can.join(', ')}.`);
      continue;
    }
    const model = typeof v.model === 'string' && v.model.trim() ? v.model.trim() : undefined;
    if (model !== undefined && !MODEL_RE.test(model)) problems.push(`capabilities.${c}.model: the model id as the provider names it.`);
    const pool = v.pool === true;
    if (pool && !model) problems.push(`capabilities.${c}: the node picks this provider by capability alone only with a model to use; set model.`);
    const entry: ProviderCapabilityConfig = { enabled, pool, ...(model ? { model } : {}) };
    if (typeof v.voice === 'string' && c === 'speech' && v.voice.trim()) entry.voice = v.voice.trim().slice(0, 64);
    readSpeechPcm(v, c, entry, problems);
    if (typeof v.language === 'string' && c === 'transcription' && /^[a-z]{2,3}$/.test(v.language)) entry.language = v.language;
    if (v.params !== undefined && v.params !== null) {
      if (!PARAM_CAPABILITIES.includes(c)) problems.push(`capabilities.${c}.params: only text, vision and files take fine-tuning.`);
      else { const params = readProviderParams(v.params, `capabilities.${c}.params`, problems); if (params) entry.params = params; }
    }
    if (v.parser !== undefined) {
      if (c !== 'files' || type !== 'openrouter' || !['native', 'mistral-ocr', 'cloudflare-ai'].includes(String(v.parser))) {
        problems.push('parser: only an OpenRouter provider\'s files capability takes one: native, mistral-ocr or cloudflare-ai.');
      } else entry.parser = v.parser as ProviderCapabilityConfig['parser'];
    }
    out[c] = entry;
  }
  return out;
}

function parseHealth(raw: unknown): AiProvider['health'] {
  const by: AiProvider['health']['byCapability'] = {};
  const src = isObj(raw) && isObj(raw.byCapability) ? raw.byCapability : {};
  for (const [cap, v] of Object.entries(src)) {
    if (!(ALL_CAPABILITIES as readonly string[]).includes(cap) || !isObj(v)) continue;
    const status = ['untested', 'ok', 'degraded', 'failing'].includes(String(v.status)) ? v.status as HealthStatus : 'untested';
    const h: CapabilityHealth = { status };
    if (typeof v.lastTestAt === 'string') h.lastTestAt = v.lastTestAt;
    if (typeof v.lastOkAt === 'string') h.lastOkAt = v.lastOkAt;
    if (isObj(v.lastError) && typeof v.lastError.code === 'string') {
      h.lastError = { code: v.lastError.code, at: String(v.lastError.at ?? ''), message: String(v.lastError.message ?? '').slice(0, 300) };
    }
    by[cap as AiCapability] = h;
  }
  return { byCapability: by };
}

function legacyOf(v: Record<string, unknown>): NonNullable<AiProvider['legacy']> {
  const provider = v.provider === 'lmstudio' || v.provider === 'custom' ? v.provider : 'openrouter';
  return {
    settingsVersion: typeof v.settingsVersion === 'number' ? v.settingsVersion : null,
    keyVersion: typeof v.keyVersion === 'number' ? v.keyVersion : null,
    provider,
  };
}

export interface ParseOptions {
  /** The operator's privilege: auth by the NAME of a variable of this node. */
  allowEnv: boolean;
  /** The operator's egress list, for the operator's own records only. */
  egress?: readonly string[];
  /**
   * A stored record that already carries a `problem` (an ambiguous migration) is read even though its
   * address would be refused today, so it stays visible with that sentence instead of vanishing. It
   * is never called: route-plan.ts rejects a provider with a problem.
   */
  stored?: boolean;
}

/**
 * Read one provider record from untrusted input: the operator's JSON, an owner's request body or a
 * stored record. Returns the record or the list of what is wrong with it.
 */
export function parseAiProvider(
  raw: unknown, source: AiProviderSource, config: AimeatConfig, opts: ParseOptions,
): { provider: AiProvider; problems: [] } | { provider: null; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(raw)) return { provider: null, problems: ['A provider is an object.'] };
  const id = providerIdOf(raw.id) ?? '';
  if (!id) problems.push(PROVIDER_ID_PROBLEM);
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : id;
  const type = (PROVIDER_TYPES as readonly unknown[]).includes(raw.type) ? raw.type as AiAdapterType : null;
  if (!type) problems.push(`type: one of ${PROVIDER_TYPES.join(', ')}.`);
  const tolerate = opts.stored === true && typeof raw.problem === 'string' && raw.problem.length > 0;
  const addressProblems: string[] = [];

  let baseUrl = '';
  let extension: string | undefined;
  if (type === 'extension') {
    // An installed extension of the owner's serves it (V6): no address, a name. Whose extension it
    // is, and which ops it declares, is checked where the owner saves it (provider-store.ts).
    extension = typeof raw.extension === 'string' && EXTENSION_NAME_RE.test(raw.extension) ? raw.extension : undefined;
    if (!extension) problems.push('extension: the name of one of your installed extensions whose manifest declares provides.ai_provider.');
    if (source !== 'owner') problems.push('type extension: an extension provider is added by its owner, not configured by the operator.');
    baseUrl = extension ? `extension://${extension}` : '';
  } else if (type && isFixedType(type)) {
    // The address of a fixed type is not the record's to choose: a record that names another one is
    // told so, rather than having it silently replaced.
    const given = typeof raw.baseUrl === 'string' ? stripTrailingSlashes(raw.baseUrl.trim()) : '';
    if (given && given !== FIXED_BASE_URLS[type] && given !== fixedBaseUrlOf(config, type)) {
      problems.push(`baseUrl: a ${type} provider is reached at ${FIXED_BASE_URLS[type]}. For another address, use type openai-compatible.`);
    }
    baseUrl = fixedBaseUrlOf(config, type);
  } else if (type) {
    const u = URL.canParse(String(raw.baseUrl ?? '')) ? new URL(String(raw.baseUrl)) : null;
    baseUrl = u && (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? stripTrailingSlashes(u.toString()) : '';
    if (!baseUrl) problems.push('baseUrl: the full http(s) address of the provider\'s OpenAI-compatible API root, with no credentials in it.');
    const host = u?.hostname.toLowerCase() ?? '';
    const listed = source !== 'owner' && !!u && !!opts.egress?.includes(u.origin);
    if (baseUrl && type === 'local' && !isLoopbackHost(host) && !listed) {
      addressProblems.push(`baseUrl: a local provider is on this machine (127.0.0.1, localhost or ::1); ${host} is somewhere else, so it is 'openai-compatible'.`);
    }
    if (baseUrl && source === 'owner' && config.securityProfile === 'public' && isLoopbackHost(host)) {
      addressProblems.push('baseUrl: on this public node an owner\'s provider cannot be on the node\'s own machine. Your own computer connects through the desktop app, not by address.');
    }
    if (baseUrl && type === 'openai-compatible' && u?.protocol === 'http:' && !isLoopbackHost(host) && !listed) {
      addressProblems.push('baseUrl: a provider outside this machine is reached over https.');
    }
  }
  if (!tolerate) problems.push(...addressProblems);

  const a = isObj(raw.auth) ? raw.auth : { type: raw.auth };
  let auth: ProviderAuth = { type: 'none' };
  // With no auth named, a self-hosted address needs none; an extension provider holds the owner's key.
  if (a.type === 'none' || (a.type === undefined && type && !isFixedType(type) && type !== 'extension')) auth = { type: 'none' };
  else if ((a.type === 'key' || a.type === undefined) && source === 'owner') auth = { type: 'key' };
  else if (a.type === 'env' && opts.allowEnv && isProviderKeyEnvName(a.env)) {
    auth = { type: 'env', env: a.env, ...(a.optional === true ? { optional: true } : {}) };
  } else if (a.type === 'env' && opts.allowEnv) {
    // A name outside the allow-list is refused, so no record can send a variable of the node
    // itself (DATABASE_URL, the data key) to its address (secrets audit 2026-10-09, S1).
    problems.push(PROVIDER_KEY_ENV_RULE);
  } else {
    problems.push(opts.allowEnv
      ? `auth: { type: 'none' } or { type: 'env', env: '${PROVIDER_KEY_ENV_PREFIX}NAME' }; an operator's provider never holds a key in the record.`
      : "auth: { type: 'key' } (the key is set separately, on the web page) or { type: 'none' }.");
  }
  if (type && isFixedType(type) && auth.type === 'none') problems.push(`auth: a ${type} provider needs a key.`);

  const capabilities = type ? parseCapabilities(raw.capabilities, type, problems) : {};
  if (problems.length || !type) return { provider: null, problems };
  const leaves = type !== 'local';
  return {
    provider: {
      id, title, type, source, baseUrl, auth, leaves,
      ...(extension ? { extension } : {}),
      dataStatement: statementOf(type, baseUrl),
      capabilities,
      health: parseHealth(raw.health),
      ...(source === 'owner' && isObj(raw.legacy) ? { legacy: legacyOf(raw.legacy) } : {}),
      ...(typeof raw.problem === 'string' && raw.problem ? { problem: raw.problem.slice(0, 300) } : {}),
    },
    problems: [],
  };
}

/** Every capability a type serves, on, with no model: the shape of a node or builtin provider. */
function capsOf(type: AiAdapterType, only?: readonly AiCapability[]): Partial<Record<AiCapability, ProviderCapabilityConfig>> {
  const out: Partial<Record<AiCapability, ProviderCapabilityConfig>> = {};
  for (const c of TYPE_CAPABILITIES[type]) if (!only || only.includes(c)) out[c] = { enabled: true, pool: false };
  return out;
}

/** The provider that holds the node's own key, or null when the node has none. */
function nodeKeyProvider(config: AimeatConfig): AiProvider | null {
  if (!(config.openrouterInstanceKey ?? '').trim() || !typeAllowed(config, 'openrouter')) return null;
  const baseUrl = fixedBaseUrlOf(config, 'openrouter');
  // J4: text as it always was; an image or a transcription only when the operator named a node
  // default model for it. Speech stays as it is until the node has a default speech model (V5).
  const caps: AiCapability[] = ['text', 'vision', 'files', 'speech', 'embed'];
  if (config.modelDefaultImage) caps.push('image');
  if (config.modelDefaultStt) caps.push('transcription');
  return {
    id: NODE_OPENROUTER_ID, title: 'This node\'s OpenRouter key', type: 'openrouter', source: 'node', baseUrl,
    auth: { type: 'node' }, leaves: true, dataStatement: statementOf('openrouter', baseUrl),
    capabilities: capsOf('openrouter', caps), health: { byCapability: {} },
  };
}

/** Every provider the operator made available: the node's key, their records, the switched-on examples. */
export function nodeAiProviders(config: AimeatConfig): AiProvider[] {
  const out: AiProvider[] = [];
  const nodeKey = nodeKeyProvider(config);
  if (nodeKey) out.push(nodeKey);
  const seen = new Set(out.map(p => p.id));
  if ((config.aiProviders ?? '').trim()) {
    let list: unknown;
    try { list = JSON.parse(config.aiProviders); } catch (err) {
      logger.error('[ai] AIMEAT_AI_PROVIDERS is not JSON; no extra providers are offered', { error: String(err) });
      list = [];
    }
    const egress = aiEgressOrigins(config);
    for (const raw of Array.isArray(list) ? list : []) {
      const p = parseAiProvider(raw, 'node', config, { allowEnv: true, egress });
      if (!p.provider) { logger.error('[ai] an operator AI provider was refused', { problems: p.problems }); continue; }
      if (!typeAllowed(config, p.provider.type) || seen.has(p.provider.id)) continue;
      seen.add(p.provider.id);
      out.push(p.provider);
    }
  }
  for (const id of (config.aiBuiltinProviders ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const b = BUILTIN[id];
    if (!b || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, title: b.title, type: 'local', source: 'builtin', baseUrl: b.baseUrl, auth: { type: 'none' },
      leaves: false, dataStatement: LOCAL_STATEMENT, capabilities: capsOf('local', ['text', 'vision', 'embed']),
      health: { byCapability: {} },
    });
  }
  return out;
}

export function aiEgressOrigins(config: AimeatConfig): string[] {
  return egressOriginsOf(config.aiProviderEgress, 'ai', 'AIMEAT_AI_PROVIDER_EGRESS');
}

/**
 * The owner's stored provider records, parsed. A record that no longer parses, or whose type the
 * node no longer allows, stays in storage and comes back with a `problem`, so the owner sees it.
 */
export async function ownerProviderRecords(storage: Storage, config: AimeatConfig, ownerGhii: string): Promise<AiProvider[]> {
  const rows = await storage.listMemory(ownerGhii, { prefix: PROVIDER_PREFIX });
  const out: AiProvider[] = [];
  for (const r of rows) {
    let p = parseAiProvider(r.value, 'owner', config, { allowEnv: false, stored: true });
    // A record that was valid when written and whose address this node now refuses (it became a
    // public node, say) is kept visible with the refusal as its problem, never dropped silently.
    if (!p.provider && isObj(r.value)) {
      p = parseAiProvider({ ...r.value, problem: p.problems.join(' ') }, 'owner', config, { allowEnv: false, stored: true });
    }
    if (!p.provider) {
      logger.warn('[ai] an owner AI provider record no longer parses', { owner: ownerGhii, key: r.key, problems: p.problems });
      continue;
    }
    if (!typeAllowed(config, p.provider.type)) {
      p.provider.problem = `This node does not allow ${p.provider.type} providers (AIMEAT_AI_PROVIDER_TYPES).`;
    }
    out.push(p.provider);
  }
  // In id order: the pool's `priority` order, when the owner's routing names no list, must be the
  // same on every backend. A memory listing has no fixed order on Postgres, and the E2E suite's
  // "priority keeps the owner's order" case failed there once for exactly that.
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The origins this provider's call may reach although private: its own, for the operator's record at a listed origin. */
function allowOriginsOf(p: AiProvider, config: AimeatConfig): string[] {
  if (p.source === 'owner' || !URL.canParse(p.baseUrl)) return [];
  const origin = new URL(p.baseUrl).origin;
  return aiEgressOrigins(config).includes(origin) ? [origin] : [];
}

/** Where a call to this provider goes, with the key that pays. */
export function providerTarget(p: AiProvider, config: AimeatConfig, key: string | undefined): AiTarget {
  const allow = allowOriginsOf(p, config);
  return { type: p.type, baseUrl: p.baseUrl, key, ...(allow.length ? { allowOrigins: allow } : {}) };
}

/** A provider as an endpoint shows it: never a key, only whether one is set. */
export function providerView(p: AiProvider, hasKey?: boolean): Record<string, unknown> {
  return {
    id: p.id, title: p.title, type: p.type, source: p.source, base_url: p.baseUrl,
    ...(p.extension ? { extension: p.extension } : {}),
    auth: {
      type: p.auth.type, ...(p.auth.env ? { env: p.auth.env } : {}),
      ...(p.source === 'owner' && p.auth.type === 'key' ? { has_key: !!hasKey } : {}),
    },
    leaves: p.leaves,
    data_statement: p.dataStatement,
    capabilities: p.capabilities,
    health: p.health.byCapability,
    ...(p.legacy ? { migrated_from: 'openrouter.settings' } : {}),
    ...(p.problem ? { problem: p.problem } : {}),
  };
}

export { FIXED_PROVIDER_TYPES };
