/**
 * @file security-tab.refusals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the admin Security page: who was turned away. The refusal log read as
 *   a story first (by door, by source, by credential, and the one fingerprint that keeps coming
 *   back), then the filters, then the lines themselves, newest first. The groupings come from the
 *   server (services/security-overview.ts, the last 24 hours); the filters and the search run over
 *   the lines already fetched, and "Show the next 200" asks the refusals door for a longer tail.
 * @structure credentialWord · whenText · matches · RefusalsSection
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the groupings are compact list
 *     rows with a progress meter for the bar (the walled source's meter in the quota colour), the
 *     filters and search are the shared toolbar, the lines the shared table that stacks on a phone.
 *   v1.1.0 -- 2026-09-13 -- Compose the shared B1 heading; encode bar lengths as SVG data.
 *   v1.0.0 — 2026-09-05 — Initial (the Security page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { time as fmtTime, dateTime as fmtDateTime } from '/js/format.js';
import { num } from './shared.js';
import { downloadBlob } from '/js/utils.js';
import { getAuthRefusals } from '/js/services/admin.js';
import { Section, Columns, Stack, ListRow, Toolbar, Table, Chip, Action, Meter, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.refusals.' + key, params);

const WINDOW_MS = 24 * 3600 * 1000;
const PAGE = 200;
const MAX_LINES = 1000;

/** The credential kind the log wrote, in words. Kinds nobody named show as themselves. */
export function credentialWord(kind) {
  const key = { none: 'none', cookie: 'cookie', pat: 'pat', 'bearer-jwt': 'jwt' }[kind || 'none'];
  return key ? S('kind.' + key) : kind;
}

/** An address as a person reads it: an IPv4 address behind a loopback or a proxy arrives IPv6-mapped. */
export function ipText(ip) {
  return String(ip || '').replace(/^::ffff:/i, '');
}

/** A time for a line: the clock for the last day, the date and clock beyond it. */
export function whenText(ts, now = Date.now()) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '';
  return now - d.getTime() < WINDOW_MS ? fmtTime(d) : fmtDateTime(d);
}

function matches(r, { window, status, q }, now) {
  if (window === '24h' && now - Date.parse(r.ts) > WINDOW_MS) return false;
  const walled = r.code === 'ATTEMPTS_REFUSED';
  if (status === 'walled' && !walled) return false;
  if (status === '401' && (r.status !== 401 || walled)) return false;
  if (status === '403' && r.status !== 403) return false;
  if (q) {
    const hay = [r.method, r.path, r.ip, r.credential, r.credential_digest, r.reason, r.code, r.principal && r.principal.sub]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** One grouping: a label, then a compact row per key with its count, and a bar scaled to the largest. */
function Grouping({ label, rows, keyOf, hotKeys, words, children }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return html`<${Stack} density="compact">
    <${Text} kind="label">${label}<//>
    <div>
      ${rows.map((r) => html`<${ListRow} key=${r.key} density="compact"
        name=${words ? html`<${Text} tone="muted">${keyOf ? keyOf(r) : r.key}<//>` : html`<${Text} kind="mono">${keyOf ? keyOf(r) : r.key}<//>`}
        nameTitle=${keyOf ? keyOf(r) : r.key} value=${num(r.count)}>
        ${words ? null : html`<${Meter} kind=${hotKeys && hotKeys.includes(r.key) ? 'quota' : 'progress'} value=${r.count} max=${max} label=${String(keyOf ? keyOf(r) : r.key)} />`}
      <//>`)}
      ${children}
    </div>
  <//>`;
}

export function RefusalsSection({ ov, switchPage, onError }) {
  const r = ov.refusals;
  const log = ov.now.log;
  const [tail, setTail] = useState(null);       // null: the overview's own tail
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [window, setWindow] = useState('24h');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const lines = useMemo(() => tail || r.tail || [], [tail, r.tail]);
  const now = Date.now();
  const shown = useMemo(
    () => lines.filter(l => matches(l, { window, status, q: q.trim().toLowerCase() }, now)),
    [lines, window, status, q, now],
  );

  const more = async () => {
    const next = Math.min(limit + PAGE, MAX_LINES);
    setBusy(true);
    try { const res = await getAuthRefusals(next); setTail(res?.data?.items || []); setLimit(next); }
    catch (e) { onError((e && e.message) || t('common.error')); }
    setBusy(false);
  };
  const download = () => downloadBlob(
    new Blob([JSON.stringify(shown, null, 2)], { type: 'application/json' }),
    `refusals-${new Date().toISOString().slice(0, 10)}.json`,
  );

  const answerChip = (l) => l.code === 'ATTEMPTS_REFUSED'
    ? html`<${Chip} tone="danger">${S('walled')}<//>`
    : html`<${Chip} tone=${l.status === 401 ? 'coral' : 'danger'}>${l.status}<//>`;

  // The one fingerprint that keeps coming back, when there is one worth a sentence.
  const topDigest = r.by_digest && r.by_digest[0] && r.by_digest[0].count >= 3 ? r.by_digest[0] : null;
  const kindTotal = topDigest ? (r.by_credential.find(c => c.key === topDigest.kind) || { count: topDigest.count }).count : 0;
  const listedSources = r.by_source.reduce((s, x) => s + x.count, 0);
  const moreSources = r.sources_in_window - r.by_source.length;

  const toggle = (value) => () => setStatus(status === value ? 'all' : value);
  const tableRows = shown.map((l) => [
    { text: whenText(l.ts, now), mono: true },
    html`<${Stack} direction="horizontal" align="center" density="compact">${answerChip(l)}<${Text} kind="mono">${l.code || ''}<//><//>`,
    { text: `${l.method || ''} ${l.path || ''}`, mono: true },
    { text: ipText(l.ip), mono: true },
    html`${credentialWord(l.credential)}${l.credential_digest ? html` <${Text} kind="mono">${l.credential_digest}<//>` : null}`,
    html`<${Text} tone="muted">${(l.reason || '').slice(0, 160)}${l.principal && l.principal.sub && !l.principal.anonymous ? ` · ${l.principal.sub}` : ''}<//>`,
  ]);

  return html`<${Section} id="adm-sec-02" title=${S('title')} count="02"
    actions=${html`
      ${log.enabled && lines.length ? html`<${Action} onClick=${download}>${S('download')}<//>` : null}
      <${Action} onClick=${() => switchPage('config')}>${S('logSettings')}<//>`}
    description=${log.enabled ? S('lead', { n: num(lines.length) }) : undefined}>
    ${!log.enabled ? html`<${Text} tone="muted">${S('disabled')}<//>` : html`
      ${r.readable_lines === 0 ? html`<${Text} tone="muted">${S('none')}<//>` : html`<${Stack}>
        ${r.in_window === 0 ? html`<${Text} tone="muted">${S('noneInWindow')}<//>` : html`
          <${Columns} layout="thirds" collapse=${900}>
            <${Grouping} label=${S('byDoor')} rows=${r.by_door} />
            <${Grouping} label=${S('bySource')} rows=${r.by_source} keyOf=${(x) => ipText(x.key)} hotKeys=${r.walled_sources}>
              ${moreSources > 0 ? html`<${ListRow} density="compact" name=${html`<${Text} tone="muted">${S('moreSources', { n: num(moreSources) })}<//>`} value=${num(r.in_window - listedSources)} />` : null}
            <//>
            <${Stack} density="compact">
              <${Grouping} label=${S('byCredential')} rows=${r.by_credential} keyOf=${(x) => credentialWord(x.key)} words=${true} />
              ${topDigest ? html`<${Text} kind="caption" tone="muted">${S(topDigest.refused_403 > topDigest.refused_401 ? 'fingerprint403' : 'fingerprint', { digest: topDigest.key, count: num(topDigest.count), total: num(kindTotal), kind: credentialWord(topDigest.kind) })}<//>` : null}
            <//>
          <//>`}

        <${Toolbar} label=${S('search')}
          filters=${[
            { id: '24h', label: S('filter24'), selected: window === '24h', onClick: () => setWindow('24h') },
            { id: 'all', label: S('filterAll', { n: num(lines.length) }), selected: window === 'all', onClick: () => setWindow('all') },
            { id: '401', label: '401', selected: status === '401', onClick: toggle('401') },
            { id: '403', label: '403', selected: status === '403', onClick: toggle('403') },
            { id: 'walled', label: S('walled'), selected: status === 'walled', onClick: toggle('walled') },
          ]}
          search=${{ ariaLabel: S('search'), placeholder: S('search'), value: q, onInput: (e) => setQ(e.target.value) }} />

        ${shown.length === 0
          ? html`<${Text} tone="muted">${S('noneMatch')}<//>`
          : html`<${Table} label=${S('title')} collapse=${600} density="compact"
              headers=${[S('time'), S('answer'), S('door'), S('source'), S('credential'), S('reason')]} rows=${tableRows} />`}
        <${Stack} direction="wrap" align="between">
          ${lines.length >= limit && limit < MAX_LINES
            ? html`<${Action} disabled=${busy} onClick=${more}>${S('next')}<//>`
            : html`<span></span>`}
          <${Text} kind="mono" tone="muted">${S('note', { shown: num(lines.length), window: num(r.in_window) })}<//>
        <//>
      <//>`}`}
  <//>`;
}
