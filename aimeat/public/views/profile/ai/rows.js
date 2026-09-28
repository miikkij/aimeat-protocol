/**
 * @file public/views/profile/ai/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app in the AI page's spend table: 30-day cost, today, the cap written on the row,
 *   calls.
 * @structure appRow
 * @usage import { appRow } from './rows.js';
 * @version-history
 *   v2.0.0 -- 2026-09-28 -- AI roles (wish-tekoalyn-roolit): the six fixed model roles leave the page, and
 *     with them the role row, its model picker and the measured transcription (roleRow, roleOpen,
 *     describe, sttPanel). A capability's model is set on its provider; what a model is for is a role
 *     (ai/roles-section.js). The spend row stays as it was.
 *   v1.14.0 -- 2026-09-26 -- Every part is a kit component (List Row with its Name, Who, Desc, Num, Doors and Panel; ModelList for the picker; Facts; Check; TextField; Box; Note; Action; VoiceRecorder's small cut): the page passes data and writes no class (page group G8).
 *   v1.13.0 -- 2026-09-26 -- The speech language's radio dots carry the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.12.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.8.0 -- 2026-09-25 -- The speech-to-text language and test under an opened role are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- A model role's row and an app's row in the spend table are the Listing (listing-row and its name, who, words and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.6.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.2.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.1.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the tone its meaning names: more for "show all" and more of a list, back, text for a plain grey word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 -- 2026-09-03 -- Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Row, Name, Num } from '/components/List.js';
import { TextField } from '/components/TextField.js';
import { x, money, compact } from './frame.js';

export function appRow(ctx, row, editing) {
  const cap = ctx.quotas?.[row.app]?.daily_usd;
  const draft = ctx.caps?.[row.app];
  return html`
    <${Row} key=${row.app}>
      <${Name} meta=${[row.tokens ? x('tokensN', { n: compact(row.tokens) }) : '', row.seconds ? x('secondsN', { n: Math.round(row.seconds) }) : ''].filter(Boolean).join(' · ')}>${row.app}<//>
      <${Num}>${money(row.cost)}<//>
      <${Num} dim>${money(row.today)}<//>
      ${editing
        ? html`<${Num}><${TextField} type="number" size="short" min="0" max="1000" step="0.10" value=${draft ?? ''} placeholder=${x('noCap')} ariaLabel=${x('colCap')} onInput=${(v) => ctx.setCap(row.app, v)} /><//>`
        : cap != null ? html`<${Num} strong>${money(cap)}<//>` : html`<${Num} dim>${x('noCap')}<//>`}
      <${Num} dim>${row.calls}<//>
    <//>`;
}
