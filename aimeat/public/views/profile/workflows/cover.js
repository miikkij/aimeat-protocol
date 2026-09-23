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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, NumeralBand strip, Table,
 *     Surface boxes for a question and the three roads, Field, Action tabs for the answer's
 *     options, KeyValue for the words; no own CSS. Every word and handler is the one it was.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the card list whose two buttons started things on the click.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Stack, Columns, Surface, NumeralBand, KeyValue, Field, Action, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, loc, rel, day, triggerWords, crumb, chipRow, workflowRows, pageLinks } from './frame.js';
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
  const partialItems = items.filter(i => i.lastRun && (i.lastRun.status === 'partial' || i.lastRun.status === 'red'));
  const partial = partialItems.length;
  const done = items.filter(i => i.lastRun?.status === 'done').length;
  const latest = items.filter(i => i.lastRun).sort((a, z) => new Date(z.lastRun.startedAt).getTime() - new Date(a.lastRun.startedAt).getTime())[0];
  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: c('stripWaiting'), value: waiting, note: waiting ? ctx.pending.map(p => loc(p.workflowTitle) || p.workflowId).join(' · ') : c('stripWaitingNone'), tone: waiting ? 'coral' : undefined },
    { label: c('stripPartial'), value: partial, note: partial ? partialItems.map(i => loc(i.def.title) || i.def.id).join(' · ') : c('stripPartialNone'), tone: partial ? 'coral' : undefined },
    { label: c('stripDone'), value: done, note: c('stripDoneSub') },
    latest ? { label: c('stripLatest'), value: rel(latest.lastRun.startedAt), note: loc(latest.def.title) || latest.def.id }
      : { label: c('stripLatest'), value: '·', note: c('noRunsYet') },
  ]} />`;
  const chips = chipRow([
    [c('chipWorkflows', { n: items.length })],
    scheduled && [c('chipScheduled', { n: scheduled })],
    waiting && [c('chipWaiting', { n: waiting }), 'sun'],
    partial && [c('chipPartial', { n: partial }), 'sun'],
  ]);
  const actions = html`<${Action} kind="primary" onClick=${() => ctx.pickView({ kind: 'create' })}>${c('newWorkflow')}<//>
    <${Action} onClick=${() => scrollTo('wp-new')}>${c('promptToChat')}<//>`;
  const rail = html`<${Rail} kind="index" title=${c('railTitle')} entries=${[
    { href: '#wp-list', label: t('profile.workflows.title'), count: items.length },
    { href: '#wp-waiting', label: c('secWaiting'), count: waiting },
    { href: '#wp-new', label: c('secNew') },
    { href: '#wp-how', label: c('howTitle') },
  ]}>${pageLinks()}<//>`;
  return html`<${Page} width="wide" title=${t('profile.workflows.title')} crumbs=${crumb(ctx, [])} identity=${chips} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${c('desc')}<//>
      ${strip}
      ${secWorkflows(ctx)}
      ${secWaiting(ctx)}
      ${secNew(ctx)}
      <${Fold} id="wp-how" number="04" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howToRead()}<//>
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function secWorkflows(ctx) {
  const list = ctx.onlyProblems ? ctx.items.filter(i => i.waiting || (i.lastRun && i.lastRun.status !== 'done')) : ctx.items;
  const actions = html`<${Action} kind="tab" selected=${!ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(false)}>${c('all')}<//>
    <${Action} kind="tab" selected=${ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(true)}>${c('onlyProblems')}<//>`;
  return html`
    <${Section} id="wp-list" title=${t('profile.workflows.title')} count=${`${ctx.items.length} · ${c('secListSub')}`} actions=${actions}>
      <${Stack}>
        ${ctx.loading && !ctx.items.length ? html`<${Text} tone="muted">${t('common.loading')}<//>`
          : !list.length ? html`<${Text} tone="muted">${ctx.items.length ? c('emptyProblems') : c('empty')}<//>`
          : workflowRows(ctx, list)}
        ${ctx.checkNote ? html`<${Surface} kind="box" tone="sun" density="compact"><${Stack} density="compact">
          <${Text} kind="label">${ctx.checkNote.title}<//>
          <${Text}>${ctx.checkNote.text}<//>
          <${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.setCheckNote(null)}>${c('close')}<//><//>
        <//><//>` : null}
        <${Text} kind="caption" tone="muted">${c('listHint')}<//>
      <//>
    <//>`;
}

function secWaiting(ctx) {
  return html`
    <${Section} id="wp-waiting" title=${c('secWaiting')} count=${ctx.pending.length}>
      ${!ctx.pending.length ? html`<${Text} tone="muted">${c('waitingNone')}<//>` : html`<${Stack}>${ctx.pending.map(p => questionBlock(ctx, p, true))}<//>`}
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
  return html`<${Surface} key=${key} kind="box"><${Stack}>
    <${Text}><strong>${wf ? `${wf} · ` : ''}${q.header || p.stepId}: ${q.prompt || ''}</strong><//>
    <${Text} kind="caption" tone="muted">${c('askedSub', { when: rel(p.askedAt), deadline: day(p.deadline) })}<//>
    <${Stack} direction="wrap" density="compact">${(q.options || []).map(o => html`<${Action} key=${o.id} kind="tab" selected=${a.picks.includes(o.id)} onClick=${() => pick(o.id)}>${o.label}<//>`)}<//>
    ${q.allowOther ? html`<${Field} placeholder=${c('otherAnswer')} value=${a.other} onInput=${e => ctx.setAnswer(key, { ...a, other: e.target.value })} />` : null}
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${ctx.answering || (!a.picks.length && !a.other.trim())} onClick=${() => ctx.handleAnswer(p, a)}>${c('answerAndGo')}<//>
      <${Action} onClick=${() => ctx.pickView({ kind: 'run', id: p.workflowId, runId: p.runId })}>${c('openRun')}<//>
      <${Action} onClick=${() => ctx.handleCancel(p.workflowId, p.runId)}>${t('profile.workflows.cancelRun')}<//>
    <//>
  <//><//>`;
}

function secNew(ctx) {
  const road = (key, k, title, body, doors) => html`<${Surface} key=${key} kind="box" tone=${ctx.road === key ? 'sun' : 'plain'} onClick=${() => ctx.setRoad(key)}>
    <${Stack} density="compact">
      <${Text} kind="label">${k}<//>
      <${Text}><strong>${title}</strong><//>
      <${Text}>${body}<//>
      <${Stack} direction="wrap" density="compact">${doors}<//>
    <//>
  <//>`;
  return html`
    <${Section} id="wp-new" title=${c('secNew')} count=${c('threeRoads')}>
      <${Stack}>
        <${Columns} layout="thirds" collapse="560" density="compact">
          ${road('mcp', c('roadMcpK'), c('roadMcpTitle'), c('roadMcpBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-mcp'); }}>${c('copyPrompt')}<//>`)}
          ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-chat'); }}>${c('copyPrompt')}<//>
            <${Action} onClick=${e => { e.stopPropagation(); ctx.setRoad('chat'); ctx.setPasteOpen(true); }}>${c('pasteResult')}<//>`)}
          ${road('form', c('roadFormK'), c('roadFormTitle'), c('roadFormBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.pickView({ kind: 'create' }); }}>${c('openForm')}<//>`)}
        <//>
        ${ctx.pasteOpen ? pasteBlock(ctx) : null}
        <${Text} kind="caption" tone="muted">${c('newHint')}<//>
      <//>
    <//>`;
}

function pasteBlock(ctx) {
  return html`<${Stack}>
    <${Field} id="wp-paste" type="textarea" rows="6" label=${c('pasteLabel')} value=${ctx.pasteText} onInput=${e => ctx.setPasteText(e.target.value)} placeholder=${c('pastePlaceholder')}
      error=${ctx.pasteError || undefined} />
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${!ctx.pasteText.trim()} onClick=${() => ctx.handlePaste()}>${c('pasteOpenInForm')}<//>
      <${Action} onClick=${() => ctx.setPasteOpen(false)}>${t('profile.cancel')}<//>
    <//>
  <//>`;
}

/** How to read this page: the words, in the reader's language, once. */
export function howToRead() {
  const rows = ['step', 'input', 'produced', 'partial', 'check', 'run', 'gate', 'trigger'];
  return html`<${Stack} density="compact">${rows.map(k => html`<${KeyValue} key=${k} label=${c('how.' + k + 'T')} value=${c('how.' + k + 'D')} />`)}<//>`;
}

export { triggerWords };
