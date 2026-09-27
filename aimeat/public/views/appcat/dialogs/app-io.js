/**
 * @file public/views/appcat/dialogs/app-io.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node calls and the small rules appcat's app dialogs share, so a dialog and a
 *   detail section that do the same act call one function: who is signed in and whether they are an
 *   operator, an app's raw bytes as text, restoring an old version as the newest, a server-side fork,
 *   staging bytes as the draft and opening it, publishing bytes through the draft slot, the anonymous
 *   token the extension popup reads with, and the words for the time between two publishes. The
 *   routes and bodies are the old catalogue's (features.md §6); nothing here keeps anything in the
 *   browser's own storage.
 * @structure me() · bareOwner(name) · sameOwner(a, b) · isOperator() · appHost() · appUrl(owner, file, sub) ·
 *   openPublished(url, row) · findRow(rows, owner, file) · apiWithToken(path, token) ·
 *   fetchAppText(owner, file, version) · textToB64(text) · restoreVersion({ owner, filename, version, manifest }) ·
 *   forkApp({ owner, filename, newName, version }) · FILENAME_RE · stagePreview(owner, file, text) ·
 *   openDraftPreview(owner, file) · publishText(owner, file, text) · anonymousToken() · signInThen(next) ·
 *   durUnits() · durationLabel(ms) · gapMs(a, b) · versionSinceText(versions, i) · versionSpanText(versions)
 * @usage import { fetchAppText, restoreVersion } from '/views/appcat/dialogs/app-io.js';
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2): carried over from the old catalogue's
 *     detail.js, server-io.js, cortex.js and util.js, with the same routes and bodies.
 */
import { api, apiPost, apiPut } from '/js/api.js';
import { getSession, authHeaders, showLoginModal, onAuthChange } from '/js/services/auth.js';
import { date } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';

/** The signed-in person's bare owner name, or null. */
export function me() { return getSession()?.owner || null; }

/** The bare account name of an owner id ("alice@node" → "alice"), lower case (features.md F351). */
export function bareOwner(name) { return String(name || '').split('@')[0].toLowerCase(); }

/** Whether two owner ids name the same account. */
export function sameOwner(a, b) { return !!b && !!bareOwner(a) && bareOwner(a) === bareOwner(b); }

/** Whether the session's JWT carries the operator role (the old page read it the same way, F321). */
export function isOperator() {
  const jwt = getSession()?.jwt;
  if (!jwt) return false;
  let payload = null;
  try {
    payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) {
    console.warn('[appcat] the session token could not be read for its roles', e);
  }
  return !!payload && Array.isArray(payload.roles) && payload.roles.includes('operator');
}

/** The host subdomain apps are served under: the node's own word when it gave one, else apps.<host>. */
export function appHost() {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  if (w.__APP_HOST) return w.__APP_HOST;
  return 'apps.' + location.host;
}

/** /v1/apps/{owner}/{file}[/{sub}] with both parts encoded. */
export function appUrl(owner, filename, sub) {
  return '/v1/apps/' + encodeURIComponent(owner || '') + '/' + encodeURIComponent(filename || '') + (sub ? '/' + sub : '');
}

/**
 * Open a published app (or one of its versions) in a new tab, top level, never framed (F113, F259).
 * The owner's own access-coded app gets its code appended from the listing row (`access_code`, which
 * only the owner's listing carries), so the owner does not land on the unlock page.
 */
export function openPublished(url, row) {
  let href = url;
  const code = row && row.access_code;
  if (code && !/[?&]code=/.test(href)) href += (href.includes('?') ? '&' : '?') + 'code=' + encodeURIComponent(code);
  window.open(href, '_blank', 'noopener');
}

/** The listing row for owner/filename in a list of rows (the store's `all`), or null. */
export function findRow(rows, owner, filename) {
  return (rows || []).find((r) => r && r.filename === filename && sameOwner(r.owner, owner)) || null;
}

/** An app's raw bytes (the newest, or `version`) as UTF-8 text; the owner's token goes with it. */
export async function fetchAppText(owner, filename, version) {
  const resp = await fetch(appUrl(owner, filename) + (version ? '?version=' + version : ''), { headers: authHeaders() });
  if (!resp.ok) throw new Error(x('io.fetchFailed', { status: resp.status }));
  return new TextDecoder('utf-8').decode(await resp.arrayBuffer());
}

/** Text as base64 of its UTF-8 bytes, in chunks so a large app does not overflow the stack. */
export function textToB64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Re-publish an old version as the newest (F127, F191): download that version, then POST /v1/apps
 * with the listing's manifest words, so the name, the descriptions, the category, the tags, the
 * extensions it uses and the icon stay what they were. Resolves to the reply's data.
 */
export async function restoreVersion({ owner, filename, version, manifest }) {
  const meta = manifest || {};
  const text = await fetchAppText(owner, filename, version);
  const body = {
    filename,
    content: textToB64(text),
    mime_type: 'text/html',
    name: meta.name || filename.replace(/\.html?$/i, ''),
    description: meta.description || '',
    descriptions: meta.descriptions || null,
    category: meta.category || 'utility',
    tags: meta.tags || [],
    uses_cortex: meta.usesCortex || [],
  };
  if (meta.icon) body.icon = meta.icon;
  const json = await apiPost('/v1/apps', body);
  return json.data || {};
}

/** The filename rule of the node (F128, F133). */
export const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** Server-side fork (F204): the node copies the bytes and records where they came from. */
export async function forkApp({ owner, filename, newName, version }) {
  const body = { new_filename: newName };
  if (version) body.version = version;
  const json = await apiPost(appUrl(owner, filename, 'fork'), body);
  return json.data || {};
}

/** Open the saved draft on its real address in a new tab (F114, F211). */
export async function openDraftPreview(owner, filename) {
  const json = await apiPost(appUrl(owner, filename, 'draft/preview-token'), {});
  window.open(json.data.preview_url, '_blank', 'noopener');
}

/** Stage the text as the draft, then open it in a new tab (F143 "Try it safely", F209 + F211). */
export async function stagePreview(owner, filename, text) {
  await apiPut(appUrl(owner, filename, 'draft'), { content: textToB64(text) });
  await openDraftPreview(owner, filename);
}

/** Stage the text as the draft and publish that draft as the new version (F143, F212). */
export async function publishText(owner, filename, text) {
  await apiPut(appUrl(owner, filename, 'draft'), { content: textToB64(text) });
  const json = await apiPost(appUrl(owner, filename, 'publish-draft'), {});
  return json.data || {};
}

let anon = null;
/** An anonymous token, minted once per page (F244): the extension popup reads with it, as before. */
export async function anonymousToken() {
  if (anon) return anon;
  try {
    const resp = await fetch('/v1/auth/anonymous', { method: 'POST' });
    const json = await resp.json();
    anon = json?.data?.token || null;
  } catch (e) {
    console.warn('[appcat] no anonymous token', e);
    anon = null;
  }
  return anon;
}

/** Run `next` now when signed in; otherwise open the sign-in dialog and run it after the sign-in. */
export function signInThen(next) {
  if (getSession()) { next(); return; }
  let off = null;
  off = onAuthChange((session) => { if (session) { off?.(); next(); } });
  if (!showLoginModal({})) { off?.(); next(); }
}

/** A JSON call with a bearer token of the caller's choosing (the anonymous one), envelope checked. */
export async function apiWithToken(path, token) {
  const resp = await fetch(path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const json = await resp.json();
  if (!json || json.ok === false) throw new Error(json?.error?.message || json?.error?.code || 'HTTP ' + resp.status);
  return json;
}

/** Re-export of the site's api() for the dialogs that call a route with a method (DELETE, PATCH). */
export { api };

// ── The time between publishes (F139, F312) ──────────────────────────────────────────────────────

/** The duration units in the page language. */
export function durUnits() { return { s: x('dur.s'), min: x('dur.min'), h: x('dur.h'), d: x('dur.d') }; }

/** The milliseconds from the earlier stamp to the later one, or 0 when they say nothing. */
export function gapMs(laterIso, earlierIso) {
  if (!laterIso || !earlierIso) return 0;
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!isFinite(later) || !isFinite(earlier) || later <= earlier) return 0;
  return later - earlier;
}

/** A length of time at the coarsest unit that still says something ('' for nothing). */
export function durationLabel(ms) {
  const u = durUnits();
  if (!(ms > 0)) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + ' ' + u.s;
  const minutes = Math.floor(seconds / 60);
  const restS = seconds % 60;
  if (minutes < 60) return restS ? `${minutes} ${u.min} ${restS} ${u.s}` : `${minutes} ${u.min}`;
  const hours = Math.floor(minutes / 60);
  const restM = minutes % 60;
  if (hours < 24) return restM ? `${hours} ${u.h} ${restM} ${u.min}` : `${hours} ${u.h}`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days} ${u.d} ${restH} ${u.h}` : `${days} ${u.d}`;
}

/** " · since the previous one 1 min 53 s" for one row of a newest-first list, or ''. */
export function versionSinceText(versions, i) {
  const prev = versions[i + 1];
  if (!prev) return '';
  const label = durationLabel(gapMs(versions[i].created_at, prev.created_at));
  return label ? ' · ' + x('versions.sincePrev') + ' ' + label : '';
}

/** " · 9/1/2026 – 9/27/2026 · first to last: 26 d" over a newest-first list, or ''. */
export function versionSpanText(versions) {
  if (versions.length < 2) return '';
  const newest = versions[0].created_at;
  const oldest = versions[versions.length - 1].created_at;
  if (!newest || !oldest) return '';
  const first = date(oldest);
  const last = date(newest);
  const when = first === last ? first : first + ' – ' + last;
  const span = durationLabel(gapMs(newest, oldest));
  return ' · ' + when + (span ? ' · ' + x('versions.span') + ' ' + span : '');
}
