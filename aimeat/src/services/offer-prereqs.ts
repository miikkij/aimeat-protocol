/**
 * @file offer-prereqs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Evaluate an offer's PREREQUISITES so the Offers card can show a runnable / blocked
 *   state with the reason — without running the offer. A prerequisite is either an UPSTREAM OFFER
 *   (met when that offer's deliverable.location.key is non-empty in owner-scope memory) or a SIGNAL
 *   (evaluated with the shared workflow signal evaluator). The offer's own `required_to_function`
 *   (the workflow consumer gate) is folded in as a hard prereq. `hard` (default true) gates the Ask;
 *   `hard:false` is advisory. The pure core (`evaluatePrereqs`) takes an injected SignalEvalCtx +
 *   offer-dep resolver, so it is unit-testable with no storage; the route binds those to owner-scope
 *   memory via `evaluateOfferPrereqs`. Reuses signal-eval.ts (no second evaluator) — see
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md §3,§5.
 * @structure
 *   - PrereqItem / OfferPrereq — the result shape attached to each offer in GET /v1/offers
 *   - offerHasPrereqs(offer) — cheap guard so the feed only evaluates offers that declare any
 *   - evaluatePrereqs(offer, ctx, resolveDep) — pure recursive-friendly core (unit-tested)
 *   - buildOfferEvalCtx / makeOfferDepResolver — owner-scope bindings
 *   - evaluateOfferPrereqs(storage, config, ownerName, agentName, offer) — the route entry point
 * @usage import { evaluateOfferPrereqs, offerHasPrereqs } from './offer-prereqs.js';
 * @version-history
 *   v1.0.0 — 2026-06-16 — Initial: offer + signal prerequisites, deterministic owner-scope evaluation.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Offer } from '../models/offer-schemas.js';
import type { Signal } from '../models/workflow-schemas.js';
import { buildGAII } from '../utils/gaii.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from './owner-memory.js';
import { evaluateSignal, globToRegExp, type SignalEvalCtx } from './workflow/signal-eval.js';
import { validateValueAgainstSchema } from './schema-validator.js';

export interface PrereqItem {
  kind: 'required' | 'signal' | 'offer';
  label: string;
  ok: boolean;
  hard: boolean;
  /** For kind:'offer' — the upstream offer id this depends on. */
  ref?: string;
  observed?: unknown;
}

export interface OfferPrereq {
  /** No HARD prereq is unmet → the Ask is allowed. */
  runnable: boolean;
  /** A hard prereq is unmet (the inverse of runnable; explicit for the UI's gate). */
  blocked: boolean;
  items: PrereqItem[];
}

type DependsOn = NonNullable<Offer['dependsOn']>;
type DependsOnEntry = DependsOn[number];

/** A dependency is hard unless it explicitly opts out (`hard:false`). */
function isHard(dep: { hard?: boolean }): boolean {
  return dep.hard !== false;
}

/** True when the offer declares anything worth evaluating (a real input gate or any dependsOn). */
export function offerHasPrereqs(offer: Pick<Offer, 'required_to_function' | 'dependsOn'>): boolean {
  const rtf = offer.required_to_function;
  const hasGate = !!rtf && rtf !== 'none';
  return hasGate || !!(offer.dependsOn && offer.dependsOn.length);
}

/** Resolve an upstream-offer reference to the memory key its deliverable lands in (or null). */
export type OfferDepResolver = (dep: { offer: string; agent?: string }) => Promise<{ deliverableKey?: string } | null>;

/**
 * Pure evaluator. Folds the offer's own `required_to_function` (hard) and each `dependsOn` entry into
 * one verdict. An upstream-offer dep is met when its deliverable key is non-empty in memory (checked
 * via a `nonempty` signal so the same evaluator handles every case). An unresolvable offer dep is
 * reported unmet (never silently passes).
 */
export async function evaluatePrereqs(
  offer: Pick<Offer, 'required_to_function' | 'dependsOn'>,
  ctx: SignalEvalCtx,
  resolveDep: OfferDepResolver,
): Promise<OfferPrereq> {
  const items: PrereqItem[] = [];

  const rtf = offer.required_to_function;
  if (rtf && rtf !== 'none') {
    const r = await evaluateSignal(rtf as Signal, ctx);
    items.push({ kind: 'required', label: 'input ready', ok: r.ok, hard: true, observed: r.observed });
  }

  for (const dep of (offer.dependsOn ?? []) as DependsOnEntry[]) {
    if ('signal' in dep) {
      const r = await evaluateSignal(dep.signal as Signal, ctx);
      items.push({ kind: 'signal', label: dep.label, ok: r.ok, hard: isHard(dep), observed: r.observed });
      continue;
    }
    // upstream-offer dependency
    const label = dep.label ?? dep.offer;
    const resolved = await resolveDep({ offer: dep.offer, agent: dep.agent });
    if (!resolved?.deliverableKey) {
      items.push({ kind: 'offer', label, ref: dep.offer, ok: false, hard: isHard(dep), observed: { error: 'unresolved upstream offer or missing deliverable.location.key' } });
      continue;
    }
    const sig: Signal = { kind: 'deterministic', key: resolved.deliverableKey, op: 'nonempty' };
    const r = await evaluateSignal(sig, ctx);
    items.push({ kind: 'offer', label, ref: dep.offer, ok: r.ok, hard: isHard(dep), observed: r.observed });
  }

  const blocked = items.some(i => i.hard && !i.ok);
  return { runnable: !blocked, blocked, items };
}

// ── owner-scope bindings ───────────────────────────────────────────────────────

/**
 * A SignalEvalCtx bound to owner-scope memory (the owner GHII + every agent + GEAI — the same union
 * the workflow engine reads), with NO vars and NO llm (an `llm` leaf degrades to a pass on the feed;
 * we never spend on the node OpenRouter just to render a card). json_schema gets the real validator.
 */
export function buildOfferEvalCtx(storage: Storage, config: AimeatConfig, ownerName: string): SignalEvalCtx {
  return {
    read: async (key) => {
      const rec = await getOwnerScopeMemory(storage, config.nodeId, ownerName, key);
      return rec ? { key, value: rec.value } : null;
    },
    listGlob: async (glob) => {
      const star = glob.indexOf('*');
      const listPrefix = star >= 0 ? glob.slice(0, star) : glob;
      const recs = await listOwnerScopeMemory(storage, config.nodeId, ownerName, { prefix: listPrefix });
      const re = globToRegExp(glob);
      return recs.filter(r => re.test(r.key)).map(r => ({ key: r.key, value: r.value }));
    },
    vars: {},
    llm: null,
    validateJsonSchema: (value, schema) => validateValueAgainstSchema(value, schema),
  };
}

/** Resolve an upstream-offer reference (defaulting to the dependent offer's own agent) to its
 *  deliverable.location.key by reading that agent's published offers. */
export function makeOfferDepResolver(storage: Storage, config: AimeatConfig, ownerName: string, selfAgent: string): OfferDepResolver {
  return async ({ offer, agent }) => {
    const agentName = agent ?? selfAgent;
    const gaii = buildGAII(agentName, ownerName, config.nodeId);
    const rec = await storage.getMemory(gaii, `agents.${agentName}.offers`);
    const offers = ((rec?.value as { offers?: Array<{ id: string; deliverable?: { location?: { key?: string } } }> } | undefined)?.offers) ?? [];
    const up = offers.find(o => o.id === offer);
    if (!up) return null;
    return { deliverableKey: up.deliverable?.location?.key };
  };
}

/** Route entry point: evaluate one offer's prerequisites against the owner's memory. */
export async function evaluateOfferPrereqs(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string, offer: Offer,
): Promise<OfferPrereq> {
  const ctx = buildOfferEvalCtx(storage, config, ownerName);
  const resolveDep = makeOfferDepResolver(storage, config, ownerName, agentName);
  return evaluatePrereqs(offer, ctx, resolveDep);
}
