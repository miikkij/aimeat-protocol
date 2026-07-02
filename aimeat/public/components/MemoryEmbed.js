/**
 * @file MemoryEmbed.js
 * @description Live memory embed for markdown documents: an ```aimeat-memory fenced block names a
 *   memory key and this component fetches it AT RENDER TIME and shows the value as a table /
 *   property list / list / value — so a document that references agent-produced data is fresh every
 *   time it is opened, with no sync machinery. Access control is entirely the server's: the memory
 *   read applies workspace rules + the entry's visibility, and a 401/403/404 renders as a friendly
 *   placeholder (the embed never widens access). All values render via text nodes — no HTML surface.
 * @structure
 *   - parseEmbedSpec(text) — parse the fence body (key/owner/view/fields/title lines)
 *   - MemoryEmbed({ spec }) — fetch + render (auto view: array-of-objects→table, object→props,
 *     array→list, scalar→value; explicit view: table|props|list|value|json), header shows the key,
 *     updated-at and a refresh button.
 * @usage import { MemoryEmbed } from '/components/MemoryEmbed.js';  html`<${MemoryEmbed} spec=${body} />`
 *   Fence example:
 *     ```aimeat-memory
 *     key: organism.{id}.w.{ws}.shared.metrics.weekly.latest
 *     view: table
 *     fields: week, sales, delta
 *     ```
 *   Optional `owner: <gaii>` reads another identity's PUBLIC key via /v1/memory/:gaii/:key.
 * @version-history
 *   v1.0.0 — 2026-07-02 — Initial: live data embeds for organism/workspace documents.
 */
import { h } from 'preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { apiGet } from '/js/api.js';
import { tOr } from '/js/i18n.js';
const html = htm.bind(h);

const MAX_ROWS = 200;
const MAX_COLS = 10;
const MAX_CELL = 160;

/** Parse the fence body: `key: value` (or `key=value`) lines; fields is a comma list. */
export function parseEmbedSpec(text) {
  const spec = {};
  String(text || '').split('\n').forEach((line) => {
    const m = line.match(/^\s*([a-zA-Z_-]+)\s*[:=]\s*(.+?)\s*$/);
    if (!m) return;
    const k = m[1].toLowerCase();
    if (k === 'fields') spec.fields = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    else spec[k] = m[2];
  });
  return spec;
}

function cellText(v) {
  if (v == null) return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) + '…' : s;
}
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function pickView(spec, value) {
  const v = (spec.view || 'auto').toLowerCase();
  if (v !== 'auto') return v;
  if (Array.isArray(value)) return value.length && value.every(isPlainObject) ? 'table' : 'list';
  if (isPlainObject(value)) return 'props';
  return 'value';
}

function renderTable(value, fields) {
  const rows = Array.isArray(value) ? value.filter(isPlainObject) : [];
  let cols = fields && fields.length ? fields : [];
  if (!cols.length) {
    const seen = [];
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (!seen.includes(k)) seen.push(k); }));
    cols = seen.slice(0, MAX_COLS);
  }
  const shown = rows.slice(0, MAX_ROWS);
  return html`
    <table>
      <thead><tr>${cols.map((c) => html`<th key=${c}>${c}</th>`)}</tr></thead>
      <tbody>
        ${shown.map((r, i) => html`<tr key=${i}>${cols.map((c) => html`<td key=${c}>${cellText(r[c])}</td>`)}</tr>`)}
      </tbody>
    </table>
    ${rows.length > MAX_ROWS ? html`<div class="md-mem-more">… ${rows.length - MAX_ROWS} ${tOr('markdown.embed.moreRows', 'more rows')}</div>` : null}
  `;
}
function renderProps(value) {
  const obj = isPlainObject(value) ? value : {};
  return html`
    <table>
      <tbody>
        ${Object.keys(obj).map((k) => html`<tr key=${k}><th>${k}</th><td>${cellText(obj[k])}</td></tr>`)}
      </tbody>
    </table>
  `;
}
function renderList(value) {
  const arr = Array.isArray(value) ? value : [value];
  return html`<ul>${arr.slice(0, MAX_ROWS).map((v, i) => html`<li key=${i}>${cellText(v)}</li>`)}</ul>`;
}
function renderJson(value) {
  return html`<pre class="md-pre"><code class="md-code">${JSON.stringify(value, null, 2)}</code></pre>`;
}

/** MemoryEmbed — fetch a memory key at render time and show it as live data. */
export function MemoryEmbed({ spec: rawSpec }) {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    const spec = parseEmbedSpec(rawSpec);
    if (!spec.key) { setState({ status: 'error', msg: tOr('markdown.embed.missingKey', 'The block declares no key') }); return; }
    setState({ status: 'loading' });
    try {
      const path = spec.owner
        ? '/v1/memory/' + encodeURIComponent(spec.owner) + '/' + encodeURIComponent(spec.key)
        : '/v1/memory/' + encodeURIComponent(spec.key);
      const resp = await apiGet(path);
      setState({ status: 'ok', value: resp?.data?.value, updatedAt: resp?.data?.updated_at || null });
    } catch (e) {
      const code = e.code || '';
      let msg;
      if (code === 'NOT_FOUND' || e.status === 404) msg = tOr('markdown.embed.notFound', 'Key not found');
      else if (e.status === 401 || code === 'AUTH_REQUIRED') msg = tOr('markdown.embed.signIn', 'Sign in to view this data');
      else if (e.status === 403 || /SCOPE|FORBIDDEN|CONSENT|ACCESS|DENIED/.test(code)) msg = tOr('markdown.embed.noAccess', 'No permission to read this key');
      else msg = tOr('markdown.embed.error', 'Could not load') + ' (' + (e.message || code || '?') + ')';
      setState({ status: 'error', msg });
    }
  }, [rawSpec]);
  useEffect(() => { load(); }, [load]);

  const spec = parseEmbedSpec(rawSpec);
  let body;
  if (state.status === 'loading') body = html`<div class="md-mem-note">${tOr('markdown.embed.loading', 'Loading…')}</div>`;
  else if (state.status === 'error') body = html`<div class="md-mem-note md-mem-err">🔒 ${state.msg}</div>`;
  else if (state.value == null) body = html`<div class="md-mem-note">${tOr('markdown.embed.empty', '(empty)')}</div>`;
  else {
    const view = pickView(spec, state.value);
    if (view === 'table') body = renderTable(state.value, spec.fields);
    else if (view === 'props') body = renderProps(state.value);
    else if (view === 'list') body = renderList(state.value);
    else if (view === 'json') body = renderJson(state.value);
    else body = html`<div class="md-mem-value">${cellText(state.value)}</div>`;
  }
  return html`
    <div class="md-mem">
      <div class="md-mem-head">
        <span class="md-mem-title">${spec.title || spec.key || 'aimeat-memory'}</span>
        ${state.updatedAt ? html`<span class="md-mem-upd">${new Date(state.updatedAt).toLocaleString()}</span>` : null}
        <button type="button" class="md-mem-refresh" title=${tOr('markdown.embed.refresh', 'Refresh')} onClick=${load}>↻</button>
      </div>
      ${body}
    </div>
  `;
}
