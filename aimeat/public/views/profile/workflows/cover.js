/**
 * @file public/views/profile/workflows/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Workflows page in the poster face (design canvas "AIMEAT Työnkulkujen sivu",
 *   direction A). The COVER says of every workflow, in one sentence, what its last run did; lifts
 *   up what waits for the person and lets them answer there; gives a new workflow three roads (a
 *   chat over MCP, a chat without MCP with the answer pasted back, the form); and explains how to
 *   read all this as a fold. A workflow opens as its own page (detail.js), a run as its own
 *   (run.js), the form as its own (form.js). Pure render functions over the ctx bag.
 * @structure renderWorkflowsView · renderCover · secWorkflows · secWaiting · questionBlock · secNew · pasteBlock · howToRead
 * @usage import { renderWorkflowsView } from './workflows/cover.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the card list whose two buttons started things on the click.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, loc, rel, day, triggerWords, crumb, workflowRows, rowsHead, pageLinks } from './frame.js';
import { renderDetail } from './detail.js';
import { renderRun } from './run.js';
import { renderForm } from './form.js';

export function renderWorkflowsView(ctx) {
  const v = ctx.view;
  if (v.kind === 'detail' && ctx.itemById(v.id)) return renderDetail(ctx, ctx.itemById(v.id));
  if (v.kind === 'run' && ctx.itemById(v.id)) return renderRun(ctx, ctx.itemById(v.id), v.runId);
  if (v.kind === 'edit' || v.kind === 'create') return renderForm(ctx);
  return renderCover(ctx);
}

function renderCover(ctx) {
  const items = ctx.items;
  const scheduled = items.filter(i => i.def.trigger?.kind === 'schedule').length;
  const waiting = ctx.pending.length;
  const partial = items.filter(i => i.lastRun && (i.lastRun.status === 'partial' || i.lastRun.status === 'red')).length;
  const done = items.filter(i => i.lastRun?.status === 'done').length;
  const latest = items.filter(i => i.lastRun).sort((a, z) => new Date(z.lastRun.startedAt).getTime() - new Date(a.lastRun.startedAt).getTime())[0];
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div><b class=${waiting ? 'og-strip-coral' : ''}>${waiting}</b><span>${c('stripWaiting')}</span><small>${waiting ? ctx.pending.map(p => loc(p.workflowTitle) || p.workflowId).join(' · ') : c('stripWaitingNone')}</small></div>
      <div><b class=${partial ? 'og-strip-coral' : ''}>${partial}</b><span>${c('stripPartial')}</span><small>${partial ? items.filter(i => i.lastRun && (i.lastRun.status === 'partial' || i.lastRun.status === 'red')).map(i => loc(i.def.title) || i.def.id).join(' · ') : c('stripPartialNone')}</small></div>
      <div><b>${done}</b><span>${c('stripDone')}</span><small>${c('stripDoneSub')}</small></div>
      <div>${latest ? html`<b>${rel(latest.lastRun.startedAt)}</b><span>${c('stripLatest')}</span><small>${loc(latest.def.title) || latest.def.id}</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('noRunsYet')}</small>`}</div>
    </div>`;
  return html`
    <div class="og og-wp">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('profile.workflows.title')}</h1>
          <div class="og-chips">
            ${chip(items.length, 'chipWorkflows')}${scheduled ? chip(scheduled, 'chipScheduled') : null}${waiting ? chip(waiting, 'chipWaiting', 'og-chip--coral') : null}${partial ? chip(partial, 'chipPartial', 'og-chip--coral') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => ctx.pickView({ kind: 'create' })}>${c('newWorkflow')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => scrollTo('wp-new')}>${c('promptToChat')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secWorkflows(ctx)}
          ${secWaiting(ctx)}
          ${secNew(ctx)}
          <${Fold} id="wp-how" num="04" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howToRead()}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'wp-list', t('profile.workflows.title'), items.length], ['02', 'wp-waiting', c('secWaiting'), waiting], ['03', 'wp-new', c('secNew'), ''], ['04', 'wp-how', c('howTitle'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secWorkflows(ctx) {
  const list = ctx.onlyProblems ? ctx.items.filter(i => i.waiting || (i.lastRun && i.lastRun.status !== 'done')) : ctx.items;
  const doors = html`<button type="button" class=${`og-door og-door--quiet ${!ctx.onlyProblems ? 'on' : ''}`} onClick=${() => ctx.setOnlyProblems(false)}>${c('all')}</button><button type="button" class=${`og-door og-door--quiet ${ctx.onlyProblems ? 'on' : ''}`} onClick=${() => ctx.setOnlyProblems(true)}>${c('onlyProblems')}</button>`;
  return html`
    <${Section} id="wp-list" num="01" title=${t('profile.workflows.title')} count=${`${ctx.items.length} · ${c('secListSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.items.length ? html`<p class="og-empty wp-loading">${t('common.loading')}</p>`
        : !list.length ? html`<p class="og-empty">${ctx.items.length ? c('emptyProblems') : c('empty')}</p>`
        : html`${rowsHead()}${workflowRows(ctx, list)}`}
      ${ctx.checkNote ? html`<div class="wp-note"><b>${ctx.checkNote.title}</b><span>${ctx.checkNote.text}</span><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setCheckNote(null)}>${c('close')}</button></div>` : null}
      <p class="wp-hint">${c('listHint')}</p>
    <//>`;
}

function secWaiting(ctx) {
  return html`
    <${Section} id="wp-waiting" num="02" title=${c('secWaiting')} count=${ctx.pending.length}>
      ${!ctx.pending.length ? html`<p class="og-empty">${c('waitingNone')}</p>` : ctx.pending.map(p => questionBlock(ctx, p, true))}
    <//>`;
}

/** A question a run put to the person, with the answer right there. */
export function questionBlock(ctx, p, withTitle) {
  const q = p.question || {};
  const key = `${p.runId}:${p.stepId}`;
  const a = ctx.answers[key] || { picks: [], other: '' };
  const pick = (id) => {
    const picks = q.multiSelect ? (a.picks.includes(id) ? a.picks.filter(x => x !== id) : [...a.picks, id]) : [id];
    ctx.setAnswer(key, { ...a, picks });
  };
  const wf = withTitle ? (loc(p.workflowTitle) || p.workflowId) : null;
  return html`
    <div class="wp-ask" key=${key}>
      <b>${wf ? `${wf} · ` : ''}${q.header || p.stepId}: ${q.prompt || ''}</b>
      <p>${c('askedSub', { when: rel(p.askedAt), deadline: day(p.deadline) })}</p>
      <div class="og-choice wp-ask-choice">${(q.options || []).map(o => html`<button type="button" key=${o.id} class=${`og-choice-btn ${a.picks.includes(o.id) ? 'on' : ''}`} onClick=${() => pick(o.id)}>${o.label}</button>`)}</div>
      ${q.allowOther ? html`<input class="og-input wp-ask-other" placeholder=${c('otherAnswer')} value=${a.other} onInput=${e => ctx.setAnswer(key, { ...a, other: e.target.value })} />` : null}
      <div class="og-doors">
        <button type="button" class="og-slab" disabled=${ctx.answering || (!a.picks.length && !a.other.trim())} onClick=${() => ctx.handleAnswer(p, a)}>${c('answerAndGo')}</button>
        <button type="button" class="og-door" onClick=${() => ctx.pickView({ kind: 'run', id: p.workflowId, runId: p.runId })}>${c('openRun')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.handleCancel(p.workflowId, p.runId)}>${t('profile.workflows.cancelRun')}</button>
      </div>
    </div>`;
}

function secNew(ctx) {
  const road = (key, k, title, body, doors) => html`
    <div class=${`wp-road ${ctx.road === key ? 'on' : ''}`} key=${key} onClick=${() => ctx.setRoad(key)}>
      <span class="wp-road-k">${k}</span><b>${title}</b><p>${body}</p><div class="og-doors">${doors}</div>
    </div>`;
  return html`
    <${Section} id="wp-new" num="03" title=${c('secNew')} count=${c('threeRoads')}>
      <div class="wp-roads">
        ${road('mcp', c('roadMcpK'), c('roadMcpTitle'), c('roadMcpBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-mcp'); }}>${c('copyPrompt')}</button>`)}
        ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-chat'); }}>${c('copyPrompt')}</button><button type="button" class="og-door og-door--quiet" onClick=${e => { e.stopPropagation(); ctx.setRoad('chat'); ctx.setPasteOpen(true); }}>${c('pasteResult')}</button>`)}
        ${road('form', c('roadFormK'), c('roadFormTitle'), c('roadFormBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.pickView({ kind: 'create' }); }}>${c('openForm')}</button>`)}
      </div>
      ${ctx.pasteOpen ? pasteBlock(ctx) : null}
      <p class="wp-hint">${c('newHint')}</p>
    <//>`;
}

function pasteBlock(ctx) {
  return html`
    <div class="wp-paste">
      <label class="og-label" for="wp-paste">${c('pasteLabel')}</label>
      <textarea id="wp-paste" class="og-textarea" rows="6" value=${ctx.pasteText} onInput=${e => ctx.setPasteText(e.target.value)} placeholder=${c('pastePlaceholder')}></textarea>
      ${ctx.pasteError ? html`<p class="wp-error">${ctx.pasteError}</p>` : null}
      <div class="og-doors"><button type="button" class="og-slab" disabled=${!ctx.pasteText.trim()} onClick=${() => ctx.handlePaste()}>${c('pasteOpenInForm')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setPasteOpen(false)}>${t('profile.cancel')}</button></div>
    </div>`;
}

/** How to read this page: the words, in the reader's language, once. */
export function howToRead() {
  const rows = ['step', 'input', 'produced', 'partial', 'check', 'run', 'gate', 'trigger'];
  return html`<div class="wp-words">${rows.map(k => html`<div key=${k}><b>${c('how.' + k + 'T')}</b></div><div key=${k + 'd'}>${c('how.' + k + 'D')}</div>`)}</div>`;
}

export { triggerWords };
