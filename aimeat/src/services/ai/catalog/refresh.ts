/**
 * @file refresh.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refreshing the model catalogue from its sources (System 2 plan, V4;
 *   docs/internal/llmproviderintegrations/06, sections 4 and 6). The node's own scheduled job runs it
 *   (core handler `ai-catalog-refresh`, daily, doing the work when AIMEAT_AI_CATALOG_REFRESH says it
 *   is due), and `pnpm ai:catalog:refresh` runs the same fetch and merge to write the seed.
 *
 *   A SOURCE THAT DOES NOT ANSWER NEVER EMPTIES THE CATALOGUE. Its last models are carried as they
 *   were, and `ai.catalog.meta` records the failure against that source; with no source answering,
 *   nothing is written but the meta. A model the sources that did answer no longer list starts
 *   retiring, and is retired after four weeks missing or when its own retirement date passes.
 *
 *   A RETIRED MODEL THE OPERATOR RECOMMENDS is told to the operators once per refresh that retires
 *   it (plan 06, section 6); the node never changes anybody's model itself.
 * @structure parsePriceOverrides · refreshDue · refreshCatalog · keepPaidPrices · buildCatalog
 * @version-history
 *   v1.1.1 — 2026-10-05 — The operator accounts are found with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.1.0 — 2026-10-05 — keepPaidPrices: a refresh never makes a paid model free; the operator's
 *     override still can (secaudit 2026-10, AI-5).
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import { logger } from '../../../utils/logger.js';
import { isOperatorAccount } from '../../../utils/operator-account.js';
import { notify } from '../../notify.js';
import { recommendedModelsOf } from '../policy-store.js';
import { fetchSource, sourceUrls, type SourceName } from './sources.js';
import { fromModelsDev, fromOpenRouter, fromLiteLLM, mergeSources, applyLifecycle } from './normalize.js';
import { catalogMeta, catalogModels, writeCatalog } from './store.js';
import type { CatalogMeta, CatalogModel, CatalogSource, ModelPrice } from './types.js';

const SOURCE_LABEL: Record<SourceName, CatalogSource> = { modelsDev: 'models.dev', openRouter: 'openrouter', liteLlm: 'litellm' };

/** AIMEAT_AI_PRICE_OVERRIDES, read leniently: an entry that does not read is left out and logged. */
export function parsePriceOverrides(raw: string | undefined): Record<string, Partial<ModelPrice>> {
  const out: Record<string, Partial<ModelPrice>> = {};
  if (!raw?.trim()) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [ref, v] of Object.entries(parsed)) {
      if (!/^[a-z-]+:.+/.test(ref) || !v || typeof v !== 'object' || Array.isArray(v)) {
        logger.warn('[ai-catalog] an AIMEAT_AI_PRICE_OVERRIDES entry was left out', { ref });
        continue;
      }
      const price: Partial<ModelPrice> = {};
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && n >= 0) (price as Record<string, number>)[k] = n;
      out[ref] = price;
    }
  } catch (err) {
    logger.error('[ai-catalog] AIMEAT_AI_PRICE_OVERRIDES is not JSON; no correction applies', { error: String(err) });
  }
  return out;
}

/** Whether the scheduled job should refresh now, by the operator's cadence and the last refresh. */
export function refreshDue(config: AimeatConfig, meta: CatalogMeta | null, now = Date.now()): boolean {
  if (config.aiCatalogRefresh === 'off') return false;
  if (!meta || meta.origin === 'seed') return true;
  const age = now - Date.parse(meta.refreshedAt);
  const period = config.aiCatalogRefresh === 'daily' ? 23 * 3_600_000 : 6.5 * 24 * 3_600_000;
  return !(age < period);
}

export interface BuiltCatalog {
  models: CatalogModel[];
  /** Per source: the count it gave, or the error it failed with. */
  sources: Record<SourceName, { count?: number; error?: string }>;
  answered: number;
}

const paidText = (p: ModelPrice): boolean => (p.inPerMtok ?? 0) > 0 || (p.outPerMtok ?? 0) > 0;

/**
 * A model whose text price was above zero keeps that price when a refresh says it is free. The
 * recorded cost is what the node's AI allowance and the price ceiling count, so a source that answers
 * with a zero price (by mistake, or tampered with) would have let the node's key pay for that model
 * without counting it (secaudit 2026-10, AI-5). The operator's own correction (AIMEAT_AI_PRICE_OVERRIDES)
 * still sets any price, zero included.
 */
export function keepPaidPrices(previous: CatalogModel[], fresh: CatalogModel[], overrides: Record<string, Partial<ModelPrice>>): CatalogModel[] {
  const before = new Map(previous.map(m => [`${m.type}:${m.id}`, m]));
  return fresh.map(m => {
    const ref = `${m.type}:${m.id}`;
    const prev = before.get(ref);
    if (!prev || !paidText(prev.price) || paidText(m.price) || overrides[ref]) return m;
    logger.warn('[ai-catalog] a source priced a paid model at zero; the earlier price is kept', { model: ref });
    return { ...m, price: { ...m.price, inPerMtok: prev.price.inPerMtok, outPerMtok: prev.price.outPerMtok } };
  });
}

/**
 * Fetch every source and merge them over `previous`. A failed source's last models are carried
 * unchanged, so the retirement rules see only what the answering sources dropped.
 */
export async function buildCatalog(config: AimeatConfig, previous: CatalogModel[], now: string): Promise<BuiltCatalog> {
  const urls = sourceUrls(config);
  const names = Object.keys(urls) as SourceName[];
  const settled = await Promise.allSettled(names.map(n => fetchSource(urls[n])));
  const sources = {} as BuiltCatalog['sources'];
  const parts = { modelsDev: [] as CatalogModel[], openRouter: [] as CatalogModel[], liteLlm: [] as CatalogModel[] };
  const failed: CatalogSource[] = [];
  names.forEach((n, i) => {
    const r = settled[i];
    if (r.status === 'rejected') {
      sources[n] = { error: String((r.reason as Error)?.message ?? r.reason) };
      failed.push(SOURCE_LABEL[n]);
      return;
    }
    try {
      const models = n === 'modelsDev' ? fromModelsDev(r.value, now) : n === 'openRouter' ? fromOpenRouter(r.value, now) : fromLiteLLM(r.value, now);
      parts[n] = models;
      sources[n] = { count: models.length };
    } catch (err) {
      sources[n] = { error: `did not read: ${String(err)}` };
      failed.push(SOURCE_LABEL[n]);
    }
  });
  const answered = names.length - failed.length;
  const overrides = parsePriceOverrides(config.aiPriceOverrides);
  let fresh = keepPaidPrices(previous, mergeSources(parts, overrides), overrides);
  if (failed.length && answered) {
    // What only the failed sources knew stays as it was: absent from them is not absent from the world.
    const seen = new Set(fresh.map(m => `${m.type}:${m.id}`));
    const carried = previous.filter(m => !seen.has(`${m.type}:${m.id}`) && m.sources.every(s => failed.includes(s) || s === 'operator'));
    fresh = [...fresh, ...carried];
  }
  return { models: answered ? applyLifecycle(previous, fresh, now, true) : previous, sources, answered };
}

/** Tell the operators, once, about recommended models this refresh retired. */
async function tellOperatorsOfRetired(storage: Storage, config: AimeatConfig, previous: CatalogModel[], next: CatalogModel[]): Promise<void> {
  const wasRetired = new Set(previous.filter(m => m.status === 'retired').map(m => `${m.type}:${m.id}`.toLowerCase()));
  const recommended = new Set(Object.values(recommendedModelsOf(config)).flat().map(r => r.toLowerCase()));
  const newly = next.filter(m => m.status === 'retired' && !wasRetired.has(`${m.type}:${m.id}`.toLowerCase())
    && recommended.has(`${m.type}:${m.id}`.toLowerCase()));
  if (!newly.length) return;
  const refs = newly.map(m => `${m.type}:${m.id}`).join(', ');
  logger.warn(`[ai-catalog] a recommended model is retired: ${refs}`);
  const operators = (await storage.listOwners()).filter(isOperatorAccount);
  for (const o of operators) {
    await notify(storage, `${o.name}@${config.nodeId}`, {
      type: 'ai_model_retired',
      title: 'A model you recommend is no longer offered',
      body: `The model catalogue marks ${refs} as retired. Owners who chose the recommended models no longer get it; replace it in the recommended models on the Config tab (AI).`,
      link: '/v1/admin?tab=config',
    }).catch(err => logger.warn('[ai-catalog] could not tell an operator about a retired model', { operator: o.name, error: String(err) }));
  }
}

/** One refresh: fetch, merge, retire, write, and say what happened. Never throws. */
export async function refreshCatalog(storage: Storage, config: AimeatConfig): Promise<{ written: boolean; sources: BuiltCatalog['sources'] }> {
  const now = new Date().toISOString();
  const previous = catalogModels();
  const prevMeta = catalogMeta();
  try {
    const built = await buildCatalog(config, previous, now);
    const sources: CatalogMeta['sources'] = { ...(prevMeta?.sources ?? {}) };
    for (const [n, r] of Object.entries(built.sources) as Array<[SourceName, { count?: number; error?: string }]>) {
      const label = SOURCE_LABEL[n];
      sources[label] = r.error
        ? { ...(sources[label] ?? {}), lastError: { at: now, message: r.error.slice(0, 300) } }
        : { lastOkAt: now, count: r.count };
    }
    const meta: CatalogMeta = built.answered
      ? { snapshot: `catalog@${now}`, refreshedAt: now, origin: 'refresh', sources, sizes: prevMeta?.sizes ?? {} }
      : { ...(prevMeta ?? { snapshot: 'none', refreshedAt: now, origin: 'seed', sizes: {} }), sources };
    // With no source answering, only the meta changes: it records the failure against each source.
    await writeCatalog(storage, config, built.models, meta, built.answered ? undefined : []);
    if (built.answered) await tellOperatorsOfRetired(storage, config, previous, built.models);
    logger.info(`[ai-catalog] refreshed: ${built.models.length} models, ${built.answered} of 3 sources answered`);
    return { written: built.answered > 0, sources: built.sources };
  } catch (err) {
    logger.error('[ai-catalog] the refresh failed; the catalogue is as it was', { error: String(err) });
    return { written: false, sources: { modelsDev: {}, openRouter: {}, liteLlm: {} } };
  }
}
