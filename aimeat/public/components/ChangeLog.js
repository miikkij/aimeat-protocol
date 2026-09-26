/**
 * @file public/components/ChangeLog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A thing's list of changes: the version and the date in the grey typewriter face,
 *   then what changed, and a breaking change in coral after it. Three columns; one on a phone. A
 *   page passes the entries, newest first; it never writes a class. Its look is
 *   css/components/changelog.css (.changelog).
 * @structure ChangeLog({ entries: [{ key, version, date, summary, breaking }] })
 * @usage html`<${ChangeLog} entries=${log.map((c, i) => ({ key: i, version: c.version, date: c.date,
 *   summary: c.summary, breaking: c.breaking ? `${x('breaking')}: ${c.breaking}` : null }))} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Libraries page's changelog as a component, same markup; the
 *     breaking change is the Tinted notice word (page group G8).
 *   v1.1.0 — 2026-09-27 — Draws its own name: .lb-cl is .changelog (a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { Tinted } from '/components/Figure.js';

const html = htm.bind(h);

export function ChangeLog({ entries = [] }) {
  return html`<div class="changelog">${entries.map((c, i) => {
    const k = c.key ?? i;
    return html`<div class="m" key=${'v' + k}>${c.version}</div><div class="m" key=${'d' + k}>${c.date}</div><div key=${'s' + k}>${c.summary}${c.breaking ? html` <${Tinted} strong tone="notice">${c.breaking}<//>` : null}</div>`;
  })}</div>`;
}

export default ChangeLog;
