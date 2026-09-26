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
import { CopyButton } from '/components/CopyButton.js';
import { num } from '/js/format.js';
import { x, statusWord, modelWord, proofWord, isCommunity, appName, appUrlOf, aiTextFor } from './frame.js';

const dot = (p) => html`<i class=${`status-dot ${p.status === 'deprecated' ? 'status-dot--inactive' : 'status-dot--active'}`} aria-hidden="true"></i>`;

function subLine(p) {
  const parts = [isCommunity(p) ? x('communityWord') : '', statusWord(p), modelWord(p), proofWord(p)].filter(Boolean);
  if ((p.requires || []).length) parts.push(x('requiresShort', { list: p.requires.join(', ') }));
  return parts.join(' · ');
}

function usesLine(p) {
  const n = p.used_by?.apps || 0;
  if (!n) return html`<small class="is-dim">${x('usedNone')}</small>`;
  return html`<small>${n === 1 ? x('usedOne') : x('usedMany', { n })}</small>`;
}

export function packRow(ctx, p) {
  const open = ctx.expanded === p.id;
  const deprecated = p.status === 'deprecated';
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${p.id}>
      <div class="listing-name">${dot(p)}${p.title || p.id}${p.version ? html`<span class="poster-chip">${p.version}</span>` : null}<small class=${deprecated ? 'is-warn' : ''}>${deprecated && p.supersededBy ? `${statusWord(p)} → ${p.supersededBy}` : subLine(p)}</small></div>
      <div class="listing-desc">${p.description || ''}</div>
      <div><span class="lb-me">${p.apiSurface || p.id}${usesLine(p)}</span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggle(p)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.copyForAi(p)}>${x('copyAi')}</button>
      </div>
      ${open ? packOpen(ctx, p) : null}
    </div>`;
}

function modelExplained(p) {
  if (p.modelTier === 'any') return html`<b>${x('model.any')}.</b> ${x('model.anyLong')}`;
  if (p.modelTier === 'frontier') return html`<b>${x('model.frontier')}.</b> ${x('model.frontierLong')}`;
  if (isCommunity(p)) return x('model.communityLong');
  return x('model.needsDocLong');
}

function packOpen(ctx, p) {
  const d = ctx.details[p.id];
  if (!d) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet lb-empty loading-mark">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet lb-empty">${d.error}</p></div>`;
  const include = Array.isArray(d.include) ? d.include : (p.include || []);
  const proofs = p.proofs || d.proofs || [];
  const used = p.used_by || {};
  const changelog = Array.isArray(d.changelog) ? d.changelog.slice().reverse() : [];
  const aiText = aiTextFor(p, d);
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${p.description || ''}</p>
      <div class="facts">
        <div class="facts-k poster-label">${x('intoApp')}</div><div class="facts-v">${include.map((line) => html`<code key=${line} class="code-inline">${line}</code>`)}<small>${include.length > 1 ? x('intoAppOrder') : x('intoAppOne')} · <${CopyButton} text=${include.join('\n')} className="og-crumb-link" label=${x('copyLines')} copiedLabel=${x('copied')} /></small></div>
        <div class="facts-k poster-label">${x('forAi')}</div><div class="facts-v">${d.ai_doc ? x('forAiBody', { n: num(d.ai_doc.length) }) : x('forAiNone')}<small>${x('forAiSub', { id: p.id })} · <${CopyButton} text=${aiText} className="og-crumb-link" label=${x('copyAi')} copiedLabel=${x('copied')} /> · <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleDoc(p)}>${ctx.docShown === p.id ? x('hide') : x('show')}</button></small>${ctx.docShown === p.id && d.ai_doc ? html`<pre class="code-block lb-out">${d.ai_doc}</pre>` : null}</div>
        ${p.apiSurface ? html`<div class="facts-k poster-label">${x('api')}</div><div class="facts-v"><code class="code-inline">${p.apiSurface}</code></div>` : null}
        <div class="facts-k poster-label">${x('forModel')}</div><div class="facts-v">${modelExplained(p)}${p.apiCaveat ? html`<div class="lb-warnbox poster-aside poster-aside--small">${x('caveatLead')} ${p.apiCaveat}</div>` : null}</div>
        <div class="facts-k poster-label">${x('proven')}</div><div class="facts-v">${proofs.length ? html`<div class="lb-proof">${proofs.map((pr) => html`
            <div key=${pr.model + pr.date}>${pr.model}</div><div class=${pr.verdict === 'pass' ? 'ok' : 'no'}>${pr.verdict === 'pass' ? x('proofPass') : x('proofFail')}</div><div>${pr.tokens ? `${num(pr.tokens)} tok` : ''}</div><div>${pr.date || ''}</div><div title=${pr.evidence || ''}>${(pr.evidence || '').split('/').pop()}${pr.self_reported || d.self_reported ? ` · ${x('selfReported')}` : ''}</div>`)}</div>` : x('provenNone')}<small>${x('provenSub')}</small></div>
        <div class="facts-k poster-label">${x('usedBy')}</div><div class="facts-v">${(used.apps || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - (used.app_names || []).length }) : ''}<small>${x('usedBySub')}</small>` : html`${x('usedNone')}<small>${x('usedNoneSub')}</small>`}</div>
        ${p.showcaseUrl || p.demoTemplateId ? html`<div class="facts-k poster-label">${x('seeWorking')}</div><div class="facts-v">${p.showcaseUrl ? html`<a class="og-crumb-link" href=${p.showcaseUrl} target="_blank" rel="noopener">Design Book</a> ` : null}${p.demoTemplateId ? html`<span>${p.showcaseUrl ? ' · ' : ''}${x('demoTemplate', { id: p.demoTemplateId })}</span>` : null}<small>${x('seeWorkingSub')}</small></div>` : null}
        <div class="facts-k poster-label">${x('versionSize')}</div><div class="facts-v">${[p.version || x('noVersion'), p.license, p.sizeEstimate].filter(Boolean).join(' · ')}${d.sourceUrl ? html` · <a class="og-crumb-link" href=${d.sourceUrl} target="_blank" rel="noopener">${d.sourceUrl.replace(/^https?:\/\//, '')}</a>` : null}<small>${p.version ? x('versionSub') : x('noVersionSub')}</small></div>
        ${p.status === 'deprecated' ? html`<div class="facts-k poster-label">${x('deprecatedK')}</div><div class="facts-v">${p.supersededBy ? x('deprecatedWith', { id: p.supersededBy }) : x('deprecatedWithout')}</div>` : null}
        ${changelog.length ? html`<div class="facts-k poster-label">${x('changes')}</div><div class="facts-v"><div class="lb-cl">${changelog.map((c, i) => html`<div class="m" key=${'v' + i}>${c.version}</div><div class="m" key=${'d' + i}>${c.date}</div><div key=${'s' + i}>${c.summary}${c.breaking ? html` <b class="is-warn">${x('breaking')}: ${c.breaking}</b>` : null}</div>`)}</div></div>` : null}
      </div>
      <div class="og-doors listing-open-doors">
        <${CopyButton} text=${aiText} className="poster-action poster-action--small" label=${x('copyAi')} copiedLabel=${x('copied')} />
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle(p)}>${x('close')}</button>
      </div>
    </div>`;
}
