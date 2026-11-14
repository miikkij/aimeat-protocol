/**
 * @file public/views/profile/vault/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Vault page (design canvas "Holvi"): the head says what the page is for and offers the
 *   two actions, Share a secret and Ask for a secret; the page's start (PageStart) gives the sentence
 *   for one's own AI; the title's question mark is concept.secretShares. 01 waiting for you (Pick up),
 *   02 asked of you (Deposit), 03 made by you (its state, its pickups and who may pick it up; Open
 *   shows its terms and its events, Revoke ends it), 04 your organisms' vaults, 05 this browser's key
 *   for end-to-end shares. Pure render over the ctx bag; every part is a library component and the
 *   file writes no class. How the page explains itself: .claude/rules/page-guidance.md.
 * @structure renderVaultView · secForMe · secToFill · secMade · madeRow · sharePanel · secOrganisms ·
 *   secDevice
 * @usage import { renderVaultView } from './vault/cover.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date, dateTime, num } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageSection } from '/components/PageSection.js';
import { PageStart } from '/components/PageStart.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, Panel } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Hint } from '/components/Hint.js';
import {
  x, crumb, pageLinks, accountOf, formatWord, protectionWord, retentionWords, whoWords, statusWord, statusTone,
  actorWords, eventWords, checkFacts, sizeWords,
} from './frame.js';
import { renderDialogs } from './dialogs.js';

const html = htm.bind(h);

export function renderVaultView(ctx) {
  const l = ctx.lists;
  const counts = l ? { forMe: l.for_me.length, toFill: l.to_fill.length, made: l.made.length, orgs: l.organisms.length } : null;
  const marks = counts ? [
    counts.forMe ? { label: x('chipForMe', { n: num(counts.forMe) }), tone: 'coral' } : null,
    counts.toFill ? { label: x('chipToFill', { n: num(counts.toFill) }), tone: 'coral' } : null,
    { label: x('chipMade', { n: num(counts.made) }) },
  ] : [];
  const actions = html`
    <${Loud} onClick=${() => ctx.openShare()}>${x('share')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.openAsk()}>${x('ask')}<//><//>`;
  const sections = [
    { id: 'vs-for-me', num: '01', label: x('secForMe'), count: counts ? String(counts.forMe) : '' },
    { id: 'vs-to-fill', num: '02', label: x('secToFill'), count: counts ? String(counts.toFill) : '' },
    { id: 'vs-made', num: '03', label: x('secMade'), count: counts ? String(counts.made) : '' },
    { id: 'vs-organisms', num: '04', label: x('secOrganisms'), count: counts ? String(counts.orgs) : '' },
    { id: 'vs-device', num: '05', label: x('secDevice'), count: ctx.keys ? String(ctx.keys.length) : '' },
  ];
  const start = html`<${PageStart} id="vault" done=${counts ? counts.made > 0 : null}
    action=${{ onClick: () => ctx.openAsk() }} />`;
  return html`
    <${SettingsPage} name="vs" crumb=${crumb()} title=${t('profile.tabs.vault')} help="concept.secretShares" marks=${marks}
      desc=${x('lede')} actions=${actions} start=${start}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />${renderDialogs(ctx)}`}>
      ${ctx.failed ? html`<${Note} kind="quiet">${x('loadFailed')} <${Action} small soft onClick=${() => ctx.reload()}>${x('retry')}<//><//>` : null}
      ${secForMe(ctx)}
      ${secToFill(ctx)}
      ${secMade(ctx)}
      ${secOrganisms(ctx)}
      ${secDevice(ctx)}
    <//>`;
}

const listBody = (ctx, items, render, opts) => (!ctx.lists
  ? html`<${Note} kind="loading" />`
  : html`<${List} cols=${opts.cols} head=${opts.head} labels empty=${html`<${Note} kind="quiet">${opts.empty}<//>`} rows=${items} render=${render} />`);

/* ── 01 waiting for you ───────────────────────────────────────────────────────────────────────── */

function secForMe(ctx) {
  const items = ctx.lists?.for_me || [];
  return html`
    <${PageSection} id="vs-for-me" num="01" title=${x('secForMe')} count=${ctx.lists ? num(items.length) : ''} first>
      ${listBody(ctx, items, (s) => html`
        <${Row} key=${s.id}>
          <${Name} href=${'/v1/secret-pickup?share=' + encodeURIComponent(s.id)} meta=${`${formatWord(s.format)} · ${protectionWord(s.protection)}`}>${s.name}<//>
          <${Who} sub=${dateTime(s.deposited_at || s.created_at)}>${accountOf(s.maker, ctx.nodeId)}<//>
          <${Desc} sub=${sizeWords(s)}>${retentionWords(s)}<//>
          <${Doors}><${Action} small row href=${'/v1/secret-pickup?share=' + encodeURIComponent(s.id)}>${x('pickUp')}<//><//>
        <//>`, { cols: 'name-who-desc-doors', head: [x('col.name'), x('col.from'), x('col.lasts'), ''], empty: x('emptyForMe') })}
    <//>`;
}

/* ── 02 asked of you ──────────────────────────────────────────────────────────────────────────── */

function secToFill(ctx) {
  const items = ctx.lists?.to_fill || [];
  return html`
    <${PageSection} id="vs-to-fill" num="02" title=${x('secToFill')} count=${ctx.lists ? num(items.length) : ''}>
      ${listBody(ctx, items, (s) => html`
        <${Row} key=${s.id}>
          <${Name} href=${'/v1/secret-deposit?share=' + encodeURIComponent(s.id)} meta=${protectionWord(s.protection)}>${s.name}<//>
          <${Who} sub=${s.request_expires_at ? x('openUntil', { date: date(s.request_expires_at) }) : ''}>${accountOf(s.maker, ctx.nodeId)}<//>
          <${Desc} lines=${3}>${s.note || x('noNote')}<//>
          <${Doors}><${Action} small row href=${'/v1/secret-deposit?share=' + encodeURIComponent(s.id)}>${x('deposit')}<//><//>
        <//>`, { cols: 'name-who-desc-doors', head: [x('col.name'), x('col.asker'), x('col.note'), ''], empty: x('emptyToFill') })}
    <//>`;
}

/* ── 03 made by you, 04 your organisms' vaults ────────────────────────────────────────────────── */

function secMade(ctx) {
  const items = ctx.lists?.made || [];
  return html`
    <${PageSection} id="vs-made" num="03" title=${x('secMade')} count=${ctx.lists ? num(items.length) : ''}>
      ${listBody(ctx, items, (s) => madeRow(ctx, s), {
        cols: 'name-state-who-n-doors', head: [x('col.name'), x('col.state'), x('col.who'), { label: x('col.pickups'), num: true }, ''], empty: x('emptyMade'),
      })}
      <${Hint}>${x('madeHint')}<//>
    <//>`;
}

function secOrganisms(ctx) {
  const items = ctx.lists?.organisms || [];
  return html`
    <${PageSection} id="vs-organisms" num="04" title=${x('secOrganisms')} count=${ctx.lists ? num(items.length) : ''}>
      ${listBody(ctx, items, (s) => madeRow(ctx, s), {
        cols: 'name-state-who-n-doors', head: [x('col.name'), x('col.state'), x('col.who'), { label: x('col.pickups'), num: true }, ''], empty: x('emptyOrganisms'),
      })}
    <//>`;
}

function madeRow(ctx, s) {
  const open = ctx.openId === s.id;
  const live = s.status === 'ready' || s.status === 'waiting';
  const request = s.kind === 'request';
  return html`
    <${Row} key=${s.id} open=${open} faded=${!live}>
      <${Name} onOpen=${() => ctx.toggleOpen(s.id)}
        meta=${[request ? x('kind.request') : formatWord(s.format), protectionWord(s.protection), s.organism ? ctx.orgName(s.organism) : ''].filter(Boolean).join(' · ')}>${s.name}<//>
      <${Cell}><${Mark} kind="status" tone=${statusTone(s.status)}>${statusWord(s.status)}<//><//>
      <${Who} sub=${retentionWords(s)}>${whoWords(s, ctx.nodeId, ctx.orgName(s.organism), ctx.ownerGhii)}<//>
      <${Num} title=${x('pickupsLine', { n: num(s.pickups || 0) })}>${num(s.pickups || 0)}<//>
      <${Doors}>
        <${Action} small row expanded=${open} onClick=${() => ctx.toggleOpen(s.id)}>${open ? x('close') : x('open')}<//>
        ${live && s.you?.manage ? html`<${Action} small row tone="danger" disabled=${ctx.busy} onClick=${() => ctx.revoke(s)}>${x('revoke')}<//>` : null}
      <//>
      ${open ? sharePanel(ctx, s) : null}
    <//>`;
}

/** One share opened: its terms, the check its deposit got, and its events. */
function sharePanel(ctx, s) {
  const one = ctx.detail && ctx.detail.id === s.id ? ctx.detail : null;
  const share = one || s;
  const live = share.status === 'ready' || share.status === 'waiting';
  const events = one?.events || null;
  const facts = [
    { key: 'who', k: x('f.who'), v: whoWords(share, ctx.nodeId, ctx.orgName(share.organism), ctx.ownerGhii) },
    { key: 'lasts', k: x('f.lasts'), v: retentionWords(share) },
    { key: 'protection', k: x('f.protection'), v: protectionWord(share.protection) },
    { key: 'format', k: x('f.format'), v: [formatWord(share.format), share.file_name || '', sizeWords(share)].filter(Boolean).join(' · ') },
    share.note ? { key: 'note', k: x('f.note'), v: share.note } : null,
    share.kind === 'request' && share.request_expires_at ? { key: 'reqUntil', k: x('f.requestUntil'), v: dateTime(share.request_expires_at) } : null,
    { key: 'made', k: x('f.made'), v: dateTime(share.created_at), sub: actorWords({ actor: share.created_by, on_behalf_of: share.maker, kind: 'created' }, ctx.ownerGhii, ctx.nodeId) },
    share.deposited_at && share.kind === 'request' ? { key: 'deposited', k: x('f.deposited'), v: dateTime(share.deposited_at) } : null,
    share.revoked_at ? { key: 'revoked', k: x('f.revoked'), v: dateTime(share.revoked_at) } : null,
  ].filter(Boolean);
  const check = checkFacts(share.check);
  return html`
    <${Panel} doors=${live && share.you?.manage ? html`
      <${Action} small tone="danger" disabled=${ctx.busy} onClick=${() => ctx.revoke(share)}>${x('revoke')}<//>
      <${Note} inline>${x('revokeHint')}<//>` : null}>
      <${Facts} rows=${facts} />
      ${check.length ? html`<${Label} block>${x('check.title')}<//><${Facts} rows=${check} />` : null}
      <${Label} block>${x('events')}<//>
      ${events === null
        ? (ctx.detailFailed ? html`<${Note} kind="quiet">${x('eventsFailed')}<//>` : html`<${Note} kind="loading" />`)
        : html`<${List} cols="name-words-when" dense empty=${html`<${Note} kind="quiet">${x('noEvents')}<//>`}
            rows=${events} render=${(e, i) => html`
              <${Row} key=${e.at + i}>
                <${Name}>${eventWords(e)}<//>
                <${Desc}>${actorWords(e, ctx.ownerGhii, ctx.nodeId)}<//>
                <${When}>${dateTime(e.at)}<//>
              <//>`} />`}
    <//>`;
}

/* ── 05 this browser's key ────────────────────────────────────────────────────────────────────── */

function secDevice(ctx) {
  const keys = ctx.keys;
  const local = ctx.localKey;
  const here = local && keys ? keys.find((k) => k.key_id === local.keyId) : null;
  const state = !ctx.cryptoReady ? x('device.noCrypto') : here ? x('device.here', { label: here.label }) : local ? x('device.localOnly') : x('device.none');
  return html`
    <${PageSection} id="vs-device" num="05" title=${x('secDevice')} count=${keys ? num(keys.length) : ''}>
      <${Note} kind="lead">${x('device.lead')}<//>
      <${Facts} rows=${[{
        key: 'here', k: x('device.thisBrowser'), v: state, warn: !here,
        action: !ctx.cryptoReady ? null : here
          ? html`<${Action} small tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removeKey(here)}>${x('device.remove')}<//>`
          : html`<${Action} small disabled=${ctx.busy} onClick=${() => ctx.registerKey()}>${x('device.register')}<//>`,
      }]} />
      ${!keys ? html`<${Note} kind="loading" />` : html`
        <${List} cols="name-desc-when-doors" head=${[x('device.colBrowser'), x('device.colKey'), x('device.colUsed'), '']}
          empty=${html`<${Note} kind="quiet">${x('device.empty')}<//>`}
          rows=${keys} render=${(k) => html`
            <${Row} key=${k.key_id}>
              <${Name} meta=${local && local.keyId === k.key_id ? x('device.thisOne') : null}>${k.label || x('device.unnamed')}<//>
              <${Desc} sub=${x('device.added', { date: date(k.created_at) })}>${k.key_id}<//>
              <${When}>${k.last_used_at ? dateTime(k.last_used_at) : x('device.notUsed')}<//>
              <${Doors}><${Action} small row tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removeKey(k)}>${x('device.remove')}<//><//>
            <//>`} />`}
      <${Hint}>${x('device.hint')}<//>
    <//>`;
}
