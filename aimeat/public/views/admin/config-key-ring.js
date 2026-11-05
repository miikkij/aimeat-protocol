/**
 * @file config-key-ring.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the "Node" group of the admin Config tab shows under its settings about the data
 *   key: which keys this node holds, which one seals new secrets, the last run of the re-encrypt job
 *   with its counts, and whether the other key may be removed; with a button that starts the job
 *   (GET and POST /v1/admin/encryption/reencrypt, the calls aimeat_admin_key_reencrypt makes). The
 *   keys themselves are set in the environment and never shown or typed here. It reads again on the
 *   `aimeat-live-update` event (the job sends `key-reencrypt` while it runs) and never on a timer.
 *   Made of the component kit; it writes no class.
 * @structure KeyRingStatus · w · sayKey
 * @usage html`<${KeyRingStatus} />` (config-tab.js SECTION_ACTIONS.node)
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate, num } from '/js/format.js';
import { Stack } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Facts } from '/components/Facts.js';
import { Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

/** A word of this group, under dashboard.keyRing. */
const w = (key, vars) => t('dashboard.keyRing.' + key, vars);
/** The environment variable of a key id. */
const sayKey = (id) => (id === 0 ? 'AIMEAT_ENCRYPTION_KEY' : `AIMEAT_ENCRYPTION_KEY_${id}`);

export function KeyRingStatus() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = (await apiGet('/v1/admin/encryption/reencrypt'))?.data ?? null;
      setStatus(data);
      // "The job started" belongs to a running job: once it has ended, the facts above say how.
      if (data?.job?.state !== 'running') setMessage((m) => (m?.started ? null : m));
    }
    catch (err) { swallowed('config-key-ring: status', err); setStatus({ failed: true }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = (e) => { const d = e?.detail?.domains; if (!d || d.has?.('key-reencrypt') || d.has?.('config')) load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const start = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await apiPost('/v1/admin/encryption/reencrypt', {});
      setMessage({ ok: true, started: true, text: r?.data?.started ? w('started') : w('alreadyRunning') });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err?.message || w('startFailed') });
    }
    setBusy(false);
  };

  if (!status) return html`<${Note} kind="loading" />`;
  if (status.failed) return html`<${Note} kind="quiet">${w('readFailed')}<//>`;
  const { ring, job } = status;
  const two = (ring?.keys || []).length > 1;
  const other = two ? ring.keys.find((k) => k !== ring.current) : null;
  const counts = job?.counts;

  let says;
  if (!ring?.keys?.length) says = w('noKey');
  else if (!two) says = w('oneKey');
  else if (!job) says = w('noRun', { key: ring.current, other: sayKey(other) });
  else if (job.state === 'running') says = w('running', { key: job.target_key, other: sayKey(other) });
  else if (job.state === 'failed') says = w('failed', { other: sayKey(other) });
  else if (job.target_key !== ring.current) says = w('stale', { key: job.target_key, current: ring.current, other: sayKey(other) });
  else if (status.old_key_removable) says = w('removable', { key: ring.current, other: sayKey(other) });
  else says = w('left', { n: num(status.old_key_values ?? 0), key: ring.current, other: sayKey(other) });

  const rows = [
    { k: w('keys'), v: two ? w('keysTwo', { a: sayKey(ring.keys[0]), b: sayKey(ring.keys[1]) }) : (ring?.keys?.length ? sayKey(ring.keys[0]) : w('none')), mono: true },
    two && { k: w('current'), v: sayKey(ring.current), mono: true, sub: w('currentSub') },
    job && { k: w('lastRun'), v: w('state.' + job.state), sub: job.finished_at ? fmtDate(job.finished_at) : (job.started_at ? fmtDate(job.started_at) : '') },
    counts && { k: w('counts'), v: w('countsLine', { moved: num(counts.moved), current: num(counts.current), unreadable: num(counts.unreadable), changed: num(counts.conflicts) }), warn: counts.unreadable > 0 || counts.conflicts > 0 },
    job && job.unreadable_at?.length > 0 && { k: w('unreadableAt'), v: job.unreadable_at.map((u) => `${u.source}: ${u.id.join(' · ')}`).join('; '), mono: true, warn: true },
  ];

  return html`
    <${Stack} gap="large" above="section">
      <${SubHeading} rule desc=${w('desc')}>${w('title')}<//>
      <${Facts} rows=${rows} />
      <${Note} kind="aside" size="small">${says}<//>
      ${two && job?.state !== 'running' ? html`<${Loud} control disabled=${busy} onClick=${start}>${w('start')}<//>` : null}
      ${message ? html`<${Note} kind="message" error=${!message.ok} role="status">${message.text}<//>` : null}
    <//>`;
}

export default KeyRingStatus;
