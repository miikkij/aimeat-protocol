/**
 * @file public/views/appcat/gaps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the catalogue says and offers about an own app that is missing something
 *   (model.js kunto), in the two places a person meets it:
 *   - GapLead, over Your apps while a "Something missing" row of the index filters the list: the
 *     condition's words with its question mark, the short explanation, and one action that copies a
 *     prompt for every app in the list;
 *   - GapLine, in an own app's open row: what that app is missing, each condition with its question
 *     mark, and the action that copies a prompt for that app.
 *   The explanations are locale data (`explain.appGap.<condition>.*`, and `explain.concept.appGaps`
 *   for the group, which the index opens), so the same words reach an AI through the settings
 *   handbook. The prompt is gap-prompt.js. Own apps only: the listing gives nobody else an app's
 *   build guide state, and nothing here is drawn on another person's app (Jouni, 2026-11-23).
 * @structure GAP_CONCEPT · gapTerm(key) · gapsOf(sa, cat) · GapLead({ gap, rows }) · GapLine({ sa })
 * @usage html`<${GapLead} gap="noMap" rows=${ownRows} />` · html`<${GapLine} sa=${sa} />`
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { HelpTip } from '/components/HelpTip.js';
import { explainOf } from '/components/ExplainDialog.js';
import { x, xn } from '/views/appcat/i18n.js';
import { useCatalog, appRef, notice } from '/views/appcat/store.js';
import { KUNTO_KEYS, kunto, appName } from '/views/appcat/model.js';
import { gapPrompt } from '/views/appcat/gap-prompt.js';

const html = htm.bind(h);

/** The explanation of the whole group, opened from the index's "Something missing" word. */
export const GAP_CONCEPT = 'concept.appGaps';

/** The explanation of one condition (`explain.appGap.<key>.*`). */
export const gapTerm = (key) => 'appGap.' + key;

/**
 * The conditions an own app meets, in the index's order. Until the person's skills have been read,
 * "no skill" is left out: every app would carry it (store.js skillsLoaded).
 * @param {any} sa a listing row
 * @param {{ skillsBound: Set<string>, skillsLoaded: boolean }} cat the catalogue's state
 * @returns {string[]} KUNTO_KEYS
 */
export function gapsOf(sa, cat) {
  const flags = kunto(sa, cat.skillsBound || new Set());
  return KUNTO_KEYS.filter((k) => flags[k] && (k !== 'noSkill' || cat.skillsLoaded));
}

/** The action that copies a prompt and says so in the page's notice. */
function CopyFix({ prompt, children }) {
  return html`<${Action} small copy=${prompt} copiedLabel=${x('gaps.copied')}
    onCopied=${() => notice(x('gaps.copiedNotice'), 'success')}>${children}<//>`;
}

/**
 * Over Your apps while a condition filters it: what the condition is, and the prompt for every app
 * the list shows.
 * @param {{ gap: string, rows: any[] }} props `rows` the own apps the list shows under the filter
 */
export function GapLead({ gap, rows }) {
  const words = x('kunto.' + gap);
  const term = gapTerm(gap);
  const apps = rows.map((sa) => ({ name: appName(sa), ref: appRef(sa), gaps: [gap] }));
  return html`
    <${Note} kind="lead"><b>${words}</b> <${HelpTip} term=${term} label=${words} /> ${explainOf(term, 'short')}<//>
    ${apps.length ? html`<${Actions} apart><${CopyFix} prompt=${gapPrompt(apps)}>${xn('gaps.copyAll', apps.length)}<//><//>` : null}`;
}

/**
 * In an own app's open row: what the app is missing and the prompt that asks the person's AI to
 * fix it. Draws nothing when the app is missing nothing.
 * @param {{ sa: any }} props
 */
export function GapLine({ sa }) {
  const cat = useCatalog();
  const gaps = gapsOf(sa, cat);
  if (!gaps.length) return null;
  const prompt = gapPrompt([{ name: appName(sa), ref: appRef(sa), gaps }]);
  return html`
    <${Note} kind="hint">${x('gaps.rowLead')} ${gaps.map((k, i) => html`${i ? ' · ' : ''}${x('kunto.' + k)} <${HelpTip} term=${gapTerm(k)} label=${x('kunto.' + k)} />`)}<//>
    <${Actions}><${CopyFix} prompt=${prompt}>${x('gaps.copyOne')}<//><//>`;
}
