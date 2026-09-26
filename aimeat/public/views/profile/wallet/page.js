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
 * @structure renderPage · federated · head · strip · secSources · secLedger · secMoney · secRails ·
 *   secRoads
 * @usage import { renderPage } from './wallet/page.js';
 * @version-history
 *   v1.21.0 — 2026-09-26 — On the component kit (page group G7): the frame, crumb, head, rail and
 *     strip are SettingsPage and FigureStrip; the sections are Section; where the morsels came from and
 *     went to and the pace are the new MorselFlow and MorselPace (components/MorselFlow.js, the bar the
 *     one Meter); what morsels buy is CardGrid; the ledger filters are Tabs in the filter tone; the
 *     lists are List with its More line; the share figures a FigureStrip; the doors Action, Loud and
 *     Actions; the two roads Roads; the federated box SettingBox. The testnet tag keeps main's dim
 *     tone (Mark tone="dim", og-chip--dim on main). The page writes no class.
 *   v1.20.0 -- 2026-09-26 -- The ready-made request is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.19.0 -- 2026-09-26 -- The figure on the pace meter wears the Meter's figure class (.poster-meter-figure); nothing on screen changes.
 *   v1.18.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.17.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.16.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-25 -- What morsels buy is the Item grid (css/components/item-grid.css), a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- The line under a list with its count is the More line (css/components/more-line.css), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- The share figures are the figure strip (og-strip); "Verified" is its word cut in the fine tone (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The ledger, the share entries, the purchases and sales and the payout rails are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the pace explanation.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Lompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { scrollToSection } from '/components/Rail.js';
import { Tabs } from '/components/Tabs.js';
import { List, More } from '/components/List.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { MorselFlow, MorselPace } from '/components/MorselFlow.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Card, CardGrid } from '/components/Card.js';
import { Roads, Road } from '/components/Roads.js';
import { Space } from '/components/Layout.js';
import { x, money, morsels, signed, dateWord, sourcesOf, crumb, pageLinks, openTab, GRANTED } from './frame.js';
import { txRow, railRow, shareRow, moneyRow } from './rows.js';

const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);
const isMoney = (item) => item.currency && item.currency !== 'morsel';

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const w = ctx.wallet;
  const l = w?.lifetime || {};
  const sh = ctx.shares;
  const railsOn = ctx.railsOn;
  const sections = [
    { id: 'wal-sources', num: '01', label: x('secSources'), count: w ? `${signed(l.earned)} / ${signed(-l.spent)}` : '' },
    { id: 'wal-ledger', num: '02', label: x('secLedger'), count: w ? String(ctx.rowsTotal) : '' },
    { id: 'wal-money', num: '03', label: x('secMoney'), count: sh ? money(sh.total, sh.currency) : '' },
    { id: 'wal-rails', num: '04', label: x('secRails'), count: ctx.payout ? `${railsOn} / 3` : '' },
    { id: 'wal-roads', num: '05', label: x('secRoads'), count: '' },
  ];
  return html`
    <${SettingsPage} name="wal" crumb=${crumb()} ...${head(ctx)} strip=${strip(ctx)}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${!w ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        ${secSources(ctx)}
        ${secLedger(ctx)}
        ${secMoney(ctx)}
        ${secRails(ctx)}
        ${secRoads(ctx)}`}
    <//>`;
}

function federated(ctx) {
  return html`
    <${SettingsPage} name="wal" crumb=${crumb()} title=${t('profile.tabs.wallet')} sub=${x('titleSub')} desc=${x('desc')}>
      <${SettingBox} label=${x('federatedLabel')} irreversible>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}<//>
    <//>`;
}

/** The mast as SettingsPage's head props: title, the tags, the words (and the request's message), the request slab and its doors. */
function head(ctx) {
  const w = ctx.wallet;
  const p = ctx.payout;
  const cap = Number(w?.daily_allowance?.accumulation_cap) || 0;
  const pace = Number(w?.daily_allowance?.amount) || 0;
  const room = w ? Math.max(0, cap - (Number(w.balance) || 0)) : 0;
  const marks = !w ? [] : [
    { label: morsels(w.balance), tone: 'sun' },
    { label: x('chipPace', { n: pace, cap }) },
    p ? { label: [x('rail.stripe'), p.x402?.enabled ? x('rail.x402') : '', x('rail.invoice')].filter(Boolean).join(' · ').toLowerCase() } : null,
    p?.x402?.enabled && p.x402.testnet ? { label: x('chipTestnet'), tone: 'dim' } : null,
  ];
  const copy = w ? x('copyBalanceText', { balance: morsels(w.balance), available: w.available, escrow: w.in_escrow }) : '';
  const actions = html`
    ${w && room > 0
      ? html`<${Loud} control disabled=${ctx.busy === 'request'} onClick=${() => ctx.requestToday()}>${ctx.busy === 'request' ? x('requesting') : x('requestToday')}<//><${Note} kind="hint" slab inline>${x('requestHint', { n: morsels(Math.min(pace, room)), cap })}<//>`
      : w ? html`<${Note} kind="hint" slab inline>${x('atCap', { cap })}<//>` : null}
    <${Actions}>
      ${w ? html`<${Action} small copy=${copy}>${x('copyBalance')}<//>` : null}
      <${Action} small soft onClick=${() => scrollToSection('wal-roads')}>${x('toAi')}<//>
    <//>`;
  return { title: t('profile.tabs.wallet'), sub: x('titleSub'), marks, desc: html`${x('desc')}${msg(ctx.requestMsg)}`, actions };
}

function strip(ctx) {
  const w = ctx.wallet;
  if (!w) return html`<${FigureStrip} loading=${4} />`;
  const l = w.lifetime || {};
  const cap = Number(w.daily_allowance?.accumulation_cap) || 0;
  const sh = ctx.shares;
  const p = ctx.payout;
  return html`<${FigureStrip} items=${[
    { n: w.balance, label: x('stripBalance'), sub: `${x('stripBalanceSub', { available: w.available, escrow: w.in_escrow })}${Number(w.balance) >= cap ? ` · ${x('stripAtCap')}` : ''}` },
    { n: html`<${Tinted} tone="fine">${signed(l.earned)}<//> / <${Tinted} tone="notice">${signed(-l.spent)}<//>`, label: x('stripFlow'),
      sub: `${x('stripFlowSub', { n: l.total_rows ?? ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}${l.unrecorded > 0 ? ` · ${x('stripUnrecorded', { n: l.unrecorded })}` : ''}` },
    sh
      ? { n: money(sh.total, sh.currency), label: x('stripShares'), sub: x('stripSharesSub', { accrued: money(sh.accrued, sh.currency), released: money(sh.released, sh.currency) }) }
      : { n: '·', tone: 'dim', label: x('stripShares'), sub: x('stripNoShares') },
    p
      ? { n: `${ctx.railsOn} / 3`, label: x('stripRails'), sub: [p.stripe?.configured ? x('rail.stripe') + ' ✓' : x('rail.stripe') + ' ✗', p.x402?.enabled ? (p.x402.configured ? x('rail.x402') + ' ✓' : x('rail.x402') + ' ✗') + (p.x402.testnet ? ` (${x('testnetShort')})` : '') : '', x('stripInvoiceAlways')].filter(Boolean).join(' · ') }
      : { n: '·', tone: 'dim', label: x('stripRails'), sub: x('stripRailsOff') },
  ]} />`;
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
  const col = (key, title, total, list, rows, tone) => ({
    key, title, total: signed(total), tone,
    count: `${x('rowsN', { n: rows.length })}${rows.length ? ` · ${span(rows)}` : ''}`,
    rows: list.map((src) => ({ key: src.title, title: src.title, sub: x('timesN', { n: src.count }), sum: src.sum })),
    empty: x('nothingYet'),
  });
  const capWords = Number(w.balance) >= cap ? x('paceAtCap', { balance: w.balance, cap }) : x('paceBelowCap', { balance: w.balance, days: pace ? Math.ceil((cap - Number(w.balance)) / pace) : 0 });
  const rowWords = l.total_rows ? (l.unrecorded > 0 ? x('paceRows', { sum: signed(l.ledger_sum), unrecorded: morsels(l.unrecorded) }) : l.unrecorded < 0 ? x('paceRowsOver', { sum: signed(l.ledger_sum), n: morsels(-l.unrecorded) }) : x('paceRowsExact', { sum: signed(l.ledger_sum) })) : '';
  return html`
    <${Section} id="wal-sources" num="01" title=${x('secSources')} count=${x('secSourcesSub', { in: signed(l.earned), out: signed(-l.spent), unrecorded: l.unrecorded > 0 ? l.unrecorded : 0 })} first=${true}>
      <${MorselFlow} columns=${[col('in', x('came'), l.earned, s.in, inRows, 'fine'), col('out', x('went'), -l.spent, s.out, outRows, 'notice')]} />
      <${MorselPace} title=${x('paceTitle')} words=${`${x('paceBody', { pace, cap })} ${capWords} ${rowWords}`} pct=${pct} figure=${`${w.balance} / ${cap}`} />
      <${Space} above="large" below="tight"><${Label} block>${x('usesTitle')}<//><//>
      <${CardGrid}>
        ${['work', 'tool', 'data', 'store', 'porting', 'overage'].map((k) => html`<${Card} key=${k} name=${x('use.' + k)} text=${x('useBody.' + k)} meta=${x('useSub.' + k)} />`)}
      <//>
      <${Note} kind="hint">${x('hintSources')}<//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secLedger(ctx) {
  const rows = ctx.filtered;
  const shown = rows.slice(0, ctx.shown);
  const counts = ctx.counts;
  const filters = [['all', counts.all], ['in', counts.in], ['out', counts.out], ['agent', counts.agent]];
  const copyAll = ctx.rows.map((tx) => `${tx.timestamp || ''}\t${signed(tx.amount)}\t${tx.type}\t${tx.tracking_code || ''}\t${tx.counterparty_gaii || ''}\t${tx.initiator_gaii || ''}`).join('\n');
  const showMore = rows.length > shown.length ? () => ctx.showMore() : null;
  return html`
    <${Section} id="wal-ledger" num="02" title=${x('secLedger')} count=${x('secLedgerSub', { n: ctx.rowsTotal, first: dateWord(ctx.first), last: dateWord(ctx.last) })}>
      ${ctx.rowsTotal ? html`
        <${Tabs} tone="filter" value=${ctx.filter} onSelect=${(v) => ctx.setFilter(v)}
          items=${filters.map(([id, n]) => ({ value: id, label: x('filter.' + id), count: n }))} />
        <${List} cols="name-when-amount-doors" keepCols head=${[x('colWhat'), x('colWhen'), { label: x('colAmount'), num: true }, '']}>
          ${shown.map((tx) => txRow(ctx, tx))}
        <//>
        <${More} label=${x('showMore', { shown: shown.length, total: rows.length })} onMore=${showMore}
          note=${ctx.rowsPartial ? x('rowsPartial', { n: ctx.rows.length, total: ctx.rowsTotal }) : undefined}>
          <${Action} small soft copy=${copyAll}>${x('copyAll')}<//>
        <//>` : html`<${Note} kind="quiet"><b>${x('noRowsLead')}</b> ${x('noRowsBody')}<//>`}
      <${Note} kind="hint">${x('hintLedger', { n: counts.agent })}<//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secMoney(ctx) {
  const sh = ctx.shares;
  const purchases = (ctx.sessions || []).filter(isMoney);
  const sales = (ctx.orders || []).filter(isMoney);
  const doneSales = sales.filter((o) => o.status === 'completed');
  const verified = ctx.earnings?.verification;
  const entries = ctx.earnings?.entries || [];
  return html`
    <${Section} id="wal-money" num="03" title=${x('secMoney')} count=${sh ? x('secMoneySub', { shares: money(sh.total, sh.currency), sales: doneSales.length }) : x('secMoneySubNone')}>
      <${Note} kind="lead">${x('moneyIntro')}<//>
      ${sh ? html`
        <${FigureStrip} lead wrap items=${[
          { n: money(sh.accrued, sh.currency), label: x('share.accruedTitle'), sub: x('share.entriesN', { n: sh.accruedCount }) },
          { n: money(sh.released, sh.currency), label: x('share.releasedTitle'), sub: x('share.entriesN', { n: sh.releasedCount }) },
          { n: money(sh.paid, sh.currency), label: x('share.paidTitle'), sub: x('share.paidSub') },
          verified?.state === 'verified'
            ? { n: x('share.verified'), tone: 'word fine', label: verified.subjectLabel || ctx.approval?.subject || '', sub: verified.payable ? x('share.payable') : verified.message || '' }
            : { n: x('share.unverified'), tone: 'word', label: x('share.unverifiedSub'), sub: verified?.message || '' },
        ]} />
        ${ctx.openShares ? html`
          <${List} cols="name-when-amount-doors" keepCols apart head=${[x('share.colEntry'), x('share.colBuyer'), { label: x('share.colShare'), num: true }, '']}>
            ${entries.map((e, i) => shareRow(e, i))}
          <//>` : null}` : html`<${Note} kind="quiet">${x('share.none')}<//>`}
      ${purchases.length || sales.length ? html`
        <${List} cols="name-when-amount-doors" keepCols apart head=${[x('money.colTrade'), x('colWhen'), { label: x('money.colSum'), num: true }, '']}>
          ${sales.map((o) => moneyRow(o, true))}
          ${purchases.map((s) => moneyRow(s, false))}
        <//>` : html`<${Note} kind="quiet">${x('money.none')}<//>`}
      <${Actions}>
        <${Action} small onClick=${() => openTab('pnl')}>${x('toPnl')}<//>
        ${sh && entries.length ? html`<${Action} small soft expanded=${!!ctx.openShares} onClick=${() => ctx.toggleShares()}>${ctx.openShares ? x('close') : x('share.showEntries', { n: entries.length })}<//>` : null}
      <//>
      <${Note} kind="hint">${x('hintMoney')}<//>
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRails(ctx) {
  const p = ctx.payout;
  const rails = [{ id: 'stripe' }, ...(p?.x402?.enabled ? [{ id: 'x402' }] : []), { id: 'invoice' }];
  return html`
    <${Section} id="wal-rails" num="04" title=${x('secRails')} count=${p ? x('secRailsSub', { n: ctx.railsOn }) : null}>
      <${Note} kind="lead">${x('railsIntro')}<//>
      ${p === false ? html`<${Note} kind="quiet">${x('railsOff')}<//>` : !p ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        <${List} cols="name-state-cur-doors" keepCols head=${[x('rail.colRail'), x('rail.colState'), x('rail.colCurrencies'), '']}>
          ${rails.map((r) => railRow(ctx, r))}
        <//>`}
      <${Note} kind="hint">${x('hintRails')}<//>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = x('leadRequest');
  return html`
    <${Section} id="wal-roads" num="05" title=${x('secRoads')}>
      <${Note} kind="lead">${x('roadsIntro')}<//>
      <${Roads} wide>
        <${Road} lead name=${x('roadAsk')} text=${x('roadAskBody')} code=${request}
          doors=${html`<${Action} small copy=${request}>${x('copyRequest')}<//>`} />
        <${Road} name=${x('roadAgent')} text=${x('roadAgentBody')} meta=${x('roadAgentSub', { n: ctx.counts.agent, total: ctx.rowsTotal })} />
      <//>
    <//>`;
}
