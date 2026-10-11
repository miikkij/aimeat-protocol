/**
 * @file src/services/app-pacing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's pacing amount, in one place for every route and MCP tool that reads, writes or
 *   shows it. Ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa (2026-10-11): a
 *   morsel is pacing, never a price. An app's old morsel price `priceMorsels` is its pacing amount
 *   `tollMorsels` (REST `toll_morsels`): taking the app once (POST /v1/app-store/purchase) moves that
 *   many morsels through chargePacing, and the app has no money price.
 *
 *   Until MORSEL_PRICE_FIELDS_REMOVED_IN a write may still send the old `price_morsels` /
 *   `priceMorsels`, read as the pacing amount, and a manifest in a response still carries
 *   `priceMorsels` as a mirror with a `deprecated` note beside it. From that release both are gone and
 *   an old field is refused with 400 MORSEL_PRICE_REMOVED.
 * @structure appToll · appIsPaced · readAppTollInput · presentAppManifest
 * @usage
 *   const t = readAppTollInput(req.body);
 *   if (!t.ok) return res.status(400).json(error(config.nodeId, t.code, t.message));
 *   res.json(success(config.nodeId, { manifest: presentAppManifest(out.manifest) }));
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import type { AimeatConfig } from '../config.js';
import type { AppManifest } from '../storage/interface.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_DEPRECATION, MORSEL_PRICE_FIELDS_REMOVED_IN } from '../config-pacing.js';
import { TOLL_MORSELS_MAX } from '../models/offer-schemas.js';

/** The app's pacing amount in whole morsels; 0 when it has none. */
export function appToll(manifest: Pick<AppManifest, 'tollMorsels'> | null | undefined): number {
  const t = manifest?.tollMorsels;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
}

/**
 * True when opening this app needs it taken first: the app store is on and the app has a pacing
 * amount. The gates that answered "is this a paid app" ask this now.
 */
export function appIsPaced(config: Pick<AimeatConfig, 'marketplaceEnabled'>, manifest: Pick<AppManifest, 'tollMorsels'> | null | undefined): boolean {
  return !!config.marketplaceEnabled && appToll(manifest) > 0;
}

/** What a publish body said about the pacing amount. */
export type AppTollInput =
  | { ok: true; /** undefined = not mentioned (carry the live value forward); 0 = clear it. */ toll: number | undefined; legacy: boolean }
  | { ok: false; code: 'INVALID_INPUT' | 'MORSEL_PRICE_REMOVED'; message: string };

/** A body value as a whole number of morsels, or the reason it is not one. */
function morselsOf(name: string, v: unknown): number | string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${name} must be a whole number of morsels, 0 or more.`;
  return Math.floor(v);
}

/**
 * The pacing amount a publish body sets: `toll_morsels`, plus, while the old fields are live, the
 * deprecated `price_morsels` / `priceMorsels` added to it (a converted app keeps the same per-take
 * pacing it had), capped at TOLL_MORSELS_MAX. Nothing mentioned answers `toll: undefined`.
 */
export function readAppTollInput(body: Record<string, unknown> | null | undefined): AppTollInput {
  const b = body ?? {};
  const toll = morselsOf('toll_morsels', b.toll_morsels);
  if (typeof toll === 'string') return { ok: false, code: 'INVALID_INPUT', message: toll };
  const oldName = b.price_morsels !== undefined ? 'price_morsels' : b.priceMorsels !== undefined ? 'priceMorsels' : null;
  if (oldName && !legacyMorselFieldsLive()) {
    return {
      ok: false, code: 'MORSEL_PRICE_REMOVED',
      message: `${oldName} was removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}: a morsel is pacing, not a price. Send toll_morsels, the morsels of pacing taking this app moves.`,
    };
  }
  const legacy = oldName ? morselsOf(oldName, b[oldName]) : undefined;
  if (typeof legacy === 'string') return { ok: false, code: 'INVALID_INPUT', message: legacy };
  if (toll === undefined && legacy === undefined) return { ok: true, toll: undefined, legacy: false };
  return { ok: true, toll: Math.min((toll ?? 0) + (legacy ?? 0), TOLL_MORSELS_MAX), legacy: legacy !== undefined };
}

/** A manifest as a response shows it, with the 3.x mirror while it is live. */
export type PresentedAppManifest<T extends AppManifest> = T & { priceMorsels?: number; deprecated?: { priceMorsels: string } };

/**
 * The manifest as a response carries it: unchanged, plus, until MORSEL_PRICE_FIELDS_REMOVED_IN and
 * only when the app has a pacing amount, the deprecated `priceMorsels` with the same value and
 * `deprecated: { priceMorsels: MORSEL_PRICE_DEPRECATION }` beside it, so a 3.x client reading the old
 * key keeps working and learns what to read instead. A copy: the stored record is untouched.
 */
export function presentAppManifest<T extends AppManifest>(manifest: T): PresentedAppManifest<T> {
  const toll = appToll(manifest);
  if (toll <= 0 || !legacyMorselFieldsLive()) return manifest;
  return { ...manifest, priceMorsels: toll, deprecated: { priceMorsels: MORSEL_PRICE_DEPRECATION } };
}
