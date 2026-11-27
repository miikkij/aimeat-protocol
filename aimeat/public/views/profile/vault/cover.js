/**
 * @file public/views/profile/vault/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Vault page (design canvas "Holvi"): the head says what the page is for and offers the
 *   two actions, Share a secret and Ask for a secret; the figure strip says what waits for the person
 *   and what they made; the page's start (PageStart) gives the sentence for one's own AI; the title's
 *   question mark is concept.secretShares. The sections, numbered in the order they are drawn: waiting
 *   for you (Pick up) and asked of you (Deposit), each only while it holds something; made by you (its
 *   state, its pickups and who may pick it up; Open shows its terms and its events, Revoke ends it);
 *   your organisms' vaults once there is one; this browser's key for end-to-end shares as a fold row
 *   that says its state. No secret's value is ever drawn here. Pure render over the ctx bag; every
 *   part is a library component and the file writes no class. How the page explains itself:
 *   .claude/rules/page-guidance.md.
 * @structure renderVaultView · secForMe · secToFill · secMade · madeRow · sharePanel · secOrganisms ·
 *   secDevice
 * @usage import { renderVaultView } from './vault/cover.js';
 * @version-history
 *   v1.1.0 — 2026-11-27 — A figure strip under the head (waiting for you and asked of you in the notice
 *     tone, made by you with how many can still be picked up, the shared places' vaults when there is
 *     one) from the list the page already reads, replacing the head's three count chips; not drawn
 *     while every figure is zero (FigureStrip hideZeros). Waiting for you, asked of you and the shared
 *     places' vaults are drawn only while they hold something, so what needs the person comes first
 *     and an empty page says one line (the made-by-you empty line); the numbers and the rail follow
 *     what is drawn, and every section keeps its id. This browser's key is a FoldSection row whose
 *     detail is its state and whose lead keeps the line that the private key never leaves the
 *     browser. No control, list or safety line was removed.
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date, dateTime, num } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { FigureStrip } from '/components/FigureStrip.js';
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
  // How many of the person's own shares and requests can still be picked up or filled (the rest
  // ended or were revoked). Counted from the list the page already read; no value is ever shown.
  const liveMade = l ? l.made.filter((s) => s.status === 'ready' || s.status === 'waiting').length : 0;
  const actions = html`
    <${Loud} onClick=${() => ctx.openShare()}>${x('share')}<//>
    <${Actions}><${Action} small onClick=${() => ctx.openAsk()}>${x('ask')}<//><//>`;
  // Where things stand, under the head: what waits for the person (pick up, deposit) in the notice
  // tone and first, then what they made, then their shared places' vaults when they hold any. The
  // head's three chips said the same counts; the strip replaces them. With nothing at all the strip
  // is not drawn (hideZeros).
  const strip = !counts ? (ctx.failed ? null : html`<${FigureStrip} loading=${3} />`) : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'forMe', n: counts.forMe, tone: counts.forMe ? 'notice' : undefined, label: x('stripForMe'), sub: counts.forMe ? x('stripForMeSub') : undefined },
    { key: 'toFill', n: counts.toFill, tone: counts.toFill ? 'notice' : undefined, label: x('stripToFill'), sub: counts.toFill ? x('stripToFillSub') : undefined },
    { key: 'made', n: counts.made, label: x('stripMade'), sub: counts.made ? x('stripMadeSub', { n: num(liveMade) }) : undefined },
    counts.orgs ? { key: 'orgs', n: counts.orgs, label: x('stripOrganisms') } : null,
  ]} />`;
  // What is drawn: what waits for the person and what was asked of them only while it holds
  // something, and then first; what they made always (with nothing anywhere, its one empty line is
  // the page's); their shared places' vaults once there is one; this browser's key always, as a row
  // that says its state. Numbered after filtering, so a hidden section leaves no gap.
  const shown = [
    counts?.forMe ? { id: 'vs-for-me', label: x('secForMe'), count: String(counts.forMe) } : null,
    counts?.toFill ? { id: 'vs-to-fill', label: x('secToFill'), count: String(counts.toFill) } : null,
    { id: 'vs-made', label: x('secMade'), count: counts ? String(counts.made) : '' },
    counts?.orgs ? { id: 'vs-organisms', label: x('secOrganisms'), count: String(counts.orgs) } : null,
    { id: 'vs-device', label: x('secDevice'), count: ctx.keys ? String(ctx.keys.length) : '', open: () => ctx.setDeviceOpen(true) },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  const firstId = shown[0].id;
  const start = html`<${PageStart} id="vault" done=${counts ? counts.made > 0 : null}
    action=${{ onClick: () => ctx.openAsk() }} />`;
  return html`
    <${SettingsPage} name="vs" crumb=${crumb()} title=${t('profile.tabs.vault')} help="concept.secretShares"
      desc=${x('lede')} actions=${actions} strip=${strip} start=${start}
      railTitle=${x('railTitle')} sections=${shown} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />${renderDialogs(ctx)}`}>
      ${ctx.failed ? html`<${Note} kind="quiet">${x('loadFailed')} <${Action} small soft onClick=${() => ctx.reload()}>${x('retry')}<//><//>` : null}
      ${numOf['vs-for-me'] ? secForMe(ctx, numOf['vs-for-me'], firstId === 'vs-for-me') : null}
      ${numOf['vs-to-fill'] ? secToFill(ctx, numOf['vs-to-fill'], firstId === 'vs-to-fill') : null}
      ${secMade(ctx, numOf['vs-made'], firstId === 'vs-made')}
      ${numOf['vs-organisms'] ? secOrganisms(ctx, numOf['vs-organisms']) : null}
      ${secDevice(ctx, numOf['vs-device'])}
    <//>`;
}

const listBody = (ctx, items, render, opts) => (!ctx.lists
  ? html`<${Note} kind="loading" />`
  : html`<${List} cols=${opts.cols} head=${opts.head} labels empty=${html`<${Note} kind="quiet">${opts.empty}<//>`} rows=${items} render=${render} />`);

/* ── 01 waiting for you ───────────────────────────────────────────────────────────────────────── */

function secForMe(ctx, n, first) {
  const items = ctx.lists?.for_me || [];
  return html`
    <${PageSection} id="vs-for-me" num=${n} title=${x('secForMe')} count=${ctx.lists ? num(items.length) : ''} first=${first}>
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

function secToFill(ctx, n, first) {
  const items = ctx.lists?.to_fill || [];
  return html`
    <${PageSection} id="vs-to-fill" num=${n} title=${x('secToFill')} count=${ctx.lists ? num(items.length) : ''} first=${first}>
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

function secMade(ctx, n, first) {
  const items = ctx.lists?.made || [];
  return html`
    <${PageSection} id="vs-made" num=${n} title=${x('secMade')} count=${ctx.lists ? num(items.length) : ''} first=${first}>
      ${listBody(ctx, items, (s) => madeRow(ctx, s), {
        cols: 'name-state-who-n-doors', head: [x('col.name'), x('col.state'), x('col.who'), { label: x('col.pickups'), num: true }, ''], empty: x('emptyMade'),
      })}
      <${Hint}>${x('madeHint')}<//>
    <//>`;
}

function secOrganisms(ctx, n) {
  const items = ctx.lists?.organisms || [];
  return html`
    <${PageSection} id="vs-organisms" num=${n} title=${x('secOrganisms')} count=${ctx.lists ? num(items.length) : ''}>
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

/**
 * This browser's key is a setting made once, so it is one row that says its state (registered, not
 * registered, a key this browser holds that is not registered) and opens in place. What the key is
 * for and that its private part never leaves the browser is the row's lead, read while it is shut.
 */
function secDevice(ctx, n) {
  const keys = ctx.keys;
  const local = ctx.localKey;
  const here = local && keys ? keys.find((k) => k.key_id === local.keyId) : null;
  const state = !ctx.cryptoReady ? x('device.noCrypto') : here ? x('device.here', { label: here.label }) : local ? x('device.localOnly') : x('device.none');
  return html`
    <${FoldSection} id="vs-device" num=${n} title=${x('secDevice')} sub=${keys ? state : '…'} wrap lead=${x('device.lead')}
      open=${ctx.deviceOpen} onToggle=${() => ctx.setDeviceOpen(!ctx.deviceOpen)}>
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
