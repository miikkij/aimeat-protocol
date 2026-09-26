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
 *   v1.18.0 — 2026-09-26 — On the component kit (page group G7): the rows are the List (Row, Name,
 *     When, Desc, Num with the Figure in its state tone, Doors, Panel); an opened ledger row's facts
 *     are Facts (a value not recorded in its missing grey); a rail's state is the Status Mark with the
 *     network under it; the key or address field is TextField in its dashed box (the key typed hidden
 *     with no eye, as main: `unmanaged`; the address kept out of password managers: `noManager`); the
 *     steps to get one are IndexList with their links as coral links (Action tone="link"); the doors
 *     are Action. The page writes no class.
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
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Row, Name, Desc, Num, When, Doors, Panel } from '/components/List.js';
import { Facts } from '/components/Facts.js';
import { Figure } from '/components/Figure.js';
import { Action } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { x, money, morsels, signed, dateWord, timeWord, shortName, rowWords, rowKind } from './frame.js';

const shareWord = (status) => (x('share.' + status) !== 'walpage.share.' + status ? x('share.' + status) : status);

/* ── One ledger row ───────────────────────────────────────────────────────────────────────────── */

export function txRow(ctx, tx) {
  const open = ctx.openTx === tx.id;
  const w = rowWords(tx, ctx.self, ctx.agents);
  const kind = rowKind(tx);
  const toggle = () => ctx.toggleTx(tx.id);
  return html`
    <${Row} key=${tx.id} open=${open}>
      <${Name} onOpen=${toggle} meta=${w.sub}>${w.title}<//>
      <${When}>${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}<//>
      <${Num}><${Figure} small end tone=${kind === 'out' ? 'notice' : kind === 'in' ? 'fine' : undefined} n=${signed(tx.amount)}
        sub=${morsels(tx.amount) === x('morselOne', { n: 1 }) ? x('unitOne') : x('unitMany')} /><//>
      <${Doors}><${Action} small row onClick=${toggle}>${open ? x('close') : x('open')}<//><//>
      ${open ? txOpen(ctx, tx, w) : null}
    <//>`;
}

function txOpen(ctx, tx, w) {
  const copy = [`${w.title}`, `${x('detail.amount')}: ${signed(tx.amount)}`, `${x('detail.when')}: ${tx.timestamp || ''}`, tx.initiator_gaii ? `${x('detail.who')}: ${tx.initiator_gaii}` : '', tx.counterparty_gaii ? `${x('detail.counterparty')}: ${tx.counterparty_gaii}` : '', tx.tracking_code ? `${x('detail.code')}: ${tx.tracking_code}` : '', `${x('detail.id')}: ${tx.id || ''}`].filter(Boolean).join('\n');
  const agent = tx.initiator_gaii ? (ctx.agents || []).find((a) => a.gaii === tx.initiator_gaii) : null;
  const missing = x('detail.notRecorded');
  const doors = html`
    <${Action} small soft copy=${copy}>${x('copyRow')}<//>
    ${agent ? html`<${Action} small soft onClick=${() => ctx.openAgents()}>${x('showAgent')}<//>` : null}`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${x('detail.lead', { n: morsels(tx.amount), when: `${dateWord(tx.timestamp)} ${timeWord(tx.timestamp)}`, what: w.title })} ${tx.initiator_gaii ? x('detail.leadAgent', { name: agent?.name || shortName(tx.initiator_gaii) }) : x('detail.leadYou')}${!tx.tracking_code && !tx.counterparty_gaii ? ' ' + x('detail.leadMissing') : ''}<//>
      <${Facts} rows=${[
        tx.initiator_gaii
          ? { k: x('detail.who'), v: html`${agent?.name || shortName(tx.initiator_gaii)} <${Code}>${tx.initiator_gaii}<//>`, sub: x('detail.agentSpends') }
          : { k: x('detail.who'), v: x('detail.youOrSystem') },
        { k: x('detail.kind'), v: html`${x('kind.' + tx.type) !== 'walpage.kind.' + tx.type ? x('kind.' + tx.type) : tx.type} <${Code}>${tx.type}<//>` },
        tx.counterparty_gaii
          ? { k: x('detail.counterparty'), v: html`${shortName(tx.counterparty_gaii)} <${Code}>${tx.counterparty_gaii}<//>` }
          : { k: x('detail.counterparty'), v: missing, missing: true },
        tx.tracking_code ? { k: x('detail.code'), v: tx.tracking_code, mono: true } : { k: x('detail.code'), v: missing, missing: true },
        { k: x('detail.id'), v: tx.id, mono: true },
      ]} />
    <//>`;
}

/* ── One payout rail ──────────────────────────────────────────────────────────────────────────── */

export function railRow(ctx, rail) {
  const open = ctx.openRail === rail.id;
  const p = ctx.payout || {};
  let state, stateSub, sub, currencies, doors;
  if (rail.id === 'stripe') {
    const s = p.stripe || {};
    state = s.configured ? html`<${Mark} kind="status" tone="fine">${x('rail.keyStored')}<//> · ${x('rail.endsWith', { hint: s.keyHint || '' })}` : html`<${Mark} kind="status" tone="attention">${x('rail.noKey')}<//> · ${x('rail.noKeyBody')}`;
    sub = x('rail.cardSub');
    currencies = (s.currencies || ['EUR', 'USD']).join(' · ');
    doors = html`<${Action} small disabled=${!ctx.payout} onClick=${() => ctx.toggleRail('stripe')}>${open ? x('close') : s.configured ? x('rail.changeKey') : x('rail.addKey')}<//>`;
  } else if (rail.id === 'x402') {
    const s = p.x402 || {};
    const addr = shortAddr(s.address);
    state = s.configured ? html`<${Mark} kind="status" tone="fine">${x('rail.addressStored')}<//> · ${addr}` : html`<${Mark} kind="status" tone="attention">${x('rail.noAddress')}<//> · ${x('rail.noAddressBody')}`;
    stateSub = s.configured ? (s.testnet ? x('rail.testnet', { network: s.network || '' }) : x('rail.mainnet', { network: s.network || '' })) : undefined;
    sub = x('rail.stableSub');
    currencies = (s.assets || []).map((a) => `${a.currency} → ${a.symbol}`).join(' · ');
    doors = html`<${Action} small onClick=${() => ctx.toggleRail('x402')}>${open ? x('close') : s.configured ? x('rail.changeAddress') : x('rail.addAddress')}<//>`;
  } else {
    state = x('rail.invoiceBody');
    sub = x('rail.invoiceSub');
    currencies = (p.invoice?.currencies || ['EUR', 'USD']).join(' · ');
    doors = null;
  }
  return html`
    <${Row} key=${rail.id} open=${open} id=${'wal-rail-' + rail.id}>
      <${Name} meta=${sub}>${x('rail.' + rail.id)}<//>
      <${Desc} sub=${stateSub}>${state}<//>
      <${Desc}>${currencies}<//>
      <${Doors}>${doors}<//>
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
  const save = () => (stripe ? ctx.saveStripe() : ctx.saveX402());
  const remove = () => (stripe ? ctx.removeStripe() : ctx.removeX402());
  const actions = html`
    <${Action} small disabled=${ctx.busy === 'rail' || !valid} onClick=${save}>${stripe ? x('rail.saveKey') : x('rail.saveAddress')}<//>
    <${Action} small soft onClick=${() => ctx.toggleRail(null)}>${x('cancel')}<//>`;
  return html`
    <${Panel} doors=${s.configured ? html`<${Action} small soft tone="danger" disabled=${ctx.busy === 'rail'} onClick=${remove}>${stripe ? x('rail.removeKey') : x('rail.removeAddress')}<//>` : null}>
      <${Note} kind="lead">${stripe ? x('rail.cardLead') : x('rail.stableLead')}<//>
      <${TextField} box unmanaged=${stripe} noManager=${!stripe} spellCheck=${false} value=${draft} placeholder=${stripe ? 'sk_live_…' : '0x…'}
        ariaLabel=${stripe ? x('rail.keyLabel') : x('rail.addressLabel')} onInput=${(v) => (stripe ? ctx.setKeyDraft(v) : ctx.setAddrDraft(v))} actions=${actions} />
      ${!stripe && draft.trim() && !valid ? html`<${Note} kind="message" error>${x('rail.addressInvalid')}<//>` : null}
      ${ctx.railMsg ? html`<${Note} kind="message" error=${!!ctx.railMsg.error}>${ctx.railMsg.text}<//>` : null}
      <${Label} block>${stripe ? x('help.cardTitle') : x('help.stableTitle')}<//>
      <${IndexList} steps>${steps.map(([text, ...links], i) => html`<${IndexStep} key=${i}>${text}${links.map(([href, label], k) => html`${k ? ' · ' : ' '}<${Action} tone="link" href=${href} newTab noReferrer>${label}<//>`)}<//>`)}<//>
    <//>`;
}

/* ── One share entry, one money purchase or sale ──────────────────────────────────────────────── */

export function shareRow(entry, i) {
  const code = String(entry.tracking_code || entry.reference || '');
  const m = code.match(/apptool:[^/]+\/([^:]+):([^:]+)/);
  const what = m ? `${m[1]} · ${m[2]}` : (entry.reference || code || x('share.entry'));
  const status = entry.status || 'accrued';
  return html`
    <${Row} key=${entry.tracking_code || i}>
      <${Name} meta=${`${entry.released_at ? `${dateWord(entry.released_at)} ${timeWord(entry.released_at)} · ` : ''}${shareWord(status)}`}>${what}<//>
      <${Desc}>${entry.buyer ? x('share.buyer', { name: shortName(entry.buyer) }) : ''}${entry.note ? ` · ${entry.note}` : ''}<//>
      <${Num}><${Figure} small end tone=${status === 'released' || status === 'paid' ? 'fine' : undefined} n=${money(entry.amount, entry.currency)} /><//>
      <${Doors}><${Mark} kind="status" tone=${status === 'accrued' ? 'off' : 'fine'}>${shareWord(status)}<//><//>
    <//>`;
}

export function moneyRow(item, sale) {
  const title = item.items?.[0]?.title || (sale ? x('money.sale') : x('money.purchase'));
  const done = item.status === 'completed';
  const stale = !done && item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();
  const when = item.createdAt || item.created_at;
  const amount = sale ? (item.receipt?.earned ?? item.total) : item.total;
  return html`
    <${Row} key=${item.id}>
      <${Name} meta=${`${done ? (sale ? x('money.paidToYou') : x('money.paid')) : stale ? x('money.expired') : x('money.open')}${sale && item.buyerOwner ? ` · ${x('share.buyer', { name: item.buyerOwner })}` : ''}`}>${sale ? x('money.soldTitle', { title }) : x('money.boughtTitle', { title })}<//>
      <${When}>${dateWord(when)} ${timeWord(when)}<//>
      <${Num}><${Figure} small end tone=${done ? (sale ? 'fine' : undefined) : 'dim'} n=${`${sale && done ? '+' : ''}${money(amount, item.currency)}`} /><//>
      <${Doors}>${!done ? html`<${Mark} kind="status" tone="off">${stale ? x('money.expired') : x('money.open')}<//>` : null}<//>
    <//>`;
}
