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
 *   v1.0.0 — 2026-09-05 — Initial (the Security page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num } from './shared.js';
import { downloadBlob } from '/js/utils.js';
import { getAuthRefusals } from '/js/services/admin.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.refusals.' + key, params);

const WINDOW_MS = 24 * 3600 * 1000;
const PAGE = 200;
const MAX_LINES = 1000;
/** The longest bar in a grouping, in px; the others scale to it. */
const BAR_MAX_PX = 90;

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
  return now - d.getTime() < WINDOW_MS ? d.toLocaleTimeString() : d.toLocaleString();
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

function Grouping({ label, rows, keyOf, hotKeys, words }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return html`<div>
    <div class="adm-sec-lbl">${label}</div>
    ${rows.map((r, i) => html`
      <div class="adm-sec-krow ${i === rows.length - 1 ? 'adm-sec-krow--last' : ''}" key=${r.key}>
        <span class="adm-sec-key ${words ? 'adm-sec-key--words' : ''}">${keyOf ? keyOf(r) : r.key}</span>
        ${words ? null : html`<span class="adm-sec-bar ${hotKeys && hotKeys.includes(r.key) ? 'adm-sec-bar--hot' : ''}" style=${`width:${Math.max(4, Math.round(r.count / max * BAR_MAX_PX))}px`}></span>`}
        <span class="adm-sec-n">${num(r.count)}</span>
      </div>`)}
  </div>`;
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

  const chip = (on, label, onClick) => html`<button type="button" class="adm-sec-fchip ${on ? 'on' : ''}" onClick=${onClick}>${label}</button>`;
  const answerChip = (l) => l.code === 'ATTEMPTS_REFUSED'
    ? html`<span class="adm-badge adm-badge--danger">${S('walled')}</span>`
    : html`<span class="adm-badge ${l.status === 401 ? 'adm-badge--warning' : 'adm-badge--danger'}">${l.status}</span>`;

  // The one fingerprint that keeps coming back, when there is one worth a sentence.
  const topDigest = r.by_digest && r.by_digest[0] && r.by_digest[0].count >= 3 ? r.by_digest[0] : null;
  const kindTotal = topDigest ? (r.by_credential.find(c => c.key === topDigest.kind) || { count: topDigest.count }).count : 0;
  const listedSources = r.by_source.reduce((s, x) => s + x.count, 0);
  const moreSources = r.sources_in_window - r.by_source.length;

  return html`
    <section class="og-sec" id="adm-sec-02">
      <div class="og-sec-h"><h2>${S('title')}<small>02</small></h2>
        <div class="og-doors">
          ${log.enabled && lines.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${download}>${S('download')}</button>` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('config')}>${S('logSettings')}</button>
        </div></div>
      ${!log.enabled ? html`<div class="adm-sec-empty adm-sec-empty--last">${S('disabled')}</div>` : html`
        <p class="adm-sec-lead">${S('lead', { n: num(lines.length) })}</p>
        ${r.readable_lines === 0 ? html`<div class="adm-sec-empty adm-sec-empty--last">${S('none')}</div>` : html`
          ${r.in_window === 0 ? html`<div class="adm-sec-empty">${S('noneInWindow')}</div>` : html`
            <div class="adm-sec-cols">
              <${Grouping} label=${S('byDoor')} rows=${r.by_door} />
              <div>
                <${Grouping} label=${S('bySource')} rows=${r.by_source} keyOf=${(x) => ipText(x.key)} hotKeys=${r.walled_sources} />
                ${moreSources > 0 ? html`<div class="adm-sec-krow adm-sec-krow--last"><span class="adm-sec-key adm-sec-key--words">${S('moreSources', { n: num(moreSources) })}</span><span class="adm-sec-n">${num(r.in_window - listedSources)}</span></div>` : null}
              </div>
              <div>
                <${Grouping} label=${S('byCredential')} rows=${r.by_credential} keyOf=${(x) => credentialWord(x.key)} words=${true} />
                ${topDigest ? html`<p class="adm-sec-note">${S(topDigest.refused_403 > topDigest.refused_401 ? 'fingerprint403' : 'fingerprint', { digest: topDigest.key, count: num(topDigest.count), total: num(kindTotal), kind: credentialWord(topDigest.kind) })}</p>` : null}
              </div>
            </div>`}

          <div class="adm-sec-filters">
            ${chip(window === '24h', S('filter24'), () => setWindow('24h'))}
            ${chip(window === 'all', S('filterAll', { n: num(lines.length) }), () => setWindow('all'))}
            <span class="adm-sec-sep"></span>
            ${chip(status === '401', '401', () => setStatus(status === '401' ? 'all' : '401'))}
            ${chip(status === '403', '403', () => setStatus(status === '403' ? 'all' : '403'))}
            ${chip(status === 'walled', S('walled'), () => setStatus(status === 'walled' ? 'all' : 'walled'))}
            <span class="adm-sec-sep"></span>
            <input type="text" class="adm-sec-search" placeholder=${S('search')} value=${q} onInput=${(e) => setQ(e.target.value)} />
          </div>

          <table class="adm-sec-tbl">
            <thead>
              <tr><th>${S('time')}</th><th>${S('answer')}</th><th>${S('door')}</th><th>${S('source')}</th><th>${S('credential')}</th><th>${S('reason')}</th></tr>
            </thead>
            <tbody>
              ${shown.length === 0 ? html`<tr><td colspan="6" class="adm-sec-reason">${S('noneMatch')}</td></tr>` : shown.map((l, i) => html`
                <tr key=${l.ts + i}>
                  <td class="adm-sec-when">${whenText(l.ts, now)}</td>
                  <td class="adm-sec-answer">${answerChip(l)} <span class="adm-sec-code">${l.code || ''}</span></td>
                  <td><span class="adm-sec-route">${l.method || ''} ${l.path || ''}</span></td>
                  <td class="adm-sec-source"><span class="adm-sec-route">${ipText(l.ip)}</span></td>
                  <td>${credentialWord(l.credential)}${l.credential_digest ? html` <span class="adm-sec-code">${l.credential_digest}</span>` : null}</td>
                  <td class="adm-sec-reason">${(l.reason || '').slice(0, 160)}${l.principal && l.principal.sub && !l.principal.anonymous ? ` · ${l.principal.sub}` : ''}</td>
                </tr>`)}
            </tbody>
          </table>
          <div class="adm-sec-foot">
            <div class="og-doors">
              ${lines.length >= limit && limit < MAX_LINES
                ? html`<button type="button" class="og-door" disabled=${busy} onClick=${more}>${S('next')}</button>`
                : null}
            </div>
            <span class="adm-sec-mono">${S('note', { shown: num(lines.length), window: num(r.in_window) })}</span>
          </div>`}`}
    </section>`;
}
