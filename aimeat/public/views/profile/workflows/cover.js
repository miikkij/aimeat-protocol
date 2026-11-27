/**
 * @file public/views/profile/workflows/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Workflows page in the poster face (design canvas "AIMEAT Työnkulkujen sivu",
 *   direction A). The COVER says of every workflow, in one sentence, what its last run did; lifts
 *   up what waits for the person and lets them answer there; gives a new workflow three roads (a
 *   chat over MCP, a chat without MCP with the answer pasted back, the form). How the page explains
 *   itself (.claude/rules/page-guidance.md): PageStart "workflows" under the head and the title's
 *   question mark concept.workflow, which says what a step, a check, a run and "stopped short" are.
 *   A workflow opens as its own page (detail.js), a run as its own (run.js), the form as its own
 *   (form.js). Pure render functions over the ctx bag; every part is a component that takes data
 *   (the page writes no class).
 * @structure renderWorkflowsView · renderCover · secWorkflows · secWaiting · questionBlock · secNew · pasteBlock
 * @usage import { renderWorkflowsView } from './workflows/cover.js';
 * @version-history
 *   v1.18.0 -- 2026-11-27 -- Usability pass on the person's three situations. The strip's first figure
 *     counts every workflow (its line how many run on a schedule) and the strip takes hideZeros, so an
 *     empty page has no band of zeros; "done in their last run" is gone and "waiting" and "stopped short"
 *     take the notice tone. A question that waits is section 01 and the list follows; the list puts a
 *     waiting workflow first, then one that stopped short. One Loud: the first question's answer while
 *     one waits, otherwise "New workflow" in the head; every other answer and the paste box's button are
 *     ordinary actions. "New workflow" (wp-new) is a fold row, open while there is no workflow. The head
 *     marks repeated the strip and are gone; the filter and the hint are drawn once there is a workflow.
 *     Sections are numbered after the filter. No control was removed.
 *   v1.17.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md): PageStart under the head (folded once a workflow exists, its button the form) and the title's question mark concept.workflow. Section 04 "How to read this" (a fold of eight word explanations, howToRead) goes; what it said is in the concept.
 *   v1.16.0 -- 2026-10-16 -- A failed first load shows the could-not-load note with Retry instead of "no
 *     workflows" (ctx.itemsFailed) (QA audit F6-05).
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
import { PageStart } from '/components/PageStart.js';
import { FigureStrip } from '/components/FigureStrip.js';
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
import { LoadFailed } from '/js/load-state.js';

export function renderWorkflowsView(ctx) {
  const v = ctx.view;
  if (v.kind === 'detail' && ctx.itemById(v.id)) return renderDetail(ctx, ctx.itemById(v.id));
  if (v.kind === 'run' && ctx.itemById(v.id)) return renderRun(ctx, ctx.itemById(v.id), v.runId);
  if (v.kind === 'edit' || v.kind === 'create') return renderForm(ctx);
  return renderCover(ctx);
}

/** A last run that stopped short: the strip's figure and the list's order read the same test. */
const stoppedShort = (i) => !!i.lastRun && (i.lastRun.status === 'partial' || i.lastRun.status === 'red');
/** The list order: a workflow that waits for the person, then one whose last run stopped short, then the rest. */
const rankOf = (i) => (i.waiting ? 0 : stoppedShort(i) ? 1 : 2);

function renderCover(ctx) {
  // Stable: within a rank the server's order stays.
  const items = ctx.items.map((i, n) => [i, n]).sort((a, z) => (rankOf(a[0]) - rankOf(z[0])) || (a[1] - z[1])).map(([i]) => i);
  const scheduled = items.filter(i => i.def.trigger?.kind === 'schedule').length;
  const waiting = ctx.pending.length;
  const partial = items.filter(stoppedShort).length;
  const latest = items.filter(i => i.lastRun).sort((a, z) => new Date(z.lastRun.startedAt).getTime() - new Date(a.lastRun.startedAt).getTime())[0];
  // The figures, from what the page already read: every workflow (and how many run on a schedule),
  // the questions that wait for the person and the workflows that stopped short (both in the notice
  // tone when there are any), and the latest run. With no workflow at all the strip is not drawn.
  const strip = ctx.loading && !items.length ? html`<${FigureStrip} loading=${4} />` : ctx.itemsFailed ? null : html`<${FigureStrip} hideZeros items=${[
    { key: 'all', n: items.length, label: c('stripAll'), sub: scheduled ? c('chipScheduled', { n: scheduled }) : undefined },
    { key: 'waiting', n: waiting, tone: waiting ? 'notice' : undefined, label: c('stripWaiting'), sub: waiting ? ctx.pending.map(p => loc(p.workflowTitle) || p.workflowId).join(' · ') : c('stripWaitingNone') },
    { key: 'partial', n: partial, tone: partial ? 'notice' : undefined, label: c('stripPartial'), sub: partial ? items.filter(stoppedShort).map(i => loc(i.def.title) || i.def.id).join(' · ') : c('stripPartialNone') },
    latest
      ? { key: 'latest', n: rel(latest.lastRun.startedAt), label: c('stripLatest'), sub: loc(latest.def.title) || latest.def.id }
      : { key: 'latest', n: '·', label: c('stripLatest'), sub: c('noRunsYet') },
  ]} />`;
  // The start (page-guidance.md): its button is this page's own form.
  const start = html`<${PageStart} id="workflows" done=${ctx.loading && !items.length ? null : items.length > 0}
    action=${{ onClick: () => ctx.pickView({ kind: 'create' }) }} />`;
  const openNew = () => { ctx.setFold('new', true); scrollToSection('wp-new'); };
  // One loud action: while a question waits, its answer (in the first question box); otherwise the
  // page's own form.
  const actions = html`
    ${waiting
      ? html`<${Action} small onClick=${() => ctx.pickView({ kind: 'create' })}>${c('newWorkflow')}<//>`
      : html`<${Loud} onClick=${() => ctx.pickView({ kind: 'create' })}>${c('newWorkflow')}<//>`}
    <${Actions}><${Action} small onClick=${openNew}>${c('promptToChat')}<//><//>`;
  // What is drawn, numbered after the filter: a question that waits comes first, then the list
  // (always: with no workflow its one line is the page's empty line), then the three ways to make a
  // new one as a row.
  const shown = [
    waiting ? { id: 'wp-waiting', label: c('secWaiting'), count: waiting } : null,
    { id: 'wp-list', label: t('profile.workflows.title'), count: items.length },
    { id: 'wp-new', label: c('secNew') },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  return html`<${SettingsPage} name="wp" crumb=${crumb(ctx, [])} title=${t('profile.workflows.title')} help="concept.workflow"
    start=${start}
    desc=${c('desc')}
    actions=${actions}
    strip=${strip}
    railTitle=${c('railTitle')}
    sections=${shown}
    pagesLabel=${c('pages')} pages=${pageLinks()}
    after=${html`<${ctx.ConfirmUI} />`}>
      ${numOf['wp-waiting'] ? secWaiting(ctx, numOf['wp-waiting']) : null}
      ${secWorkflows(ctx, items, numOf['wp-list'], !waiting)}
      ${secNew(ctx, numOf['wp-new'], items.length === 0)}
  <//>`;
}

function secWorkflows(ctx, items, n, first) {
  const list = ctx.onlyProblems ? items.filter(i => i.waiting || (i.lastRun && i.lastRun.status !== 'done')) : items;
  // The filter is drawn once there is something to filter.
  const doors = items.length ? html`<${Tab} tone="fold" on=${!ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(false)}>${c('all')}<//><${Tab} tone="fold" on=${ctx.onlyProblems} onClick=${() => ctx.setOnlyProblems(true)}>${c('onlyProblems')}<//>` : null;
  return html`
    <${PageSection} id="wp-list" num=${n} title=${t('profile.workflows.title')} count=${items.length ? `${items.length} · ${c('secListSub')}` : ''} doors=${doors} first=${first}>
      ${ctx.itemsFailed ? html`<${LoadFailed} onRetry=${ctx.reload} />`
        : ctx.loading && !items.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !list.length ? html`<${Note} kind="quiet">${items.length ? c('emptyProblems') : c('empty')}<//>`
        : workflowRows(ctx, list, { head: true })}
      ${ctx.checkNote ? html`<${Box} name=${ctx.checkNote.title}
        end=${html`<${Action} small soft onClick=${() => ctx.setCheckNote(null)}>${c('close')}<//>`}>${ctx.checkNote.text}<//>` : null}
      ${items.length ? html`<${Hint}>${c('listHint')}<//>` : null}
    <//>`;
}

function secWaiting(ctx, n) {
  return html`
    <${PageSection} id="wp-waiting" num=${n} title=${c('secWaiting')} count=${ctx.pending.length} first>
      ${ctx.pending.map((p, i) => questionBlock(ctx, p, true, i === 0))}
    <//>`;
}

/**
 * A question a run put to the person, with the answer right there. `loud`: this is the page's one
 * main action (the first question that waits); every other answer is an ordinary action.
 */
export function questionBlock(ctx, p, withTitle, loud = true) {
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
        ${loud
          ? html`<${Loud} control disabled=${ctx.answering || (!a.picks.length && !a.other.trim())} onClick=${() => ctx.handleAnswer(p, a)}>${c('answerAndGo')}<//>`
          : html`<${Action} small disabled=${ctx.answering || (!a.picks.length && !a.other.trim())} onClick=${() => ctx.handleAnswer(p, a)}>${c('answerAndGo')}<//>`}
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

/**
 * The three ways to make a workflow, as one row that opens in place. With no workflow yet it is open
 * until the person closes it, since it is how one begins.
 */
function secNew(ctx, n, none) {
  const road = (key, k, title, body, doors) => html`<${Road} key=${key} chosen=${ctx.road === key} onPick=${() => ctx.setRoad(key)} kicker=${k} name=${title} text=${body} doors=${doors} />`;
  const open = ctx.folds.new ?? none;
  return html`
    <${FoldSection} id="wp-new" num=${n} title=${c('secNew')} sub=${c('threeRoads')} open=${open} onToggle=${() => ctx.setFold('new', !open)}>
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
        <${Action} control disabled=${!ctx.pasteText.trim()} onClick=${() => ctx.handlePaste()}>${c('pasteOpenInForm')}<//>
        <${Action} small soft onClick=${() => ctx.setPasteOpen(false)}>${t('profile.cancel')}<//>
      <//>
    <//>`;
}

export { triggerWords };
