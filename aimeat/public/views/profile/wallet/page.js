/**
 * @file public/views/profile/wallet/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The wallet page in the poster face: the mast says what a morsel is and takes the
 *   day's morsels when there is room; the strip says the balance, what came and went, the shares
 *   owed and the payout rails; 01 where the morsels came from and went to, the daily pace, what
 *   morsels buy; 02 the ledger in words with filters; 03 money apart from morsels: the shares owed
 *   to you and the purchases and sales; 04 the three payout rails as rows; 05 how your AI uses the
 *   wallet. A wallet that lives on another node shows one box. Pure render over the ctx bag; the
 *   rows are rows.js.
 * @structure renderPage · federated · identity · mastActions · strip · secSources · secLedger ·
 *   secMoney · secRails · secRoads
 * @usage import { renderPage } from './wallet/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page with a numbered index Rail, the
 *     strip and the share figures plain NumeralBands, where the morsels came from two boxes of
 *     rows, the pace a box with the progress Meter, what morsels buy three Columns, the ledger and
 *     the rails ListRows behind a Toolbar of filters, the shares and trades Tables, the two roads
 *     two Surfaces; no own CSS (wallet-poster.css is gone).
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the pace explanation.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Lompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, Columns, ListRow, Table, Toolbar, NumeralBand, Meter, Chip, Action, CopyAction, Surface, Text, scrollToId } from '/components/poster-parts.js';
import { x, money, morsels, signed, dateWord, sourcesOf, crumb, pageLinks, openTab, GRANTED } from './frame.js';
import { txRow, railRow, shareCells, moneyCells, msgLine } from './rows.js';

const isMoney = (item) => item.currency && item.currency !== 'morsel';

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const w = ctx.wallet;
  const l = w?.lifetime || {};
  const sh = ctx.shares;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#wal-sources', label: x('secSources'), count: w ? `${signed(l.earned)} / ${signed(-l.spent)}` : undefined },
    { href: '#wal-ledger', label: x('secLedger'), count: w ? String(ctx.rowsTotal) : undefined },
    { href: '#wal-money', label: x('secMoney'), count: sh ? money(sh.total, sh.currency) : undefined },
    { href: '#wal-rails', label: x('secRails'), count: ctx.payout ? `${ctx.railsOn} / 3` : undefined },
    { href: '#wal-roads', label: x('secRoads') },
  ]}>${pageLinks()}<//>`;
  return html`<${Page} width="wide" title=${t('profile.tabs.wallet')} crumbs=${crumb()} identity=${identity(ctx)} actions=${mastActions(ctx)} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      ${msgLine(ctx.requestMsg)}
      ${strip(ctx)}
      ${!w ? html`<${Text} tone="muted">${x('loading')}<//>` : html`
        ${secSources(ctx)}
        ${secLedger(ctx)}
        ${secMoney(ctx)}
        ${secRails(ctx)}
        ${secRoads(ctx)}`}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function federated(ctx) {
  return html`<${Page} width="wide" title=${t('profile.tabs.wallet')} crumbs=${crumb()} identity=${html`<${Text} kind="label">${x('titleSub')}<//>`}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      <${Surface} kind="aside" tone="danger"><${Stack} density="compact">
        <${Text} kind="label">${x('federatedLabel')}<//>
        <${Text}>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}<//>
      <//><//>
    <//>
  <//>`;
}

/** Under the title: what the page is, and the balance, the pace and the rails as chips. */
function identity(ctx) {
  const w = ctx.wallet;
  const p = ctx.payout;
  const cap = Number(w?.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w?.daily_allowance?.amount) || 0;
  return html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    ${w ? html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone="sun">${morsels(w.balance)}<//>
      <${Chip}>${x('chipPace', { n: pace, cap })}<//>
      ${p ? html`<${Chip}>${[x('rail.stripe'), p.x402?.enabled ? x('rail.x402') : '', x('rail.invoice')].filter(Boolean).join(' · ').toLowerCase()}<//>` : null}
      ${p?.x402?.enabled && p.x402.testnet ? html`<${Chip} tone="muted">${x('chipTestnet')}<//>` : null}
    <//>` : null}
  <//>`;
}

/** The one loud action (the day's morsels, while there is room) and the doors. */
function mastActions(ctx) {
  const w = ctx.wallet;
  const cap = Number(w?.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w?.daily_allowance?.amount) || 0;
  const room = w ? Math.max(0, cap - (Number(w.balance) || 0)) : 0;
  const copy = w ? x('copyBalanceText', { balance: morsels(w.balance), available: w.available, escrow: w.in_escrow }) : '';
  return html`<${Stack} density="compact" align="end">
    ${w && room > 0
      ? html`<${Action} kind="primary" disabled=${ctx.busy === 'request'} onClick=${() => ctx.requestToday()}>${ctx.busy === 'request' ? x('requesting') : x('requestToday')}<//>
          <${Text} kind="caption" tone="muted">${x('requestHint', { n: morsels(Math.min(pace, room)), cap })}<//>`
      : w ? html`<${Text} kind="caption" tone="muted">${x('atCap', { cap })}<//>` : null}
    <${Stack} direction="wrap" density="compact">
      ${w ? html`<${CopyAction} text=${copy} label=${x('copyBalance')} />` : null}
      <${Action} kind="text" onClick=${() => scrollToId('wal-roads')}>${x('toAi')}<//>
    <//>
  <//>`;
}

function strip(ctx) {
  const w = ctx.wallet;
  if (!w) return html`<${NumeralBand} tone="plain" items=${[1, 2, 3, 4].map((i) => ({ id: i, label: '', value: '…' }))} />`;
  const l = w.lifetime || {};
  const cap = Number(w.daily_allowance?.accumulation_cap) || 0;
  const sh = ctx.shares;
  const p = ctx.payout;
  return html`<${NumeralBand} tone="plain" items=${[
    { id: 'balance', label: x('stripBalance'), value: w.balance, note: `${x('stripBalanceSub', { available: w.available, escrow: w.in_escrow })}${Number(w.balance) >= cap ? ` · ${x('stripAtCap')}` : ''}` },
    { id: 'flow', label: x('stripFlow'), value: `${signed(l.earned)} / ${signed(-l.spent)}`,
      note: `${x('stripFlowSub', { n: l.total_rows ?? ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}${l.unrecorded > 0 ? ` · ${x('stripUnrecorded', { n: l.unrecorded })}` : ''}` },
    sh ? { id: 'shares', label: x('stripShares'), value: money(sh.total, sh.currency), note: x('stripSharesSub', { accrued: money(sh.accrued, sh.currency), released: money(sh.released, sh.currency) }) }
      : { id: 'shares', label: x('stripShares'), value: '·', note: x('stripNoShares') },
    p ? { id: 'rails', label: x('stripRails'), value: `${ctx.railsOn} / 3`,
      note: [p.stripe?.configured ? x('rail.stripe') + ' ✓' : x('rail.stripe') + ' ✗', p.x402?.enabled ? (p.x402.configured ? x('rail.x402') + ' ✓' : x('rail.x402') + ' ✗') + (p.x402.testnet ? ` (${x('testnetShort')})` : '') : '', x('stripInvoiceAlways')].filter(Boolean).join(' · ') }
      : { id: 'rails', label: x('stripRails'), value: '·', note: x('stripRailsOff') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSources(ctx) {
  const w = ctx.wallet;
  const l = w.lifetime || {};
  const s = sourcesOf(ctx.rows, ctx.self, ctx.agents);
  const cap = Number(w.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w.daily_allowance?.amount) || 0;
  const real = ctx.rows.filter((tx) => !GRANTED.has(tx.type));
  const inRows = real.filter((tx) => Number(tx.amount) > 0), outRows = real.filter((tx) => Number(tx.amount) < 0);
  const span = (list) => (list.length ? `${dateWord(list[list.length - 1].timestamp)}–${dateWord(list[0].timestamp)}` : '');
  const col = (title, total, list, rows, tone) => html`
    <${Surface} kind="box"><${Stack} density="compact">
      <${Stack} direction="wrap" density="compact" align="center">
        <${Text} kind="number" tone=${tone}>${signed(total)}<//>
        <${Text}><strong>${title}</strong><//>
        <${Text} kind="caption" tone="muted">${x('rowsN', { n: rows.length })}${rows.length ? ` · ${span(rows)}` : ''}<//>
      <//>
      ${list.length ? list.map((src) => html`<${ListRow} key=${src.title} density="compact" name=${src.title} detail=${x('timesN', { n: src.count })} value=${src.sum} />`)
        : html`<${Text} tone="muted">${x('nothingYet')}<//>`}
    <//><//>`;
  return html`
    <${Section} id="wal-sources" title=${x('secSources')} count=${x('secSourcesSub', { in: signed(l.earned), out: signed(-l.spent), unrecorded: l.unrecorded > 0 ? l.unrecorded : 0 })}>
      <${Stack}>
        <${Columns} layout="equal" collapse="640">
          ${col(x('came'), l.earned, s.in, inRows, 'success')}
          ${col(x('went'), -l.spent, s.out, outRows, 'coral')}
        <//>
        <${Surface} kind="box"><${Columns} layout="leading" collapse="640">
          <${Text}><strong>${x('paceTitle')}</strong> ${x('paceBody', { pace, cap })} ${Number(w.balance) >= cap ? x('paceAtCap', { balance: w.balance, cap }) : x('paceBelowCap', { balance: w.balance, days: pace ? Math.ceil((cap - Number(w.balance)) / pace) : 0 })} ${l.total_rows ? (l.unrecorded > 0 ? x('paceRows', { sum: signed(l.ledger_sum), unrecorded: morsels(l.unrecorded) }) : l.unrecorded < 0 ? x('paceRowsOver', { sum: signed(l.ledger_sum), n: morsels(-l.unrecorded) }) : x('paceRowsExact', { sum: signed(l.ledger_sum) })) : ''}<//>
          <${Stack} density="compact">
            <${Meter} kind="progress" value=${Number(w.balance) || 0} max=${cap || 1} label=${x('paceTitle')} />
            <${Text} kind="mono">${w.balance} / ${cap}<//>
          <//>
        <//><//>
        <${Text} kind="label">${x('usesTitle')}<//>
        <${Columns} layout="thirds" density="compact" collapse="640">
          ${['work', 'tool', 'data', 'store', 'porting', 'overage'].map((k) => html`<${Stack} key=${k} density="compact">
            <${Text}><strong>${x('use.' + k)}</strong><//>
            <${Text} kind="caption">${x('useBody.' + k)}<//>
            <${Text} kind="mono" tone="muted">${x('useSub.' + k)}<//>
          <//>`)}
        <//>
        <${Text} kind="caption" tone="muted">${x('hintSources')}<//>
      <//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secLedger(ctx) {
  const rows = ctx.filtered;
  const shown = rows.slice(0, ctx.shown);
  const counts = ctx.counts;
  const filters = [['all', counts.all], ['in', counts.in], ['out', counts.out], ['agent', counts.agent]];
  const copyAll = ctx.rows.map((tx) => `${tx.timestamp || ''}\t${signed(tx.amount)}\t${tx.type}\t${tx.tracking_code || ''}\t${tx.counterparty_gaii || ''}\t${tx.initiator_gaii || ''}`).join('\n');
  return html`
    <${Section} id="wal-ledger" title=${x('secLedger')} count=${x('secLedgerSub', { n: ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}>
      <${Stack}>
        ${ctx.rowsTotal ? html`
          <${Toolbar} label=${x('secLedger')} filters=${filters.map(([id, n]) => ({ id, label: `${x('filter.' + id)} ${n}`, selected: ctx.filter === id, onClick: () => ctx.setFilter(id) }))} />
          <${Stack} density="compact">${shown.map((tx) => txRow(ctx, tx))}<//>
          <${Stack} direction="wrap" density="compact" align="center">
            ${rows.length > shown.length ? html`<${Action} onClick=${() => ctx.showMore()}>${x('showMore', { shown: shown.length, total: rows.length })}<//>` : null}
            <${CopyAction} kind="text" text=${copyAll} label=${x('copyAll')} />
            ${ctx.rowsPartial ? html`<${Text} kind="mono" tone="muted">${x('rowsPartial', { n: ctx.rows.length, total: ctx.rowsTotal })}<//>` : null}
          <//>` : html`<${Text}><strong>${x('noRowsLead')}</strong> ${x('noRowsBody')}<//>`}
        <${Text} kind="caption" tone="muted">${x('hintLedger', { n: counts.agent })}<//>
      <//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secMoney(ctx) {
  const sh = ctx.shares;
  const purchases = (ctx.sessions || []).filter(isMoney);
  const sales = (ctx.orders || []).filter(isMoney);
  const doneSales = sales.filter((o) => o.status === 'completed');
  const verified = ctx.earnings?.verification;
  return html`
    <${Section} id="wal-money" title=${x('secMoney')} count=${sh ? x('secMoneySub', { shares: money(sh.total, sh.currency), sales: doneSales.length }) : x('secMoneySubNone')}>
      <${Stack}>
        <${Text}>${x('moneyIntro')}<//>
        ${sh ? html`
          <${NumeralBand} tone="plain" size="small" items=${[
            { id: 'accrued', label: x('share.accruedTitle'), value: money(sh.accrued, sh.currency), note: x('share.entriesN', { n: sh.accruedCount }) },
            { id: 'released', label: x('share.releasedTitle'), value: money(sh.released, sh.currency), note: x('share.entriesN', { n: sh.releasedCount }) },
            { id: 'paid', label: x('share.paidTitle'), value: money(sh.paid, sh.currency), note: x('share.paidSub') },
            verified?.state === 'verified'
              ? { id: 'verified', label: verified.subjectLabel || ctx.approval?.subject || '', value: x('share.verified'), note: verified.payable ? x('share.payable') : verified.message || '' }
              : { id: 'verified', label: x('share.unverifiedSub'), value: x('share.unverified'), note: verified?.message || '' },
          ]} />
          ${ctx.openShares ? html`<${Table} density="compact" collapse="640" label=${x('secMoney')}
            headers=${[x('share.colEntry'), x('share.colBuyer'), x('share.colShare'), '']}
            rows=${(ctx.earnings?.entries || []).map((e) => shareCells(e))} />` : null}` : html`<${Text} tone="muted">${x('share.none')}<//>`}
        ${purchases.length || sales.length ? html`<${Table} density="compact" collapse="640" label=${x('secMoney')}
          headers=${[x('money.colTrade'), x('colWhen'), x('money.colSum'), '']}
          rows=${[...sales.map((o) => moneyCells(o, true)), ...purchases.map((s) => moneyCells(s, false))]} />`
          : html`<${Text} tone="muted">${x('money.none')}<//>`}
        <${Stack} direction="wrap" density="compact">
          <${Action} onClick=${() => openTab('pnl')}>${x('toPnl')}<//>
          ${sh && (ctx.earnings?.entries || []).length ? html`<${Action} kind="text" expanded=${ctx.openShares} onClick=${() => ctx.toggleShares()}>${ctx.openShares ? x('close') : x('share.showEntries', { n: ctx.earnings.entries.length })}<//>` : null}
        <//>
        <${Text} kind="caption" tone="muted">${x('hintMoney')}<//>
      <//>
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRails(ctx) {
  const p = ctx.payout;
  const rails = [{ id: 'stripe' }, ...(p?.x402?.enabled ? [{ id: 'x402' }] : []), { id: 'invoice' }];
  return html`
    <${Section} id="wal-rails" title=${x('secRails')} count=${p ? x('secRailsSub', { n: ctx.railsOn }) : null}>
      <${Stack}>
        <${Text}>${x('railsIntro')}<//>
        ${p === false ? html`<${Text} tone="muted">${x('railsOff')}<//>` : !p ? html`<${Text} tone="muted">${x('loading')}<//>`
          : html`<${Stack} density="compact">${rails.map((r) => railRow(ctx, r))}<//>`}
        <${Text} kind="caption" tone="muted">${x('hintRails')}<//>
      <//>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = x('leadRequest');
  return html`
    <${Section} id="wal-roads" title=${x('secRoads')}>
      <${Stack}>
        <${Text}>${x('roadsIntro')}<//>
        <${Columns} layout="leading" collapse="640">
          <${Surface} kind="record"><${Stack}>
            <${Text} kind="label">${x('roadAsk')}<//>
            <${Text}>${x('roadAskBody')}<//>
            <${Surface} kind="code">${request}<//>
            <${Stack} direction="horizontal" align="start">
              <${CopyAction} text=${request} label=${x('copyRequest')} />
            <//>
          <//><//>
          <${Surface} kind="box"><${Stack}>
            <${Text} kind="label">${x('roadAgent')}<//>
            <${Text}>${x('roadAgentBody')}<//>
            <${Text} kind="mono" tone="muted">${x('roadAgentSub', { n: ctx.counts.agent, total: ctx.rowsTotal })}<//>
          <//><//>
        <//>
      <//>
    <//>`;
}
