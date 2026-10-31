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
 * @structure OpenRouterRegion · RegionFallback · REGION_HOSTS · regionBaseUrl · allowedRegions ·
 *   RegionChoice · regionChoiceFor · regionModelIds · RegionDecision · decideRegion · regionsInUse ·
 *   REGION_COUNTRY · regionView · resetRegionModelsForTests
 * @usage
 *   const choice = regionChoiceFor(config, rules, candidate.keyScope);
 *   const d = await decideRegion(config, choice, model);
 *   if (!d.ok) reject(d.message); else target.baseUrl = d.baseUrl;
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni, 2026-10-31).
 */
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import { fixedBaseUrlOf, regionOverrideOf } from './providers.js';
import type { RoutingRules } from './routing.js';

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

/** The regions the operator lets the node's key go to (ai.openrouter_regions). Empty or unreadable: all three. */
export function allowedRegions(config: AimeatConfig): OpenRouterRegion[] {
  const listed = (config.aiOpenrouterRegions ?? '').split(',').map(s => s.trim().toLowerCase())
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
  const nodeFallback = config.aiOpenrouterRegionFallback ?? 'us';
  if (keyScope !== 'node') {
    return {
      region: rules.openrouterRegion ?? 'any', fallback: rules.openrouterRegionFallback ?? nodeFallback,
      allowed: [...OPENROUTER_REGIONS], source: rules.openrouterRegion ? 'person' : 'node',
    };
  }
  const allowed = allowedRegions(config);
  const personMay = config.aiOpenrouterRegionPersonChoice !== false;
  const nodeRegion = allowed.includes(config.aiOpenrouterRegion ?? 'any') ? (config.aiOpenrouterRegion ?? 'any') : allowed[0];
  const personRegion = personMay && rules.openrouterRegion && allowed.includes(rules.openrouterRegion) ? rules.openrouterRegion : null;
  const personFallback = personMay ? rules.openrouterRegionFallback : null;
  return {
    region: personRegion ?? nodeRegion,
    fallback: personFallback ?? nodeFallback,
    allowed,
    source: personRegion || personFallback ? 'person' : 'node',
  };
}

/** A region's model list: what was read and when, null when it could not be read. */
const lists = new Map<string, { at: number; ids: Set<string> | null }>();
const inFlight = new Map<string, Promise<Set<string> | null>>();
const LIST_TTL_MS = 6 * 60 * 60_000;
const FAILED_TTL_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 10_000;
/** The global list is about a megabyte; a regional one far less. */
const LIST_READ_BYTES = 8 * 1024 * 1024;

/** The ids of the models a region offers, or null when its list could not be read. */
export async function regionModelIds(config: AimeatConfig, region: 'eu' | 'us'): Promise<Set<string> | null> {
  const base = regionBaseUrl(config, region);
  const cached = lists.get(base);
  if (cached && Date.now() - cached.at < (cached.ids ? LIST_TTL_MS : FAILED_TTL_MS)) return cached.ids;
  const running = inFlight.get(base);
  if (running) return running;
  const read = (async () => {
    try {
      const res = await safeFetch(`${base}/models`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await readJson(res, LIST_READ_BYTES) as { data?: Array<{ id?: unknown }> } | null;
      const ids = new Set((body?.data ?? []).map(m => m?.id).filter((id): id is string => typeof id === 'string'));
      lists.set(base, { at: Date.now(), ids });
      return ids;
    } catch (err) {
      logger.warn('[ai] OpenRouter did not list a region\'s models; calls go to the region and it decides', { region, error: String(err) });
      lists.set(base, { at: Date.now(), ids: null });
      return null;
    } finally {
      inFlight.delete(base);
    }
  })();
  inFlight.set(base, read);
  return read;
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
export async function decideRegion(config: AimeatConfig, choice: RegionChoice, model: string): Promise<RegionDecision> {
  const id = model.startsWith('openrouter:') ? model.slice('openrouter:'.length) : model;
  for (const region of regionOrder(choice)) {
    const ids = region === 'any' ? null : await regionModelIds(config, region);
    // `any` takes every model; a list that could not be read lets the region decide, and it refuses
    // rather than leave the region.
    if (region === 'any' || ids === null || ids.has(id)) {
      return { ok: true, region, wanted: choice.region, baseUrl: regionBaseUrl(config, region), fellBack: region !== choice.region };
    }
  }
  const wanted = choice.region;
  const offered = wanted === 'any' ? [] : [...((await regionModelIds(config, wanted)) ?? [])].sort().slice(0, 12);
  const how = choice.source === 'person' || config.aiOpenrouterRegionPersonChoice !== false
    ? ` To let such a model run in the United States, set your AI routing rule openrouterRegionFallback to us${choice.allowed.includes('any') ? ', or to any for any country' : ''}.`
    : '';
  return {
    ok: false, wanted, offered,
    message: `${id} is not offered at ${REGION_HOSTS[wanted]}, where your calls on this node are processed, `
      + `and no fallback region is allowed for it.${offered.length ? ` Models offered there include ${offered.join(', ')}.` : ''}${how}`,
  };
}

/**
 * The regions the node's key can reach on this node's settings, for the records of processing
 * (compliance-derived.ts): every allowed region when people may choose, else the node's region and
 * its fallback.
 */
export function regionsInUse(config: AimeatConfig): OpenRouterRegion[] {
  const allowed = allowedRegions(config);
  if (config.aiOpenrouterRegionPersonChoice !== false) return allowed;
  const choice = regionChoiceFor(config, { openrouterRegion: null, openrouterRegionFallback: null }, 'node');
  return regionOrder(choice);
}

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
  return {
    hosts: REGION_HOSTS,
    /** Whether the node has an OpenRouter key of its own, so the node's choice reaches anyone at all. */
    node_key: !!(config.openrouterInstanceKey ?? '').trim(),
    node: {
      region: config.aiOpenrouterRegion ?? 'any', fallback: config.aiOpenrouterRegionFallback ?? 'us',
      allowed: allowedRegions(config), person_may_choose: config.aiOpenrouterRegionPersonChoice !== false,
    },
    in_effect: {
      node_key: { region: onNode.region, fallback: onNode.fallback, source: onNode.source },
      own_key: { region: onOwn.region, fallback: onOwn.fallback, source: onOwn.source },
    },
    note: 'eu and us keep the prompt and the answer in that region. OpenRouter keeps account, billing and security records in the United States whatever is chosen, and any may send the prompt to a provider in any country.',
  };
}

/** Forget the region lists this process read, for a test. */
export function resetRegionModelsForTests(): void {
  lists.clear(); inFlight.clear();
}
