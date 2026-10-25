/**
 * @file public/views/profile/inbox-tab/overview-cache.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Messages page's last overview, kept in this browser so the list is drawn the moment
 *   the page opens and replaced when GET /v1/messages/overview answers. One copy per signed-in
 *   identity, under PRIVATE_COPY_PREFIX, so services/auth.js removes it on sign-out. A copy that
 *   cannot be read or written is no copy: the page then waits for the server as it did before.
 * @structure readCachedOverview() · saveCachedOverview(data)
 * @usage const cached = readCachedOverview(); if (cached) apply(cached); … saveCachedOverview(fresh);
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial: the list drew only after a 3.5 s overview on aimeat.io.
 */
import { getGhii, PRIVATE_COPY_PREFIX } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

// Bumped when the overview's shape changes, so an old copy is never applied to a new page.
const SHAPE = 1;
// A copy larger than this is not kept: localStorage is about 5 MB for the whole origin.
const MAX_CHARS = 1_500_000;

const keyFor = (ghii) => `${PRIVATE_COPY_PREFIX}inbox-overview.${ghii}`;

/** The last overview this identity saw in this browser, or null. */
export function readCachedOverview() {
  const ghii = getGhii();
  if (!ghii) return null;
  try {
    const raw = localStorage.getItem(keyFor(ghii));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved?.shape === SHAPE && saved.ghii === ghii && saved.data ? saved.data : null;
  } catch (err) {
    swallowed('overview-cache: read', err);
    return null;
  }
}

/** Keep `data` (a GET /v1/messages/overview answer) as this identity's copy. */
export function saveCachedOverview(data) {
  const ghii = getGhii();
  if (!ghii || !data) return;
  try {
    const raw = JSON.stringify({ shape: SHAPE, ghii, savedAt: new Date().toISOString(), data });
    if (raw.length > MAX_CHARS) { localStorage.removeItem(keyFor(ghii)); return; }
    localStorage.setItem(keyFor(ghii), raw);
  } catch (err) {
    swallowed('overview-cache: save', err);
  }
}
