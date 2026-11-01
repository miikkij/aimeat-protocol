/**
 * @file services/ai/openrouter-region.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an OpenRouter call is processed: eu.openrouter.ai (only endpoints in the EU/EEA,
 *   the UK and Switzerland), us.openrouter.ai (only endpoints in the United States) or openrouter.ai
 *   (any provider in any country). Jouni, 2026-10-31: the operator chooses for the node's key, each
 *   person may choose for themselves when the operator allows it, a model the chosen region does not
 *   offer goes to us.openrouter.ai unless the person turned that off, and "any country" stays a third
 *   choice under that name, which the operator may forbid.
 *
 *   THE PROVIDER KEEPS ITS ADDRESS; THE CALL GETS THE REGION'S. An OpenRouter provider record is still
 *   reached at its fixed address (providers.ts), so every place that recognises OpenRouter by that
 *   address works as before. Only the call's target (route-plan.ts) carries the regional address,
 *   decided here once the model and the key that pays are known.
 *
 *   THE REGION'S MODELS ARE OPENROUTER'S OWN LIST. GET <region>/models answers the models with an
 *   endpoint in that region (measured 2026-10-31: 69 on eu, 125 on us, 452 on the global address).
 *   The list is read when first needed and kept six hours; a list that cannot be read lets the call
 *   go to the region anyway, where OpenRouter refuses rather than leave the region ("fails closed"),
 *   so an outage of the list never moves data elsewhere.
 *
 *   WHOSE CHOICE. On the node's key: the person's rule (routing.ts openrouterRegion) when the operator
 *   lets people choose and allows that region, else the node's ai.openrouter_region; a region the
 *   operator left out of ai.openrouter_regions is never used, as a choice or as a fallback. On the
 *   person's or an agent's own OpenRouter key: the person's rule, and with none, any, the address that
 *   key always used, because their own key may not be on the plan the in-region addresses need.
 *
 *   THE BUYER'S MODE (ai.region_mode, Jouni 2026-11-01). A node sold from the store is set up with one
 *   of three choices, and the choice decides the four ai.openrouter_* settings (regionSettingsOf), the
 *   free model, the text model eu-only uses, the records of processing and the privacy page, all read
 *   through the helpers here. Empty is no mode: the four settings decide as before, as on aimeat.io.
 * @structure OpenRouterRegion · RegionFallback · REGION_HOSTS · regionBaseUrl · RegionMode ·
 *   regionModeOf · regionSettingsOf · freeModelOf · freeLastResortOf · EU_ONLY_TEXT_MODEL ·
 *   allowedRegions · RegionChoice · regionChoiceFor · RegionModels · regionModels · regionModelIds ·
 *   RegionNeeds · RegionDecision · decideRegion · euOnlyModelFor · nodeTextModel · regionsInUse · REGION_MODE_LIMITS ·
 *   REGION_COUNTRY · regionView · regionDeclaration · resetRegionModelsForTests
 * @usage
 *   const choice = regionChoiceFor(config, rules, candidate.keyScope);
 *   const d = await decideRegion(config, choice, model);
 *   if (!d.ok) reject(d.message); else target.baseUrl = d.baseUrl;
 * @version-history
 *   v1.2.0 — 2026-11-01 — nodeTextModel: the statement names the node's default model for the chat and
 *     the agents, and eu-only's stand-in (Jouni, 2026-11-01 02.54).
 *   v1.1.0 — 2026-11-01 — ai.region_mode (eu, eu-only, own) decides the region settings; a region's
 *     list records which models it offers without tool calling, and a call that sends tools does not
 *     go to such an endpoint; eu-only replaces a node-chosen model the EU does not offer and has no
 *     free model (Jouni, 2026-11-01 01.17).
 *   v1.0.0 — 2026-10-31 — Initial (Jouni, 2026-10-31).
 */
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import { fixedBaseUrlOf, regionOverrideOf } from './providers.js';
import type { RoutingRules } from './routing.js';
import { nodeOpenRouterKey } from './node-openrouter-key.js';
import { resolveModelFor } from '../ai-model-defaults.js';

/**
 * The model the node's chat and agents use when a call names none and the person chose none: the
 * node's chat default, then its execution and reasoning defaults, the order services/ai/completion.ts
 * reads them in. Undefined when the node names none. On eu-only a model the EU does not offer is
 * replaced at the call (euOnlyModelFor); the statements name that model beside this one.
 */
export function nodeTextModel(config: AimeatConfig): string | undefined {
  return resolveModelFor(config, undefined, 'chat') ?? resolveModelFor(config, undefined, 'execution')
    ?? resolveModelFor(config, undefined, 'reasoning');
}

export type OpenRouterRegion = 'eu' | 'us' | 'any';
export type RegionFallback = 'off' | 'us' | 'any';

export const OPENROUTER_REGIONS: readonly OpenRouterRegion[] = ['eu', 'us', 'any'];

/** The host each region is reached at, as a person reads it. */
export const REGION_HOSTS: Readonly<Record<OpenRouterRegion, string>> = {
  eu: 'eu.openrouter.ai', us: 'us.openrouter.ai', any: 'openrouter.ai',
};

const REGION_BASE: Readonly<Record<'eu' | 'us', string>> = {
  eu: 'https://eu.openrouter.ai/api/v1', us: 'https://us.openrouter.ai/api/v1',
};

/** The API root of a region on this node: the official address, or a test stub on a node that is not public. */
export function regionBaseUrl(config: AimeatConfig, region: OpenRouterRegion): string {
  if (region === 'any') return fixedBaseUrlOf(config, 'openrouter');
  return regionOverrideOf(config, region) ?? REGION_BASE[region];
}

/**
 * The choice a node's buyer makes once (ai.region_mode; Jouni, 2026-11-01): eu is the EU as far as it
 * goes and elsewhere for the rest, each fallback recorded on the answer; eu-only is the EU and nothing
 * else, with what the EU cannot give switched off; own is the person's own OpenRouter key and their
 * own contract. Empty: no mode, and the four ai.openrouter_* settings decide as they did.
 */
export type RegionMode = '' | 'eu' | 'eu-only' | 'own';
export const REGION_MODES: readonly RegionMode[] = ['eu', 'eu-only', 'own'];

export function regionModeOf(config: AimeatConfig): RegionMode {
  const m = (config.aiRegionMode ?? '').trim();
  return (REGION_MODES as readonly string[]).includes(m) ? m as RegionMode : '';
}

/** The node's region settings in effect: the mode's when one is set, else the four settings as stored. */
export interface RegionSettings { region: OpenRouterRegion; fallback: RegionFallback; regions: string; personChoice: boolean }

export function regionSettingsOf(config: AimeatConfig): RegionSettings {
  switch (regionModeOf(config)) {
    case 'eu': return { region: 'eu', fallback: 'any', regions: 'eu,us,any', personChoice: config.aiOpenrouterRegionPersonChoice !== false };
    case 'eu-only': return { region: 'eu', fallback: 'off', regions: 'eu', personChoice: false };
    // The node holds no key of its own here; a person's own key follows their own rule (regionChoiceFor).
    case 'own': return { region: 'any', fallback: 'us', regions: 'eu,us,any', personChoice: true };
    default: return {
      region: config.aiOpenrouterRegion ?? 'any', fallback: config.aiOpenrouterRegionFallback ?? 'us',
      regions: config.aiOpenrouterRegions ?? '', personChoice: config.aiOpenrouterRegionPersonChoice !== false,
    };
  }
}

/** OpenRouter's free-models router, or '' when the mode keeps calls where it does not run (eu-only). */
export function freeModelOf(config: AimeatConfig): string {
  return regionModeOf(config) === 'eu-only' ? '' : (config.modelFreeFallback ?? '');
}

/** The node's default for the free model as the last resort; never in eu-only, where it does not run. */
export function freeLastResortOf(config: AimeatConfig): boolean {
  return regionModeOf(config) !== 'eu-only' && config.aiFreeModelLastResort !== false;
}

/**
 * The text model eu-only uses when the model the node chose is not offered in the EU: on the EU list
 * with tool calling, image input and a low price (measured 2026-11-01 on eu.openrouter.ai/api/v1/models:
 * 69 models; openai/gpt-oss-120b is listed there without tool calling).
 */
export const EU_ONLY_TEXT_MODEL = 'mistralai/mistral-small-2603';

/** The regions the operator lets the node's key go to (ai.openrouter_regions, or the mode's). Empty or unreadable: all three. */
export function allowedRegions(config: AimeatConfig): OpenRouterRegion[] {
  const listed = regionSettingsOf(config).regions.split(',').map(s => s.trim().toLowerCase())
    .filter((s): s is OpenRouterRegion => (OPENROUTER_REGIONS as readonly string[]).includes(s));
  return listed.length ? OPENROUTER_REGIONS.filter(r => listed.includes(r)) : [...OPENROUTER_REGIONS];
}

/** What one call's region is: the wanted region, what happens when its model is not there, and whose word it is. */
export interface RegionChoice {
  region: OpenRouterRegion;
  fallback: RegionFallback;
  /** The regions this call may use at all. */
  allowed: OpenRouterRegion[];
  source: 'node' | 'person';
}

/** The region a call runs in, for the key that pays it. */
export function regionChoiceFor(
  config: AimeatConfig, rules: Pick<RoutingRules, 'openrouterRegion' | 'openrouterRegionFallback'>, keyScope: 'agent' | 'own' | 'node',
): RegionChoice {
  const settings = regionSettingsOf(config);
  const nodeFallback = settings.fallback;
  if (keyScope !== 'node') {
    return {
      region: rules.openrouterRegion ?? 'any', fallback: rules.openrouterRegionFallback ?? nodeFallback,
      allowed: [...OPENROUTER_REGIONS], source: rules.openrouterRegion ? 'person' : 'node',
    };
  }
  const allowed = allowedRegions(config);
  const personMay = settings.personChoice;
  const nodeRegion = allowed.includes(settings.region) ? settings.region : allowed[0];
  const personRegion = personMay && rules.openrouterRegion && allowed.includes(rules.openrouterRegion) ? rules.openrouterRegion : null;
  const personFallback = personMay ? rules.openrouterRegionFallback : null;
  return {
    region: personRegion ?? nodeRegion,
    fallback: personFallback ?? nodeFallback,
    allowed,
    source: personRegion || personFallback ? 'person' : 'node',
  };
}

/**
 * A region's models: every id it offers, and the ids it lists WITHOUT tool calling. A model whose
 * entry names no supported parameters is not counted as lacking them, so a list that does not say
 * leaves the region to decide, as an unreadable list does.
 */
export interface RegionModels { ids: Set<string>; noTools: Set<string> }

/** A region's model list: what was read and when, null when it could not be read. */
const lists = new Map<string, { at: number; models: RegionModels | null }>();
const inFlight = new Map<string, Promise<RegionModels | null>>();
const LIST_TTL_MS = 6 * 60 * 60_000;
const FAILED_TTL_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 10_000;
/** The global list is about a megabyte; a regional one far less. */
const LIST_READ_BYTES = 8 * 1024 * 1024;

/** The models a region offers, or null when its list could not be read. */
export async function regionModels(config: AimeatConfig, region: 'eu' | 'us'): Promise<RegionModels | null> {
  const base = regionBaseUrl(config, region);
  const cached = lists.get(base);
  if (cached && Date.now() - cached.at < (cached.models ? LIST_TTL_MS : FAILED_TTL_MS)) return cached.models;
  const running = inFlight.get(base);
  if (running) return running;
  const read = (async () => {
    try {
      const res = await safeFetch(`${base}/models`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await readJson(res, LIST_READ_BYTES) as { data?: Array<{ id?: unknown; supported_parameters?: unknown }> } | null;
      const models: RegionModels = { ids: new Set(), noTools: new Set() };
      for (const m of body?.data ?? []) {
        if (typeof m?.id !== 'string') continue;
        models.ids.add(m.id);
        if (Array.isArray(m.supported_parameters) && !m.supported_parameters.includes('tools')) models.noTools.add(m.id);
      }
      lists.set(base, { at: Date.now(), models });
      return models;
    } catch (err) {
      logger.warn('[ai] OpenRouter did not list a region\'s models; calls go to the region and it decides', { region, error: String(err) });
      lists.set(base, { at: Date.now(), models: null });
      return null;
    } finally {
      inFlight.delete(base);
    }
  })();
  inFlight.set(base, read);
  return read;
}

/** The ids of the models a region offers, or null when its list could not be read. */
export async function regionModelIds(config: AimeatConfig, region: 'eu' | 'us'): Promise<Set<string> | null> {
  return (await regionModels(config, region))?.ids ?? null;
}

/** What a call needs from the region's endpoint beyond the model itself. */
export interface RegionNeeds { tools?: boolean }

/** Whether a region's list offers this model for this call: listed, and with tool calling when the call sends tools. */
function offers(models: RegionModels, id: string, needs: RegionNeeds): boolean {
  return models.ids.has(id) && !(needs.tools && models.noTools.has(id));
}

export type RegionDecision =
  | { ok: true; region: OpenRouterRegion; wanted: OpenRouterRegion; baseUrl: string; fellBack: boolean }
  | { ok: false; wanted: OpenRouterRegion; message: string; offered: string[] };

/** The regions tried, in order: the wanted one, then the fallback's, each only when allowed. */
function regionOrder(choice: RegionChoice): OpenRouterRegion[] {
  const order: OpenRouterRegion[] = [choice.region];
  if (choice.region === 'eu' && (choice.fallback === 'us' || choice.fallback === 'any')) order.push('us');
  if (choice.region !== 'any' && choice.fallback === 'any') order.push('any');
  return order.filter((r, i) => choice.allowed.includes(r) && order.indexOf(r) === i);
}

/**
 * The region this model's call goes to, or the refusal that says why none can take it. The model is
 * OpenRouter's id (`anthropic/claude-sonnet-5.5`); a reference with the `openrouter:` prefix is read
 * the same.
 */
export async function decideRegion(config: AimeatConfig, choice: RegionChoice, model: string, needs: RegionNeeds = {}): Promise<RegionDecision> {
  const id = model.startsWith('openrouter:') ? model.slice('openrouter:'.length) : model;
  for (const region of regionOrder(choice)) {
    const models = region === 'any' ? null : await regionModels(config, region);
    // `any` takes every model; a list that could not be read lets the region decide, and it refuses
    // rather than leave the region. A model listed without tool calling does not take a call that
    // sends tools: on crew36 openai/gpt-oss-120b is on the EU list with no tool calling there.
    if (region === 'any' || models === null || offers(models, id, needs)) {
      return { ok: true, region, wanted: choice.region, baseUrl: regionBaseUrl(config, region), fellBack: region !== choice.region };
    }
  }
  const wanted = choice.region;
  const listed = wanted === 'any' ? null : await regionModels(config, wanted);
  const offered = listed ? [...listed.ids].filter(m => offers(listed, m, needs)).sort().slice(0, 12) : [];
  const toolsOnly = !!(needs.tools && listed?.ids.has(id));
  const what = toolsOnly ? `${id} is offered at ${REGION_HOSTS[wanted]} without tool calling, which this call needs`
    : `${id} is not offered at ${REGION_HOSTS[wanted]}`;
  if (choice.source === 'node' && regionModeOf(config) === 'eu-only') {
    return {
      ok: false, wanted, offered,
      message: `This node keeps every AI call in the EU (EU only), and ${what}, so this is off here.`
        + `${offered.length ? ` Models offered there include ${offered.join(', ')}.` : ''}`,
    };
  }
  const how = choice.source === 'person' || regionSettingsOf(config).personChoice
    ? ` To let such a model run in the United States, set your AI routing rule openrouterRegionFallback to us${choice.allowed.includes('any') ? ', or to any for any country' : ''}.`
    : '';
  return {
    ok: false, wanted, offered,
    message: `${what}, where your calls on this node are processed, `
      + `and no fallback region is allowed for it.${offered.length ? ` Models offered there include ${offered.join(', ')}.` : ''}${how}`,
  };
}

/**
 * The model a call on the node's key uses in eu-only: the model the node chose when the EU offers it
 * for this call, else EU_ONLY_TEXT_MODEL for a text or picture call. Every other mode, a model the
 * caller named, and any other capability keep their model, and the region decides (refusing in eu-only).
 */
export async function euOnlyModelFor(
  config: AimeatConfig, model: string, capability: string, needs: RegionNeeds, callerNamed: boolean,
): Promise<string> {
  if (regionModeOf(config) !== 'eu-only' || callerNamed || !['text', 'vision', 'files'].includes(capability)) return model;
  const id = model.startsWith('openrouter:') ? model.slice('openrouter:'.length) : model;
  const eu = await regionModels(config, 'eu');
  return eu === null || offers(eu, id, needs) ? model : EU_ONLY_TEXT_MODEL;
}

/**
 * The regions the node's key can reach on this node's settings, for the records of processing
 * (compliance-derived.ts): every allowed region when people may choose, else the node's region and
 * its fallback.
 */
export function regionsInUse(config: AimeatConfig): OpenRouterRegion[] {
  const allowed = allowedRegions(config);
  if (regionSettingsOf(config).personChoice) return allowed;
  const choice = regionChoiceFor(config, { openrouterRegion: null, openrouterRegionFallback: null }, 'node');
  return regionOrder(choice);
}

/**
 * What each mode switches off or leaves to the person, as an AI reads it (the person reads the same in
 * their language: aiRegion.mode.<id>.limits). Facts from the code above and the EU list of 2026-11-01.
 */
export const REGION_MODE_LIMITS: Readonly<Record<Exclude<RegionMode, ''>, string>> = {
  eu: 'Calls go to eu.openrouter.ai first. A model the EU does not offer, or offers without the tool calling the call needs, runs at us.openrouter.ai and then openrouter.ai, and the answer records where it ran.',
  'eu-only': `Every call on the node's key stays at eu.openrouter.ai. A model the EU does not offer is replaced by ${EU_ONLY_TEXT_MODEL} for text and pictures; speech-to-text, speech, image generation, embeddings and the free models are off, because the EU list offers none of them.`,
  own: 'The node has no shared AI key. Each person adds their own OpenRouter key on the AI settings page and answers for it under their own contract with OpenRouter; nothing falls back to a shared key.',
};

/** Where each region processes a prompt, as the records of processing write a country. */
export const REGION_COUNTRY: Readonly<Record<OpenRouterRegion, string>> = {
  eu: 'EU/EEA, United Kingdom or Switzerland',
  us: 'United States',
  any: 'Any country (the model provider\'s)',
};

/**
 * The region settings as a settings page and an AI read them: the operator's choice, what this
 * person may choose, and what applies to them now on the node's key and on their own OpenRouter key.
 */
export function regionView(config: AimeatConfig, rules: Pick<RoutingRules, 'openrouterRegion' | 'openrouterRegionFallback'>): Record<string, unknown> {
  const onNode = regionChoiceFor(config, rules, 'node');
  const onOwn = regionChoiceFor(config, rules, 'own');
  const settings = regionSettingsOf(config);
  const mode = regionModeOf(config);
  return {
    hosts: REGION_HOSTS,
    /** Whether the node has an OpenRouter key of its own, so the node's choice reaches anyone at all. */
    node_key: !!nodeOpenRouterKey(config),
    /** The buyer's choice (ai.region_mode), null when none is set; `limits` names what it switches off. */
    mode: mode ? { id: mode, limits: REGION_MODE_LIMITS[mode] } : null,
    node: {
      region: settings.region, fallback: settings.fallback,
      allowed: allowedRegions(config), person_may_choose: settings.personChoice,
    },
    in_effect: {
      node_key: { region: onNode.region, fallback: onNode.fallback, source: onNode.source },
      own_key: { region: onOwn.region, fallback: onOwn.fallback, source: onOwn.source },
    },
    note: 'eu and us keep the prompt and the answer in that region. OpenRouter keeps account, billing and security records in the United States whatever is chosen, and any may send the prompt to a provider in any country.',
  };
}

/**
 * Where the node's own AI key has prompts processed, for the AI transparency statement
 * (routes/ai-transparency.ts): the buyer's choice and its limits, the region, the fallback and the
 * regions in use. A node without its own key says so; on the own-key choice each person's key decides.
 */
export function regionDeclaration(config: AimeatConfig): Record<string, unknown> {
  const mode = regionModeOf(config);
  const settings = regionSettingsOf(config);
  const nodeKey = !!nodeOpenRouterKey(config);
  const model = nodeTextModel(config);
  return {
    mode: mode || null,
    ...(mode ? { mode_limits: REGION_MODE_LIMITS[mode] } : {}),
    node_key: nodeKey,
    ...(nodeKey ? {
      // The model behind the chat and the agents when nobody chose one (Jouni, 2026-11-01 02.54: the
      // customer-visible text and the records name the model and the region).
      default_model: model ?? null,
      ...(mode === 'eu-only' ? { eu_only_model: EU_ONLY_TEXT_MODEL } : {}),
      region: settings.region, host: REGION_HOSTS[settings.region], fallback: settings.fallback,
      regions_in_use: regionsInUse(config).map(r => ({ region: r, host: REGION_HOSTS[r], country: REGION_COUNTRY[r] })),
    } : {}),
    note: 'eu keeps the prompt and the answer in the EU/EEA, the United Kingdom or Switzerland; us in the United States; any lets the model\'s provider be in any country. OpenRouter keeps account, billing and security records in the United States whatever is chosen. Each answer records where it ran.',
  };
}

/** Forget the region lists this process read, for a test. */
export function resetRegionModelsForTests(): void {
  lists.clear(); inFlight.clear();
}
