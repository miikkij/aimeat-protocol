/**
 * @file query.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model catalogue filtered for one caller: the answer of GET /v1/ai/models and of
 *   aimeat_ai_models, in one place so the route and the tool cannot disagree (System 2 plan, V4 and
 *   V5). Moved out of routes/ai-models.ts, with the same filters and the same answer.
 *
 *   `allowed=true` keeps what this caller can actually use: a provider of the model's type that
 *   serves the capability, and a model the caller's policy allows.
 * @structure MODEL_CAPABILITIES · MAX_MODEL_ROWS · ModelQuery · modelView() · queryModels()
 * @version-history
 *   v1.0.0 — 2026-09-28 — Moved from routes/ai-models.ts for the MCP tool aimeat_ai_models (V5).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import { AiCompletionError } from '../errors.js';
import { catalogMeta, catalogModels } from './store.js';
import { servesCapability } from './price.js';
import { CATALOG_TYPES, type CatalogModel, type CatalogType } from './types.js';
import { providersForOwner } from '../provider-store.js';
import { TYPE_CAPABILITIES } from '../providers.js';
import { loadPolicyDecision } from '../policy-gate.js';
import { isAllowed, type CallerClass } from '../policy.js';
import type { AiCapability } from '../types.js';

export const MODEL_CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
export const MAX_MODEL_ROWS = 2000;

export interface ModelQuery {
  capability?: string;
  type?: string;
  /** Comma-separated statuses, or `all`. Default active,retiring. */
  status?: string;
  allowed?: boolean;
}

/** Who asks, for `allowed`: the payer, and the caller as the policy names it. */
export interface ModelQueryCaller {
  payer: string;
  agent?: string;
  caller: CallerClass;
  verifiedApp?: string;
}

/** One model as the endpoint shows it; `ref` is what a call or a policy names. */
export function modelView(m: CatalogModel): Record<string, unknown> {
  return {
    ref: `${m.type}:${m.id}`, type: m.type, id: m.id, name: m.name,
    ...(m.family ? { family: m.family } : {}), ...(m.released ? { released: m.released } : {}),
    caps: m.caps, limits: m.limits, price: m.price, status: m.status,
    ...(m.retiresAt ? { retires_at: m.retiresAt } : {}),
    sources: m.sources,
  };
}

export async function queryModels(
  storage: Storage, config: AimeatConfig, who: ModelQueryCaller, q: ModelQuery,
): Promise<Record<string, unknown>> {
  const capability = q.capability as AiCapability | undefined;
  if (capability && !MODEL_CAPABILITIES.includes(capability)) {
    throw new AiCompletionError('INVALID_QUERY', 400, `capability: one of ${MODEL_CAPABILITIES.join(', ')}.`);
  }
  const type = q.type as CatalogType | undefined;
  if (type && !(CATALOG_TYPES as readonly string[]).includes(type)) {
    throw new AiCompletionError('INVALID_QUERY', 400, `type: one of ${CATALOG_TYPES.join(', ')}. A local server's models are not in the catalogue.`);
  }
  const status = q.status === 'all' ? null : (q.status ?? 'active,retiring').split(',');
  let models = catalogModels(type ? [type] : undefined)
    .filter(m => !status || status.includes(m.status))
    .filter(m => !capability || servesCapability(m, capability));
  if (q.allowed) {
    const cap = capability ?? 'text';
    const { node, owner } = await providersForOwner(storage, config, who.payer);
    const reachable = new Set([...owner, ...node].filter(p => !p.problem && p.capabilities[cap]?.enabled && TYPE_CAPABILITIES[p.type].includes(cap)).map(p => p.type as string));
    const policy = await loadPolicyDecision(storage, config, who.payer, {
      capability: cap, caller: who.caller, ...(who.verifiedApp ? { verifiedApp: who.verifiedApp } : {}), ...(who.agent ? { agent: who.agent } : {}),
    });
    models = models.filter(m => reachable.has(m.type) && isAllowed(policy.decision, `${m.type}:${m.id}`));
  }
  const total = models.length;
  const meta = catalogMeta();
  return {
    models: models.slice(0, MAX_MODEL_ROWS).map(modelView), total, truncated: total > MAX_MODEL_ROWS,
    snapshot: meta?.snapshot ?? null, refreshed_at: meta?.refreshedAt ?? null,
  };
}
