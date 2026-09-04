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
 * @structure renderPage · federated · mast · strip · secSources · secLedger · secMoney · secRails ·
 *   secRoads
 * @usage import { renderPage } from './wallet/page.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Lompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, money, morsels, signed, dateWord, sourcesOf, crumb, pageLinks, openTab, GRANTED } from './frame.js';
import { txRow, railRow, shareRow, moneyRow } from './rows.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`wal-msg ${m.error ? 'is-err' : ''}`}>${m.text}</small>` : null);
const isMoney = (item) => item.currency && item.currency !== 'morsel';

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const w = ctx.wallet;
  const l = w?.lifetime || {};
  const sh = ctx.shares;
  const railsOn = ctx.railsOn;
  const rail = [
    ['01', 'wal-sources', x('secSources'), w ? `${signed(l.earned)} / ${signed(-l.spent)}` : ''],
    ['02', 'wal-ledger', x('secLedger'), w ? String(ctx.rowsTotal) : ''],
    ['03', 'wal-money', x('secMoney'), sh ? money(sh.total, sh.currency) : ''],
    ['04', 'wal-rails', x('secRails'), ctx.payout ? `${railsOn} / 3` : ''],
    ['05', 'wal-roads', x('secRoads'), ''],
  ];
  return html`
    <div class="og og-wal">
      ${crumb()}
      ${mast(ctx)}
      ${strip(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${!w ? html`<p class="wal-empty">${x('loading')}</p>` : html`
            ${secSources(ctx)}
            ${secLedger(ctx)}
            ${secMoney(ctx)}
            ${secRails(ctx)}
            ${secRoads(ctx)}`}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function federated(ctx) {
  return html`
    <div class="og og-wal">
      ${crumb()}
      <div class="og-mast"><div class="og-mast-words"><h1 class="og-title">${t('profile.tabs.wallet')}<small>${x('titleSub')}</small></h1><p class="og-desc">${x('desc')}</p></div></div>
      <div class="og-box og-box--solid wal-box"><span class="og-box-label">${x('federatedLabel')}</span>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}</div>
    </div>`;
}

function mast(ctx) {
  const w = ctx.wallet;
  const p = ctx.payout;
  const cap = Number(w?.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w?.daily_allowance?.amount) || 0;
  const room = w ? Math.max(0, cap - (Number(w.balance) || 0)) : 0;
  const chips = !w ? [] : [
    chip(morsels(w.balance), 'og-chip--sun'),
    chip(x('chipPace', { n: pace, cap })),
    p ? chip([x('rail.stripe'), p.x402?.enabled ? x('rail.x402') : '', x('rail.invoice')].filter(Boolean).join(' · ').toLowerCase()) : null,
    p?.x402?.enabled && p.x402.testnet ? chip(x('chipTestnet'), 'og-chip--dim') : null,
  ];
  const copy = w ? x('copyBalanceText', { balance: morsels(w.balance), available: w.available, escrow: w.in_escrow }) : '';
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('profile.tabs.wallet')}<small>${x('titleSub')}</small></h1>
        <div class="og-chips">${chips}</div>
        <p class="og-desc">${x('desc')}</p>
        ${msg(ctx.requestMsg)}
      </div>
      <div class="og-mast-actions">
        ${w && room > 0
          ? html`<button type="button" class="og-slab" disabled=${ctx.busy === 'request'} onClick=${() => ctx.requestToday()}>${ctx.busy === 'request' ? x('requesting') : x('requestToday')}</button><small class="wal-slab-hint">${x('requestHint', { n: morsels(Math.min(pace, room)), cap })}</small>`
          : w ? html`<small class="wal-slab-hint">${x('atCap', { cap })}</small>` : null}
        <div class="og-doors">
          ${w ? html`<${CopyButton} className="og-door" text=${copy} label=${x('copyBalance')} />` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => scrollTo('wal-roads')}>${x('toAi')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx) {
  const w = ctx.wallet;
  if (!w) return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
  const l = w.lifetime || {};
  const cap = Number(w.daily_allowance?.accumulation_cap) || 0;
  const sh = ctx.shares;
  const p = ctx.payout;
  return html`
    <div class="og-strip">
      <div><b>${w.balance}</b><span>${x('stripBalance')}</span><small>${x('stripBalanceSub', { available: w.available, escrow: w.in_escrow })}${Number(w.balance) >= cap ? ` · ${x('stripAtCap')}` : ''}</small></div>
      <div><b><span class="is-good">${signed(l.earned)}</span> / <span class="is-low">${signed(-l.spent)}</span></b><span>${x('stripFlow')}</span><small>${x('stripFlowSub', { n: l.total_rows ?? ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}${l.unrecorded > 0 ? ` · ${x('stripUnrecorded', { n: l.unrecorded })}` : ''}</small></div>
      <div>${sh ? html`<b>${money(sh.total, sh.currency)}</b><span>${x('stripShares')}</span><small>${x('stripSharesSub', { accrued: money(sh.accrued, sh.currency), released: money(sh.released, sh.currency) })}</small>` : html`<b class="is-dim">·</b><span>${x('stripShares')}</span><small>${x('stripNoShares')}</small>`}</div>
      <div>${p ? html`<b>${ctx.railsOn} / 3</b><span>${x('stripRails')}</span><small>${[p.stripe?.configured ? x('rail.stripe') + ' ✓' : x('rail.stripe') + ' ✗', p.x402?.enabled ? (p.x402.configured ? x('rail.x402') + ' ✓' : x('rail.x402') + ' ✗') + (p.x402.testnet ? ` (${x('testnetShort')})` : '') : '', x('stripInvoiceAlways')].filter(Boolean).join(' · ')}</small>` : html`<b class="is-dim">·</b><span>${x('stripRails')}</span><small>${x('stripRailsOff')}</small>`}</div>
    </div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSources(ctx) {
  const w = ctx.wallet;
  const l = w.lifetime || {};
  const s = sourcesOf(ctx.rows, ctx.self, ctx.agents);
  const cap = Number(w.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w.daily_allowance?.amount) || 0;
  const pct = cap ? Math.min(100, Math.round((Number(w.balance) / cap) * 100)) : 0;
  const real = ctx.rows.filter((tx) => !GRANTED.has(tx.type));
  const inRows = real.filter((tx) => Number(tx.amount) > 0), outRows = real.filter((tx) => Number(tx.amount) < 0);
  const span = (list) => (list.length ? `${dateWord(list[list.length - 1].timestamp)}–${dateWord(list[0].timestamp)}` : '');
  const col = (title, total, list, rows, cls) => html`
    <div class="wal-col">
      <div class="wal-col-h"><b class=${cls}>${signed(total)}</b> ${title}<small>${x('rowsN', { n: rows.length })}${rows.length ? ` · ${span(rows)}` : ''}</small></div>
      ${list.length ? list.map((src) => html`<div class="wal-src" key=${src.title}><span>${src.title}<small>${x('timesN', { n: src.count })}</small></span><b>${src.sum}</b></div>`) : html`<div class="wal-src is-dim">${x('nothingYet')}</div>`}
    </div>`;
  return html`
    <${Section} id="wal-sources" num="01" title=${x('secSources')} count=${x('secSourcesSub', { in: signed(l.earned), out: signed(-l.spent), unrecorded: l.unrecorded > 0 ? l.unrecorded : 0 })} first=${true}>
      <div class="wal-flow">
        ${col(x('came'), l.earned, s.in, inRows, 'is-good')}
        ${col(x('went'), -l.spent, s.out, outRows, 'is-low')}
      </div>
      <div class="wal-pace">
        <div><b>${x('paceTitle')}</b> ${x('paceBody', { pace, cap })} ${Number(w.balance) >= cap ? x('paceAtCap', { balance: w.balance, cap }) : x('paceBelowCap', { balance: w.balance, days: pace ? Math.ceil((cap - Number(w.balance)) / pace) : 0 })} ${l.total_rows ? (l.unrecorded > 0 ? x('paceRows', { sum: signed(l.ledger_sum), unrecorded: morsels(l.unrecorded) }) : l.unrecorded < 0 ? x('paceRowsOver', { sum: signed(l.ledger_sum), n: morsels(-l.unrecorded) }) : x('paceRowsExact', { sum: signed(l.ledger_sum) })) : ''}</div>
        <div class="wal-bar"><i style=${`width:${pct}%`}></i><span>${w.balance} / ${cap}</span></div>
      </div>
      <span class="og-label wal-label">${x('usesTitle')}</span>
      <div class="wal-uses">
        ${['work', 'tool', 'data', 'store', 'porting', 'overage'].map((k) => html`<div key=${k}><b>${x('use.' + k)}</b>${x('useBody.' + k)}<small>${x('useSub.' + k)}</small></div>`)}
      </div>
      <p class="wal-hint">${x('hintSources')}</p>
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
    <${Section} id="wal-ledger" num="02" title=${x('secLedger')} count=${x('secLedgerSub', { n: ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}>
      ${ctx.rowsTotal ? html`
        <div class="wal-filters">${filters.map(([id, n]) => html`<button type="button" key=${id} class=${`og-chip ${ctx.filter === id ? 'og-chip--sun' : ''}`} onClick=${() => ctx.setFilter(id)}>${x('filter.' + id)} ${n}</button>`)}</div>
        <div class="wal-rows">
          <div class="wal-row wal-row--head"><div>${x('colWhat')}</div><div>${x('colWhen')}</div><div class="wal-amt">${x('colAmount')}</div><div></div></div>
          ${shown.map((tx) => txRow(ctx, tx))}
        </div>
        <div class="og-doors wal-more">
          ${rows.length > shown.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.showMore()}>${x('showMore', { shown: shown.length, total: rows.length })}</button>` : null}
          <${CopyButton} className="og-door og-door--quiet" text=${copyAll} label=${x('copyAll')} />
          ${ctx.rowsPartial ? html`<small>${x('rowsPartial', { n: ctx.rows.length, total: ctx.rowsTotal })}</small>` : null}
        </div>` : html`<p class="wal-empty"><b>${x('noRowsLead')}</b> ${x('noRowsBody')}</p>`}
      <p class="wal-hint">${x('hintLedger', { n: counts.agent })}</p>
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
    <${Section} id="wal-money" num="03" title=${x('secMoney')} count=${sh ? x('secMoneySub', { shares: money(sh.total, sh.currency), sales: doneSales.length }) : x('secMoneySubNone')}>
      <p class="wal-para">${x('moneyIntro')}</p>
      ${sh ? html`
        <div class="wal-share">
          <div><b>${money(sh.accrued, sh.currency)}</b><span>${x('share.accruedTitle')}</span><small>${x('share.entriesN', { n: sh.accruedCount })}</small></div>
          <div><b>${money(sh.released, sh.currency)}</b><span>${x('share.releasedTitle')}</span><small>${x('share.entriesN', { n: sh.releasedCount })}</small></div>
          <div><b>${money(sh.paid, sh.currency)}</b><span>${x('share.paidTitle')}</span><small>${x('share.paidSub')}</small></div>
          <div>${verified?.state === 'verified' ? html`<b class="is-good wal-share-word">${x('share.verified')}</b><span>${verified.subjectLabel || ctx.approval?.subject || ''}</span><small>${verified.payable ? x('share.payable') : verified.message || ''}</small>` : html`<b class="wal-share-word">${x('share.unverified')}</b><span>${x('share.unverifiedSub')}</span><small>${verified?.message || ''}</small>`}</div>
        </div>
        ${ctx.openShares ? html`<div class="wal-rows wal-rows--money">
          <div class="wal-row wal-row--head"><div>${x('share.colEntry')}</div><div>${x('share.colBuyer')}</div><div class="wal-amt">${x('share.colShare')}</div><div></div></div>
          ${(ctx.earnings?.entries || []).map((e, i) => shareRow(e, i))}
        </div>` : null}` : html`<p class="wal-empty">${x('share.none')}</p>`}
      ${purchases.length || sales.length ? html`
        <div class="wal-rows wal-rows--money">
          <div class="wal-row wal-row--head"><div>${x('money.colTrade')}</div><div>${x('colWhen')}</div><div class="wal-amt">${x('money.colSum')}</div><div></div></div>
          ${sales.map((o) => moneyRow(o, true))}
          ${purchases.map((s) => moneyRow(s, false))}
        </div>` : html`<p class="wal-empty">${x('money.none')}</p>`}
      <div class="og-doors wal-more">
        <button type="button" class="og-door" onClick=${() => openTab('pnl')}>${x('toPnl')}</button>
        ${sh && (ctx.earnings?.entries || []).length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleShares()}>${ctx.openShares ? x('close') : x('share.showEntries', { n: ctx.earnings.entries.length })}</button>` : null}
      </div>
      <p class="wal-hint">${x('hintMoney')}</p>
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRails(ctx) {
  const p = ctx.payout;
  const rails = [{ id: 'stripe' }, ...(p?.x402?.enabled ? [{ id: 'x402' }] : []), { id: 'invoice' }];
  return html`
    <${Section} id="wal-rails" num="04" title=${x('secRails')} count=${p ? x('secRailsSub', { n: ctx.railsOn }) : null}>
      <p class="wal-para">${x('railsIntro')}</p>
      ${p === false ? html`<p class="wal-empty">${x('railsOff')}</p>` : !p ? html`<p class="wal-empty">${x('loading')}</p>` : html`
        <div class="wal-rows wal-rows--rails">
          <div class="wal-row wal-row--head"><div>${x('rail.colRail')}</div><div>${x('rail.colState')}</div><div>${x('rail.colCurrencies')}</div><div></div></div>
          ${rails.map((r) => railRow(ctx, r))}
        </div>`}
      <p class="wal-hint">${x('hintRails')}</p>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = x('leadRequest');
  return html`
    <${Section} id="wal-roads" num="05" title=${x('secRoads')} count=${null}>
      <p class="wal-para">${x('roadsIntro')}</p>
      <div class="wal-roads">
        <div class="wal-road is-lead">
          <span class="og-label">${x('roadAsk')}</span>
          <p>${x('roadAskBody')}</p>
          <pre>${request}</pre>
          <div class="og-doors"><${CopyButton} className="og-door" text=${request} label=${x('copyRequest')} /></div>
        </div>
        <div class="wal-road">
          <span class="og-label">${x('roadAgent')}</span>
          <p>${x('roadAgentBody')}</p>
          <small>${x('roadAgentSub', { n: ctx.counts.agent, total: ctx.rowsTotal })}</small>
        </div>
      </div>
    <//>`;
}
