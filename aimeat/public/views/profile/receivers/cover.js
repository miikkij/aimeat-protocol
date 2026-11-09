/**
 * @file public/views/profile/receivers/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Receivers page's cover (design canvas "Vastaanottimet", artboard Settings): the
 *   lede, the title's question mark (concept.receiver: what a receiver is, the use cases, when to use
 *   something else) and the one loud action "New receiver"; the page's start (PageStart: what it is
 *   for, the prompt for one's own AI, which then proposes a receiver they approve here, and what
 *   happens next); 01 the list of receivers (name, what it writes, its data description (CSM) or
 *   none, its state, today's counts and the last delivery); 02 how a new receiver is made on this
 *   node (the node setting receivers.mode in words); 03 the limits and safety facts (what it may do,
 *   what it may not, how it goes stale, its key). Pure render over the ctx bag; every part is a
 *   library component, and the file writes no class. How the page explains itself:
 *   .claude/rules/page-guidance.md.
 * @structure renderReceiversView · renderCover · secList · receiverRow · secNew · secHow
 * @usage import { renderReceiversView } from './receivers/cover.js';
 * @version-history
 *   v1.1.0 — 2026-11-08 — The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart in place of the dashed aside, and the title's question mark concept.receiver with
 *     the use cases.
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ago, num } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageSection } from '/components/PageSection.js';
import { List, Row, Name, Desc, Num, When, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Hint } from '/components/Hint.js';
import { PageStart } from '/components/PageStart.js';
import { openTab } from '/components/Rail.js';
import { x, crumb, pageLinks, targetWords, shapeWords, stateWord, stateTone } from './frame.js';
import { renderDetail } from './detail.js';
import { renderDialogs } from './dialogs.js';

const html = htm.bind(h);

export function renderReceiversView(ctx) {
  return html`${ctx.view.kind === 'detail' ? renderDetail(ctx) : renderCover(ctx)}${renderDialogs(ctx)}`;
}

function renderCover(ctx) {
  const list = ctx.list || [];
  const waiting = list.filter((r) => r.state === 'proposed').length;
  const refused = list.reduce((s, r) => s + (r.refused_today || 0), 0);
  const off = ctx.mode === 'off';
  const marks = ctx.list ? [
    { label: x('chipCount', { n: num(list.length) }) },
    waiting ? { label: x('chipWaiting', { n: num(waiting) }), tone: 'coral' } : null,
    refused ? { label: x('chipRefused', { n: num(refused) }), tone: 'coral' } : null,
    off ? { label: x('chipOff'), tone: 'dim' } : null,
  ] : [];
  const actions = html`<${Loud} disabled=${off} onClick=${() => ctx.openCreate()}>${x('new')}<//>`;
  const sections = [
    { id: 'rc-list', num: '01', label: x('secList'), count: ctx.list ? list.length : '' },
    { id: 'rc-new', num: '02', label: x('secNew') },
    { id: 'rc-how', num: '03', label: x('secHow') },
  ];
  // The start: folded once the person has a receiver; its button is the page's own form.
  const start = html`<${PageStart} id="receivers" done=${ctx.list ? list.length > 0 : null}
    action=${off ? undefined : { onClick: () => ctx.openCreate() }} />`;
  return html`
    <${SettingsPage} name="rc" crumb=${crumb(ctx)} title=${t('profile.tabs.receivers')} help="concept.receiver" marks=${marks}
      desc=${x('lede')} actions=${actions} start=${start}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secList(ctx, list)}
      ${secNew(ctx)}
      ${secHow()}
    <//>`;
}

function secList(ctx, list) {
  return html`
    <${PageSection} id="rc-list" num="01" title=${x('secList')} count=${ctx.list ? x('secListSub', { n: num(list.length) }) : ''} first>
      ${ctx.failed ? html`<${Note} kind="quiet">${x('loadFailed')} <${Action} small soft onClick=${() => ctx.reload()}>${x('retry')}<//><//>`
        : !ctx.list ? html`<${Note} kind="loading" />`
        : html`<${List} cols="name-desc-count-when-doors" keepCols
            head=${[x('col.name'), x('col.writes'), { label: x('col.today'), num: true }, x('col.last'), '']}
            empty=${html`<${Note} kind="quiet"><b>${x('emptyTitle')}</b> ${x('emptyBody')}<//>`}
            rows=${list} render=${(r) => receiverRow(ctx, r)} />`}
      <${Hint}>${x('listHint')}<//>
    <//>`;
}

function receiverRow(ctx, r) {
  const proposed = r.state === 'proposed';
  const open = () => (proposed ? ctx.openDecide(r.name) : ctx.openDetail(r.name));
  const today = r.delivered_today || 0;
  const refused = r.refused_today || 0;
  return html`
    <${Row} key=${r.uid} faded=${r.state === 'paused' || r.state === 'expired'}>
      <${Name} onOpen=${open} meta=${shapeWords(r)} warn=${!r.schema} note=${refused > 0 ? x('chipRefused', { n: num(refused) }) : undefined}
        tag=${html`<${Mark} kind="status" tone=${stateTone(r.state)}>${stateWord(r.state)}<//>`}>${r.display_name || r.name}<//>
      <${Desc} sub=${r.name}>${targetWords(r.target)}<//>
      <${Num} title=${x('todayLine', { n: num(today), refused: num(refused) })}>${num(today)}<//>
      <${When}>${r.last_delivery_at ? ago(r.last_delivery_at) : x('never')}<//>
      <${Doors}><${Action} small row onClick=${open}>${proposed ? x('decide') : x('open')}<//><//>
    <//>`;
}

function secNew(ctx) {
  const mode = ctx.mode || 'self';
  return html`
    <${PageSection} id="rc-new" num="02" title=${x('secNew')} count=${x('mode.' + mode + 'Chip')}>
      <${Note} kind="lead">${x('mode.' + mode)}<//>
      <${Facts} wide rows=${[
        { key: 'ai', k: x('newAiK'), v: x('newAiV') },
        { key: 'here', k: x('newHereK'), v: x('newHereV'), action: mode === 'off' ? null : html`<${Action} small onClick=${() => ctx.openCreate()}>${x('new')}<//>` },
        { key: 'agent', k: x('newAgentK'), v: x('newAgentV') },
      ]} />
    <//>`;
}

function secHow() {
  return html`
    <${PageSection} id="rc-how" num="03" title=${x('secHow')}>
      <${Facts} wide rows=${[
        { key: 'may', k: x('how.mayK'), v: x('how.mayV') },
        { key: 'not', k: x('how.notK'), v: x('how.notV') },
        { key: 'stale', k: x('how.staleK'), v: x('how.staleV') },
        // The Access page lists every credential that acts in the person's name, receiver keys included.
        { key: 'key', k: x('how.keyK'), v: x('how.keyV'), action: html`<${Action} small soft onClick=${() => openTab('access')}>${t('profile.tabs.access')}<//>` },      ]} />
    <//>`;
}
