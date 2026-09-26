/**
 * @file public/views/profile/libraries/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row of the Libraries page and what opens under it. The row: the pack's name
 *   with its version, its status and model words, what it gives, the name the code calls it by and
 *   how many published apps load it, the doors. Opened: the include lines, the text an AI gets,
 *   the API, the model words explained, the proof ledger, who uses it, where it is seen working,
 *   version, licence, size and source, the changelog.
 * @structure packRow · packOpen
 * @usage import { packRow } from './rows.js';
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- Every part is a kit component (List Row with its Name, Desc, code Cell, Doors and Panel; Facts; Code; Note; Action; ProofLedger; ChangeLog): the page passes data and writes no class (page group G8).
 *   v1.14.0 -- 2026-09-26 -- The text for an AI is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.13.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- The dot before a library's name is the Status dot (.status-dot, active or inactive), a unification.
 *   v1.9.0 -- 2026-09-25 -- An opened pack's facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A pack's row is the Listing (listing-row and its name, words and doors cells, the open panel), a unification: the look most tabs use. The in-the-app column keeps its typewriter face on a span inside a plain cell.
 *   v1.7.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from '/js/format.js';
import { Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { ProofLedger } from '/components/ProofLedger.js';
import { ChangeLog } from '/components/ChangeLog.js';
import { x, statusWord, modelWord, proofWord, isCommunity, appName, appUrlOf, aiTextFor } from './frame.js';

function subLine(p) {
  const parts = [isCommunity(p) ? x('communityWord') : '', statusWord(p), modelWord(p), proofWord(p)].filter(Boolean);
  if ((p.requires || []).length) parts.push(x('requiresShort', { list: p.requires.join(', ') }));
  return parts.join(' · ');
}

function usesWords(p) {
  const n = p.used_by?.apps || 0;
  if (!n) return x('usedNone');
  return n === 1 ? x('usedOne') : x('usedMany', { n });
}

export function packRow(ctx, p) {
  const open = ctx.expanded === p.id;
  const deprecated = p.status === 'deprecated';
  return html`
    <${Row} key=${p.id} open=${open}>
      <${Name} dot=${deprecated ? 'inactive' : 'active'} tag=${p.version || null}
        meta=${deprecated && p.supersededBy ? `${statusWord(p)} → ${p.supersededBy}` : subLine(p)} warn=${deprecated}>${p.title || p.id}<//>
      <${Desc}>${p.description || ''}<//>
      <${Cell} code sub=${usesWords(p)} subQuiet=${!(p.used_by?.apps || 0)}>${p.apiSurface || p.id}<//>
      <${Doors}>
        <${Action} small row onClick=${() => ctx.toggle(p)}>${open ? x('close') : x('open')}<//>
        <${Action} small row soft onClick=${() => ctx.copyForAi(p)}>${x('copyAi')}<//>
      <//>
      ${open ? packOpen(ctx, p) : null}
    <//>`;
}

function modelExplained(p) {
  if (p.modelTier === 'any') return html`<b>${x('model.any')}.</b> ${x('model.anyLong')}`;
  if (p.modelTier === 'frontier') return html`<b>${x('model.frontier')}.</b> ${x('model.frontierLong')}`;
  if (isCommunity(p)) return x('model.communityLong');
  return x('model.needsDocLong');
}

const withoutScheme = (u) => String(u).replace(/^https?:\/\//, '');
const link = (href, words, key) => html`<${Action} tone="link" key=${key} href=${href} newTab>${words}<//>`;

/** The text an AI gets: how long it is, the grey line with its two doors, and the text itself
 *  while it is shown. */
function forAiValue(ctx, p, d, aiText) {
  const docOpen = ctx.docShown === p.id;
  const toggleDoc = () => ctx.toggleDoc(p);
  const copyDoor = html`<${Action} tone="link" copy=${aiText} copiedLabel=${x('copied')}>${x('copyAi')}<//>`;
  const showDoor = html`<${Action} tone="more" onClick=${toggleDoc}>${docOpen ? x('hide') : x('show')}<//>`;
  const doors = html`${x('forAiSub', { id: p.id })} · ${copyDoor} · ${showDoor}`;
  const words = d.ai_doc ? x('forAiBody', { n: num(d.ai_doc.length) }) : x('forAiNone');
  return html`<${FactLine} sub=${doors}>${words}<//>${docOpen && d.ai_doc ? html`<${Code} block tall>${d.ai_doc}<//>` : null}`;
}

/** One proof as a ledger row: the evidence's file name, and "self-reported" when it is. */
function proofRow(pr, d) {
  const file = (pr.evidence || '').split('/').pop();
  const self = pr.self_reported || d.self_reported ? ' · ' + x('selfReported') : '';
  return {
    key: pr.model + pr.date, model: pr.model, pass: pr.verdict === 'pass',
    verdict: pr.verdict === 'pass' ? x('proofPass') : x('proofFail'),
    tokens: pr.tokens ? num(pr.tokens) + ' tok' : '', date: pr.date || '',
    evidence: file + self, evidenceTitle: pr.evidence || '',
  };
}

function packOpen(ctx, p) {
  const d = ctx.details[p.id];
  if (!d) return html`<${Panel}><${Note} kind="loading">${t('common.loading')}<//><//>`;
  if (d.error) return html`<${Panel}><${Note} kind="quiet">${d.error}<//><//>`;
  const include = Array.isArray(d.include) ? d.include : (p.include || []);
  const proofs = p.proofs || d.proofs || [];
  const used = p.used_by || {};
  const changelog = Array.isArray(d.changelog) ? d.changelog.slice().reverse() : [];
  const aiText = aiTextFor(p, d);
  return html`
    <${Panel} doors=${html`
        <${Action} small copy=${aiText} copiedLabel=${x('copied')}>${x('copyAi')}<//>
        <${Action} small soft onClick=${() => ctx.toggle(p)}>${x('close')}<//>`}>
      <${Note} kind="lead">${p.description || ''}<//>
      <${Facts} rows=${[
        { k: x('intoApp'), v: include.map((line) => html`<${Code} key=${line}>${line}<//>`),
          sub: html`${include.length > 1 ? x('intoAppOrder') : x('intoAppOne')} · <${Action} tone="link" copy=${include.join('\n')} copiedLabel=${x('copied')}>${x('copyLines')}<//>` },
        { k: x('forAi'), v: forAiValue(ctx, p, d, aiText) },
        p.apiSurface && { k: x('api'), v: p.apiSurface, mono: true },
        { k: x('forModel'), v: html`${modelExplained(p)}${p.apiCaveat ? html`<${Note} kind="aside" size="small">${x('caveatLead')} ${p.apiCaveat}<//>` : null}` },
        { k: x('proven'),
          v: proofs.length ? html`<${ProofLedger} rows=${proofs.map((pr) => proofRow(pr, d))} />` : x('provenNone'),
          sub: x('provenSub') },
        (used.apps || 0)
          ? { k: x('usedBy'), v: html`${(used.app_names || []).map((ref) => html`${link(appUrlOf(ref), appName(ref), ref)} `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - (used.app_names || []).length }) : ''}`, sub: x('usedBySub') }
          : { k: x('usedBy'), v: x('usedNone'), sub: x('usedNoneSub') },
        (p.showcaseUrl || p.demoTemplateId) && { k: x('seeWorking'),
          v: html`${p.showcaseUrl ? html`${link(p.showcaseUrl, 'Design Book')} ` : null}${p.demoTemplateId ? html`<span>${p.showcaseUrl ? ' · ' : ''}${x('demoTemplate', { id: p.demoTemplateId })}</span>` : null}`,
          sub: x('seeWorkingSub') },
        { k: x('versionSize'),
          v: html`${[p.version || x('noVersion'), p.license, p.sizeEstimate].filter(Boolean).join(' · ')}${d.sourceUrl ? html` · ${link(d.sourceUrl, withoutScheme(d.sourceUrl))}` : null}`,
          sub: p.version ? x('versionSub') : x('noVersionSub') },
        p.status === 'deprecated' && { k: x('deprecatedK'), v: p.supersededBy ? x('deprecatedWith', { id: p.supersededBy }) : x('deprecatedWithout') },
        changelog.length > 0 && { k: x('changes'),
          v: html`<${ChangeLog} entries=${changelog.map((c, i) => ({ key: i, version: c.version, date: c.date, summary: c.summary, breaking: c.breaking ? `${x('breaking')}: ${c.breaking}` : null }))} />` },
      ]} />
    <//>`;
}
