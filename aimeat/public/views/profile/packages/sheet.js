/**
 * @file public/views/profile/packages/sheet.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package's "what you get" sheet on its opened row, and the settings its install asks
 *   (guided journey P3). The sheet is the server's (GET /v1/packages/:group `sheet`,
 *   services/package-sheet.ts), so the page and the person's AI read the same thing: what it gives,
 *   what to ask their AI, what data its apps keep and where it goes, which agents come with it, what
 *   runs on its own and which guides their AI gets. Composed from Note and Facts; writes no class.
 * @structure sheetBlock(ctx, o) · asksBlock(ctx, o, key)
 * @usage ${sheetBlock(ctx, o)} … ${asksBlock(ctx, o, key)}
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { x } from './frame.js';

const html = htm.bind(h);
const lines = (items) => html`${items.map((s, i) => html`<div key=${i}>${s}</div>`)}`;

/** What the package gives, in the facts a person decides on. Null until the sheet has been read. */
export function sheetBlock(ctx, o) {
  const s = ctx.sheets?.[o.group];
  if (s === undefined || s === false) return null;
  if (s === null) return html`<${Note} kind="meta">${x('sheetLoading')}<//>`;
  const data = [
    ...(s.data ?? []).map((d) => `${d.app}: ${d.what || x('sheetDataNoWhat')}${d.leaves?.length ? ' ' + x('sheetDataLeaves', { list: d.leaves.map((l) => l.to).join('; ') }) : ''}`),
    ...(s.dataUnmapped ?? []).map((app) => x('sheetDataUnmapped', { app })),
  ];
  const rows = [
    s.prompts?.length && { k: x('sheetAskK'), v: lines(s.prompts), sub: x('sheetAskSub') },
    data.length && { k: x('sheetDataK'), v: lines(data) },
    s.agents?.length && { k: x('sheetAgentsK'), v: lines(s.agents.map((a) => `${a.name} (${a.app})${a.purpose ? ': ' + a.purpose : ''}`)), sub: x('sheetAgentsSub') },
    s.runsOnItsOwn?.length && { k: x('sheetRunsK'), v: lines(s.runsOnItsOwn.map((r) => `${r.component}: ${r.what}${r.when ? ` (${r.when})` : ''}`)), sub: x('sheetRunsSub') },
    s.guides?.length && { k: x('sheetGuidesK'), v: s.guides.join(', '), sub: x('sheetGuidesSub') },
  ].filter(Boolean);
  return html`
    ${s.outcome ? html`<${Note} kind="lead">${s.outcome}<//>` : null}
    ${rows.length ? html`<${Facts} rows=${rows} />` : null}`;
}

/** The settings the install asks, as fields; what is typed goes with the install as `config`. */
export function asksBlock(ctx, o, key) {
  const s = ctx.sheets?.[o.group];
  const asks = s && s.asks ? s.asks : [];
  if (!asks.length) return null;
  const values = ctx.installConfig?.[key] || {};
  // The part's name goes in front only when more than one part asks, so one app's fields read plainly.
  const many = new Set(asks.map((a) => a.componentId)).size > 1;
  return { k: x('sheetAsksK'), sub: x('sheetAsksSub'), v: html`${asks.map((a) => html`
    <${TextField} key=${a.componentId + '.' + a.field} secret=${a.secret}
      label=${`${many ? a.component + ': ' : ''}${a.title || a.field}${a.required ? ' *' : ''}`}
      hint=${a.description || (a.default ? x('sheetAsksDefault', { value: a.default }) : '')}
      value=${(values[a.componentId] || {})[a.field] ?? ''}
      placeholder=${a.default || ''}
      onInput=${(v) => ctx.setConfigValue(key, a.componentId, a.field, v)} />`)}` };
}

/** The required settings still empty, by their title: the install is not sent until they are filled. */
export function missingAsks(ctx, o, key) {
  const asks = ctx.sheets?.[o.group]?.asks ?? [];
  const values = ctx.installConfig?.[key] || {};
  return asks.filter((a) => a.required && !String((values[a.componentId] || {})[a.field] ?? '').trim())
    .map((a) => a.title || a.field);
}
