/**
 * @file src/storage/app-manifest-pacing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app manifest as both storage providers hand it out: a morsel PRICE stored before
 *   ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa (2026-10-11), under the old
 *   key `priceMorsels`, is read as the app's pacing amount `tollMorsels`. A morsel is pacing, never a
 *   price, so an app that "cost" N morsels is now free (until it gets a money price) with N morsels of
 *   pacing. The manifest is a JSON document on both backends, so this needs no migration: every read
 *   of a manifest (live app, listing row, draft, purchase receipt snapshot) passes through here, and a
 *   record written by 3.26.1 reads the same as one written today.
 * @structure normalizeAppManifestPacing(manifest)
 * @usage manifest: normalizeAppManifestPacing(JSON.parse(row.manifest))
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import type { AppManifest } from './types/apps.js';
import { TOLL_MORSELS_MAX } from '../models/offer-schemas.js';

/**
 * The manifest with any stored `priceMorsels` folded into `tollMorsels` (old value added to a
 * declared toll, capped at TOLL_MORSELS_MAX) and the old key removed. A manifest without the old key
 * comes back as the same object. Never throws: a non-object passes through untouched.
 */
export function normalizeAppManifestPacing<T extends AppManifest | null | undefined>(manifest: T): T {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const raw = manifest as AppManifest & { priceMorsels?: unknown };
  if (!Object.hasOwn(raw, 'priceMorsels')) return manifest;
  const { priceMorsels: legacy, ...rest } = raw;
  const old = typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0 ? Math.floor(legacy) : 0;
  const declared = typeof rest.tollMorsels === 'number' && rest.tollMorsels > 0 ? Math.floor(rest.tollMorsels) : 0;
  const toll = Math.min(declared + old, TOLL_MORSELS_MAX);
  const out = { ...rest } as AppManifest;
  if (toll > 0) out.tollMorsels = toll;
  else delete out.tollMorsels;
  return out as T;
}
