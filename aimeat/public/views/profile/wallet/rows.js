/**
 * @file public/views/profile/wallet/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the wallet page: one ledger row in words (what happened, when, how
 *   many morsels) and what opens under it (who made the call, the counterparty, the tracking code,
 *   the id, a copy door); one payout rail (card, stablecoin, invoice) and what opens under it (the
 *   field for the key or the address, the steps for getting one, the remove door); one share
 *   entry; one money purchase or sale.
 * @structure txRow · txOpen · railRow · railOpen · shareRow · moneyRow
 * @usage import { txRow, railRow, shareRow, moneyRow } from './rows.js';
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.14.0 -- 2026-09-26 -- A payout rail's state (a key or an address stored, or none) is the Status: fine or attention, a unification: Jouni's decision Status.
 *   v1.13.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.11.0 -- 2026-09-25 -- The facts of an opened ledger row are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A ledger row, a rail, a share entry and a purchase or sale are the Listing (listing-row and its name, words and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.8.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose detail frames from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { x, money, morsels, signed, dateWord, timeWord, shortName, rowWords, rowKind } from './frame.js';

/* ── One ledger row ───────────────────────────────────────────────────────────────────────────── */

export function txRow(ctx, tx) {
  const open = ctx.openTx === tx.id;
  const w = rowWords(tx, ctx.self, ctx.agents);
  const kind = rowKind(tx);
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${tx.id}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTx(tx.id)}>${w.title}</button><small>${w.sub}</small></div>
      <div class="poster-time">${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}</div>
      <div class=${`wal-amt poster-stat-number poster-stat-number--small ${kind === 'out' ? 'is-out' : kind === 'in' ? 'is-in' : ''}`}>${signed(tx.amount)}<small>${morsels(tx.amount) === x('morselOne', { n: 1 }) ? x('unitOne') : x('unitMany')}</small></div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleTx(tx.id)}>${open ? x('close') : x('open')}</button></div>
      ${open ? txOpen(ctx, tx, w) : null}
    </div>`;
}

function txOpen(ctx, tx, w) {
  const copy = [`${w.title}`, `${x('detail.amount')}: ${signed(tx.amount)}`, `${x('detail.when')}: ${tx.timestamp || ''}`, tx.initiator_gaii ? `${x('detail.who')}: ${tx.initiator_gaii}` : '', tx.counterparty_gaii ? `${x('detail.counterparty')}: ${tx.counterparty_gaii}` : '', tx.tracking_code ? `${x('detail.code')}: ${tx.tracking_code}` : '', `${x('detail.id')}: ${tx.id || ''}`].filter(Boolean).join('\n');
  const agent = tx.initiator_gaii ? (ctx.agents || []).find((a) => a.gaii === tx.initiator_gaii) : null;
  const missing = html`<span class="is-dim">${x('detail.notRecorded')}</span>`;
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${x('detail.lead', { n: morsels(tx.amount), when: `${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}`, what: w.title })} ${tx.initiator_gaii ? x('detail.leadAgent', { name: agent?.name || shortName(tx.initiator_gaii) }) : x('detail.leadYou')}${!tx.tracking_code && !tx.counterparty_gaii ? ' ' + x('detail.leadMissing') : ''}</p>
      <div class="facts">
        <div class="facts-k poster-label">${x('detail.who')}</div><div class="facts-v">${tx.initiator_gaii ? html`${agent?.name || shortName(tx.initiator_gaii)} <code class="code-inline">${tx.initiator_gaii}</code><small>${x('detail.agentSpends')}</small>` : x('detail.youOrSystem')}</div>
        <div class="facts-k poster-label">${x('detail.kind')}</div><div class="facts-v">${x('kind.' + tx.type) !== 'walpage.kind.' + tx.type ? x('kind.' + tx.type) : tx.type} <code class="code-inline">${tx.type}</code></div>
        <div class="facts-k poster-label">${x('detail.counterparty')}</div><div class="facts-v">${tx.counterparty_gaii ? html`${shortName(tx.counterparty_gaii)} <code class="code-inline">${tx.counterparty_gaii}</code>` : missing}</div>
        <div class="facts-k poster-label">${x('detail.code')}</div><div class="facts-v">${tx.tracking_code ? html`<code class="code-inline">${tx.tracking_code}</code>` : missing}</div>
        <div class="facts-k poster-label">${x('detail.id')}</div><div class="facts-v"><code class="code-inline">${tx.id}</code></div>
      </div>
      <div class="og-doors listing-open-doors">
        <${CopyButton} className="poster-action poster-action--small poster-action--lower" text=${copy} label=${x('copyRow')} />
        ${agent ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.openAgents()}>${x('showAgent')}</button>` : null}
      </div>
    </div>`;
}

/* ── One payout rail ──────────────────────────────────────────────────────────────────────────── */

export function railRow(ctx, rail) {
  const open = ctx.openRail === rail.id;
  const p = ctx.payout || {};
  let state, sub, currencies, doors;
  if (rail.id === 'stripe') {
    const s = p.stripe || {};
    state = s.configured ? html`<b class="poster-status poster-status--fine">${x('rail.keyStored')}</b> · ${x('rail.endsWith', { hint: s.keyHint || '' })}` : html`<b class="poster-status poster-status--attention">${x('rail.noKey')}</b> · ${x('rail.noKeyBody')}`;
    sub = x('rail.cardSub');
    currencies = (s.currencies || ['EUR', 'USD']).join(' · ');
    doors = html`<button type="button" class="poster-action poster-action--small" disabled=${!ctx.payout} onClick=${() => ctx.toggleRail('stripe')}>${open ? x('close') : s.configured ? x('rail.changeKey') : x('rail.addKey')}</button>`;
  } else if (rail.id === 'x402') {
    const s = p.x402 || {};
    state = s.configured ? html`<b class="poster-status poster-status--fine">${x('rail.addressStored')}</b> · ${shortAddr(s.address)}<small>${s.testnet ? x('rail.testnet', { network: s.network || '' }) : x('rail.mainnet', { network: s.network || '' })}</small>` : html`<b class="poster-status poster-status--attention">${x('rail.noAddress')}</b> · ${x('rail.noAddressBody')}`;
    sub = x('rail.stableSub');
    currencies = (s.assets || []).map((a) => `${a.currency} → ${a.symbol}`).join(' · ');
    doors = html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.toggleRail('x402')}>${open ? x('close') : s.configured ? x('rail.changeAddress') : x('rail.addAddress')}</button>`;
  } else {
    state = x('rail.invoiceBody');
    sub = x('rail.invoiceSub');
    currencies = (p.invoice?.currencies || ['EUR', 'USD']).join(' · ');
    doors = null;
  }
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${rail.id} id=${'wal-rail-' + rail.id}>
      <div class="listing-name">${x('rail.' + rail.id)}<small>${sub}</small></div>
      <div class="listing-desc wal-w">${state}</div>
      <div class="listing-desc wal-cur">${currencies}</div>
      <div class="listing-doors">${doors}</div>
      ${open ? railOpen(ctx, rail.id) : null}
    </div>`;
}

const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');

function railOpen(ctx, id) {
  const stripe = id === 'stripe';
  const s = stripe ? ctx.payout?.stripe || {} : ctx.payout?.x402 || {};
  const draft = stripe ? ctx.keyDraft : ctx.addrDraft;
  const valid = stripe ? draft.trim().length >= 8 : /^0x[a-fA-F0-9]{40}$/.test(draft.trim());
  const steps = stripe
    ? [[x('help.card1'), ['https://dashboard.stripe.com/register', 'dashboard.stripe.com/register']], [x('help.card2'), ['https://dashboard.stripe.com/apikeys', 'dashboard.stripe.com/apikeys']], [x('help.card3')], [x('help.card4')]]
    : [[x('help.stable1'), ['https://www.coinbase.com/wallet', 'Coinbase Wallet'], ['https://metamask.io/', 'MetaMask']], [x('help.stable2')], [x('help.stable3')], ...(s.testnet ? [[x('help.stable4')]] : [])];
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${stripe ? x('rail.cardLead') : x('rail.stableLead')}</p>
      <div class="field-row">
        <input class="og-input" type=${stripe ? 'password' : 'text'} autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" value=${draft} placeholder=${stripe ? 'sk_live_…' : '0x…'} aria-label=${stripe ? x('rail.keyLabel') : x('rail.addressLabel')} onInput=${(e) => (stripe ? ctx.setKeyDraft(e.target.value) : ctx.setAddrDraft(e.target.value))} />
        <button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'rail' || !valid} onClick=${() => (stripe ? ctx.saveStripe() : ctx.saveX402())}>${stripe ? x('rail.saveKey') : x('rail.saveAddress')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleRail(null)}>${x('cancel')}</button>
      </div>
      ${!stripe && draft.trim() && !valid ? html`<small class="form-message form-message--error">${x('rail.addressInvalid')}</small>` : null}
      ${ctx.railMsg ? html`<small class=${`form-message ${ctx.railMsg.error ? 'form-message--error' : ''}`}>${ctx.railMsg.text}</small>` : null}
      <span class="poster-label wal-label">${stripe ? x('help.cardTitle') : x('help.stableTitle')}</span>
      <${IndexList} steps className="wal-steps">${steps.map(([text, ...links], i) => html`<${IndexStep} key=${i}>${text}${links.map(([href, label], k) => html`${k ? ' · ' : ' '}<a href=${href} target="_blank" rel="noopener noreferrer">${label}</a>`)}<//>`)}<//>
      ${s.configured ? html`<div class="og-doors listing-open-doors"><button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" disabled=${ctx.busy === 'rail'} onClick=${() => (stripe ? ctx.removeStripe() : ctx.removeX402())}>${stripe ? x('rail.removeKey') : x('rail.removeAddress')}</button></div>` : null}
    </div>`;
}

/* ── One share entry, one money purchase or sale ──────────────────────────────────────────────── */

export function shareRow(entry, i) {
  const code = String(entry.tracking_code || entry.reference || '');
  const m = code.match(/apptool:[^/]+\/([^:]+):([^:]+)/);
  const what = m ? `${m[1]} · ${m[2]}` : (entry.reference || code || x('share.entry'));
  const status = entry.status || 'accrued';
  return html`
    <div class="listing-row" key=${entry.tracking_code || i}>
      <div class="listing-name">${what}<small>${entry.released_at ? `${dateWord(entry.released_at)} ${timeWord(entry.released_at)} · ` : ''}${x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status}</small></div>
      <div class="listing-desc">${entry.buyer ? x('share.buyer', { name: shortName(entry.buyer) }) : ''}${entry.note ? ` · ${entry.note}` : ''}</div>
      <div class=${`wal-amt poster-stat-number poster-stat-number--small ${status === 'released' || status === 'paid' ? 'is-in' : ''}`}>${money(entry.amount, entry.currency)}</div>
      <div class="listing-doors"><span class=${`poster-status ${status === 'accrued' ? 'poster-status--off' : 'poster-status--fine'}`}>${x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status}</span></div>
    </div>`;
}

export function moneyRow(item, sale) {
  const title = item.items?.[0]?.title || (sale ? x('money.sale') : x('money.purchase'));
  const done = item.status === 'completed';
  const stale = !done && item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();
  const when = item.createdAt || item.created_at;
  const amount = sale ? (item.receipt?.earned ?? item.total) : item.total;
  return html`
    <div class="listing-row" key=${item.id}>
      <div class="listing-name">${sale ? x('money.soldTitle', { title }) : x('money.boughtTitle', { title })}<small>${done ? (sale ? x('money.paidToYou') : x('money.paid')) : stale ? x('money.expired') : x('money.open')}${sale && item.buyerOwner ? ` · ${x('share.buyer', { name: item.buyerOwner })}` : ''}</small></div>
      <div class="poster-time">${dateWord(when)} ${timeWord(when)}</div>
      <div class=${`wal-amt poster-stat-number poster-stat-number--small ${done ? (sale ? 'is-in' : '') : 'is-dim'}`}>${sale && done ? '+' : ''}${money(amount, item.currency)}</div>
      <div class="listing-doors">${!done ? html`<span class="poster-status poster-status--off">${stale ? x('money.expired') : x('money.open')}</span>` : null}</div>
    </div>`;
}
