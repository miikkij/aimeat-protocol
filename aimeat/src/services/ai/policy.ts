/**
 * @file policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model policy (System 2 plan, V2; docs/internal/llmproviderintegrations/05): which
 *   models a call may use, as the intersection of the layers that have a list. Every layer can only
 *   tighten, so nobody can loosen a rule another layer set.
 *
 *   - The node's RECOMMENDED models: an operator setting per capability (AIMEAT_AI_RECOMMENDED_MODELS).
 *     No model names live in code; a fresh node has none, and the list restricts nobody until an
 *     owner chooses it.
 *   - The OWNER's policy (memory record `ai.policy.models`): `open` (no list), `recommended` (the node's
 *     list, following its updates) or `custom` (the owner's own list), with four switches for whose
 *     calls it covers: the owner's own, the node's chat, the owner's agents, apps. Beside it the
 *     owner may tighten one agent or one app further.
 *   - The APP's own list: `models=` in its published `<meta name="aimeat-ai">`. It binds the app
 *     itself, so it needs no verified identity.
 *
 *   A pure module: no storage, no config reads. prepareAiCall (services/ai/completion.ts) loads the
 *   inputs and asks.
 * @structure
 *   - AI_PROVIDER_TYPES / parseModelRef() / refOf() — the `<type>:<model id>` reference
 *   - OwnerAiPolicy / normaliseOwnerPolicy() — the owner's record, validated
 *   - RecommendedModels / parseRecommendedModels() — the operator's list per capability
 *   - effectivePolicy() / blockingLayer() / isAllowed() / firstAllowed() — the decision
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
 *   v1.1.0 — 2026-09-28 — firstAllowed() takes `serves`: a custom list's model is a source for the
 *     capability the model catalogue says it serves, not only for text (V4).
 */
import type { AiCapability } from './types.js';

/** Every provider type a model reference can name (04, section 1). V2 serves the first three kinds
 *  through the owner's single legacy provider; the others arrive with provider records in V3. */
export const AI_PROVIDER_TYPES = [
  'openrouter', 'openai', 'anthropic', 'mistral', 'xai', 'local', 'openai-compatible', 'extension',
] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

/** The capabilities a recommendation or a policy is kept for. */
export const AI_CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];

/**
 * A model reference split into its provider type and the model id at that provider.
 *
 * The prefix counts only when it is a known type and comes before any slash, because model ids
 * carry colons of their own: `deepseek/deepseek-v4-pro:free` on OpenRouter, `qwen3:8b` on Ollama.
 * A bare id has no type: it means the caller's own provider, which keeps every app that sends an
 * OpenRouter id today working.
 */
export function parseModelRef(value: string): { type?: AiProviderType; id: string } {
  const v = value.trim();
  const colon = v.indexOf(':');
  if (colon > 0) {
    const head = v.slice(0, colon).toLowerCase();
    if (!head.includes('/') && (AI_PROVIDER_TYPES as readonly string[]).includes(head)) {
      return { type: head as AiProviderType, id: v.slice(colon + 1) };
    }
  }
  return { id: v };
}

/** The canonical reference: `<type>:<id>`. Compared without regard to case. */
export function refOf(type: string, id: string): string {
  return `${type}:${id}`;
}

const norm = (ref: string) => ref.trim().toLowerCase();

/** A well-formed reference: a known type, a colon, and a non-empty id without whitespace. */
export function isModelRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  const p = parseModelRef(value);
  return !!p.type && p.id.length > 0 && !/\s/.test(p.id);
}

// ── the owner's record ──────────────────────────────────────────────────────────────────────────

export type PolicyMode = 'open' | 'recommended' | 'custom';

/** Whose calls the owner's policy covers. All on when the owner turns a policy on (05, section 9). */
export interface PolicyAppliesTo {
  owner: boolean;
  chat: boolean;
  agents: boolean;
  apps: boolean;
}

export interface OwnerAiPolicy {
  version: 1;
  mode: PolicyMode;
  /** Only for `custom`: the owner's own list of references. */
  allow: string[];
  appliesTo: PolicyAppliesTo;
  /** Tighter lists for single apps, keyed by `owner/file.html`. Honoured only for a call the node
   *  identified from an app grant, never from a self-declared app_id (05, section 7). */
  apps: Record<string, { allow: string[] }>;
  /** Tighter lists for single agents, keyed by the agent's bare name. */
  agents: Record<string, { allow: string[] }>;
  updatedAt?: string;
}

export const OPEN_POLICY: OwnerAiPolicy = {
  version: 1, mode: 'open', allow: [],
  appliesTo: { owner: true, chat: true, agents: true, apps: true }, apps: {}, agents: {},
};

/** One problem found in an owner's policy input, named so the caller can fix it. */
export interface PolicyProblem { field: string; message: string }

function refList(value: unknown, field: string, problems: PolicyProblem[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { problems.push({ field, message: 'must be a list of model references' }); return []; }
  const out: string[] = [];
  for (const [i, v] of value.entries()) {
    if (isModelRef(v)) out.push(v.trim());
    else problems.push({ field: `${field}[${i}]`, message: `"${String(v)}" is not a model reference of the form <type>:<model id>, for example openrouter:anthropic/claude-opus-5.5` });
  }
  if (out.length > 200) problems.push({ field, message: 'at most 200 references' });
  return [...new Map(out.map(r => [norm(r), r])).values()];
}

function scopedLists(value: unknown, field: string, problems: PolicyProblem[]): Record<string, { allow: string[] }> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) { problems.push({ field, message: 'must be an object of { allow: [...] }' }); return {}; }
  const out: Record<string, { allow: string[] }> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) problems.push({ field, message: 'at most 100 entries' });
  for (const [name, entry] of entries) {
    if (!name || name.length > 200) { problems.push({ field: `${field}.${name}`, message: 'a name of 1-200 characters' }); continue; }
    const allow = refList((entry as { allow?: unknown } | null)?.allow, `${field}.${name}.allow`, problems);
    if (allow.length) out[name] = { allow };
  }
  return out;
}

/**
 * Validate an owner's policy input. Returns the record to store, or the problems, all of them at
 * once, so an AI fixing its call gets every field in one answer.
 */
export function normaliseOwnerPolicy(input: unknown): { policy: OwnerAiPolicy } | { problems: PolicyProblem[] } {
  const problems: PolicyProblem[] = [];
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode = v.mode ?? 'open';
  if (mode !== 'open' && mode !== 'recommended' && mode !== 'custom') {
    problems.push({ field: 'mode', message: 'one of open, recommended, custom' });
  }
  const allow = refList(v.allow, 'allow', problems);
  if (mode === 'custom' && allow.length === 0) {
    problems.push({ field: 'allow', message: 'a custom policy needs at least one model reference' });
  }
  const appliesIn = (v.appliesTo && typeof v.appliesTo === 'object' ? v.appliesTo : {}) as Record<string, unknown>;
  const appliesTo: PolicyAppliesTo = { owner: true, chat: true, agents: true, apps: true };
  for (const key of Object.keys(appliesTo) as Array<keyof PolicyAppliesTo>) {
    if (appliesIn[key] === undefined) continue;
    if (typeof appliesIn[key] !== 'boolean') problems.push({ field: `appliesTo.${key}`, message: 'true or false' });
    else appliesTo[key] = appliesIn[key] as boolean;
  }
  const apps = scopedLists(v.apps, 'apps', problems);
  const agents = scopedLists(v.agents, 'agents', problems);
  if (problems.length) return { problems };
  return {
    policy: {
      version: 1, mode: mode as PolicyMode, allow: mode === 'custom' ? allow : [],
      appliesTo, apps, agents, updatedAt: new Date().toISOString(),
    },
  };
}

/** A stored record read back leniently: anything unreadable is the open policy, never an error. */
export function readOwnerPolicy(value: unknown): OwnerAiPolicy {
  const r = normaliseOwnerPolicy(value);
  return 'policy' in r ? { ...r.policy, updatedAt: (value as { updatedAt?: string } | undefined)?.updatedAt } : OPEN_POLICY;
}

// ── the node's recommendations ──────────────────────────────────────────────────────────────────

export type RecommendedModels = Partial<Record<AiCapability, string[]>>;

/**
 * Read the operator's list: a JSON object from capability to an ordered list of references. An
 * unknown capability or a malformed reference is left out and reported, and the node boots either
 * way: a typo in one entry must not take the node down or empty the rest of the list.
 */
export function parseRecommendedModels(raw: string | undefined): { models: RecommendedModels; problems: string[] } {
  const problems: string[] = [];
  const models: RecommendedModels = {};
  if (!raw || !raw.trim()) return { models, problems };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { models, problems: [`AIMEAT_AI_RECOMMENDED_MODELS is not JSON: ${(err as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { models, problems: ['AIMEAT_AI_RECOMMENDED_MODELS must be a JSON object: { "text": ["openrouter:..."], ... }'] };
  }
  for (const [cap, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(AI_CAPABILITIES as readonly string[]).includes(cap)) { problems.push(`unknown capability "${cap}"`); continue; }
    if (!Array.isArray(list)) { problems.push(`"${cap}" must be a list`); continue; }
    const refs = list.filter((r): r is string => {
      if (isModelRef(r)) return true;
      problems.push(`"${cap}": "${String(r)}" is not a <type>:<model id> reference`);
      return false;
    });
    if (refs.length) models[cap as AiCapability] = refs;
  }
  return { models, problems };
}

// ── the decision ────────────────────────────────────────────────────────────────────────────────

/** Who is calling, as the owner's four switches name it. */
export type CallerClass = 'owner' | 'chat' | 'agent' | 'app';

export interface PolicyContext {
  capability: AiCapability;
  caller: CallerClass;
  /** The owner's agent that asked, by bare name. */
  agent?: string;
  /** The app the node identified from an app grant (`owner/file.html`). Never a self-declared id. */
  verifiedApp?: string;
  /** The app's own `models=` list from its published meta, when the call came from an app. */
  appModels?: string[];
}

/** Which layer set a list. `owner` covers both `recommended` and `custom`; `source` tells them apart. */
export type PolicyLayerName = 'owner' | 'agent' | 'app';

export interface PolicyLayer {
  layer: PolicyLayerName;
  /** Where the list came from, for the message a person reads. */
  source: 'recommended' | 'custom' | 'owner-agent' | 'owner-app' | 'app-meta';
  allow: string[];
}

export interface PolicyDecision {
  /** The intersection of every layer's list, or 'any' when no layer has one. */
  allowed: string[] | 'any';
  layers: PolicyLayer[];
}

const APPLIES_KEY: Record<CallerClass, keyof PolicyAppliesTo> = { owner: 'owner', chat: 'chat', agent: 'agents', app: 'apps' };

export function effectivePolicy(
  recommended: RecommendedModels, owner: OwnerAiPolicy | undefined, ctx: PolicyContext,
): PolicyDecision {
  const layers: PolicyLayer[] = [];
  if (owner && owner.mode !== 'open' && owner.appliesTo[APPLIES_KEY[ctx.caller]] !== false) {
    if (owner.mode === 'recommended') {
      // A capability the operator recommended nothing for is not restricted by this layer: an
      // empty recommendation is the operator having no opinion, not a ban on the capability.
      const list = recommended[ctx.capability];
      if (list?.length) layers.push({ layer: 'owner', source: 'recommended', allow: list });
    } else {
      layers.push({ layer: 'owner', source: 'custom', allow: owner.allow });
    }
  }
  // The owner's tightening for one agent or one app applies whenever it is set: the owner named
  // that caller on purpose.
  if (ctx.agent && owner?.agents[ctx.agent]?.allow.length) {
    layers.push({ layer: 'agent', source: 'owner-agent', allow: owner.agents[ctx.agent].allow });
  }
  if (ctx.verifiedApp && owner?.apps[ctx.verifiedApp]?.allow.length) {
    layers.push({ layer: 'app', source: 'owner-app', allow: owner.apps[ctx.verifiedApp].allow });
  }
  if (ctx.appModels?.length) layers.push({ layer: 'app', source: 'app-meta', allow: ctx.appModels });

  if (layers.length === 0) return { allowed: 'any', layers };
  let allowed = layers[0].allow;
  for (const l of layers.slice(1)) {
    const keep = new Set(l.allow.map(norm));
    allowed = allowed.filter(r => keep.has(norm(r)));
  }
  return { allowed, layers };
}

export function isAllowed(decision: PolicyDecision, ref: string): boolean {
  if (decision.allowed === 'any') return true;
  return decision.allowed.some(r => norm(r) === norm(ref));
}

/** The first layer whose list leaves this reference out, or null when every layer allows it. */
export function blockingLayer(decision: PolicyDecision, ref: string): PolicyLayer | null {
  return decision.layers.find(l => !l.allow.some(r => norm(r) === norm(ref))) ?? null;
}

/**
 * The model the node picks when the owner's own choice is not allowed: the first allowed reference,
 * in the node's recommended order for the capability and then in the policy's own order, that the
 * caller's providers can reach. Null when there is none.
 *
 * A model of a custom list is a source when `serves` (the model catalogue, V4) says it serves the
 * capability. A model the catalogue does not know is taken to be a text model, as before the
 * catalogue, and a source for text only.
 */
export function firstAllowed(
  decision: PolicyDecision, capability: AiCapability, recommended: RecommendedModels, reachable: readonly string[],
  serves: (ref: string) => boolean | undefined = () => undefined,
): string | null {
  const reach = new Set(reachable.map(t => t.toLowerCase()));
  const custom = decision.allowed === 'any' ? [] : decision.allowed.filter(ref => {
    const known = serves(ref);
    return known ?? capability === 'text';
  });
  const ordered = [...(recommended[capability] ?? []), ...custom];
  for (const ref of ordered) {
    const p = parseModelRef(ref);
    if (p.type && reach.has(p.type) && isAllowed(decision, ref)) return ref;
  }
  return null;
}
