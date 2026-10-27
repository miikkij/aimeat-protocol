/**
 * @file public/js/input-limits.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's input length limits, for the browser: the same numbers, by the same class
 *   names, as src/models/input-limits.ts, which the server enforces. A field given one of these as
 *   its maxLength stops the typing at the length the server would refuse, so a person never sends
 *   what comes back as "too long". test/unit/input-limits-browser.test.ts holds this file equal to
 *   the server's, so the two cannot drift apart.
 * @structure INPUT_LIMITS
 * @usage import { INPUT_LIMITS } from '/js/input-limits.js';
 *        html`<${TextField} label=${t('x.title')} maxLength=${INPUT_LIMITS.title} … />`
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
export const INPUT_LIMITS = Object.freeze({
  id: 256,
  key: 1024,
  name: 200,
  title: 500,
  line: 2048,
  url: 2048,
  email: 254,
  description: 10_000,
  text: 100_000,
});
