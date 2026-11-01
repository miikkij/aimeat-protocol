/**
 * @file public/views/profile/offers/data-list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data products on the Offers page (design canvas "Data ulos", board Tarjoama): the
 *   cover's section 06 with the first products and the way to make one, and the page of all of them
 *   with its two filters, "Data products · n" and "Out of date · n". Each row says the product, where
 *   it comes from (the source's action or key) and its rows, its freshness, who may use it with its
 *   named shares, its reads this week, and the door that opens it. Made of the component kit: the
 *   page passes data and never a class.
 * @structure secData · dataPage · dataRows
 * @usage import { secData, dataPage } from './data-list.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D9.7, D6.1, D3).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { num } from '/js/format.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Num, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tabs } from '/components/Tabs.js';
import { renderPage } from './frame.js';
import { d, stateOf, freshWord, freshTone, needsLook, audienceWord, productTitle } from './data-model.js';

const COVER_ROWS = 6;
const openProduct = (ctx, p) => ctx.pickView({ kind: 'product', name: p.name });
const newProduct = (ctx) => ctx.pickView({ kind: 'wizard' });

/** The source line under a product's name: "kaiku-signals › search · 180 rows · 2 versions". */
function sourceLine(p) {
  const src = (p.sources || []).map((s) => s.label || s.kind).join(' + ');
  const rows = p.last_run?.rows;
  return [src, typeof rows === 'number' ? d('list.rows', { n: num(rows) }) : null].filter(Boolean).join(' · ');
}

/** The rows of a list of products. */
export function dataRows(ctx, list) {
  return html`<${List} cols="name-state-who-n-doors" labels
    head=${[d('list.colName'), d('list.colFresh'), d('list.colWho'), { label: d('list.colReads'), num: true }, '']}
    rows=${list} render=${(p) => {
      const state = stateOf(p);
      const vis = p.package?.visibility || p.visibility;
      return html`<${Row} key=${p.name} faded=${!!p.package?.withdrawn}>
        <${Name} clip=${2} onOpen=${() => openProduct(ctx, p)} meta=${sourceLine(p)}
          warn=${p.last_run && p.last_run.ok === false}>${productTitle(p)}<//>
        <${Desc}><${Mark} kind="status" tone=${p.package?.withdrawn ? 'off' : freshTone(state)}>${p.package?.withdrawn ? d('list.withdrawn') : freshWord(state)}<//><//>
        <${Desc}><${Marks}>${audienceWord(vis, ctx.data.orgNames)}${p.shares ? html`<${Mark} tone="sun">${d('list.sharesN', { n: p.shares })}<//>` : null}<//><//>
        <${Num}>${d('list.readsWeek', { n: num(p.reads_7d || 0) })}<//>
        <${Doors}><${Action} small row onClick=${() => openProduct(ctx, p)}>${d('list.open')}<//><//>
      <//>`;
    }} />`;
}

/** The cover's section 06: the first products and the ways on. */
export function secData(ctx) {
  const products = ctx.data.products || [];
  const old = products.filter(needsLook).length;
  const doors = html`
    <${Action} small onClick=${() => newProduct(ctx)}>${d('list.new')}<//>
    ${products.length ? html`<${Action} tone="more" onClick=${() => ctx.pickView({ kind: 'page', id: 'data' })}>${d('list.allN', { n: products.length })}<//>` : null}
    ${old ? html`<${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'data', filter: 'old' })}>${d('list.oldN', { n: old })}<//>` : null}`;
  return html`<${Section} id="op-data" num="06" title=${d('list.title')} count=${d('list.sub', { n: products.length })} doors=${doors}>
    ${ctx.data.products === null ? html`<${Note} kind="loading" />`
      : products.length ? dataRows(ctx, products.slice(0, COVER_ROWS))
        : html`<${Note} kind="quiet">${d('list.empty')}<//>`}
    <${Note}>${d('list.hint')}<//>
  <//>`;
}

/** The page of every data product, with its two filters. */
export function dataPage(ctx) {
  const products = ctx.data.products || [];
  const filter = ctx.view.filter === 'old' ? 'old' : 'all';
  const old = products.filter(needsLook);
  const list = filter === 'old' ? old : products;
  return renderPage(ctx, {
    id: 'data', crumbs: [d('list.title')], title: d('list.title'),
    marks: [{ label: d('list.chipProducts', { n: products.length }) }, old.length ? { label: d('list.chipOld', { n: old.length }), tone: 'coral' } : null].filter(Boolean),
    desc: d('list.desc'),
    actions: html`<${Loud} onClick=${() => newProduct(ctx)}>${d('list.new')}<//>`,
    children: html`
      <${Tabs} tone="filter" label=${d('list.filterLabel')} value=${filter}
        onSelect=${(v) => ctx.pickView({ kind: 'page', id: 'data', filter: v })}
        items=${[{ value: 'all', label: d('list.filterAll'), count: products.length }, { value: 'old', label: d('list.filterOld'), count: old.length, attention: old.length > 0 }]} />
      ${ctx.data.products === null ? html`<${Note} kind="loading" />`
        : list.length ? dataRows(ctx, list)
          : html`<${Note} kind="quiet">${filter === 'old' ? d('list.noneOld') : d('list.empty')}<//>`}
      <${Note}>${d('list.askAi')}<//>`,
  });
}
