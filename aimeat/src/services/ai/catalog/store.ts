/**
 * @file store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the model catalogue lives and how a call reads it (System 2 plan, V4;
 *   docs/internal/llmproviderintegrations/06, section 3).
 *
 *   MEMORY RECORDS, ONE PER PROVIDER TYPE, no table: `ai.catalog.<type>` and `ai.catalog.meta` under
 *   the node's own identity `system@<nodeId>`, where the node keeps its other shared records (the
 *   manifest schema, the template bundles, the compliance register). A type is always read whole,
 *   which is what one record is for (.claude/rules/namespaces-memory.md). Measured 2026-09-28: the
 *   largest, OpenRouter, is well under the 1024 kB value limit; a refresh warns at 700 kB.
 *
 *   READ ONCE PER PROCESS. loadCatalog() fills a process cache at boot and after each refresh, so a
 *   call never reads the database for the catalogue (plan 06, section 3). A fresh node, or a node
 *   whose records are gone, writes the seed the build shipped with (src/data/ai-catalog/seed.json),
 *   creating only what is missing, as the other seeders do; a node without network works on the seed.
 * @structure catalogKey · META_KEY · loadCatalog · writeCatalog · catalogModel · catalogModels ·
 *   catalogMeta · catalogSnapshot · readSeed
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import { upsertPrivateRecord } from '../../private-record.js';
import { emitChange } from '../../event-bus.js';
import { logger } from '../../../utils/logger.js';
import { CATALOG_TYPES, type CatalogMeta, type CatalogModel, type CatalogRecord, type CatalogType } from './types.js';

export const catalogKey = (type: CatalogType): string => `ai.catalog.${type}`;
export const META_KEY = 'ai.catalog.meta';
const systemOf = (config: AimeatConfig): string => `system@${config.nodeId}`;

/** The seed the build ships: `{ snapshot, generatedAt, models }`, written by `pnpm ai:catalog:refresh`. */
export interface CatalogSeed { snapshot: string; generatedAt: string; models: CatalogModel[] }

const SEED_URL = new URL('../../../data/ai-catalog/seed.json', import.meta.url);

/** The seed in the repo, or null when a build shipped without it (the node then has an empty catalogue). */
export function readSeed(): CatalogSeed | null {
  const path = fileURLToPath(SEED_URL);
  if (!existsSync(path)) { logger.warn('[ai-catalog] no seed file in this build', { path }); return null; }
  try {
    const seed = JSON.parse(readFileSync(path, 'utf8')) as CatalogSeed;
    return Array.isArray(seed.models) ? seed : null;
  } catch (err) {
    logger.error('[ai-catalog] the seed file does not parse; the catalogue starts empty', { error: String(err) });
    return null;
  }
}

// ── the process cache ───────────────────────────────────────────────────────────────────────────

const byType = new Map<CatalogType, Map<string, CatalogModel>>();
let meta: CatalogMeta | null = null;

function cache(models: CatalogModel[], m: CatalogMeta | null): void {
  byType.clear();
  for (const t of CATALOG_TYPES) byType.set(t, new Map());
  for (const model of models) byType.get(model.type)?.set(model.id, model);
  meta = m;
}

/** One model, or undefined. Case-sensitive on the id, as the provider writes it; a second try lower-cased. */
export function catalogModel(type: string, id: string): CatalogModel | undefined {
  const t = byType.get(type as CatalogType);
  if (!t) return undefined;
  return t.get(id) ?? [...t.values()].find(m => m.id.toLowerCase() === id.toLowerCase());
}

/** Every model the cache holds, optionally of some types. */
export function catalogModels(types?: readonly CatalogType[]): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const t of types ?? CATALOG_TYPES) out.push(...(byType.get(t)?.values() ?? []));
  return out;
}

export function catalogMeta(): CatalogMeta | null { return meta; }

/** The id a catalogue-priced usage row cites. */
export function catalogSnapshot(): string | null { return meta?.snapshot ?? null; }

// ── the records ─────────────────────────────────────────────────────────────────────────────────

/**
 * Read the records into the process cache, writing the seed for any type that has none. Called at
 * boot; never throws, because a node starts whatever its catalogue holds.
 */
export async function loadCatalog(storage: Storage, config: AimeatConfig): Promise<void> {
  try {
    const [rows, metaRec] = await Promise.all([
      Promise.all(CATALOG_TYPES.map(t => storage.getMemory(systemOf(config), catalogKey(t)))),
      storage.getMemory(systemOf(config), META_KEY),
    ]);
    const missing = CATALOG_TYPES.filter((_t, i) => !rows[i]);
    let models = rows.flatMap(r => ((r?.value as unknown as CatalogRecord | undefined)?.models ?? []));
    let m = (metaRec?.value as unknown as CatalogMeta | undefined) ?? null;
    if (missing.length) {
      const seed = readSeed();
      if (seed) {
        const seeded = seed.models.filter(x => missing.includes(x.type));
        await writeCatalog(storage, config, seeded, m ?? {
          snapshot: seed.snapshot, refreshedAt: seed.generatedAt, origin: 'seed', sources: {}, sizes: {},
        }, missing);
        models = [...models.filter(x => !missing.includes(x.type)), ...seeded];
        m = catalogMeta();
        logger.info(`[ai-catalog] seeded ${seeded.length} models for ${missing.join(', ')}`);
      }
    }
    cache(models, m);
  } catch (err) {
    logger.error('[ai-catalog] the catalogue could not be read; calls price without it until the next refresh', { error: String(err) });
  }
}

/**
 * Write the records for `types` (all types by default) and the meta, and refresh the process cache.
 * One write per type: a type is read whole, so it is written whole.
 */
export async function writeCatalog(
  storage: Storage, config: AimeatConfig, models: CatalogModel[], m: CatalogMeta,
  types: readonly CatalogType[] = CATALOG_TYPES,
): Promise<void> {
  const now = new Date().toISOString();
  const sizes: CatalogMeta['sizes'] = { ...m.sizes };
  for (const t of types) {
    const record: CatalogRecord = { type: t, models: models.filter(x => x.type === t), updatedAt: now };
    const size = JSON.stringify(record).length;
    sizes[t] = size;
    if (size > 700 * 1024) logger.warn(`[ai-catalog] ai.catalog.${t} is ${Math.round(size / 1024)} kB; split it by modality before it reaches the 1024 kB limit`);
    await upsertPrivateRecord(storage, systemOf(config), catalogKey(t), record, ['ai', 'catalog']);
  }
  const nextMeta: CatalogMeta = { ...m, sizes };
  await upsertPrivateRecord(storage, systemOf(config), META_KEY, nextMeta, ['ai', 'catalog']);
  // The cache holds every type; the types not written keep what the cache had.
  const kept = catalogModels().filter(x => !types.includes(x.type));
  cache([...kept, ...models.filter(x => types.includes(x.type))], nextMeta);
  emitChange('ai-catalog');
}
