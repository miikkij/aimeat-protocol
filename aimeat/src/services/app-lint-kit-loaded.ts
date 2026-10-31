/**
 * @file app-lint-kit-loaded.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A publish-time check: the page calls the Atelier kit (`AIMEAT.atelier`) and never
 *   loads the kit's script, /v1/libs/aimeat-atelier.js. No other served library defines the
 *   namespace, so the first call throws a TypeError and every line after it in that script is
 *   lost: no handlers, no data, no sign-in pill. Seen on 2026-10-31 on a store-bought node: the
 *   node chat published a shopping list whose first script line was `AIMEAT.atelier.i18n`, and its
 *   Add button did nothing (v28 #13, #14). Read by services/app-artifact-lint.ts, which refuses the
 *   publish on it.
 *
 *   A page that tests for the namespace before it calls it (`AIMEAT.atelier &&`, `typeof
 *   AIMEAT.atelier`) does not throw, so it passes.
 * @structure kitCalledButNotLoaded(html) · KIT_NOT_LOADED_MESSAGE
 * @usage if (kitCalledButNotLoaded(html)) blocking.push(finding('atelier-kit-not-loaded', 'critical', KIT_NOT_LOADED_MESSAGE));
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (v28 #13).
 */

/** Whether the page calls `AIMEAT.atelier` with no script tag for the kit and no test for it first. */
export function kitCalledButNotLoaded(html: string): boolean {
  if (!/\bAIMEAT\s*\.\s*atelier\b/.test(html)) return false;
  if (/aimeat-atelier\.js/i.test(html)) return false;
  return !/typeof\s+(?:window\s*\.\s*)?AIMEAT\s*\.\s*atelier\b|\bAIMEAT\s*\.\s*atelier\s*(?:&&|\?|\))/.test(html);
}

export const KIT_NOT_LOADED_MESSAGE =
  'The page calls `AIMEAT.atelier` and never loads the kit, so its first call throws and the rest of '
  + 'that script never runs: no buttons, no data, no sign-in. Add '
  + '`<script src="/v1/libs/aimeat-atelier.js"></script>` (and `<link rel="stylesheet" href="/lib/aimeat-atelier.css">`) '
  + 'in the head, after aimeat-auth.js and aimeat-data.js.';
