/**
 * @file public/js/services/internet-opening.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The calls of an app opened to the internet on a closed node (src/routes/internet-opening.ts),
 *   as thin wrappers over the shared api.js helpers. The operator's side (the list, a decision, a close,
 *   the owners trusted to open on their own) serves the admin page "Open to the internet"
 *   (views/admin/internet-openings-tab.js); the owner's side (one app's opening: read, open or ask,
 *   close or withdraw) serves the app detail's section (views/appcat/sections/internet.js). Every call
 *   resolves to the AIMEAT envelope and throws on a refusal, with the server's `code` on the error.
 * @structure getInternetOpenings · decideInternetOpening · closeInternetOpening · setInternetOpener ·
 *   removeInternetOpener · getAppInternetOpening · openAppToInternet · closeAppToInternet
 * @usage import { getInternetOpenings } from '/js/services/internet-opening.js';
 *        const r = await getInternetOpenings(); r.data.openings
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

const enc = encodeURIComponent;
const appPath = (owner, filename) => `/v1/apps/${enc(owner)}/${enc(filename)}/internet-opening`;

// ── The operator's side ──
/** The node's list: mode, max_days, counts, openings and the trusted owners. `state` narrows it. */
export const getInternetOpenings = (state) => apiGet('/v1/admin/internet-openings' + (state ? `?state=${enc(state)}` : ''));
/** Approve or decline what waits: `which` is 'request' (open or extend) or 'forms'; a decline names its note. */
export const decideInternetOpening = (owner, filename, { decision, note, which }) =>
  apiPost(`/v1/admin/internet-openings/${enc(owner)}/${enc(filename)}/decision`, { decision, ...(note ? { note } : {}), ...(which ? { which } : {}) });
/** Close any opening; the reason is optional and the owner reads it. */
export const closeInternetOpening = (owner, filename, reason) =>
  apiPost(`/v1/admin/internet-openings/${enc(owner)}/${enc(filename)}/close`, reason ? { reason } : {});
/** Trust an owner to open apps without asking, with a reason and an optional end date (YYYY-MM-DD). */
export const setInternetOpener = (owner, reason, until) =>
  apiPut(`/v1/admin/internet-openers/${enc(owner)}`, { reason, ...(until ? { until } : {}) });
/** Take that trust back; what the owner opened stays open. */
export const removeInternetOpener = (owner) => apiDelete(`/v1/admin/internet-openers/${enc(owner)}`);

// ── The owner's side ──
/** One app's opening for its owner: mode, max_days, may_open_directly, opens_under, declared_forms, opening. */
export const getAppInternetOpening = (owner, filename) => apiGet(appPath(owner, filename));
/** Open, ask an operator, or extend: 200 opened/extended, 202 requested/extend_requested. */
export const openAppToInternet = (owner, filename, reason, days) =>
  apiPost(appPath(owner, filename), { reason, ...(days ? { days } : {}) });
/** Close the opening, or withdraw a request that waits. */
export const closeAppToInternet = (owner, filename, reason) =>
  apiDelete(appPath(owner, filename) + (reason ? `?reason=${enc(reason)}` : ''));
