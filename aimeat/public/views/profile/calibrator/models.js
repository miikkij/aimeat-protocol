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
 *   2026-09-22 -- Composed from the shared set: the judge, a candidate and a model in the picker are
 *     shared rows, as on the AI page; no page classes remain.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-llm-editor.js v1.0.0).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Section, Stack, ListRow, Surface, Field, Text, Action } from '/components/poster-parts.js';
import { rankModels, matchesQuery, modelPageUrl, answersInText } from '/views/profile/openrouter/pricing.js';
import { modelWords, priceWords, contextWords, findModel } from '../ai/frame.js';
import { x, judgeOf, candidatesOf, openTab } from './frame.js';

const RECOMMENDED = 8;
const CHAT_ROLE = { pool: 'chat' };

/** The chosen model in a row's value column: its name, its id in mono, a quiet note. */
const modelValue = (name, id, note) => html`<${Stack} density="compact">
  <${Text}>${name}<//>${id ? html`<${Text} kind="mono">${id}<//>` : null}${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}
<//>`;

export function secModels(ctx) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const candidates = candidatesOf(p);
  const count = x('secModelsSub', { n: candidates.length });
  return html`
    <${Section} id="cal-models" title=${x('secModels')} count=${count}>
      <${Stack}>
        ${!ctx.keyed ? html`<${Stack} direction="wrap" align="center"><${Text}><strong>${x('noKeyLead')}</strong> ${x('noKeyBody')}<//><${Action} onClick=${() => openTab('ai')}>${x('openAiPage')}<//><//>` : null}
        <div>
          <${ListRow} density="compact" name=${html`<${Text} kind="label">${x('colRole')} · ${x('colFacts')}<//>`} value=${html`<${Text} kind="label">${x('colModel')}<//>`} />
          ${judgeRow(ctx, judge)}
          ${candidates.map((m, i) => candidateRow(ctx, m, i))}
        </div>
        ${ctx.pick === 'add' ? html`<${Surface} kind="record">${picker(ctx, 'add', '')}<//>` : null}
        <${Stack} direction="wrap" align="center">
          <${Action} expanded=${ctx.pick === 'add'} disabled=${!ctx.keyed || !ctx.models.length} onClick=${() => ctx.setPick(ctx.pick === 'add' ? null : 'add')}>${ctx.pick === 'add' ? x('close') : x('addModel')}<//>
          ${!candidates.length ? html`<${Text} kind="caption" tone="muted">${x('noCandidatesHint')}<//>` : null}
        <//>
        <${Text} kind="caption" tone="muted">${x('hintModels')}<//>
      <//>
    <//>`;
}

function judgeRow(ctx, judge) {
  const open = ctx.pick === 'judge';
  const model = findModel(judge.modelId, ctx.models);
  const name = judge.modelId ? modelWords(model, judge.modelId) : x('judgeServerDefault');
  const sub = judge.own ? x('judgeOwn') : judge.source === 'reasoning' ? x('judgeFromAiReasoning') : judge.source === 'default' ? x('judgeFromAiDefault') : x('judgeFromServer');
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : '';
  return html`
    <${ListRow} id="cal-judge" name=${x('judge')} detail=${x('judgeSub')}
      value=${modelValue(name, judge.modelId, sub)}
      actions=${html`<${Action} expanded=${open} disabled=${!ctx.keyed} onClick=${() => ctx.setPick(open ? null : 'judge')}>${open ? x('close') : x('change')}<//>`}>
      ${facts || open ? html`<${Stack}>
        ${facts ? html`<${Text} kind="caption" tone="muted">${facts}<//>` : null}
        ${open ? html`<${Surface} kind="record"><${Stack}>
          <${Text} kind="lead">${judge.own ? x('judgeLeadOwn', { name }) : x('judgeLeadAi', { name })}<//>
          ${picker(ctx, 'judge', judge.own ? judge.modelId : '')}
          <${Stack} direction="wrap" align="center">
            ${judge.own ? html`<${Action} disabled=${ctx.busy === 'models'} onClick=${() => ctx.setJudge(null)}>${x('judgeUseAiPage')}<//>` : null}
            ${judge.modelId && ctx.isOpenRouter ? html`<${Action} href=${modelPageUrl(judge.modelId)} target="_blank">${x('openModelPage')}<//>` : null}
            <${Action} onClick=${() => ctx.setPick(null)}>${x('close')}<//>
          <//>
        <//><//>` : null}
      <//>` : null}
    <//>`;
}

function candidateRow(ctx, m, i) {
  const model = findModel(m.modelId, ctx.models);
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : (ctx.keyed && ctx.models.length ? x('modelNotInList') : '');
  return html`
    <${ListRow} key=${m.id} name=${x('candidateN', { n: i + 1 })} detail=${x('candidateSub')}
      value=${modelValue(modelWords(model, m.modelId), m.modelId)}
      actions=${html`<${Action} tone="danger" disabled=${ctx.busy === 'models'} onClick=${() => ctx.removeCandidate(m.id)}>${x('remove')}<//>`}>
      ${facts ? html`<${Text} kind="caption" tone="muted">${facts}<//>` : null}
    <//>`;
}

/** The catalogue under an opened row: search, the recommended group, a row per model. */
function picker(ctx, slot, chosenId) {
  const pool = (ctx.models || []).filter(answersInText);
  if (!pool.length) return html`<${Text} tone="muted">${ctx.keyed ? x('modelsNone') : x('noKeyBody')}<//>`;
  const q = (ctx.query || '').trim().toLowerCase();
  const recommended = rankModels(pool, 'chat').slice(0, RECOMMENDED);
  const filtered = pool.filter((m) => matchesQuery(m, q));
  const visible = q ? filtered : (ctx.showAll ? filtered : recommended);
  const taken = new Set(candidatesOf(ctx.project).map((m) => m.modelId));
  return html`
    <${Stack} density="compact">
      <${Field} type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} ariaLabel=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
      ${!q && !ctx.showAll ? html`<${Text} kind="label">${x('recommended')}<//>` : null}
      ${visible.length ? html`<${Surface} kind="plain" density="flush" height="scroll">${visible.map((m) => pickerRow(ctx, slot, m, m.id === chosenId, slot === 'add' && taken.has(m.id)))}<//>` : html`<${Text} tone="muted">${x('noMatch')}<//>`}
      <${Stack} direction="wrap" align="center">
        ${!q && !ctx.showAll && filtered.length > visible.length ? html`<${Action} onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}<//>` : null}
        <${Text} kind="caption" tone="muted">${x('poolFacts', { n: pool.length })}<//>
      <//>
    <//>`;
}

function pickerRow(ctx, slot, m, on, taken) {
  // A model already under test, or any while one is being stored, is not taken again.
  const act = () => { if (ctx.busy === 'models' || taken) return; if (slot === 'judge') ctx.setJudge(m); else ctx.addCandidate(m); };
  return html`
    <${ListRow} key=${m.id} density="compact" selected=${on} muted=${taken} name=${modelWords(m, m.id)} onOpen=${taken ? undefined : act}
      detail=${[m.id, taken ? x('alreadyAdded') : ''].filter(Boolean).join(' · ')}
      value=${html`<${Stack} density="compact"><span>${priceWords(m, CHAT_ROLE)}</span><span>${contextWords(m)}</span><//>`} />`;
}
