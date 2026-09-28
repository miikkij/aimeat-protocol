/**
 * @file scripts/ai-catalog-refresh.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes the model catalogue's seed, src/data/ai-catalog/seed.json, from the three public
 *   sources (System 2 plan, V4; docs/internal/llmproviderintegrations/06, section 4). Run before a
 *   release: the seed is what a fresh node, or a node without network, starts with, and a price that
 *   changed shows up as a diff a person reviews. The node's own weekly refresh uses the same
 *   normalizer (src/services/ai/catalog/refresh.ts); this script only writes the file.
 *
 *   The previous seed is the starting point, so the retirement rules count across runs as they do on
 *   a node: a model the sources dropped is retiring, then retired, then gone after 180 days. A source
 *   that does not answer fails the run: a seed is never written from part of the world.
 * @usage pnpm ai:catalog:refresh
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromModelsDev, fromOpenRouter, fromLiteLLM, mergeSources, applyLifecycle, groupByType, recordSize } from '../src/services/ai/catalog/normalize.js';
import { DEFAULT_SOURCE_URLS } from '../src/services/ai/catalog/sources.js';
import type { CatalogModel } from '../src/services/ai/catalog/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'src', 'data', 'ai-catalog', 'seed.json');

async function get(url: string): Promise<unknown> {
  const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  return resp.json() as Promise<unknown>;
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const [md, or, ll] = await Promise.all([get(DEFAULT_SOURCE_URLS.modelsDev), get(DEFAULT_SOURCE_URLS.openRouter), get(DEFAULT_SOURCE_URLS.liteLlm)]);
  const merged = mergeSources({ modelsDev: fromModelsDev(md, now), openRouter: fromOpenRouter(or, now), liteLlm: fromLiteLLM(ll, now) });
  const previous: CatalogModel[] = existsSync(SEED) ? (JSON.parse(readFileSync(SEED, 'utf8')) as { models: CatalogModel[] }).models : [];
  const models = applyLifecycle(previous, merged, now, true);
  mkdirSync(dirname(SEED), { recursive: true });
  // One model per line: a price change is a one-line diff a person can read.
  const body = `{\n"snapshot": ${JSON.stringify(`seed@${now}`)},\n"generatedAt": ${JSON.stringify(now)},\n"models": [\n${models.map(m => JSON.stringify(m)).join(',\n')}\n]\n}\n`;
  writeFileSync(SEED, body);
  const groups = groupByType(models);
  for (const [type, list] of Object.entries(groups)) {
    const size = recordSize(list ?? []);
    console.log(`${type.padEnd(11)} ${String(list?.length ?? 0).padStart(4)} models  ${(size / 1024).toFixed(1).padStart(6)} kB${size > 700 * 1024 ? '  OVER 700 kB: split this type by modality' : ''}`);
  }
  console.log(`wrote ${SEED} (${(body.length / 1024).toFixed(0)} kB, ${models.length} models)`);
}

main().catch(err => { console.error(err); process.exit(1); });
