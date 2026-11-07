/**
 * @file public/views/profile/receivers/detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One receiver's own page (design canvas "Vastaanottimet", artboard Detail): the head
 *   with its state and its actions (pause or resume, change the key, extend, delete); the banner when
 *   the operator stopped it, with the reason; 01 its deliveries, all or only the refused ones, from
 *   GET /v1/receivers/{name}/deliveries (the log keeps the newest 200 and never a message's content);
 *   02 what it writes (target, CSM and version, verbs, limits, end date, key changed, who made it);
 *   03 the address with the curl example to copy. Pure render over the ctx bag; the file writes no
 *   class.
 * @structure renderDetail · doorsOf · secDeliveries · deliveryRow · secFacts · secAddress
 * @usage import { renderDetail } from './detail.js';
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ago, date, dateTime, num } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageSection } from '/components/PageSection.js';
import { List, Row, Desc, When, Cell, Doors } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Tabs } from '/components/Tabs.js';
import { Hint } from '/components/Hint.js';
import {
  x, crumb, pageLinks, targetWords, shapeWords, stateWord, stateTone, byWords, limitsWords, verbsWords,
  deliveryWords, statusTone, curlFor,
} from './frame.js';

const html = htm.bind(h);

export function renderDetail(ctx) {
  const d = ctx.detail;
  const name = ctx.view.name;
  const r = d?.receiver || (ctx.list || []).find((x0) => x0.name === name) || null;
  if (!r) {
    return html`<${SettingsPage} name="rc" page crumb=${crumb(ctx, name)} title=${name}
      rail=${railOf(ctx)}>
      ${ctx.detailFailed ? html`<${Note} kind="quiet">${x('notFound', { name })}<//>` : html`<${Note} kind="loading" />`}
    <//>`;
  }
  const marks = [
    { kind: 'status', tone: stateTone(r.state), label: stateWord(r.state) },
    r.key_id ? { label: x('keyIdChip', { id: r.key_id }) } : null,
    r.refused_today ? { label: x('chipRefused', { n: num(r.refused_today) }), tone: 'coral' } : null,
  ];
  return html`
    <${SettingsPage} name="rc" page crumb=${crumb(ctx, r.display_name || r.name)} title=${r.display_name || r.name}
      marks=${marks} desc=${r.description || null} actions=${html`<${Actions}>${doorsOf(ctx, r)}<//>`}
      rail=${railOf(ctx)} after=${html`<${ctx.ConfirmUI} />`}>
      ${r.state === 'stopped' ? html`<${Note} kind="aside" tone="irreversible">
        <b>${x('stoppedTitle')}</b> ${r.stop_reason ? x('stoppedWhy', { reason: r.stop_reason }) : x('stoppedNoReason')} ${x('stoppedOnly')}<//>` : null}
      ${r.state === 'awaiting_operator' ? html`<${Note} kind="aside" tone="waiting">${x('waitingOperator')}<//>` : null}
      ${r.state === 'expired' ? html`<${Note} kind="aside">${x('expiredNote', { date: date(r.expires_at) })}<//>` : null}
      ${r.state === 'proposed' ? html`<${Note} kind="aside" tone="waiting">${x('proposedNote')}<//>` : null}
      ${r.refused_today ? html`<${Note} kind="aside">${x('refusedToday', { n: num(r.refused_today) })}<//>` : null}
      ${secDeliveries(ctx)}
      ${secFacts(ctx, r)}
      ${secAddress(ctx, r)}
    <//>`;
}

function railOf(ctx) {
  return {
    title: x('railTitle'),
    groups: [
      { label: t('profile.tabs.receivers'), items: [
        { back: true, key: 'back', label: x('backTo'), onClick: () => ctx.openCover() },
        { section: 'rc-d-del', mark: '01', label: x('secDeliveries'), key: 'rc-d-del' },
        { section: 'rc-d-facts', mark: '02', label: x('secFacts'), key: 'rc-d-facts' },
        { section: 'rc-d-address', mark: '03', label: x('secAddress'), key: 'rc-d-address' },
      ] },
      { label: x('pages'), items: pageLinks().map((p) => ({ mark: '→', count: '→', ...p })) },
    ],
  };
}

/** The head's actions: what the owner may do with the receiver in its present state. */
function doorsOf(ctx, r) {
  const busy = ctx.busy;
  const working = r.state === 'active' || r.state === 'paused' || r.state === 'expired';
  return html`
    ${r.state === 'proposed' ? html`<${Action} small disabled=${busy} onClick=${() => ctx.openDecide(r.name)}>${x('decide')}<//>` : null}
    ${r.state === 'active' ? html`<${Action} small disabled=${busy} onClick=${() => ctx.pause(r)}>${x('pause')}<//>` : null}
    ${r.state === 'paused' ? html`<${Action} small disabled=${busy} onClick=${() => ctx.resume(r)}>${x('resume')}<//>` : null}
    ${r.has_key && r.state !== 'stopped' ? html`<${Action} small disabled=${busy} onClick=${() => ctx.rotate(r)}>${x('rotate')}<//>` : null}
    ${working ? html`<${Action} small disabled=${busy} onClick=${() => ctx.openExtend(r)}>${x('extend')}<//>` : null}
    <${Action} small tone="danger" disabled=${busy} onClick=${() => ctx.remove(r)}>${x('delete')}<//>`;
}

function secDeliveries(ctx) {
  const all = ctx.deliveries?.deliveries || [];
  const refused = all.filter((e) => e.status >= 400);
  const shown = ctx.filter === 'refused' ? refused : all;
  const doors = html`<${Action} small soft disabled=${ctx.loadingDeliveries} onClick=${() => ctx.reloadDetail()}>${x('refresh')}<//>`;
  return html`
    <${PageSection} id="rc-d-del" num="01" title=${x('secDeliveries')} count=${ctx.deliveries ? x('deliveriesSub', { n: num(all.length) }) : ''} doors=${doors} first>
      <${Tabs} tone="filter" value=${ctx.filter} onSelect=${(f) => ctx.setFilter(f)} label=${x('filterLabel')}
        items=${[
          { value: 'all', label: x('filterAll'), count: all.length },
          { value: 'refused', label: x('filterRefused'), count: refused.length, attention: refused.length > 0 && ctx.filter !== 'refused' },
        ]} />
      ${!ctx.deliveries ? html`<${Note} kind="loading" />` : html`
        <${List} cols="when-state-desc-doors" keepCols
          empty=${html`<${Note} kind="quiet">${ctx.filter === 'refused' ? x('noRefused') : x('noDeliveries')}<//>`}
          rows=${shown} render=${(e, i) => deliveryRow(e, i)} />`}
      ${ctx.deliveries?.failed_attempts ? html`<${Note} kind="hint">${x('wrongKeys', { n: num(ctx.deliveries.failed_attempts) })}<//>` : null}
      <${Hint}>${x('logHint')}<//>
    <//>`;
}

function deliveryRow(e, i) {
  const w = deliveryWords(e);
  return html`
    <${Row} key=${e.at + ':' + i}>
      <${When} at=${dateTime(e.at)}>${ago(e.at)}<//>
      <${Cell} meta><${Mark} kind="status" tone=${statusTone(e.status, e.dryRun)}>${e.dryRun ? x('dryChip') : String(e.status)}<//><//>
      <${Desc} sub=${w.sub || undefined}>${w.text}<//>
      <${Doors} />
    <//>`;
}

function secFacts(ctx, r) {
  const made = byWords(r.created_by, ctx.ownerGhii);
  const madeSub = r.approved_at && r.created_by !== ctx.ownerGhii ? x('approvedOn', { date: date(r.approved_at) }) : date(r.created_at);
  return html`
    <${PageSection} id="rc-d-facts" num="02" title=${x('secFacts')}>
      <${Facts} wide rows=${[
        { key: 'target', k: x('f.target'), v: targetWords(r.target), sub: r.target?.kind === 'space' ? r.target.organism_id : '' },
        { key: 'shape', k: x('f.shape'), v: shapeWords(r), warn: !r.schema, sub: r.schema ? x('f.shapeSub') : x('f.noShapeSub') },
        { key: 'verbs', k: x('f.verbs'), v: verbsWords(r.verbs), mono: true },
        { key: 'limits', k: x('f.limits'), v: limitsWords(r.limits) },
        { key: 'until', k: x('f.until'), v: date(r.expires_at), warn: r.state === 'expired' },
        { key: 'rotated', k: x('f.rotated'), v: r.key_rotated_at ? date(r.key_rotated_at) : x('f.neverRotated'),
          sub: r.previous_key_until ? x('f.oldKeyUntil', { time: dateTime(r.previous_key_until) }) : '' },
        { key: 'by', k: x('f.by'), v: made, sub: madeSub },
        { key: 'who', k: x('f.writesAs'), v: html`<${Code}>${r.principal}<//>`, sub: x('f.writesAsSub') },
      ]} />
    <//>`;
}

function secAddress(ctx, r) {
  const curl = curlFor(r);
  return html`
    <${PageSection} id="rc-d-address" num="03" title=${x('secAddress')}>
      <${Note} kind="lead">${r.target?.kind === 'prefix' ? x('addressLeadPrefix', { prefix: r.target.prefix }) : x('addressLead')}<//>
      <${Code} block>${`POST ${r.address}`}<//>
      <${Actions}>
        <${Action} small copy=${r.address} copiedLabel=${x('copied')}>${x('copyAddress')}<//>
        <${Action} small copy=${curl} copiedLabel=${x('copied')}>${x('copyCurl')}<//>
      <//>
      <${Code} block scroll>${curl}<//>
      <${Hint}>${x('rotateHint')}<//>
    <//>`;
}
