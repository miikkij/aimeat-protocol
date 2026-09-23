/**
 * @file public/views/profile/wallet/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the wallet page: one ledger row in words (what happened, when, how
 *   many morsels) and what opens under it (who made the call, the counterparty, the tracking code,
 *   the id, a copy door); one payout rail (card, stablecoin, invoice) and what opens under it (the
 *   field for the key or the address, the steps for getting one, the remove door); one share
 *   entry; one money purchase or sale.
 * @structure txRow · txOpen · railRow · railOpen · shareCells · moneyCells · msgLine
 * @usage import { txRow, railRow, shareCells, moneyCells } from './rows.js';
 * @version-history
 *   2026-09-22 -- The key field tells password managers to leave it alone again (passwordManager={false}).
 *   2026-09-22 -- Composed from the shared component set: a ledger row and a rail are ListRows whose
 *     open body is a record (KeyValues, a Toolbar with the key or address Field, Steps); a share
 *     entry and a money trade are the cells of a Table row, so those lists keep their column heads;
 *     no own classes.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 -- 2026-09-13 -- Compose detail frames from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Stack, ListRow, KeyValue, Toolbar, Steps, Surface, Chip, Text, Action, CopyAction, Field } from '/components/poster-parts.js';
import { x, money, morsels, signed, dateWord, timeWord, shortName, rowWords, rowKind } from './frame.js';

/** A form's message: coral when it refuses, green when it went through. */
export const msgLine = (m) => (m ? html`<${Text} kind="caption" tone=${m.error ? 'coral' : 'success'}>${m.text}<//>` : null);

/** An amount set as a small number, green when it came in, coral when it went out. */
const amount = (text, tone) => html`<${Text} kind="number" size="small" tone=${tone}>${text}<//>`;

/* ── One ledger row ───────────────────────────────────────────────────────────────────────────── */

export function txRow(ctx, tx) {
  const open = ctx.openTx === tx.id;
  const w = rowWords(tx, ctx.self, ctx.agents);
  const kind = rowKind(tx);
  return html`
    <${ListRow} key=${tx.id} name=${w.title} onOpen=${() => ctx.toggleTx(tx.id)}
      detail=${`${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)} · ${w.sub}`}
      value=${html`<${Stack} density="compact" align="end">
        ${amount(signed(tx.amount), kind === 'out' ? 'coral' : kind === 'in' ? 'success' : 'plain')}
        <${Text} kind="caption" tone="muted">${morsels(tx.amount) === x('morselOne', { n: 1 }) ? x('unitOne') : x('unitMany')}<//>
      <//>`}
      actions=${html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleTx(tx.id)}>${open ? x('close') : x('open')}<//>`}>
      ${open ? txOpen(ctx, tx, w) : null}
    <//>`;
}

function txOpen(ctx, tx, w) {
  const copy = [`${w.title}`, `${x('detail.amount')}: ${signed(tx.amount)}`, `${x('detail.when')}: ${tx.timestamp || ''}`, tx.initiator_gaii ? `${x('detail.who')}: ${tx.initiator_gaii}` : '', tx.counterparty_gaii ? `${x('detail.counterparty')}: ${tx.counterparty_gaii}` : '', tx.tracking_code ? `${x('detail.code')}: ${tx.tracking_code}` : '', `${x('detail.id')}: ${tx.id || ''}`].filter(Boolean).join('\n');
  const agent = tx.initiator_gaii ? (ctx.agents || []).find((a) => a.gaii === tx.initiator_gaii) : null;
  const missing = html`<${Text} tone="muted">${x('detail.notRecorded')}<//>`;
  const named = (word, code, note) => html`<${Stack} density="compact">
    <${Text}>${word}<//><${Text} kind="mono" tone="muted">${code}<//>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}
  <//>`;
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text}>${x('detail.lead', { n: morsels(tx.amount), when: `${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}`, what: w.title })} ${tx.initiator_gaii ? x('detail.leadAgent', { name: agent?.name || shortName(tx.initiator_gaii) }) : x('detail.leadYou')}${!tx.tracking_code && !tx.counterparty_gaii ? ' ' + x('detail.leadMissing') : ''}<//>
      <${Stack} density="compact">
        <${KeyValue} label=${x('detail.who')} value=${tx.initiator_gaii ? named(agent?.name || shortName(tx.initiator_gaii), tx.initiator_gaii, x('detail.agentSpends')) : x('detail.youOrSystem')} />
        <${KeyValue} label=${x('detail.kind')} value=${named(x('kind.' + tx.type) !== 'walpage.kind.' + tx.type ? x('kind.' + tx.type) : tx.type, tx.type)} />
        <${KeyValue} label=${x('detail.counterparty')} value=${tx.counterparty_gaii ? named(shortName(tx.counterparty_gaii), tx.counterparty_gaii) : missing} />
        <${KeyValue} label=${x('detail.code')} value=${tx.tracking_code ? html`<${Text} kind="mono">${tx.tracking_code}<//>` : missing} />
        <${KeyValue} label=${x('detail.id')} value=${html`<${Text} kind="mono">${tx.id}<//>`} />
      <//>
      <${Stack} direction="wrap" density="compact">
        <${CopyAction} kind="text" text=${copy} label=${x('copyRow')} />
        ${agent ? html`<${Action} kind="text" onClick=${() => ctx.openAgents()}>${x('showAgent')}<//>` : null}
      <//>
    <//><//>`;
}

/* ── One payout rail ──────────────────────────────────────────────────────────────────────────── */

export function railRow(ctx, rail) {
  const open = ctx.openRail === rail.id;
  const p = ctx.payout || {};
  let state, sub, currencies, doors;
  if (rail.id === 'stripe') {
    const s = p.stripe || {};
    state = s.configured ? html`<${Text}><strong>${x('rail.keyStored')}</strong> · ${x('rail.endsWith', { hint: s.keyHint || '' })}<//>`
      : html`<${Text}><${Text} kind="label" tone="coral">${x('rail.noKey')}<//> · ${x('rail.noKeyBody')}<//>`;
    sub = x('rail.cardSub');
    currencies = (s.currencies || ['EUR', 'USD']).join(' · ');
    doors = html`<${Action} kind="text" disabled=${!ctx.payout} expanded=${open} onClick=${() => ctx.toggleRail('stripe')}>${open ? x('close') : s.configured ? x('rail.changeKey') : x('rail.addKey')}<//>`;
  } else if (rail.id === 'x402') {
    const s = p.x402 || {};
    state = s.configured ? html`<${Stack} density="compact"><${Text}><strong>${x('rail.addressStored')}</strong> · ${shortAddr(s.address)}<//>
        <${Text} kind="caption" tone="muted">${s.testnet ? x('rail.testnet', { network: s.network || '' }) : x('rail.mainnet', { network: s.network || '' })}<//><//>`
      : html`<${Text}><${Text} kind="label" tone="coral">${x('rail.noAddress')}<//> · ${x('rail.noAddressBody')}<//>`;
    sub = x('rail.stableSub');
    currencies = (s.assets || []).map((a) => `${a.currency} → ${a.symbol}`).join(' · ');
    doors = html`<${Action} kind="text" expanded=${open} onClick=${() => ctx.toggleRail('x402')}>${open ? x('close') : s.configured ? x('rail.changeAddress') : x('rail.addAddress')}<//>`;
  } else {
    state = html`<${Text} tone="muted">${x('rail.invoiceBody')}<//>`;
    sub = x('rail.invoiceSub');
    currencies = (p.invoice?.currencies || ['EUR', 'USD']).join(' · ');
    doors = null;
  }
  return html`
    <${ListRow} key=${rail.id} id=${'wal-rail-' + rail.id} name=${x('rail.' + rail.id)} detail=${sub}
      value=${currencies} actions=${doors}>
      ${state}
      ${open ? railOpen(ctx, rail.id) : null}
    <//>`;
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
    <${Surface} kind="record"><${Stack}>
      <${Text}>${stripe ? x('rail.cardLead') : x('rail.stableLead')}<//>
      <${Toolbar} label=${stripe ? x('rail.keyLabel') : x('rail.addressLabel')} actions=${html`
        <${Action} disabled=${ctx.busy === 'rail' || !valid} onClick=${() => (stripe ? ctx.saveStripe() : ctx.saveX402())}>${stripe ? x('rail.saveKey') : x('rail.saveAddress')}<//>
        <${Action} kind="text" onClick=${() => ctx.toggleRail(null)}>${x('cancel')}<//>`}>
        <${Field} type=${stripe ? 'password' : 'text'} autoComplete="off" passwordManager=${false} spellCheck=${false} value=${draft} placeholder=${stripe ? 'sk_live_…' : '0x…'}
          ariaLabel=${stripe ? x('rail.keyLabel') : x('rail.addressLabel')} onInput=${(e) => (stripe ? ctx.setKeyDraft(e.target.value) : ctx.setAddrDraft(e.target.value))} />
      <//>
      ${!stripe && draft.trim() && !valid ? html`<${Text} kind="caption" tone="coral">${x('rail.addressInvalid')}<//>` : null}
      ${msgLine(ctx.railMsg)}
      <${Text} kind="label">${stripe ? x('help.cardTitle') : x('help.stableTitle')}<//>
      <${Steps} items=${steps.map(([text, ...links]) => html`<${Text}>${text}${links.map(([href, label], k) => html`${k ? ' · ' : ' '}<${Action} kind="text" href=${href} target="_blank">${label}<//>`)}<//>`)} />
      ${s.configured ? html`<${Stack} direction="horizontal" align="start">
        <${Action} tone="danger" disabled=${ctx.busy === 'rail'} onClick=${() => (stripe ? ctx.removeStripe() : ctx.removeX402())}>${stripe ? x('rail.removeKey') : x('rail.removeAddress')}<//>
      <//>` : null}
    <//><//>`;
}

/* ── One share entry, one money purchase or sale: the cells of a table row ─────────────────────── */

/** A share's status in words; the bare status when no language has named it. */
const shareWord = (status) => (x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status);

export function shareCells(entry) {
  const code = String(entry.tracking_code || entry.reference || '');
  const m = code.match(/apptool:[^/]+\/([^:]+):([^:]+)/);
  const what = m ? `${m[1]} · ${m[2]}` : (entry.reference || code || x('share.entry'));
  const status = entry.status || 'accrued';
  return [
    html`<${Stack} density="compact"><${Text}><strong>${what}</strong><//>
      <${Text} kind="mono" tone="muted">${entry.released_at ? `${dateWord(entry.released_at)} ${timeWord(entry.released_at)} · ` : ''}${shareWord(status)}<//><//>`,
    html`<${Text} tone="muted">${entry.buyer ? x('share.buyer', { name: shortName(entry.buyer) }) : ''}${entry.note ? ` · ${entry.note}` : ''}<//>`,
    amount(money(entry.amount, entry.currency), status === 'released' || status === 'paid' ? 'success' : 'plain'),
    html`<${Chip} tone=${status === 'accrued' ? 'muted' : 'plain'}>${shareWord(status)}<//>`,
  ];
}

export function moneyCells(item, sale) {
  const title = item.items?.[0]?.title || (sale ? x('money.sale') : x('money.purchase'));
  const done = item.status === 'completed';
  const stale = !done && item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();
  const when = item.createdAt || item.created_at;
  const sum = sale ? (item.receipt?.earned ?? item.total) : item.total;
  return [
    html`<${Stack} density="compact"><${Text}><strong>${sale ? x('money.soldTitle', { title }) : x('money.boughtTitle', { title })}</strong><//>
      <${Text} kind="mono" tone="muted">${done ? (sale ? x('money.paidToYou') : x('money.paid')) : stale ? x('money.expired') : x('money.open')}${sale && item.buyerOwner ? ` · ${x('share.buyer', { name: item.buyerOwner })}` : ''}<//><//>`,
    html`<${Text} tone="muted">${dateWord(when)} ${timeWord(when)}<//>`,
    amount(`${sale && done ? '+' : ''}${money(sum, item.currency)}`, done ? (sale ? 'success' : 'plain') : 'muted'),
    !done ? html`<${Chip} tone="muted">${stale ? x('money.expired') : x('money.open')}<//>` : '',
  ];
}
