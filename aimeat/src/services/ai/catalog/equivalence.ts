/**
 * @file equivalence.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which ids name one model across provider types (System 2 plan, V4; plan 11,
 *   section 6): a call that named `anthropic:claude-opus-5-5` may fall back only to that same model,
 *   and OpenRouter lists it as `anthropic/claude-opus-5.5`. Both reduce to one key: the id without
 *   its vendor prefix, lower-cased, dots as dashes, a trailing date left out. Only models the
 *   catalogue lists are matched, so a key never invents a model.
 * @structure canonicalModelKey · equivalentModels
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { catalogModels } from './store.js';
import type { CatalogModel } from './types.js';

/** `anthropic/claude-opus-5.5` and `claude-opus-5-5` → `claude-opus-5-5`; `…-20260921` loses the date. */
export function canonicalModelKey(id: string): string {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return bare.toLowerCase().replace(/:free$/, '').replace(/\./g, '-').replace(/-20\d{6}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/** The catalogued models on OTHER types that are the same model as `type:id`, not retired. */
export function equivalentModels(type: string, id: string): CatalogModel[] {
  const key = canonicalModelKey(id);
  return catalogModels().filter(m => m.type !== type && m.status !== 'retired' && canonicalModelKey(m.id) === key);
}
