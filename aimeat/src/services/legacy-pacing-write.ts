/**
 * @file src/services/legacy-pacing-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 4.0.0 refusal of the old morsel price on the generic memory write routes, for the
 *   two listing sources stored as memory: an app's tool manifest (`apps.{app}.tools`, a tool's
 *   `price.morsels`) and an agent's offers document (`agents.{agent}.offers`, an offer's `price`).
 *
 *   WHY. From MORSEL_PRICE_FIELDS_REMOVED_IN (src/config-pacing.ts) the node refuses the old morsel
 *   price fields, and the dedicated routes did: aimeat_app_tools_publish (legacyToolPriceRefusal) and
 *   PUT /v1/agents/:name/offers answered 400 MORSEL_PRICE_REMOVED. The same document written through
 *   POST, PUT or PATCH /v1/memory or the bulk routes was stored, and the EXCHANGE projection then read
 *   the old field as pacing. A removed field is removed on every route or it is not removed (security
 *   DNA invariant: a rule is enforced on every route). Before 4.0.0 this returns null and the write
 *   goes on, as the dedicated routes accept the field as pacing there.
 * @structure LegacyPacingWriteRefusal · legacyPacingWriteRefusal(key, value)
 * @usage
 *   const legacy = legacyPacingWriteRefusal(key, value);
 *   if (legacy) return res.status(legacy.status).json(error(config.nodeId, legacy.code, legacy.message));
 *
 *   A knowledge package manifest (`packages/{id}/manifest`) is checked here too: its
 *   `sharing.morsel_price` is the deprecated name of `sharing.toll_morsels` (counted, refused only on a
 *   mismatch or from MORSEL_PRICE_NAMES_REMOVED_IN; services/toll-morsels-names.ts).
 * @version-history
 *   v1.1.0 — 2026-10-13 — A knowledge package manifest's sharing.morsel_price is counted as a deprecated
 *     use and a mismatch with sharing.toll_morsels is refused
 *     (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   v1.0.0 — 2026-10-12 — Initial (the 4.0.0 sweep).
 */
import { MORSEL_PRICE_FIELDS_REMOVED_IN, legacyMorselFieldsLive } from '../config-pacing.js';
import { legacyToolPriceRefusal } from '../models/app-tool-schemas.js';
import { normalizeKnowledgeSharing, type TollNameRefusal } from './toll-morsels-names.js';

export interface LegacyPacingWriteRefusal {
  ok: false;
  status: 400;
  code: 'MORSEL_PRICE_REMOVED' | TollNameRefusal['code'];
  message: string;
}

const record = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/**
 * The refusal for writing `value` under `key` when it carries the old morsel price on a node that no
 * longer takes it, or null. Any key other than the two listing sources and a knowledge package
 * manifest returns null at once.
 */
export function legacyPacingWriteRefusal(key: string, value: unknown): LegacyPacingWriteRefusal | null {
  // A knowledge package manifest written as plain memory (the MCP packager prompt writes it with
  // aimeat_memory_write): its sharing.morsel_price is the deprecated name of sharing.toll_morsels.
  // The value is stored as the person wrote it; the use is counted with the Deprecation headers, two
  // names that disagree are refused, and MORSEL_PRICE_NAMES_REMOVED_IN refuses the old name.
  if (/^packages\/[^/]+\/manifest$/.test(key)) {
    const sharing = normalizeKnowledgeSharing(record(value)?.sharing);
    return sharing.ok ? null : sharing;
  }
  const isTools = /^apps\..+\.tools$/.test(key);
  const isOffers = /^agents\..+\.offers$/.test(key);
  if ((!isTools && !isOffers) || legacyMorselFieldsLive()) return null;
  const doc = record(value);
  if (isTools) {
    const tools = Array.isArray(doc?.tools) ? doc!.tools as Array<{ name?: string; price?: { morsels?: number } | null }> : [];
    const refusal = legacyToolPriceRefusal({ tools });
    return refusal ? { ok: false, ...refusal } : null;
  }
  const offers = Array.isArray(doc?.offers) ? doc!.offers as Array<Record<string, unknown>> : [];
  const named = offers.filter(o => record(o)?.price !== undefined && o.price !== null).map(o => String(o.id ?? '?'));
  if (!named.length) return null;
  return {
    ok: false, status: 400, code: 'MORSEL_PRICE_REMOVED',
    message: `price.morsels was removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}: a morsel is pacing, not a price. `
      + `Set tollMorsels (the pacing amount per use) and priceMoney on: ${named.join(', ')}.`,
  };
}
