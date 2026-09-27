/**
 * @file public/views/appcat/sections/app-write.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the detail sections of detail builder B share: the one write to an app record
 *   (PATCH /v1/apps/{filename}, the route the old catalogue's Manage, Search, Marks and Legal wrote
 *   through), a date in the page's language, the words of a refusal, and whether the signed-in
 *   person is an operator (the subdomain door). Not a section: the shell loads only the section ids
 *   it knows.
 * @structure patchApp(filename, body) · dateText(iso) · errorText(err, fallback) · noticeKind(text) · isOperator()
 * @usage import { patchApp, dateText } from './app-write.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — noticeKind(text): the kind the old page gave a notice from its words
 *     (appcat parity, sections-c).
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder B).
 */
import { apiPatch } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { date } from '/js/format.js';

/**
 * Write to the signed-in person's own app. Resolves to the answer's data (the state after the write
 * and the server's `note`); a refusal throws with the server's words.
 * @param {string} filename @param {object} body
 */
export async function patchApp(filename, body) {
  const res = await apiPatch('/v1/apps/' + encodeURIComponent(filename), body);
  return (res && res.data) || {};
}

/**
 * A date in the reader's own format, as the site writes every date (/js/format.js: the regional
 * format is the reader's setting, not the page's language); '' for no date.
 */
export function dateText(iso) {
  if (!iso) return '';
  return Number.isNaN(new Date(iso).getTime()) ? '' : date(iso);
}

/** The words of a refusal: the server's own, else the section's fallback. */
export function errorText(err, fallback) {
  const m = err && err.message ? String(err.message) : '';
  return m || fallback || String(err || '');
}

/**
 * The kind of a notice as the old page chose it from the words when a part gave none (its ui.js
 * showNotice): a failure's words are an error, a done thing's a success, anything else a plain
 * notice. Search, Marks and Legal gave none, so "Write the page first" was a plain notice and a
 * server's note took the kind its words carry (added by appcat sections-c, parity).
 */
export function noticeKind(text) {
  const s = String(text ?? '');
  if (/\b(fail|failed|error|invalid|denied|unable|not found|wrong|expired)\b/i.test(s)) return 'error';
  if (/\b(copied|done|success|saved|cleared|removed|imported|updated|added)\b/i.test(s)) return 'success';
  return 'info';
}

/** Whether the signed-in person is an operator of this node (the JWT's roles carry 'operator'). */
export function isOperator() {
  const jwt = getSession()?.jwt;
  if (!jwt) return false;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Array.isArray(payload.roles) && payload.roles.includes('operator');
  // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable token means no operator door
  } catch { return false; }
}
