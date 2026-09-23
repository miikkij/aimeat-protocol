/**
 * @file src/services/decide/providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A DECISION PROVIDER is a record, not a constant (ruling 2026-09-23, "the decision
 *   model has providers"). Every project that serves `POST /v1/systemone` can answer the node's
 *   questions, so the node holds each one as a record that says where it is, what it can carry and
 *   what it costs, and picks one per call.
 *
 *   THREE SOURCES, and none of them is a list in code the owner cannot extend:
 *   - `node`: the operator's. The configured provider (AIMEAT_DECIDE_BASE_URL and the key chain,
 *     TypeSafe's Jev unless pointed elsewhere) and any in AIMEAT_DECIDE_PROVIDERS.
 *   - `builtin`: the local examples the operator switches on (AIMEAT_DECIDE_BUILTIN_PROVIDERS), with
 *     limits measured on a development machine, not copied from the projects' pages.
 *   - `owner`: the owner's own address and key (Jouni ruled that they may). A memory record under
 *     the reserved `decide.` prefix, written by the owner in person only; its key sits in a record
 *     of its own on the credential list (services/secret-records.ts), so no generic door shows it.
 *
 *   SELECTION, STRONGEST FIRST: the rule's (or the call's), the agent's, the owner's default, the
 *   node's. The same order the keys follow, so nobody learns two.
 *
 *   CAPABILITY IS CHECKED BEFORE THE CALL. A rule needing 40 options on a provider that carries 20 is
 *   refused by name, in the provider's own numbers, rather than answered badly.
 *
 *   A LOCAL PROVIDER needs no key, costs nothing and touches no allowance. It sits on loopback, which
 *   safeFetch refuses unless the operator allowed private egress; the refusal says so here rather
 *   than surfacing as a connection error. The scrubber stays on: "the data does not leave the
 *   machine" is a different sentence from "the data goes to TypeSafe in the USA", and each provider
 *   carries its own.
 * @structure
 *   DecisionProvider · ProviderAuth · ProviderLimits · BUILTIN_PROVIDERS · nodeProviders ·
 *   listProviders · getProvider · selectProvider · providerViolations · assertProviderReachable ·
 *   putOwnerProvider · deleteOwnerProvider · readOwnerProviderKey · readProviderChoice ·
 *   writeProviderChoice · providerView
 * @usage
 *   const { provider, chosenBy } = await selectProvider(storage, config, { ownerGhii, agent, named });
 *   const problems = providerViolations(provider, state, questions);
 * @version-history
 *   v1.1.0 — 2026-09-23 — `local` is checked, not taken on trust: a provider calling itself local
 *     must be on this machine, because `leaves: false` skips an app's data-map row, tells the person
 *     nothing left, and leaves the call out of the budget and the ledger. An operator provider may
 *     not take the node's key chain at an address of its own either.
 *   v1.0.0 — 2026-09-23 — Initial: decision providers (wish decision-providers-laya-locally-beside-jev).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { DecideError } from './errors.js';
import { estimateTokens, type JevQuestion, type LimitViolation } from './limits.js';
import { SYSTEMONE_ADAPTERS } from './systemone-client.js';

export type ProviderKind = 'hosted' | 'local';
export type ProviderSource = 'node' | 'builtin' | 'owner';

/**
 * How the provider is authorised. `key`: for the node's configured provider, the key chain (the
 * agent's, the owner's, the node's); for an owner's provider, the key stored with it. `env`: the NAME
 * of a variable on this node (operator providers only). `none`: nothing is sent.
 */
export interface ProviderAuth { type: 'key' | 'env' | 'none'; env?: string }

export interface ProviderLimits {
  /** Estimated tokens one request may carry, state and questions together. */
  contextTokens: number;
  /** Options one choice question may offer before answers degrade or are refused. */
  maxChoiceOptions: number;
  scoreLevels: { min: number; max: number };
}

export interface ProviderCapabilities {
  /** Whether a choice and a score answer carry `confidence`. Without it a rule's bands cannot cut. */
  confidence: boolean;
  /** Languages the CONTENT may be in; `*` for any. Questions are English on every provider. */
  languages: string[];
}

export interface DecisionProvider {
  id: string;
  title: string;
  kind: ProviderKind;
  source: ProviderSource;
  /** The full address of the System One endpoint, `…/v1/systemone`. */
  url: string;
  /** The model or checkpoint name sent in the request, and pinned in the record. */
  model: string;
  auth: ProviderAuth;
  limits: ProviderLimits;
  capabilities: ProviderCapabilities;
  /** USD per million input tokens. 0 for a local provider. */
  pricePerMtok: number;
  /** Whether the state leaves this machine. */
  leaves: boolean;
  /** Where the data goes, in one sentence the settings page and a data map can repeat. */
  dataStatement: string;
  /** For a built-in example: when and how its limits were measured. */
  measured?: string;
  /** The answer reshaper for a provider that deviates (SYSTEMONE_ADAPTERS in systemone-client.ts). */
  adapter?: string;
}

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const PROVIDER_PREFIX = 'decide.providers.';
/** The owner's own provider key. Under `decide.apikey.` so the credential list matches it by prefix. */
export const PROVIDER_KEY_PREFIX = 'decide.apikey.provider.';
export const PROVIDER_CHOICE_RECORD = 'decide.provider-choice';
const MAX_OWNER_PROVIDERS = 20;

const LOCAL_STATEMENT = 'The scrubbed state goes to a decision model on this machine and does not leave it.';

/**
 * The local examples an operator may switch on. The numbers are MEASURED, not taken from the
 * projects' pages: RTX 4090, 2026-09-23, 12 support tickets with a known topic per option count,
 * a known fact placed after growing filler for the context. The ports are the ones
 * docs/internal/systemone/systemone.ps1 gives them. `contextTokens` is in the node's own estimate
 * (a quarter of the JSON length), which counts more tokens than any of these models' tokenizers do.
 */
export const BUILTIN_PROVIDERS: Readonly<Record<string, Omit<DecisionProvider, 'source'>>> = Object.freeze({
  laya: {
    id: 'laya', title: 'Laya (local, multilingual)', kind: 'local',
    url: 'http://127.0.0.1:8801/v1/systemone', model: 'multilingual', auth: { type: 'none' },
    limits: { contextTokens: 1024, maxChoiceOptions: 20, scoreLevels: { min: 2, max: 10 } },
    capabilities: { confidence: true, languages: ['*'] },
    pricePerMtok: 0, leaves: false, dataStatement: LOCAL_STATEMENT,
    measured: 'laya 0.3.7, multilingual checkpoint, 2026-09-23: reads 1024 tokens and drops the rest without an error, so the node refuses a longer state; 12/12 right at 5 and at 20 options, 9/12 at 60; confidence on every answer type; Finnish content 5/6 at 5 options and 4/6 at 20; about 21 ms a call.',
    adapter: 'laya',
  },
  von: {
    id: 'von', title: 'von (local)', kind: 'local',
    url: 'http://127.0.0.1:8802/v1/systemone', model: 'von-1.1.0', auth: { type: 'none' },
    limits: { contextTokens: 4700, maxChoiceOptions: 20, scoreLevels: { min: 2, max: 10 } },
    capabilities: { confidence: true, languages: ['en'] },
    pricePerMtok: 0, leaves: false, dataStatement: LOCAL_STATEMENT,
    measured: 'von-sdk 1.1.1, 2026-09-23: a fact at the end is read at 4700 tokens, weaker at 9400 and lost at 18800, with no error; 12/12 right at 5 options, 11/12 at 20, 8/12 at 60; confidence on choice and score; no Finnish (0/6); about 46 ms a call once the weights are loaded (the first call took 47 s).',
  },
  jeff: {
    id: 'jeff', title: 'jeff (local, GLiFormer)', kind: 'local',
    url: 'http://127.0.0.1:8803/v1/systemone', model: 'gliformer-large-v1', auth: { type: 'env', env: 'AIMEAT_DECIDE_JEFF_KEY' },
    limits: { contextTokens: 5000, maxChoiceOptions: 60, scoreLevels: { min: 2, max: 10 } },
    capabilities: { confidence: true, languages: ['en'] },
    pricePerMtok: 0, leaves: false, dataStatement: LOCAL_STATEMENT,
    measured: 'jeff 0.1.0 with gliformer-large-v1, 2026-09-23: refuses a state over 20000 characters (HTTP 422); 12/12 right at 5 options, 11/12 at 20, 12/12 at 60 with a mean confidence of 0.43; confidence on choice and score; Finnish content 5/6 at 5 options and 3/6 at 20; about 56 ms a call. It wants a bearer key: AIMEAT_DECIDE_JEFF_KEY must match JEFF_API_KEYS.',
  },
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What the node's configured provider is: the one every owner had before providers existed. */
function configuredProvider(config: AimeatConfig): DecisionProvider {
  const local = config.decideProviderKind === 'local';
  return {
    id: config.decideProviderId, title: config.decideProviderId === 'typesafe' ? 'TypeSafe Jev' : config.decideProviderId,
    kind: local ? 'local' : 'hosted', source: 'node', url: config.decideBaseUrl, model: config.decideModel,
    auth: { type: local ? 'none' : 'key' },
    limits: { contextTokens: config.decideMaxRequestTokens, maxChoiceOptions: config.decideMaxChoiceOptions, scoreLevels: { min: 2, max: 10 } },
    capabilities: { confidence: true, languages: ['*'] },
    pricePerMtok: local ? 0 : config.decidePricePerMtok,
    leaves: !local,
    dataStatement: local ? LOCAL_STATEMENT
      : config.decideProviderId === 'typesafe'
        ? 'The scrubbed state goes to TypeSafe in the USA, which answers the questions and keeps nothing it is not required to.'
        : `The scrubbed state goes to ${new URL(config.decideBaseUrl).host}, outside this machine.`,
  };
}

/** This machine, for the one word that decides whether the data leaves it. */
const LOOPBACK = (host: string): boolean => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);

/**
 * Read one provider record from untrusted input: the operator's JSON or an owner's request body.
 * Returns the record or the list of what is wrong with it. `allowEnv` is the operator's privilege:
 * an owner naming a variable of this node would have the node send its secret to the owner's address.
 */
export function parseProvider(
  raw: unknown, source: ProviderSource, opts: { allowEnv: boolean },
): { provider: DecisionProvider; problems: [] } | { provider: null; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(raw)) return { provider: null, problems: ['A provider is an object.'] };
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!PROVIDER_ID_RE.test(id)) problems.push("id: lower-case letters, digits and '-', 2 to 63 characters.");
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : id;
  const kind = raw.kind === 'local' ? 'local' : raw.kind === 'hosted' ? 'hosted' : null;
  if (!kind) problems.push("kind: 'hosted' or 'local'.");
  const u = URL.canParse(String(raw.url ?? '')) ? new URL(String(raw.url)) : null;
  const url = u && (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.toString() : '';
  if (!url) problems.push('url: the full http(s) address of the /v1/systemone endpoint, with no credentials in it.');
  if (url && kind === 'hosted' && url.startsWith('http:')) problems.push('url: a hosted provider is reached over https.');
  // LOCAL MEANS THIS MACHINE, and the word is load-bearing rather than descriptive: `leaves` is
  // taken from it, and `leaves: false` is what skips an app's data-map row, states to the person
  // that nothing left the machine, and leaves the call out of the budget and the ledger. Declared
  // and not checked, `kind: 'local'` with a remote address made all four of those untrue at once.
  if (url && kind === 'local' && u && !LOOPBACK(u.hostname.toLowerCase())) {
    problems.push(`url: a local provider is on this machine (127.0.0.1, localhost or ::1); ${u.hostname} is somewhere else, so it is 'hosted'.`);
  }
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!MODEL_RE.test(model)) problems.push('model: the model or checkpoint name the provider expects, up to 128 characters.');

  const a = isObj(raw.auth) ? raw.auth : { type: raw.auth };
  let auth: ProviderAuth = { type: 'none' };
  if (a.type === 'none' || a.type === undefined) auth = { type: 'none' };
  else if (a.type === 'key') auth = { type: 'key' };
  else if (a.type === 'env' && opts.allowEnv && typeof a.env === 'string' && ENV_RE.test(a.env)) auth = { type: 'env', env: a.env };
  else problems.push(opts.allowEnv
    ? "auth: { type: 'none' }, { type: 'key' } or { type: 'env', env: 'VARIABLE_NAME' }."
    : "auth: { type: 'none' } or { type: 'key' } with the key sent as api_key.");

  const l = isObj(raw.limits) ? raw.limits : {};
  const int = (v: unknown, lo: number, hi: number, dflt: number): number | null => {
    if (v === undefined) return dflt;
    return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  };
  const contextTokens = int(l.contextTokens ?? l.context_tokens, 64, 1_000_000, 1024);
  const maxChoiceOptions = int(l.maxChoiceOptions ?? l.max_choice_options, 2, 10_000, 20);
  const sl = isObj(l.scoreLevels ?? l.score_levels) ? (l.scoreLevels ?? l.score_levels) as Record<string, unknown> : {};
  const minLevels = int(sl.min, 2, 100, 2);
  const maxLevels = int(sl.max, 2, 100, 10);
  if (contextTokens === null) problems.push('limits.context_tokens: a whole number from 64 to 1000000.');
  if (maxChoiceOptions === null) problems.push('limits.max_choice_options: a whole number from 2 to 10000.');
  if (minLevels === null || maxLevels === null || (minLevels ?? 0) > (maxLevels ?? 0)) problems.push('limits.score_levels: { min, max }, 2 ≤ min ≤ max ≤ 100.');

  const c = isObj(raw.capabilities) ? raw.capabilities : {};
  const languages = Array.isArray(c.languages) && c.languages.every(x => typeof x === 'string' && /^(\*|[a-z]{2,3})$/.test(x))
    ? (c.languages as string[]).slice(0, 50) : ['*'];
  const price = raw.pricePerMtok ?? raw.price_per_mtok ?? 0;
  if (typeof price !== 'number' || !(price >= 0 && price <= 1000)) problems.push('price_per_mtok: USD per million input tokens, 0 to 1000.');
  if (kind === 'local' && typeof price === 'number' && price > 0) problems.push('price_per_mtok: a local provider costs nothing; leave it 0.');

  const adapter = raw.adapter === undefined || raw.adapter === null ? undefined : raw.adapter;
  if (adapter !== undefined && (typeof adapter !== 'string' || !(adapter in SYSTEMONE_ADAPTERS))) {
    problems.push(`adapter: one of ${Object.keys(SYSTEMONE_ADAPTERS).join(', ')}, or leave it out.`);
  }

  if (problems.length || !kind || contextTokens === null || maxChoiceOptions === null || minLevels === null || maxLevels === null) {
    return { provider: null, problems };
  }
  const leaves = kind === 'hosted';
  return {
    provider: {
      id, title, kind, source, url, model, auth,
      limits: { contextTokens, maxChoiceOptions, scoreLevels: { min: minLevels, max: maxLevels } },
      capabilities: { confidence: c.confidence !== false, languages },
      pricePerMtok: kind === 'local' ? 0 : price as number,
      leaves,
      dataStatement: leaves ? `The scrubbed state goes to ${new URL(url).host}, outside this machine.` : LOCAL_STATEMENT,
      ...(typeof adapter === 'string' ? { adapter } : {}),
    },
    problems: [],
  };
}

/** Every provider the operator made available: the configured one, their extras, the switched-on examples. */
export function nodeProviders(config: AimeatConfig): DecisionProvider[] {
  const out: DecisionProvider[] = [configuredProvider(config)];
  const seen = new Set(out.map(p => p.id));
  if (config.decideProviders.trim()) {
    let list: unknown;
    try { list = JSON.parse(config.decideProviders); } catch (err) {
      logger.error('[decide] AIMEAT_DECIDE_PROVIDERS is not JSON; no extra providers are offered', { error: String(err) });
      list = [];
    }
    for (const raw of Array.isArray(list) ? list : []) {
      const p = parseProvider(raw, 'node', { allowEnv: true });
      if (!p.provider) { logger.error('[decide] an operator provider was refused', { problems: p.problems }); continue; }
      // THE KEY CHAIN BELONGS TO ONE ADDRESS. `auth: { type: 'key' }` means the agent's key, then
      // the owner's, then the NODE's, and config-decide.ts has promised since it was written that
      // the node's key goes to `decideBaseUrl`'s host and nowhere else. An extra provider naming
      // `key` with an address of its own would quietly break that promise, so it is refused here
      // and the operator is told to name a variable instead (`auth: { type: 'env', env: … }`).
      if (p.provider.auth.type === 'key' && p.provider.url !== config.decideBaseUrl) {
        logger.error('[decide] an operator provider asked for the node key chain at another address', {
          provider: p.provider.id,
          fix: "give it auth { type: 'env', env: 'ITS_OWN_VARIABLE' }, or point AIMEAT_DECIDE_BASE_URL at it",
        });
        continue;
      }
      if (seen.has(p.provider.id)) continue;
      seen.add(p.provider.id);
      out.push(p.provider);
    }
  }
  for (const id of config.decideBuiltinProviders.split(',').map(s => s.trim()).filter(Boolean)) {
    const b = BUILTIN_PROVIDERS[id];
    if (!b || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...b, source: 'builtin' });
  }
  return out;
}

/** The owner's own providers, as stored. A record that no longer parses is skipped and logged. */
async function ownerProviders(storage: Storage, ownerGhii: string): Promise<DecisionProvider[]> {
  const rows = await storage.listMemory(ownerGhii, { prefix: PROVIDER_PREFIX });
  const out: DecisionProvider[] = [];
  for (const r of rows) {
    const p = parseProvider(r.value, 'owner', { allowEnv: false });
    if (p.provider) out.push(p.provider);
    else logger.warn('[decide] an owner provider record no longer parses', { owner: ownerGhii, key: r.key, problems: p.problems });
  }
  return out;
}

/** Every provider this owner may use: the node's first, then their own. */
export async function listProviders(storage: Storage, config: AimeatConfig, ownerGhii: string): Promise<DecisionProvider[]> {
  return [...nodeProviders(config), ...(await ownerProviders(storage, ownerGhii))];
}

export async function getProvider(storage: Storage, config: AimeatConfig, ownerGhii: string, id: string): Promise<DecisionProvider | null> {
  const node = nodeProviders(config).find(p => p.id === id);
  if (node) return node;
  if (!PROVIDER_ID_RE.test(id)) return null;
  const rec = await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`);
  if (!rec) return null;
  return parseProvider(rec.value, 'owner', { allowEnv: false }).provider;
}

/** The provider an owner who chose none gets. */
export function nodeDefaultProvider(config: AimeatConfig): DecisionProvider {
  const all = nodeProviders(config);
  return all.find(p => p.id === config.decideDefaultProvider.trim()) ?? all[0];
}

export interface ProviderChoice { default: string | null; agents: Record<string, string> }

export async function readProviderChoice(storage: Storage, ownerGhii: string): Promise<ProviderChoice> {
  const v = (await storage.getMemory(ownerGhii, PROVIDER_CHOICE_RECORD))?.value;
  const o = isObj(v) ? v : {};
  const agents = isObj(o.agents)
    ? Object.fromEntries(Object.entries(o.agents).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};
  return { default: typeof o.default === 'string' ? o.default : null, agents };
}

/**
 * The owner sets their default, or one agent's provider. `null` removes the choice. Every id named
 * must be a provider this owner can use now, so a choice never points at nothing.
 */
export async function writeProviderChoice(
  storage: Storage, config: AimeatConfig, ownerGhii: string, input: { default?: unknown; agents?: unknown },
): Promise<ProviderChoice> {
  const current = await readProviderChoice(storage, ownerGhii);
  const known = new Set((await listProviders(storage, config, ownerGhii)).map(p => p.id));
  const check = (v: unknown, field: string): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string' || !known.has(v)) {
      throw new DecideError('UNKNOWN_PROVIDER', 400, `${field}: '${String(v)}' is not a decision provider you can use. Known: ${[...known].join(', ')}.`);
    }
    return v;
  };
  const next: ProviderChoice = { default: current.default, agents: { ...current.agents } };
  if (input.default !== undefined) next.default = check(input.default, 'provider');
  if (input.agents !== undefined) {
    if (!isObj(input.agents)) throw new DecideError('INVALID_BODY', 400, 'agent_providers: { "<agent name>": "<provider id>" | null }.');
    for (const [agent, id] of Object.entries(input.agents)) {
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(agent)) throw new DecideError('INVALID_BODY', 400, `agent_providers: '${agent}' is not an agent name.`);
      const v = check(id, `agent_providers.${agent}`);
      if (v === null) delete next.agents[agent]; else next.agents[agent] = v;
    }
  }
  await upsertPrivateRecord(storage, ownerGhii, PROVIDER_CHOICE_RECORD, { ...next, updatedAt: new Date().toISOString() }, ['decide', 'provider']);
  emitChange('ai-decisions', ownerGhii);
  return next;
}

export type ProviderChosenBy = 'call' | 'rule' | 'agent' | 'owner' | 'node';

/**
 * Which provider answers this call. Strongest first: the one the rule (or the call) names, the one
 * the owner set for this agent, the owner's default, the node's. A name that no longer resolves is a
 * refusal that says which choice named it, never a quiet fall to the next.
 */
export async function selectProvider(
  storage: Storage, config: AimeatConfig,
  q: { ownerGhii: string; agent: string | null; named?: string | null; namedBy?: 'call' | 'rule' },
): Promise<{ provider: DecisionProvider; chosenBy: ProviderChosenBy }> {
  const resolve = async (id: string, by: ProviderChosenBy): Promise<{ provider: DecisionProvider; chosenBy: ProviderChosenBy }> => {
    const p = await getProvider(storage, config, q.ownerGhii, id);
    if (!p) {
      const who = by === 'rule' ? 'The rule names' : by === 'call' ? 'This call names' : by === 'agent' ? 'The owner set for this agent' : 'The owner\'s default is';
      throw new DecideError('UNKNOWN_PROVIDER', 400, `${who} the decision provider '${id}', which does not exist on this node. GET /v1/ai/decide/providers lists the ones there are; the owner changes the choice with PUT /v1/ai/decide/settings.`);
    }
    return { provider: p, chosenBy: by };
  };
  if (q.named) return resolve(q.named, q.namedBy ?? 'call');
  const choice = await readProviderChoice(storage, q.ownerGhii);
  if (q.agent && choice.agents[q.agent]) return resolve(choice.agents[q.agent], 'agent');
  if (choice.default) return resolve(choice.default, 'owner');
  return { provider: nodeDefaultProvider(config), chosenBy: 'node' };
}

/**
 * What this provider cannot carry, in its own numbers, before anything is sent. The node's own
 * limits (checkDecideRequest) are checked first; these are the provider's, and usually tighter.
 */
export function providerViolations(provider: DecisionProvider, state: unknown, questions: Record<string, JevQuestion>): LimitViolation[] {
  const out: LimitViolation[] = [];
  // The name the settings page shows, so the refusal and the screen say the same thing; the id is on
  // the violation for a program.
  const name = `The provider "${provider.title}"`;
  const who = { provider: provider.id, providerTitle: provider.title };
  for (const [id, q] of Object.entries(questions ?? {})) {
    if (q.type === 'choice' && isObj(q.criteria)) {
      const n = Object.keys(q.criteria).length;
      if (n > provider.limits.maxChoiceOptions) {
        out.push({ question: id, code: 'PROVIDER_CANNOT_CARRY', what: 'options', limit: provider.limits.maxChoiceOptions, count: n, ...who,
          message: `${name} carries ${provider.limits.maxChoiceOptions} options; choice question '${id}' has ${n}. Use a provider that carries more, or walk the options in stages.` });
      }
    }
    if (q.type === 'score' && Array.isArray(q.criteria)) {
      const n = q.criteria.length;
      const { min, max } = provider.limits.scoreLevels;
      if (n < min || n > max) {
        out.push({ question: id, code: 'PROVIDER_CANNOT_CARRY', what: 'levels', limit: max, count: n, ...who,
          message: `${name} carries score questions of ${min} to ${max} levels; '${id}' has ${n}.` });
      }
    }
  }
  // Said in characters, as the settings page says it: the node's token estimate is a quarter of the length.
  const tokens = estimateTokens({ state, questions });
  if (Number.isFinite(tokens) && tokens > provider.limits.contextTokens) {
    out.push({ code: 'PROVIDER_CANNOT_CARRY', what: 'length', limit: provider.limits.contextTokens * 4, count: tokens * 4, ...who,
      message: `${name} reads about ${provider.limits.contextTokens * 4} characters; this request is about ${tokens * 4}. Send the fields the questions need, or use a provider that reads more.` });
  }
  return out;
}


/**
 * A provider on loopback is reachable only when the operator allowed private egress. Said here, by
 * name, rather than left to safeFetch's refusal, which reads as a network fault.
 */
export function assertProviderReachable(provider: DecisionProvider): void {
  if (!URL.canParse(provider.url)) return;
  const host = new URL(provider.url).hostname.toLowerCase();
  if (!LOOPBACK(host)) return;
  if (process.env.AIMEAT_ALLOW_PRIVATE_EGRESS === 'true' || process.env.AIMEAT_DEV_MODE === 'true') return;
  throw new DecideError('PRIVATE_EGRESS_REQUIRED', 503,
    `The decision provider '${provider.id}' is at ${host}, on this machine. This node does not send to its own machine unless the operator sets AIMEAT_ALLOW_PRIVATE_EGRESS=true, which belongs on a development machine, not on a public node.`);
}

/** The key of an owner's own provider, decrypted, or null. Never logged, never returned by a door. */
export async function readOwnerProviderKey(storage: Storage, config: AimeatConfig, ownerGhii: string, id: string): Promise<string | null> {
  const enc = (await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`))?.value as { encrypted?: unknown } | undefined;
  if (typeof enc?.encrypted !== 'string' || !enc.encrypted) return null;
  const encKey = getEncryptionKey(config);
  if (!encKey) throw new DecideError('ENCRYPTION_NOT_CONFIGURED', 503, 'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
  return decrypt(enc.encrypted, encKey);
}

/**
 * The owner adds or replaces a provider of their own. An id the node already uses is refused, so a
 * name always means one address. `api_key` is stored encrypted beside it and never read back.
 */
export async function putOwnerProvider(
  storage: Storage, config: AimeatConfig, ownerGhii: string, id: string, body: unknown,
): Promise<DecisionProvider> {
  const raw = isObj(body) ? { ...body, id } : body;
  const p = parseProvider(raw, 'owner', { allowEnv: false });
  if (!p.provider) throw new DecideError('INVALID_PROVIDER', 400, p.problems.join(' '), { problems: p.problems });
  if (nodeProviders(config).some(n => n.id === id)) {
    throw new DecideError('PROVIDER_ID_TAKEN', 409, `'${id}' is one of this node's providers. Give yours another id.`);
  }
  const key = `${PROVIDER_PREFIX}${id}`;
  const existing = await storage.getMemory(ownerGhii, key);
  if (!existing && (await storage.listMemoryMeta(ownerGhii, { prefix: PROVIDER_PREFIX })).length >= MAX_OWNER_PROVIDERS) {
    throw new DecideError('TOO_MANY_PROVIDERS', 409, `An account holds at most ${MAX_OWNER_PROVIDERS} decision providers of its own.`);
  }
  const apiKey = (body as Record<string, unknown>).api_key;
  if (p.provider.auth.type === 'key') {
    const hasKey = typeof apiKey === 'string' || !!(await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`));
    if (!hasKey) throw new DecideError('INVALID_PROVIDER', 400, "auth is 'key', so send the provider's key as api_key.");
  }
  if (apiKey !== undefined) {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 4 || apiKey.length > 512 || /\s/.test(apiKey.trim())) {
      throw new DecideError('INVALID_PROVIDER', 400, 'api_key: one token as the provider issued it, no spaces.');
    }
    const encKey = getEncryptionKey(config);
    if (!encKey) throw new DecideError('ENCRYPTION_NOT_CONFIGURED', 503, 'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
    await upsertPrivateRecord(storage, ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`,
      { encrypted: encrypt(apiKey.trim(), encKey), set_at: new Date().toISOString() }, ['decide', 'secret']);
  }
  const { source: _s, dataStatement: _d, ...stored } = p.provider;
  void _s; void _d;
  await upsertPrivateRecord(storage, ownerGhii, key,
    { spec: 'aimeat.decision-provider/v1', ...stored, updatedAt: new Date().toISOString() }, ['decide', 'provider']);
  emitChange('ai-decisions', ownerGhii);
  return p.provider;
}

/** Remove an owner's provider and its key. A choice that named it is cleared with it. */
export async function deleteOwnerProvider(storage: Storage, config: AimeatConfig, ownerGhii: string, id: string): Promise<boolean> {
  if (!PROVIDER_ID_RE.test(id) || !(await storage.getMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`))) return false;
  await storage.deleteMemory(ownerGhii, `${PROVIDER_PREFIX}${id}`);
  if (await storage.getMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`)) await storage.deleteMemory(ownerGhii, `${PROVIDER_KEY_PREFIX}${id}`);
  const choice = await readProviderChoice(storage, ownerGhii);
  if (choice.default === id || Object.values(choice.agents).includes(id)) {
    await writeProviderChoice(storage, config, ownerGhii, {
      ...(choice.default === id ? { default: null } : {}),
      agents: Object.fromEntries(Object.entries(choice.agents).filter(([, v]) => v === id).map(([k]) => [k, null])),
    });
  }
  emitChange('ai-decisions', ownerGhii);
  return true;
}

/** A provider as a door shows it: never a key, only whether one is set. */
export function providerView(p: DecisionProvider, hasKey?: boolean): Record<string, unknown> {
  return {
    id: p.id, title: p.title, kind: p.kind, source: p.source, url: p.url, model: p.model,
    auth: { type: p.auth.type, ...(p.auth.env ? { env: p.auth.env } : {}), ...(p.source === 'owner' && p.auth.type === 'key' ? { has_key: !!hasKey } : {}) },
    limits: { context_tokens: p.limits.contextTokens, max_choice_options: p.limits.maxChoiceOptions, score_levels: p.limits.scoreLevels },
    capabilities: p.capabilities,
    price_per_mtok: p.pricePerMtok,
    leaves: p.leaves,
    data_statement: p.dataStatement,
    ...(p.measured ? { measured: p.measured } : {}),
    ...(p.adapter ? { adapter: p.adapter } : {}),
  };
}

/** The providers door and the settings view share this: every provider, with who chose what. */
export async function providersView(storage: Storage, config: AimeatConfig, ownerGhii: string, agent?: string | null): Promise<{
  providers: Record<string, unknown>[]; default: string; node_default: string; agents: Record<string, string>; this_agent?: string;
}> {
  const [all, choice] = await Promise.all([listProviders(storage, config, ownerGhii), readProviderChoice(storage, ownerGhii)]);
  const keys = new Set((await storage.listMemoryMeta(ownerGhii, { prefix: PROVIDER_KEY_PREFIX })).map(m => m.key.slice(PROVIDER_KEY_PREFIX.length)));
  const nodeDefault = nodeDefaultProvider(config).id;
  const effective = choice.default ?? nodeDefault;
  return {
    providers: all.map(p => providerView(p, keys.has(p.id))),
    default: effective,
    node_default: nodeDefault,
    agents: choice.agents,
    ...(agent ? { this_agent: choice.agents[agent] ?? effective } : {}),
  };
}
