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
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-llm-editor.js v1.0.0).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Section } from '/views/profile/organisms/poster-parts.js';
import { rankModels, matchesQuery, modelPageUrl, answersInText } from '/views/profile/openrouter/pricing.js';
import { modelWords, priceWords, contextWords, findModel } from '../ai/frame.js';
import { x, judgeOf, candidatesOf, openTab } from './frame.js';

const RECOMMENDED = 8;
const CHAT_ROLE = { pool: 'chat' };

export function secModels(ctx) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const candidates = candidatesOf(p);
  const count = x('secModelsSub', { n: candidates.length });
  return html`
    <${Section} id="cal-models" num="03" title=${x('secModels')} count=${count}>
      ${!ctx.keyed ? html`<p class="cal-empty"><b>${x('noKeyLead')}</b> ${x('noKeyBody')} <button type="button" class="og-door og-door--quiet" onClick=${() => openTab('ai')}>${x('openAiPage')}</button></p>` : null}
      <div class="cal-ml">
        <div class="cal-mr cal-mr--head"><div>${x('colRole')}</div><div>${x('colModel')}</div><div>${x('colFacts')}</div><div></div></div>
        ${judgeRow(ctx, judge)}
        ${candidates.map((m, i) => candidateRow(ctx, m, i))}
        ${ctx.pick === 'add' ? html`<div class="cal-mr is-open"><div class="cal-open">${picker(ctx, 'add', '')}</div></div>` : null}
      </div>
      <div class="og-doors cal-add">
        <button type="button" class="og-door" disabled=${!ctx.keyed || !ctx.models.length} onClick=${() => ctx.setPick(ctx.pick === 'add' ? null : 'add')}>${ctx.pick === 'add' ? x('close') : x('addModel')}</button>
        ${!candidates.length ? html`<small>${x('noCandidatesHint')}</small>` : null}
      </div>
      <p class="cal-hint">${x('hintModels')}</p>
    <//>`;
}

function judgeRow(ctx, judge) {
  const open = ctx.pick === 'judge';
  const model = findModel(judge.modelId, ctx.models);
  const name = judge.modelId ? modelWords(model, judge.modelId) : x('judgeServerDefault');
  const sub = judge.own ? x('judgeOwn') : judge.source === 'reasoning' ? x('judgeFromAiReasoning') : judge.source === 'default' ? x('judgeFromAiDefault') : x('judgeFromServer');
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : '';
  return html`
    <div class=${`cal-mr ${open ? 'is-open' : ''}`} id="cal-judge">
      <div class="cal-role">${x('judge')}<small>${x('judgeSub')}</small></div>
      <div class="cal-model"><b>${name}</b>${judge.modelId ? html`<code>${judge.modelId}</code>` : null}<small>${sub}</small></div>
      <div class="cal-facts">${facts}</div>
      <div class="cal-go"><button type="button" class="og-door" disabled=${!ctx.keyed} onClick=${() => ctx.setPick(open ? null : 'judge')}>${open ? x('close') : x('change')}</button></div>
      ${open ? html`<div class="cal-open">
        <p class="cal-lead">${judge.own ? x('judgeLeadOwn', { name }) : x('judgeLeadAi', { name })}</p>
        ${picker(ctx, 'judge', judge.own ? judge.modelId : '')}
        <div class="og-doors">
          ${judge.own ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'models'} onClick=${() => ctx.setJudge(null)}>${x('judgeUseAiPage')}</button>` : null}
          ${judge.modelId && ctx.isOpenRouter ? html`<a class="og-door og-door--quiet" href=${modelPageUrl(judge.modelId)} target="_blank" rel="noopener">${x('openModelPage')}</a>` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setPick(null)}>${x('close')}</button>
        </div>
      </div>` : null}
    </div>`;
}

function candidateRow(ctx, m, i) {
  const model = findModel(m.modelId, ctx.models);
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : (ctx.keyed && ctx.models.length ? x('modelNotInList') : '');
  return html`
    <div class="cal-mr" key=${m.id}>
      <div class="cal-role">${x('candidateN', { n: i + 1 })}<small>${x('candidateSub')}</small></div>
      <div class="cal-model"><b>${modelWords(model, m.modelId)}</b><code>${m.modelId}</code></div>
      <div class="cal-facts">${facts}</div>
      <div class="cal-go"><button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'models'} onClick=${() => ctx.removeCandidate(m.id)}>${x('remove')}</button></div>
    </div>`;
}

/** The catalogue under an opened row: search, the recommended group, a row per model. */
function picker(ctx, slot, chosenId) {
  const pool = (ctx.models || []).filter(answersInText);
  if (!pool.length) return html`<p class="cal-empty">${ctx.keyed ? x('modelsNone') : x('noKeyBody')}</p>`;
  const q = (ctx.query || '').trim().toLowerCase();
  const recommended = rankModels(pool, 'chat').slice(0, RECOMMENDED);
  const filtered = pool.filter((m) => matchesQuery(m, q));
  const visible = q ? filtered : (ctx.showAll ? filtered : recommended);
  const taken = new Set(candidatesOf(ctx.project).map((m) => m.modelId));
  return html`
    <div class="cal-pick">
      <input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} aria-label=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
      ${!q && !ctx.showAll ? html`<div class="cal-pick-group">${x('recommended')}</div>` : null}
      ${visible.length ? html`<ul class="cal-pick-list">${visible.map((m) => pickerRow(ctx, slot, m, m.id === chosenId, slot === 'add' && taken.has(m.id)))}</ul>` : html`<div class="cal-pick-empty">${x('noMatch')}</div>`}
      <div class="cal-pick-more">
        ${!q && !ctx.showAll && filtered.length > visible.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}</button>` : null}
        <span>${x('poolFacts', { n: pool.length })}</span>
      </div>
    </div>`;
}

function pickerRow(ctx, slot, m, on, taken) {
  const act = () => (slot === 'judge' ? ctx.setJudge(m) : ctx.addCandidate(m));
  return html`
    <li class=${`cal-pick-row ${on ? 'is-on' : ''} ${taken ? 'is-taken' : ''}`} key=${m.id}>
      <button type="button" disabled=${ctx.busy === 'models' || taken} onClick=${act}>
        <span><b>${modelWords(m, m.id)}</b><code>${m.id}</code></span>
        <span class="cal-pick-note">${taken ? x('alreadyAdded') : ''}</span>
        <span class="cal-pick-price">${priceWords(m, CHAT_ROLE)}</span>
        <span class="cal-pick-ctx">${contextWords(m)}</span>
      </button>
    </li>`;
}
