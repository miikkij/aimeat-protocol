/**
 * @file src/services/app-display-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule for an app's display version (`manifest.version`, the "1.4.0" a
 *   catalogue card and aimeat_app_manage { action: "versions" } show), and the refusal for a value
 *   that breaks it.
 *
 *   The display version is a label, separate from the version NUMBER the node counts up on every
 *   publish. The caller states it on a publish (`version` on POST /v1/apps and aimeat_app_publish)
 *   or on the draft (`version` on PUT .../draft, POST .../publish-draft, aimeat_app_draft_save and
 *   aimeat_app_draft_publish). Every one of those code paths asks this function, so a value refused
 *   on one is refused on all of them.
 *
 *   THE RULE IS NARROW ON PURPOSE AND ONLY JUDGES NEW STATEMENTS. A value the app already carries
 *   (copied from the live app into a draft, or carried forward on a publish that does not name one)
 *   is never re-judged, so an app published before this rule existed keeps working.
 * @structure
 *   - APP_DISPLAY_VERSION_RE — the accepted shape
 *   - appDisplayVersionRefusal(value) — null when the value is absent or acceptable, else the refusal
 * @usage
 *   const bad = appDisplayVersionRefusal(req.body?.version);
 *   if (bad) { res.status(bad.status).json(error(config.nodeId, bad.code, bad.message, bad.status, bad.details)); return; }
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial: the draft tools state the display version as the publish does
 *     (wish-the-app-draft-tools-can-set-the-display-version).
 */

/**
 * Letters, digits, dots, hyphens, plus signs and underscores, starting with a letter or a digit,
 * at most 40 characters: every semantic version ("1.4.0", "2.0.0-beta.1+build.7") fits, and so do
 * the date and "v2" shapes owners use.
 */
export const APP_DISPLAY_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;

/** The refusal shape every app code path renders (the same fields as PublishAppRefusal['refusal']). */
export interface AppDisplayVersionRefusal {
  status: 400;
  code: 'INVALID_INPUT';
  message: string;
  details: { version: unknown };
}

/**
 * Null when `value` is absent (`undefined` or `null`, which means "not stated") or fits the rule;
 * otherwise the refusal to answer with.
 */
export function appDisplayVersionRefusal(value: unknown): AppDisplayVersionRefusal | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && APP_DISPLAY_VERSION_RE.test(value)) return null;
  return {
    status: 400,
    code: 'INVALID_INPUT',
    message: 'This display version cannot be used. Give 1 to 40 letters, digits, dots, hyphens, plus '
      + 'signs or underscores that start with a letter or a digit, for example 1.4.0, or leave the '
      + 'version out to keep the one the app has.',
    details: { version: value },
  };
}
