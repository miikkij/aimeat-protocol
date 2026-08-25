/**
 * @file src/services/surface-layout/keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a surface layout and its passages are stored, and which keys this feature
 *   claims. Deliberately dependency-free: site.ts has to refuse these keys on its own memory doors,
 *   and the layout service has to store under them, so putting the strings in either one of those
 *   files would make the two import each other.
 *
 *   TWO PREFIXES, FOR ONE REASON. `portal/` is served to anyone: GET /v1/site/sync takes no auth and
 *   returns every key under it WITH its value, and site writes are visibility 'public'. The layout
 *   can live there — it is a list of block names, and the portal's is a public page anyway. The
 *   free-form BODIES cannot: on a department's home they are that department's own words. They go
 *   under `site/` at visibility 'owner', which the sync sweep does not match.
 * @structure LAYOUT_KEY_PREFIX · FREEFORM_KEY_PREFIX · layoutKey · freeformKey · isReservedSurfaceKey
 * @usage
 *   import { isReservedSurfaceKey } from './surface-layout/keys.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial, split out of service.ts so site.ts can guard without a cycle.
 */
import type { SurfaceId } from './types.js';

/** Where a surface's layout lives. Under `portal/` so the mirror and the import bundle carry it. */
export const LAYOUT_KEY_PREFIX = 'portal/layout.';

/** Where a free-form body lives. NOT under `portal/`, because that prefix is served without auth. */
export const FREEFORM_KEY_PREFIX = 'site/free.';

/** The key for one surface's layout. */
export function layoutKey(surface: SurfaceId): string {
    return `${LAYOUT_KEY_PREFIX}${surface}`;
}

/** The key for one free-form body. */
export function freeformKey(slug: string): string {
    return `${FREEFORM_KEY_PREFIX}${slug}`;
}

/**
 * Whether a key belongs to this feature and must not be written or deleted through the generic
 * portal-memory doors. Without this an operator clears their node's home by pressing the delete
 * cross beside a JSON blob they do not recognise in the admin Memory Keys card — and the import
 * bundle, which writes `portal/*` keys straight through, would be a second way past the validator.
 */
export function isReservedSurfaceKey(key: string): boolean {
    return key.startsWith(LAYOUT_KEY_PREFIX) || key.startsWith(FREEFORM_KEY_PREFIX);
}
