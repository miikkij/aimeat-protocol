/**
 * @file public/components/Facts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Named values, read only, as one component (C4 "Facts" of the component plan): the name
 *   on the left as the row label, its value on the right, a grey line under the value when it needs
 *   one; one column on a phone. A page passes the rows as data and named options; it never writes a
 *   class. The look is css/components/facts.css (the look most Settings & Controls tabs had on main:
 *   the skills, extensions, capabilities, libraries, packages and portfolio copies, identical).
 *
 *   Facts({ rows, wide, flush }): `wide` is the wide cut (a longer name column, more air above: an
 *   opened panel's facts, an AI's rules); `flush` puts the facts at the very top of their box.
 *   A row is { k, v, sub, key, mono, warn, missing, pre, controls, action, actions, state, subTone };
 *   a falsy row is left out, so a page can write `cond && { … }`.
 *   - k: the name. `state` = 'fine' | 'attention' | 'danger' | 'off' draws the name as a Status in that
 *     tone (a status code that is itself the name).
 *   - v: the value: words, a number, or a vnode made of kit components (Mark, Marks, Code, Action,
 *     Note, Tinted, FactLine, Meter, Switch…). `mono`: the value is an identifier, drawn as code.
 *   - sub: the grey line under the value; `subTone` = 'notice' draws it in coral. A sub of '' still
 *     draws the (empty) line, as the pages did; leave it undefined for none.
 *   - warn: the value needs a look (the attention colour). missing: the value is not known or not set
 *     (grey). pre: the value keeps its own line breaks. controls: the value is controls in a row (a
 *     picker and its action).
 *   - action: one action after the value on the same line. actions: a row of actions under the value.
 *   FactLine({ sub, subTone, children }): one line of a value made of several lines, each with its own
 *   grey line under it.
 * @structure Facts({ rows, wide, flush }) · FactLine({ sub, subTone, children })
 * @usage html`<${Facts} rows=${[{ k: t('x.id'), v: id, mono: true }, { k: t('x.calls'), v: n, sub: t('x.callsSub') }]} />`
 *        html`<${Facts} wide rows=${[{ k: t('x.list'), v: items.map((i) => html`<${FactLine} key=${i.id} sub=${i.when}>${i.name}<//>`) }]} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the name and value rows ~40 Settings pages wrote by hand
 *     (<div class="facts"><div class="facts-k poster-label">…) as one component, with the meanings the
 *     pages' own rules carried kept as named options (component plan C4).
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';
import { Actions } from '/components/Action.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const STATES = new Set(['fine', 'attention', 'danger', 'off']);
const has = (x) => x !== undefined && x !== null && x !== false;

/** The grey line under a value or a line; `tone` 'notice' draws it in coral. */
function Sub({ tone, children }) {
  return html`<small class=${tone === 'notice' ? 'facts-sub--notice' : undefined}>${children}</small>`;
}

/** One line of a value made of several lines. */
export function FactLine({ sub, subTone, children }) {
  return html`<div>${children}${has(sub) ? html`<${Sub} tone=${subTone}>${sub}<//>` : null}</div>`;
}

function Name({ k, state }) {
  if (STATES.has(state)) return html`<dt class="facts-k"><${Mark} kind="status" tone=${state}>${k}<//></dt>`;
  return html`<dt class="facts-k poster-label">${k}</dt>`;
}

function Value({ row }) {
  const cls = cx('facts-v', row.warn && 'facts-v--warn', row.missing && 'facts-v--missing',
    row.pre && 'facts-v--pre', row.controls && 'facts-v--controls');
  const v = row.mono && has(row.v) && row.v !== '' ? html`<code class="code-inline">${row.v}</code>` : row.v;
  return html`<dd class=${cls}>${v}${row.action ? html` <span class="facts-after">${row.action}</span>` : null}${has(row.sub) ? html`<${Sub} tone=${row.subTone}>${row.sub}<//>` : null}${row.actions ? html`<${Actions}>${row.actions}<//>` : null}</dd>`;
}

export function Facts({ rows = [], wide, flush }) {
  const list = (rows || []).filter(Boolean);
  return html`<dl class=${cx('facts', wide && 'facts--wide', flush && 'facts--flush')}>${list.map((row, i) => html`<${Fragment} key=${row.key ?? (typeof row.k === 'string' ? row.k : i)}>
    <${Name} k=${row.k} state=${row.state} />
    <${Value} row=${row} />
  <//>`)}</dl>`;
}

export default Facts;
