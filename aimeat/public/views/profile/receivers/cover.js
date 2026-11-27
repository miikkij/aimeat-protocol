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
 *   Since 2026-11-27 the order is 01 the list, 02 the limits and safety facts (only once there is a
 *   receiver), 03 how a new one is made as one row that says the node's mode and opens in place;
 *   numbered after the filter.
 * @structure renderReceiversView · renderCover · rankOf · secList · receiverRow · secNew · secHow
 * @usage import { renderReceiversView } from './receivers/cover.js';
 * @version-history
 *   v1.2.0 -- 2026-11-27 -- Where things stand is a figure strip (webhooks and how many work, proposals
 *     that wait for the person, refused and delivered today) from the list the page already reads, with
 *     hideZeros; the head keeps only the "switched off" mark. A proposal comes first in the list, then
 *     a webhook with refusals today. "Making an incoming webhook" is a FoldSection whose row says the
 *     mode; the limits section is drawn once there is a webhook. The empty line says the one way to
 *     get one (or that the operator switched them off). No control was removed.
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
import { FoldSection } from '/components/FoldSection.js';
import { FigureStrip } from '/components/FigureStrip.js';
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

/** The list order: a proposal that waits for the person, then a webhook with refusals today, then the rest. */
const rankOf = (r) => (r.state === 'proposed' ? 0 : (r.refused_today || 0) > 0 ? 1 : 2);

function renderCover(ctx) {
  // Stable: within a rank the server's order stays.
  const list = (ctx.list || []).map((r, i) => [r, i]).sort((a, b) => (rankOf(a[0]) - rankOf(b[0])) || (a[1] - b[1])).map(([r]) => r);
  const waiting = list.filter((r) => r.state === 'proposed').length;
  const working = list.filter((r) => r.state === 'active').length;
  const refused = list.reduce((s, r) => s + (r.refused_today || 0), 0);
  const delivered = list.reduce((s, r) => s + (r.delivered_today || 0), 0);
  const off = ctx.mode === 'off';
  const marks = off && ctx.list ? [{ label: x('chipOff'), tone: 'dim' }] : [];
  // The figures, from the list the page already read: every webhook (and how many work), the
  // proposals that wait for the person's decision, and today's refused and delivered messages.
  // With no webhook at all the strip is not drawn.
  const strip = ctx.failed ? null : !ctx.list ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'all', n: list.length, label: x('stripAll'), sub: list.length ? x('stripAllSub', { n: num(working) }) : undefined },
    { key: 'waiting', n: waiting, tone: waiting ? 'notice' : undefined, label: x('stripWaiting'), sub: waiting ? x('stripWaitingSub') : undefined },
    { key: 'refused', n: refused, tone: refused ? 'notice' : undefined, label: x('stripRefused'), sub: refused ? x('stripRefusedSub') : undefined },
    { key: 'delivered', n: delivered, label: x('stripDelivered') },
  ]} />`;
  const actions = html`<${Loud} disabled=${off} onClick=${() => ctx.openCreate()}>${x('new')}<//>`;
  // What is drawn: the list always (with no webhook its one line is the page's empty line), the
  // limits once there is a webhook they apply to, and how a new one is made always, as one row,
  // since it is how one begins. Numbered after the filter.
  const shown = [
    { id: 'rc-list', label: x('secList'), count: ctx.list ? list.length : '' },
    list.length ? { id: 'rc-how', label: x('secHow') } : null,
    { id: 'rc-new', label: x('secNew') },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  // The start: folded once the person has a receiver; its button is the page's own form.
  const start = html`<${PageStart} id="receivers" done=${ctx.list ? list.length > 0 : null}
    action=${off ? undefined : { onClick: () => ctx.openCreate() }} />`;
  return html`
    <${SettingsPage} name="rc" crumb=${crumb(ctx)} title=${t('profile.tabs.receivers')} help="concept.receiver" marks=${marks}
      desc=${x('lede')} actions=${actions} strip=${strip} start=${start}
      railTitle=${x('railTitle')} sections=${shown.length > 1 ? shown : undefined} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secList(ctx, list)}
      ${numOf['rc-how'] ? secHow(numOf['rc-how']) : null}
      ${secNew(ctx, numOf['rc-new'])}
    <//>`;
}

function secList(ctx, list) {
  // With none, the one line says how one gets here; with the switch off, that none can be made.
  const empty = ctx.mode === 'off'
    ? html`<${Note} kind="quiet"><b>${x('emptyTitle')}</b> ${x('mode.off')}<//>`
    : html`<${Note} kind="quiet"><b>${x('emptyTitle')}</b> ${x('emptyBody')}<//>`;
  return html`
    <${PageSection} id="rc-list" num="01" title=${x('secList')} count=${ctx.list ? x('secListSub', { n: num(list.length) }) : ''} first>
      ${ctx.failed ? html`<${Note} kind="quiet">${x('loadFailed')} <${Action} small soft onClick=${() => ctx.reload()}>${x('retry')}<//><//>`
        : !ctx.list ? html`<${Note} kind="loading" />`
        : html`<${List} cols="name-desc-count-when-doors" keepCols
            head=${[x('col.name'), x('col.writes'), { label: x('col.today'), num: true }, x('col.last'), '']}
            empty=${empty}
            rows=${list} render=${(r) => receiverRow(ctx, r)} />`}
      ${list.length ? html`<${Hint}>${x('listHint')}<//>` : null}
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

/** How a new receiver is made: one row that says the node's mode, the three ways inside it. */
function secNew(ctx, n) {
  const mode = ctx.mode || 'self';
  return html`
    <${FoldSection} id="rc-new" num=${n} title=${x('secNew')} sub=${x('mode.' + mode + 'Chip')} open=${ctx.newOpen} onToggle=${ctx.toggleNew}>
      <${Note} kind="lead">${x('mode.' + mode)}<//>
      <${Facts} wide rows=${[
        { key: 'ai', k: x('newAiK'), v: x('newAiV') },
        { key: 'here', k: x('newHereK'), v: x('newHereV'), action: mode === 'off' ? null : html`<${Action} small onClick=${() => ctx.openCreate()}>${x('new')}<//>` },
        { key: 'agent', k: x('newAgentK'), v: x('newAgentV') },
      ]} />
    <//>`;
}

function secHow(n) {
  return html`
    <${PageSection} id="rc-how" num=${n} title=${x('secHow')}>
      <${Facts} wide rows=${[
        { key: 'may', k: x('how.mayK'), v: x('how.mayV') },
        { key: 'not', k: x('how.notK'), v: x('how.notV') },
        { key: 'stale', k: x('how.staleK'), v: x('how.staleV') },
        // The Access page lists every credential that acts in the person's name, receiver keys included.
        { key: 'key', k: x('how.keyK'), v: x('how.keyV'), action: html`<${Action} small soft onClick=${() => openTab('access')}>${t('profile.tabs.access')}<//>` },      ]} />
    <//>`;
}
