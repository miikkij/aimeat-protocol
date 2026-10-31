/**
 * @file public/views/profile/packages/sale.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package its author sells to accounts of this node, on the Packages page (Jouni,
 *   2026-10-31, "optio B"). On an offer's opened row: the price, and Buy, or that this account bought
 *   it already. On one of the owner's own packages: the price the author sets, the sale's state, and
 *   the sales with a refund for each. Facts rows and a dense List; writes no class. The work is the
 *   node's (PUT /v1/packages/:group/price, GET .../sales, POST .../sales/:order/refund, the checkout).
 * @structure offerSaleRow(ctx, o) · ownSaleWord(ctx, p) · ownSaleRows(ctx, p)
 * @usage <${Facts} rows=${[offerSaleRow(ctx, o), …]} />
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import { h } from 'preact';
import htm from 'htm';
import { Action, Actions } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { money as fmtMoney } from '/js/format.js';
import { x, priceWord, dateWord } from './frame.js';

const html = htm.bind(h);

/** The price row of a package on sale, for a buyer. Null for a package that is not sold. */
export function offerSaleRow(ctx, o) {
  if (!o.sale) return null;
  const mine = o.author === ctx.ownerName;
  const busy = ctx.busy === 'buy:' + o.group;
  const sub = mine ? x('sale.yoursSub') : o.owned ? x('sale.ownedSub') : o.sale.buyable ? x('sale.buySub', { author: o.author }) : x('sale.pausedSub');
  const actions = !mine && !o.owned && o.sale.buyable ? html`
    <${Actions}>
      <${Action} small disabled=${!!ctx.busy} onClick=${() => ctx.buy(o, 'card')}>${busy ? x('sale.buying') : x('sale.buy', { price: priceWord(o.sale) })}<//>
      ${ctx.testMoney ? html`<${Action} small soft disabled=${!!ctx.busy} onClick=${() => ctx.buy(o, 'test')}>${x('sale.buyTest')}<//>` : null}
    <//>` : null;
  return { k: x('sale.priceK'), v: o.owned ? x('sale.owned', { price: priceWord(o.sale) }) : priceWord(o.sale), sub, actions };
}

/** An own package's sale in a few words for its closed row ("€12.00 · on sale"), or '' when it is not on sale. */
export function ownSaleWord(ctx, p) {
  const sale = ctx.selling?.[p.packageGroupId];
  return sale && sale.state !== 'ended' ? `${priceWord(sale)} · ${x('sale.stateWord.' + sale.state)}` : '';
}

/** One sale, with its refund. */
function saleRow(ctx, p, s) {
  const refundable = s.state === 'paid';
  return html`
    <${Row} key=${s.order}>
      <${Name} meta=${dateWord(s.bought_at)}>${s.buyer}<//>
      <${Desc}>${fmtMoney(s.amount / 1e6, s.currency)} · ${x('sale.state.' + s.state)}<//>
      <${Doors}>${refundable ? html`<${Action} small row soft tone="danger" disabled=${!!ctx.busy} onClick=${() => ctx.refund(p, s)}>${x('sale.refund')}<//>` : null}<//>
    <//>`;
}

/** The author's rows for one of their own packages: the price they set, and the sales. */
export function ownSaleRows(ctx, p) {
  const group = p.packageGroupId;
  const sale = ctx.selling?.[group] || null;
  const form = ctx.priceForm?.[group] || { amount: sale?.price ? String(sale.price.amount / 1e6) : '', currency: sale?.price?.currency || 'EUR' };
  const busy = !!ctx.busy;
  const set = (patch) => ctx.setPriceForm(group, { ...form, ...patch });
  const live = sale && sale.state !== 'ended';
  // The currency first, then the amount with its button: one price, read left to right.
  const priceField = html`
    <${Tabs} label=${x('sale.currencyK')} value=${form.currency} onSelect=${(v) => set({ currency: v })}
      items=${[{ value: 'EUR', label: 'EUR', disabled: busy }, { value: 'USD', label: 'USD', disabled: busy }]} />
    <${TextField} box value=${form.amount} inputMode="decimal" placeholder=${x('sale.amountPlaceholder')} ariaLabel=${x('sale.amountK')}
      onInput=${(v) => set({ amount: v })}
      actions=${html`<${Action} small disabled=${busy || !String(form.amount).trim()} onClick=${() => ctx.setPrice(p, form)}>${live ? x('sale.savePrice') : x('sale.startSale')}<//>`} />`;
  const stateDoors = live ? html`
    <${Actions}>
      ${sale.state === 'on_sale'
        ? html`<${Action} small soft disabled=${busy} onClick=${() => ctx.setSaleState(p, 'paused')}>${x('sale.pause')}<//>`
        : html`<${Action} small soft disabled=${busy} onClick=${() => ctx.setSaleState(p, 'on_sale')}>${x('sale.resume')}<//>`}
      <${Action} small soft tone="danger" disabled=${busy} onClick=${() => ctx.setSaleState(p, 'ended')}>${x('sale.end')}<//>
    <//>` : null;
  const sales = ctx.sales?.[group];
  return [
    {
      k: x('sale.ownK'),
      v: live ? `${priceWord(sale)} · ${x('sale.stateWord.' + sale.state)}` : x('sale.notOnSale'),
      sub: p.visibility !== 'private' ? x('sale.needsPrivate') : live ? x('sale.ownSub') : x('sale.ownSubOff'),
      actions: html`${priceField}${stateDoors}`,
    },
    sale && {
      k: x('sale.salesK'),
      v: sales === undefined ? x('sale.salesLoading') : sales.sales.length
        ? x('sale.salesLine', { n: sales.sales.filter((s) => s.state === 'paid').length, totals: Object.entries(sales.totals || {}).map(([c, a]) => fmtMoney(a / 1e6, c)).join(', ') || '0' })
        : x('sale.noSales'),
      sub: sales?.sales?.length ? html`
        <${List} cols="name-desc-doors" dense apart>
          ${sales.sales.map((s) => saleRow(ctx, p, s))}
        <//>` : x('sale.salesSub'),
    },
  ];
}
