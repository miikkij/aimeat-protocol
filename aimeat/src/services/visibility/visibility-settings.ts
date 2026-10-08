/**
 * @file src/services/visibility/visibility-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's visibility settings, one record (`signals.visibility.settings`): whether
 *   the place counts at all (layer A), and the analytics tags the owner already uses that the place
 *   adds to its pages (layer B: a Microsoft Clarity project id, a Google Analytics 4 measurement id).
 *
 *   READ ON EVERY PAGE SERVE, SO IT IS CACHED. A change made on this process is seen at once; one
 *   made on another process within SETTINGS_TTL_MS.
 *
 *   THE IDS ARE CHECKED AGAINST THEIR SHAPE before they are stored, because they are written into
 *   every page the owner serves as part of a script. Only letters and digits reach the page.
 * @structure CLARITY_ID_RE · GA4_ID_RE · getVisibilitySettings · setVisibilitySettings ·
 *   cachedVisibilitySettings · VisibilitySettingsError · resetVisibilitySettingsCache (tests)
 * @usage const s = await cachedVisibilitySettings(storage, ownerGhii); if (s.enabled) …
 * @version-history
 *   v1.0.0 — 2026-10-08 — Moved out of visibility-counter.ts, with the tag ids of layer B.
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { VISIBILITY_SETTINGS_KEY, type VisibilitySettings } from '../../models/visibility-schemas.js';

/** How long settings are trusted from memory. */
const SETTINGS_TTL_MS = 60_000;

/** A Clarity project id: ten or so lower-case letters and digits (`k7x2m9qp1a`). */
export const CLARITY_ID_RE = /^[a-z0-9]{6,20}$/;
/** A GA4 measurement id: `G-` and letters and digits (`G-ABC123XYZ9`). */
export const GA4_ID_RE = /^G-[A-Z0-9]{4,20}$/;

export class VisibilitySettingsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'VisibilitySettingsError';
  }
}

interface Cached { settings: VisibilitySettings; until: number }
const cache = new Map<string, Cached>();

const nowIso = (): string => new Date().toISOString();

function normalize(value: Partial<VisibilitySettings> | undefined): VisibilitySettings {
  return {
    enabled: value?.enabled !== false,
    clarityProjectId: typeof value?.clarityProjectId === 'string' && CLARITY_ID_RE.test(value.clarityProjectId) ? value.clarityProjectId : null,
    ga4MeasurementId: typeof value?.ga4MeasurementId === 'string' && GA4_ID_RE.test(value.ga4MeasurementId) ? value.ga4MeasurementId : null,
    updatedAt: value?.updatedAt ?? '',
  };
}

/** The owner's settings, read from storage. Absent means on, with no tags. */
export async function getVisibilitySettings(storage: Storage, ownerGhii: string): Promise<VisibilitySettings> {
  const row = await storage.getMemory(ownerGhii, VISIBILITY_SETTINGS_KEY);
  return normalize(row?.value as Partial<VisibilitySettings> | undefined);
}

export interface VisibilitySettingsInput {
  enabled?: boolean;
  /** A string sets the id, null removes it, absent keeps it. */
  clarityProjectId?: string | null;
  ga4MeasurementId?: string | null;
}

/**
 * Change the owner's settings. Only the fields given change. An id of the wrong shape is refused
 * before anything is written.
 */
export async function setVisibilitySettings(
  storage: Storage, ownerGhii: string, input: VisibilitySettingsInput,
): Promise<VisibilitySettings> {
  const clarity = typeof input.clarityProjectId === 'string' ? input.clarityProjectId.trim().toLowerCase() : input.clarityProjectId;
  const ga4 = typeof input.ga4MeasurementId === 'string' ? input.ga4MeasurementId.trim().toUpperCase() : input.ga4MeasurementId;
  if (typeof clarity === 'string' && clarity !== '' && !CLARITY_ID_RE.test(clarity)) {
    throw new VisibilitySettingsError('INVALID_INPUT', 'clarity_project_id is the project id from Clarity\'s Settings > Overview: 6 to 20 letters and digits.');
  }
  if (typeof ga4 === 'string' && ga4 !== '' && !GA4_ID_RE.test(ga4)) {
    throw new VisibilitySettingsError('INVALID_INPUT', 'ga4_measurement_id is the Measurement ID of a GA4 web data stream, such as G-ABC123XYZ9.');
  }
  const existingRow = await storage.getMemory(ownerGhii, VISIBILITY_SETTINGS_KEY);
  const existing = normalize(existingRow?.value as Partial<VisibilitySettings> | undefined);
  const now = nowIso();
  const settings: VisibilitySettings = {
    enabled: input.enabled ?? existing.enabled,
    clarityProjectId: clarity === undefined ? existing.clarityProjectId : (clarity || null),
    ga4MeasurementId: ga4 === undefined ? existing.ga4MeasurementId : (ga4 || null),
    updatedAt: now,
  };
  await storage.setMemory({
    key: VISIBILITY_SETTINGS_KEY, ownerGaii: ownerGhii,
    value: settings as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['signal-visibility'], ttlHours: null,
    version: (existingRow?.version ?? 0) + 1, createdAt: existingRow?.createdAt ?? now, updatedAt: now,
  } as MemoryRecord);
  cache.set(ownerGhii, { settings, until: Date.now() + SETTINGS_TTL_MS });
  return settings;
}

/** The owner's settings from memory when fresh, from storage otherwise. For the serve paths. */
export async function cachedVisibilitySettings(storage: Storage, ownerGhii: string): Promise<VisibilitySettings> {
  const hit = cache.get(ownerGhii);
  if (hit && hit.until > Date.now()) return hit.settings;
  const settings = await getVisibilitySettings(storage, ownerGhii);
  if (cache.size > 10_000) cache.clear();
  cache.set(ownerGhii, { settings, until: Date.now() + SETTINGS_TTL_MS });
  return settings;
}

/** Test seam. */
export function resetVisibilitySettingsCache(): void {
  cache.clear();
}
