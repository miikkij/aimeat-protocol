/**
 * @file public/views/profile/calibrator/models.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of a calibration: the judge (this calibration's own choice, or the AI
 *   page's reasoning model) and the models under test, as rows, and the picker that opens under
 *   a row: the same catalogue, the same search and the same recommended group as the AI page, so
 *   a model is chosen the same way everywhere. Without a key on the AI page the rows say so and
 *   point there.
 * @structure secModels · judgeRow · candidateRow · picker · pickerRow
 * @usage import { secModels } from './models.js';
 * @version-history
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.9.0 -- 2026-09-25 -- The judge and the models under test are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.7.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.4.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-llm-editor.js v1.0.0).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { PageSection } from '/components/PageSection.js';
import { rankModels, matchesQuery, modelPageUrl, answersInText } from '/views/profile/openrouter/pricing.js';
import { modelWords, priceWords, contextWords, findModel } from '../ai/frame.js';
import { x, judgeOf, candidatesOf, openTab } from './frame.js';
import { Hint } from '/components/Hint.js';

const RECOMMENDED = 8;
const CHAT_ROLE = { pool: 'chat' };

export function secModels(ctx) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const candidates = candidatesOf(p);
  const count = x('secModelsSub', { n: candidates.length });
  return html`
    <${PageSection} id="cal-models" num="03" title=${x('secModels')} count=${count}>
      ${!ctx.keyed ? html`<p class="poster-quiet cal-empty"><b>${x('noKeyLead')}</b> ${x('noKeyBody')} <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => openTab('ai')}>${x('openAiPage')}</button></p>` : null}
      <div class="listing listing--name-who-facts-doors">
        <div class="listing-row listing-row--head"><div class="poster-label">${x('colRole')}</div><div class="poster-label">${x('colModel')}</div><div class="poster-label">${x('colFacts')}</div><div class="poster-label"></div></div>
        ${judgeRow(ctx, judge)}
        ${candidates.map((m, i) => candidateRow(ctx, m, i))}
        ${ctx.pick === 'add' ? html`<div class="listing-row is-open"><div class="listing-open poster-box poster-box--raised">${picker(ctx, 'add', '')}</div></div>` : null}
      </div>
      <div class="og-doors cal-add">
        <button type="button" class="poster-action poster-action--small" disabled=${!ctx.keyed || !ctx.models.length} onClick=${() => ctx.setPick(ctx.pick === 'add' ? null : 'add')}>${ctx.pick === 'add' ? x('close') : x('addModel')}</button>
        ${!candidates.length ? html`<small class="poster-hint">${x('noCandidatesHint')}</small>` : null}
      </div>
      <${Hint}>${x('hintModels')}<//>
    <//>`;
}

function judgeRow(ctx, judge) {
  const open = ctx.pick === 'judge';
  const model = findModel(judge.modelId, ctx.models);
  const name = judge.modelId ? modelWords(model, judge.modelId) : x('judgeServerDefault');
  const sub = judge.own ? x('judgeOwn') : judge.source === 'reasoning' ? x('judgeFromAiReasoning') : judge.source === 'default' ? x('judgeFromAiDefault') : x('judgeFromServer');
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : '';
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} id="cal-judge">
      <div class="listing-name">${x('judge')}<small>${x('judgeSub')}</small></div>
      <div class="listing-who cal-model"><b>${name}</b>${judge.modelId ? html`<code class="code-inline">${judge.modelId}</code>` : null}<small>${sub}</small></div>
      <div class="listing-desc cal-facts">${facts}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" disabled=${!ctx.keyed} onClick=${() => ctx.setPick(open ? null : 'judge')}>${open ? x('close') : x('change')}</button></div>
      ${open ? html`<div class="listing-open poster-box poster-box--raised">
        <p class="og-lead">${judge.own ? x('judgeLeadOwn', { name }) : x('judgeLeadAi', { name })}</p>
        ${picker(ctx, 'judge', judge.own ? judge.modelId : '')}
        <div class="og-doors listing-open-doors">
          ${judge.own ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'models'} onClick=${() => ctx.setJudge(null)}>${x('judgeUseAiPage')}</button>` : null}
          ${judge.modelId && ctx.isOpenRouter ? html`<a class="poster-action poster-action--small poster-action--lower" href=${modelPageUrl(judge.modelId)} target="_blank" rel="noopener">${x('openModelPage')}</a>` : null}
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setPick(null)}>${x('close')}</button>
        </div>
      </div>` : null}
    </div>`;
}

function candidateRow(ctx, m, i) {
  const model = findModel(m.modelId, ctx.models);
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : (ctx.keyed && ctx.models.length ? x('modelNotInList') : '');
  return html`
    <div class="listing-row" key=${m.id}>
      <div class="listing-name">${x('candidateN', { n: i + 1 })}<small>${x('candidateSub')}</small></div>
      <div class="listing-who cal-model"><b>${modelWords(model, m.modelId)}</b><code class="code-inline">${m.modelId}</code></div>
      <div class="listing-desc cal-facts">${facts}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row poster-action--danger poster-action--lower" disabled=${ctx.busy === 'models'} onClick=${() => ctx.removeCandidate(m.id)}>${x('remove')}</button></div>
    </div>`;
}

/** The catalogue under an opened row: search, the recommended group, a row per model. */
function picker(ctx, slot, chosenId) {
  const pool = (ctx.models || []).filter(answersInText);
  if (!pool.length) return html`<p class="poster-quiet cal-empty">${ctx.keyed ? x('modelsNone') : x('noKeyBody')}</p>`;
  const q = (ctx.query || '').trim().toLowerCase();
  const recommended = rankModels(pool, 'chat').slice(0, RECOMMENDED);
  const filtered = pool.filter((m) => matchesQuery(m, q));
  const visible = q ? filtered : (ctx.showAll ? filtered : recommended);
  const taken = new Set(candidatesOf(ctx.project).map((m) => m.modelId));
  return html`
    <div class="model-picker cal-pick">
      <input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} aria-label=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
      ${!q && !ctx.showAll ? html`<div class="model-picker-group poster-day-title">${x('recommended')}</div>` : null}
      ${visible.length ? html`<ul class="model-picker-list">${visible.map((m) => pickerRow(ctx, slot, m, m.id === chosenId, slot === 'add' && taken.has(m.id)))}</ul>` : html`<div class="poster-quiet model-picker-empty">${x('noMatch')}</div>`}
      <div class="model-picker-more">
        ${!q && !ctx.showAll && filtered.length > visible.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}</button>` : null}
        <span>${x('poolFacts', { n: pool.length })}</span>
      </div>
    </div>`;
}

function pickerRow(ctx, slot, m, on, taken) {
  const act = () => (slot === 'judge' ? ctx.setJudge(m) : ctx.addCandidate(m));
  return html`
    <li class=${`model-picker-row ${on ? 'is-on' : ''} ${taken ? 'is-taken' : ''}`} key=${m.id}>
      <button type="button" disabled=${ctx.busy === 'models' || taken} onClick=${act}>
        <span><b>${modelWords(m, m.id)}</b><code>${m.id}</code></span>
        <span class="model-picker-note">${taken ? x('alreadyAdded') : ''}</span>
        <span class="model-picker-price">${priceWords(m, CHAT_ROLE)}</span>
        <span class="model-picker-ctx">${contextWords(m)}</span>
      </button>
    </li>`;
}
