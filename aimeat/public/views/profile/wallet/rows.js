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
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { x, money, morsels, signed, dateWord, timeWord, shortName, rowWords, rowKind } from './frame.js';

/* ── One ledger row ───────────────────────────────────────────────────────────────────────────── */

export function txRow(ctx, tx) {
  const open = ctx.openTx === tx.id;
  const w = rowWords(tx, ctx.self, ctx.agents);
  const kind = rowKind(tx);
  return html`
    <div class=${`wal-row wal-tx ${open ? 'is-open' : ''}`} key=${tx.id}>
      <div class="wal-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.toggleTx(tx.id)}>${w.title}</button><small>${w.sub}</small></div>
      <div class="wal-w">${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}</div>
      <div class=${`wal-amt ${kind === 'out' ? 'is-out' : kind === 'in' ? 'is-in' : ''}`}>${signed(tx.amount)}<small>${morsels(tx.amount) === x('morselOne', { n: 1 }) ? x('unitOne') : x('unitMany')}</small></div>
      <div class="wal-go"><button type="button" class="og-door" onClick=${() => ctx.toggleTx(tx.id)}>${open ? x('close') : x('open')}</button></div>
      ${open ? txOpen(ctx, tx, w) : null}
    </div>`;
}

function txOpen(ctx, tx, w) {
  const copy = [`${w.title}`, `${x('detail.amount')}: ${signed(tx.amount)}`, `${x('detail.when')}: ${tx.timestamp || ''}`, tx.initiator_gaii ? `${x('detail.who')}: ${tx.initiator_gaii}` : '', tx.counterparty_gaii ? `${x('detail.counterparty')}: ${tx.counterparty_gaii}` : '', tx.tracking_code ? `${x('detail.code')}: ${tx.tracking_code}` : '', `${x('detail.id')}: ${tx.id || ''}`].filter(Boolean).join('\n');
  const agent = tx.initiator_gaii ? (ctx.agents || []).find((a) => a.gaii === tx.initiator_gaii) : null;
  const missing = html`<span class="is-dim">${x('detail.notRecorded')}</span>`;
  return html`
    <div class="wal-open">
      <p class="wal-lead">${x('detail.lead', { n: morsels(tx.amount), when: `${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}`, what: w.title })} ${tx.initiator_gaii ? x('detail.leadAgent', { name: agent?.name || shortName(tx.initiator_gaii) }) : x('detail.leadYou')}${!tx.tracking_code && !tx.counterparty_gaii ? ' ' + x('detail.leadMissing') : ''}</p>
      <div class="wal-kv">
        <div class="wal-k">${x('detail.who')}</div><div class="wal-v">${tx.initiator_gaii ? html`${agent?.name || shortName(tx.initiator_gaii)} <code>${tx.initiator_gaii}</code><small>${x('detail.agentSpends')}</small>` : x('detail.youOrSystem')}</div>
        <div class="wal-k">${x('detail.kind')}</div><div class="wal-v">${x('kind.' + tx.type) !== 'walpage.kind.' + tx.type ? x('kind.' + tx.type) : tx.type} <code>${tx.type}</code></div>
        <div class="wal-k">${x('detail.counterparty')}</div><div class="wal-v">${tx.counterparty_gaii ? html`${shortName(tx.counterparty_gaii)} <code>${tx.counterparty_gaii}</code>` : missing}</div>
        <div class="wal-k">${x('detail.code')}</div><div class="wal-v">${tx.tracking_code ? html`<code>${tx.tracking_code}</code>` : missing}</div>
        <div class="wal-k">${x('detail.id')}</div><div class="wal-v"><code>${tx.id}</code></div>
      </div>
      <div class="og-doors">
        <${CopyButton} className="og-door og-door--quiet" text=${copy} label=${x('copyRow')} />
        ${agent ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openAgents()}>${x('showAgent')}</button>` : null}
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
    state = s.configured ? html`<b>${x('rail.keyStored')}</b> · ${x('rail.endsWith', { hint: s.keyHint || '' })}` : html`<b class="is-low">${x('rail.noKey')}</b> · ${x('rail.noKeyBody')}`;
    sub = x('rail.cardSub');
    currencies = (s.currencies || ['EUR', 'USD']).join(' · ');
    doors = html`<button type="button" class="og-door" disabled=${!ctx.payout} onClick=${() => ctx.toggleRail('stripe')}>${open ? x('close') : s.configured ? x('rail.changeKey') : x('rail.addKey')}</button>`;
  } else if (rail.id === 'x402') {
    const s = p.x402 || {};
    state = s.configured ? html`<b>${x('rail.addressStored')}</b> · ${shortAddr(s.address)}<small>${s.testnet ? x('rail.testnet', { network: s.network || '' }) : x('rail.mainnet', { network: s.network || '' })}</small>` : html`<b class="is-low">${x('rail.noAddress')}</b> · ${x('rail.noAddressBody')}`;
    sub = x('rail.stableSub');
    currencies = (s.assets || []).map((a) => `${a.currency} → ${a.symbol}`).join(' · ');
    doors = html`<button type="button" class="og-door" onClick=${() => ctx.toggleRail('x402')}>${open ? x('close') : s.configured ? x('rail.changeAddress') : x('rail.addAddress')}</button>`;
  } else {
    state = x('rail.invoiceBody');
    sub = x('rail.invoiceSub');
    currencies = (p.invoice?.currencies || ['EUR', 'USD']).join(' · ');
    doors = null;
  }
  return html`
    <div class=${`wal-row wal-rail ${open ? 'is-open' : ''}`} key=${rail.id} id=${'wal-rail-' + rail.id}>
      <div class="wal-nm">${x('rail.' + rail.id)}<small>${sub}</small></div>
      <div class="wal-w">${state}</div>
      <div class="wal-cur">${currencies}</div>
      <div class="wal-go">${doors}</div>
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
    <div class="wal-open">
      <p class="wal-lead">${stripe ? x('rail.cardLead') : x('rail.stableLead')}</p>
      <div class="wal-field">
        <input class="og-input" type=${stripe ? 'password' : 'text'} autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" value=${draft} placeholder=${stripe ? 'sk_live_…' : '0x…'} aria-label=${stripe ? x('rail.keyLabel') : x('rail.addressLabel')} onInput=${(e) => (stripe ? ctx.setKeyDraft(e.target.value) : ctx.setAddrDraft(e.target.value))} />
        <button type="button" class="og-door" disabled=${ctx.busy === 'rail' || !valid} onClick=${() => (stripe ? ctx.saveStripe() : ctx.saveX402())}>${stripe ? x('rail.saveKey') : x('rail.saveAddress')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleRail(null)}>${x('cancel')}</button>
      </div>
      ${!stripe && draft.trim() && !valid ? html`<small class="wal-msg is-err">${x('rail.addressInvalid')}</small>` : null}
      ${ctx.railMsg ? html`<small class=${`wal-msg ${ctx.railMsg.error ? 'is-err' : ''}`}>${ctx.railMsg.text}</small>` : null}
      <span class="og-label wal-label">${stripe ? x('help.cardTitle') : x('help.stableTitle')}</span>
      <ol class="wal-steps">${steps.map(([text, ...links], i) => html`<li key=${i}>${text}${links.map(([href, label], k) => html`${k ? ' · ' : ' '}<a href=${href} target="_blank" rel="noopener noreferrer">${label}</a>`)}</li>`)}</ol>
      ${s.configured ? html`<div class="og-doors"><button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'rail'} onClick=${() => (stripe ? ctx.removeStripe() : ctx.removeX402())}>${stripe ? x('rail.removeKey') : x('rail.removeAddress')}</button></div>` : null}
    </div>`;
}

/* ── One share entry, one money purchase or sale ──────────────────────────────────────────────── */

export function shareRow(entry, i) {
  const code = String(entry.tracking_code || entry.reference || '');
  const m = code.match(/apptool:[^/]+\/([^:]+):([^:]+)/);
  const what = m ? `${m[1]} · ${m[2]}` : (entry.reference || code || x('share.entry'));
  const status = entry.status || 'accrued';
  return html`
    <div class="wal-row" key=${entry.tracking_code || i}>
      <div class="wal-nm">${what}<small>${entry.released_at ? `${dateWord(entry.released_at)} ${timeWord(entry.released_at)} · ` : ''}${x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status}</small></div>
      <div class="wal-w">${entry.buyer ? x('share.buyer', { name: shortName(entry.buyer) }) : ''}${entry.note ? ` · ${entry.note}` : ''}</div>
      <div class=${`wal-amt ${status === 'released' || status === 'paid' ? 'is-in' : ''}`}>${money(entry.amount, entry.currency)}</div>
      <div class="wal-go"><span class=${`og-chip ${status === 'accrued' ? 'og-chip--dim' : ''}`}>${x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status}</span></div>
    </div>`;
}

export function moneyRow(item, sale) {
  const title = item.items?.[0]?.title || (sale ? x('money.sale') : x('money.purchase'));
  const done = item.status === 'completed';
  const stale = !done && item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();
  const when = item.createdAt || item.created_at;
  const amount = sale ? (item.receipt?.earned ?? item.total) : item.total;
  return html`
    <div class="wal-row" key=${item.id}>
      <div class="wal-nm">${sale ? x('money.soldTitle', { title }) : x('money.boughtTitle', { title })}<small>${done ? (sale ? x('money.paidToYou') : x('money.paid')) : stale ? x('money.expired') : x('money.open')}${sale && item.buyerOwner ? ` · ${x('share.buyer', { name: item.buyerOwner })}` : ''}</small></div>
      <div class="wal-w">${dateWord(when)} ${timeWord(when)}</div>
      <div class=${`wal-amt ${done ? (sale ? 'is-in' : '') : 'is-dim'}`}>${sale && done ? '+' : ''}${money(amount, item.currency)}</div>
      <div class="wal-go">${!done ? html`<span class="og-chip og-chip--dim">${stale ? x('money.expired') : x('money.open')}</span>` : null}</div>
    </div>`;
}
