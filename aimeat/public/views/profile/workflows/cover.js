/**
 * @file public/views/profile/workflows/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Workflows page in the poster face (design canvas "AIMEAT Työnkulkujen sivu",
 *   direction A). The COVER says of every workflow, in one sentence, what its last run did; lifts
 *   up what waits for the person and lets them answer there; gives a new workflow three roads (a
 *   chat over MCP, a chat without MCP with the answer pasted back, the form); and explains how to
 *   read all this as a fold. A workflow opens as its own page (detail.js), a run as its own
 *   (run.js), the form as its own (form.js). Pure render functions over the ctx bag; every part is
 *   a component that takes data (the page writes no class).
 * @structure renderWorkflowsView · renderCover · secWorkflows · secWaiting · questionBlock · secNew · pasteBlock · howToRead
 * @usage import { renderWorkflowsView } from './workflows/cover.js';
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- Every part is a component that takes data (page group G5): the page frame is the SettingsPage, the strip the FigureStrip, the check note and a waiting question the Box (the question's answers the Tabs, several at once where the question takes several, its own answer a TextField), the three roads the Roads, the paste box the TextArea with its message, how to read the page the Facts.
 *   v1.14.0 -- 2026-09-26 -- The workflows table's heading row is inside its Listing (workflowRows with head), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-26 -- A question waiting for the person is the Object box on the page's ground, its answers the Tab with the chosen one on the sun (a unification: Jouni's decision "Question box").
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- How to read this page is the Facts; a fold's paragraph is the lead and a read-only value under its label the Facts' value (a unification: the look most tabs use); the rail's dead base look goes.
 *   v1.10.0 -- 2026-09-25 -- A road or an option you choose is the Choice tile (.poster-choice), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the card list whose two buttons started things on the click.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollToSection } from '/components/Rail.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { Roads, Road } from '/components/Roads.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { c, loc, rel, day, triggerWords, crumb, workflowRows, pageLinks } from './frame.js';
import { renderDetail } from './detail.js';
import { renderRun } from './run.js';
import { renderForm } from './form.js';
import { Hint } from '/components/Hint.js';

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
  const tag = (n, key, tone) => ({ label: c(key, { n }), tone });
  const strip = html`<${FigureStrip} items=${[
    { key: 'waiting', n: waiting, tone: waiting ? 'coral' : undefined, label: c('stripWaiting'), sub: waiting ? ctx.pending.map(p => loc(p.workflowTitle) || p.workflowId).join(' · ') : c('stripWaitingNone') },
    { key: 'partial', n: partial, tone: partial ? 'coral' : undefined, label: c('stripPartial'), sub: partial ? items.filter(i => i.lastRun && (i.lastRun.status === 'partial' || i.lastRun.status === 'red')).map(i => loc(i.def.title) || i.def.id).join(' · ') : c('stripPartialNone') },
    { key: 'done', n: done, label: c('stripDone'), sub: c('stripDoneSub') },
    latest
      ? { key: 'latest', n: rel(latest.lastRun.startedAt), label: c('stripLatest'), sub: loc(latest.def.title) || latest.def.id }
      : { key: 'latest', n: '·', label: c('stripLatest'), sub: c('noRunsYet') },
  ]} />`;
  return html`<${SettingsPage} name="wp" crumb=${crumb(ctx, [])} title=${t('profile.workflows.title')}
    marks=${[tag(items.length, 'chipWorkflows'), scheduled ? tag(scheduled, 'chipScheduled') : null,
      waiting ? tag(waiting, 'chipWaiting', 'coral') : null, partial ? tag(partial, 'chipPartial', 'coral') : null]}
    desc=${c('desc')}
    actions=${html`
      <${Loud} onClick=${() => ctx.pickView({ kind: 'create' })}>${c('newWorkflow')}<//>
      <${Actions}><${Action} small onClick=${() => scrollToSection('wp-new')}>${c('promptToChat')}<//><//>`}
    strip=${strip}
    railTitle=${c('railTitle')}
    sections=${[
      { id: 'wp-list', num: '01', label: t('profile.workflows.title'), count: items.length },
      { id: 'wp-waiting', num: '02', label: c('secWaiting'), count: waiting },
      { id: 'wp-new', num: '03', label: c('secNew'), count: '' },
      { id: 'wp-how', num: '04', label: c('howTitle'), count: '', open: () => ctx.setFold('how', true) },
    ]}
    pagesLabel=${c('pages')} pages=${pageLinks()}
    after=${html`<${ctx.ConfirmUI} />`}>
      ${secWorkflows(ctx)}
      ${secWaiting(ctx)}
      ${secNew(ctx)}
      <${FoldSection} clip id="wp-how" num="04" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howToRead()}<//>
  <//>`;
}

function secWorkflows(ctx) {
  const list = ctx.onlyProblems ? ctx.items.filter(i => i.waiting || (i.lastRun && i.lastRun.status !== 'done')) : ctx.items;
  const doors = html`<${Tab} tone="fold" on=${!ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(false)}>${c('all')}<//><${Tab} tone="fold" on=${ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(true)}>${c('onlyProblems')}<//>`;
  return html`
    <${PageSection} id="wp-list" num="01" title=${t('profile.workflows.title')} count=${`${ctx.items.length} · ${c('secListSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.items.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !list.length ? html`<${Note} kind="quiet">${ctx.items.length ? c('emptyProblems') : c('empty')}<//>`
        : workflowRows(ctx, list, { head: true })}
      ${ctx.checkNote ? html`<${Box} name=${ctx.checkNote.title}
        end=${html`<${Action} small soft onClick=${() => ctx.setCheckNote(null)}>${c('close')}<//>`}>${ctx.checkNote.text}<//>` : null}
      <${Hint}>${c('listHint')}<//>
    <//>`;
}

function secWaiting(ctx) {
  return html`
    <${PageSection} id="wp-waiting" num="02" title=${c('secWaiting')} count=${ctx.pending.length}>
      ${!ctx.pending.length ? html`<${Note} kind="quiet">${c('waitingNone')}<//>` : ctx.pending.map(p => questionBlock(ctx, p, true))}
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
    <${Box} key=${key} name=${`${wf ? `${wf} · ` : ''}${q.header || p.stepId}: ${q.prompt || ''}`}
      doors=${html`
        <${Loud} control disabled=${ctx.answering || (!a.picks.length && !a.other.trim())} onClick=${() => ctx.handleAnswer(p, a)}>${c('answerAndGo')}<//>
        <${Action} small onClick=${() => ctx.pickView({ kind: 'run', id: p.workflowId, runId: p.runId })}>${c('openRun')}<//>
        <${Action} small soft onClick=${() => ctx.handleCancel(p.workflowId, p.runId)}>${t('profile.workflows.cancelRun')}<//>`}>
      <${Stack}>
        <${Note}>${c('askedSub', { when: rel(p.askedAt), deadline: day(p.deadline) })}<//>
        <${Tabs} kind="toggle" label=${q.prompt || q.header || p.stepId} value=${a.picks} onSelect=${(id) => pick(id)}
          items=${(q.options || []).map(o => ({ value: o.id, label: o.label, key: o.id }))} />
        ${q.allowOther ? html`<${TextField} size="medium" ariaLabel=${c('otherAnswer')} placeholder=${c('otherAnswer')} value=${a.other} onInput=${v => ctx.setAnswer(key, { ...a, other: v })} />` : null}
      <//>
    <//>`;
}

function secNew(ctx) {
  const road = (key, k, title, body, doors) => html`<${Road} key=${key} chosen=${ctx.road === key} onPick=${() => ctx.setRoad(key)} kicker=${k} name=${title} text=${body} doors=${doors} />`;
  return html`
    <${PageSection} id="wp-new" num="03" title=${c('secNew')} count=${c('threeRoads')}>
      <${Roads} cols="three">
        ${road('mcp', c('roadMcpK'), c('roadMcpTitle'), c('roadMcpBody'), html`<${Action} small onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-mcp'); }}>${c('copyPrompt')}<//>`)}
        ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<${Action} small onClick=${e => { e.stopPropagation(); ctx.copyPrompt('create-chat'); }}>${c('copyPrompt')}<//>
          <${Action} small soft onClick=${e => { e.stopPropagation(); ctx.setRoad('chat'); ctx.setPasteOpen(true); }}>${c('pasteResult')}<//>`)}
        ${road('form', c('roadFormK'), c('roadFormTitle'), c('roadFormBody'), html`<${Action} small onClick=${e => { e.stopPropagation(); ctx.pickView({ kind: 'create' }); }}>${c('openForm')}<//>`)}
      <//>
      ${ctx.pasteOpen ? pasteBlock(ctx) : null}
      <${Hint}>${c('newHint')}<//>
    <//>`;
}

function pasteBlock(ctx) {
  return html`
    <${Stack} above="medium">
      <${TextArea} id="wp-paste" label=${c('pasteLabel')} rows=${6} value=${ctx.pasteText} onInput=${v => ctx.setPasteText(v)} placeholder=${c('pastePlaceholder')}
        message=${ctx.pasteError || null} error />
      <${Actions}>
        <${Loud} control disabled=${!ctx.pasteText.trim()} onClick=${() => ctx.handlePaste()}>${c('pasteOpenInForm')}<//>
        <${Action} small soft onClick=${() => ctx.setPasteOpen(false)}>${t('profile.cancel')}<//>
      <//>
    <//>`;
}

/** How to read this page: the words, in the reader's language, once. */
export function howToRead() {
  const rows = ['step', 'input', 'produced', 'partial', 'check', 'run', 'gate', 'trigger'];
  return html`<${Facts} wide rows=${rows.map(k => ({ key: k, k: c('how.' + k + 'T'), v: c('how.' + k + 'D') }))} />`;
}

export { triggerWords };
