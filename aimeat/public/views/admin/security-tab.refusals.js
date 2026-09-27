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
 *   v2.0.0 -- 2026-09-27 -- Library components only: the groupings are CountBars, the window and the
 *     answer filters Tabs in the filter tone, the search the SearchLine, the log a List with its own
 *     cut, the foot More. The page writes no class.
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
import { Section } from '/components/Section.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Tabs } from '/components/Tabs.js';
import { Row as Line } from '/components/Layout.js';
import { List, Row, When, Cell, Desc, SearchLine, More } from '/components/List.js';
import { CountBars, CountBarsSet } from '/components/CountBars.js';

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

  // The answer: the wall in coral, a 401 to look at, a 403 refused outright.
  const answerMark = (l) => l.code === 'ATTEMPTS_REFUSED'
    ? html`<${Mark} kind="status" tone="danger">${S('walled')}<//>`
    : html`<${Mark} kind="status" tone=${l.status === 401 ? 'attention' : 'danger'}>${l.status}<//>`;

  // The one fingerprint that keeps coming back, when there is one worth a sentence.
  const topDigest = r.by_digest && r.by_digest[0] && r.by_digest[0].count >= 3 ? r.by_digest[0] : null;
  const kindTotal = topDigest ? (r.by_credential.find(c => c.key === topDigest.kind) || { count: topDigest.count }).count : 0;
  const listedSources = r.by_source.reduce((s, x) => s + x.count, 0);
  const moreSources = r.sources_in_window - r.by_source.length;
  // A status filter pressed again lets every answer through.
  const pickStatus = (v) => setStatus(status === v ? 'all' : v);

  return html`
    <${Section} id="adm-sec-02" num="02" title=${S('title')} doors=${html`
      ${log.enabled && lines.length ? html`<${Action} small soft onClick=${download}>${S('download')}<//>` : null}
      <${Action} small soft onClick=${() => switchPage('config')}>${S('logSettings')}<//>`}>
      ${!log.enabled ? html`<${Note} kind="quiet">${S('disabled')}<//>` : html`
        <${Note} kind="lead">${S('lead', { n: num(lines.length) })}<//>
        ${r.readable_lines === 0 ? html`<${Note} kind="quiet">${S('none')}<//>` : html`
          ${r.in_window === 0 ? html`<${Note} kind="quiet">${S('noneInWindow')}<//>` : html`
            <${CountBarsSet}>
              <${CountBars} label=${S('byDoor')} rows=${r.by_door} />
              <${CountBars} label=${S('bySource')} rows=${r.by_source} keyOf=${(x) => ipText(x.key)} hot=${r.walled_sources}
                more=${moreSources > 0 ? { name: S('moreSources', { n: num(moreSources) }), count: r.in_window - listedSources } : null} />
              <div>
                <${CountBars} label=${S('byCredential')} rows=${r.by_credential} keyOf=${(x) => credentialWord(x.key)} words=${true} />
                ${topDigest ? html`<${Note} kind="hint">${S(topDigest.refused_403 > topDigest.refused_401 ? 'fingerprint403' : 'fingerprint', { digest: topDigest.key, count: num(topDigest.count), total: num(kindTotal), kind: credentialWord(topDigest.kind) })}<//>` : null}
              </div>
            <//>`}

          <${Line} wrap gap="medium" above="section" below="small">
            <${Tabs} tone="filter" value=${window} onSelect=${setWindow}
              items=${[{ value: '24h', label: S('filter24') }, { value: 'all', label: S('filterAll', { n: num(lines.length) }) }]} />
            <${Tabs} tone="filter" value=${status} onSelect=${pickStatus}
              items=${[{ value: '401', label: '401' }, { value: '403', label: '403' }, { value: 'walled', label: S('walled') }]} />
            <${SearchLine} text beside placeholder=${S('search')} value=${q} onInput=${(e) => setQ(e.target.value)} />
          <//>

          <${List} cols="when-state-path-where-kind-desc" empty=${S('noneMatch')}
            head=${[S('time'), S('answer'), S('door'), S('source'), S('credential'), S('reason')]}
            rows=${shown} render=${(l, i) => html`
              <${Row} key=${l.ts + i}>
                <${When}>${whenText(l.ts, now)}<//>
                <${Cell} line>${answerMark(l)} ${l.code ? html`<${Code}>${l.code}<//>` : null}<//>
                <${Cell} code>${l.method || ''} ${l.path || ''}<//>
                <${Cell} code>${ipText(l.ip)}<//>
                <${Cell} line>${credentialWord(l.credential)}${l.credential_digest ? html` <${Code}>${l.credential_digest}<//>` : null}<//>
                <${Desc}>${(l.reason || '').slice(0, 160)}${l.principal && l.principal.sub && !l.principal.anonymous ? ` · ${l.principal.sub}` : ''}<//>
              <//>`} />
          <${More} label=${S('next')} disabled=${busy} onMore=${lines.length >= limit && limit < MAX_LINES ? more : null}
            note=${S('note', { shown: num(lines.length), window: num(r.in_window) })} />`}`}
    <//>`;
}
