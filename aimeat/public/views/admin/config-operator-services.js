/**
 * @file public/views/admin/config-operator-services.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the "Agents" group of the admin Config tab shows under its settings about the
 *   operator services (agents.operator_services): for each entry, the accounts it covers with their
 *   state, and the operator's switch per account (off with an optional reason the person reads, or on
 *   again). Reads GET /v1/operator-services and GET /v1/operator-services/{id}/accounts, switches with
 *   PUT /v1/operator-services/{id}/accounts/{account}, the same calls aimeat_admin_service_access
 *   makes. It reads again on the `operator-services` and `config` live events and never on a timer.
 *   Made of the component kit; it writes no class. Nothing is drawn while no entry exists.
 * @structure OperatorServiceAccounts · EntryAccounts · w
 * @usage html`<${OperatorServiceAccounts} />` (config-tab.js SECTION_ACTIONS.agents)
 * @version-history
 *   v1.1.0 — 2026-11-27 — An account the operator switched off shows the reason given, with who and when.
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2: the operator's switch per account).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Doors, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { TextField } from '/components/TextField.js';

/** A word of this part, under dashboard.operatorServices. */
const w = (key, vars) => t('dashboard.operatorServices.' + key, vars);

/**
 * The operator's reason for an account switched off, with who switched it and when (`reason`, `by`, `at`
 * on a row in state operator_off), or null when no reason was given. Who is the account or agent name,
 * without the server part.
 */
function offReasonLine(r) {
  if (r.state !== 'operator_off' || typeof r.reason !== 'string' || !r.reason.trim()) return null;
  const by = typeof r.by === 'string' && r.by ? r.by.replace(/@[^@]*$/, '') : '';
  const who = [by, r.at ? fmtDate(r.at) : ''].filter(Boolean).join(', ');
  return `${w('offReason', { reason: r.reason.trim() })}${who ? ` (${who})` : ''}`;
}

/** Re-read on these live domains: the service's own changes and a saved setting. */
const onLive = (load) => {
  const handler = (e) => { const d = e?.detail?.domains; if (!d || d.has?.('operator-services') || d.has?.('config')) load(); };
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
};

/** The accounts of one entry, a page at a time, each with its state and the operator's switch. */
function EntryAccounts({ entry }) {
  const [rows, setRows] = useState(null);
  const [next, setNext] = useState(null);
  const [asking, setAsking] = useState(null);   // the account whose off reason is being typed
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = (await apiGet(`/v1/operator-services/${encodeURIComponent(entry.id)}/accounts?limit=100`))?.data;
      setRows(d?.accounts ?? []); setNext(d?.next_cursor ?? null);
    } catch (err) { swallowed('config-operator-services: accounts', err); setRows([]); }
  }, [entry.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLive(load), [load]);

  const more = async () => {
    try {
      const d = (await apiGet(`/v1/operator-services/${encodeURIComponent(entry.id)}/accounts?limit=100&cursor=${encodeURIComponent(next)}`))?.data;
      setRows((r) => [...(r ?? []), ...(d?.accounts ?? [])]); setNext(d?.next_cursor ?? null);
    } catch (err) { swallowed('config-operator-services: more', err); }
  };

  const set = async (account, on) => {
    setBusy(account); setMessage(null);
    try {
      await apiPut(`/v1/operator-services/${encodeURIComponent(entry.id)}/accounts/${encodeURIComponent(account)}`,
        on ? { on: true } : { on: false, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setMessage(w(on ? 'turnedOn' : 'turnedOff', { account, service: entry.display_name }));
      setAsking(null); setReason('');
      await load();
    } catch (err) {
      setMessage(err?.message || w('failed'));
    } finally { setBusy(null); }
  };

  if (rows === null) return html`<${Note} kind="loading">${t('common.loading')}<//>`;
  return html`
    ${message && html`<${Note} kind="message">${message}<//>`}
    <${List} cols="name-doors" empty=${w('noAccounts')}>
      ${rows.map((r) => html`
        <${Row} key=${r.account}>
          <${Name} meta=${`${w('state.' + r.state)}${r.at ? ` · ${fmtDate(r.at)}` : ''}`} desc=${offReasonLine(r)}>${r.account}<//>
          <${Doors}>
            ${r.state === 'operator_off'
              ? html`<${Action} small control disabled=${busy === r.account} onClick=${() => set(r.account, true)}>${w('turnOn')}<//>`
              : asking === r.account
                ? html`<${TextField} size="medium" label=${w('reasonLabel')} value=${reason} onInput=${setReason} />
                    <${Action} small control tone="danger" disabled=${busy === r.account} onClick=${() => set(r.account, false)}>${w('confirmOff')}<//>
                    <${Action} small control onClick=${() => { setAsking(null); setReason(''); }}>${t('common.cancel')}<//>`
                : html`<${Action} small control onClick=${() => { setAsking(r.account); setReason(''); }}>${w('turnOff')}<//>`}
          <//>
        <//>`)}
    <//>
    ${next && html`<${More} label=${w('more')} onMore=${more} />`}`;
}

export function OperatorServiceAccounts() {
  const [entries, setEntries] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = (await apiGet('/v1/operator-services'))?.data;
      setEntries(d?.view === 'operator' ? d.services ?? [] : []);
    } catch (err) { swallowed('config-operator-services: list', err); setEntries([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLive(load), [load]);

  if (!entries || entries.length === 0) return null;
  return html`
    <${SubHeading} level=${4}>${w('title')}<//>
    <${Note} kind="hint">${w('lede')}<//>
    ${entries.map((e) => html`
      <div key=${e.id}>
        <${SubHeading} level=${5}>${e.display_name}<//>
        <${Note} kind="meta">${w('policy', {
          audience: e.audience === 'all' || !e.audience ? w('audienceAll') : w('audienceSome', { n: (e.audience.accounts ?? []).length }),
          required: e.required ? w('required') : w('notRequired'),
        })}${e.private_read ? ` ${w('privateRead')}` : ''}${e.enabled === false ? ` ${w('disabled')}` : ''}<//>
        <${EntryAccounts} entry=${e} />
      </div>`)}`;
}

export default OperatorServiceAccounts;
