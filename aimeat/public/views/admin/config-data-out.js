/**
 * @file config-data-out.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the "Data out" group of the admin Config tab shows under its settings (design
 *   canvas "Data ulos", board Admin-Config; WP9b): the Dataspace Protocol provider as it runs now
 *   (GET /v1/admin/dataspace), the outside parties' figures the Security page reads (GET
 *   /v1/admin/security/overview, `parties`), the apps whose owners ask to let people register without
 *   an account with Approve and Refuse (GET and POST /v1/admin/app-party-registrations, the calls
 *   aimeat_admin_app_party_registrations makes), the DCAT feed's address, and the note on the setting
 *   a new node starts with. It reads again on the `aimeat-live-update` event and never on a timer.
 *   Made of the component kit; it writes no class.
 * @structure DataOutStatus · reg
 * @usage html`<${DataOutStatus} />` (config-tab.js SECTION_ACTIONS.data_out)
 * @version-history
 *   v1.1.0 — 2026-11-01 — The installation's id, read-only with a copy action, as the board's
 *     "Installation id" (WP10e B16).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { getNodeId } from '/js/services/auth.js';
import { date as fmtDate, num } from '/js/format.js';
import { Stack } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, When, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

/** A word of this group, under dashboard.dataOut. */
const w = (key, vars) => t('dashboard.dataOut.' + key, vars);

/** One read that may fail on its own: the others still show. */
async function read(path, label) {
  try { return (await apiGet(path))?.data ?? null; }
  catch (err) { swallowed(`config-data-out: ${label}`, err); return null; }
}

export function DataOutStatus() {
  const [state, setState] = useState(null);   // { dsp, parties, regs }
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [dsp, sec, regs] = await Promise.all([
      read('/v1/admin/dataspace', 'dataspace'),
      read('/v1/admin/security/overview', 'security'),
      read('/v1/admin/app-party-registrations', 'registrations'),
    ]);
    setState({ dsp, parties: sec?.parties ?? null, regs });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const decide = async (r, decision) => {
    setBusy(`${r.owner}/${r.filename}`); setMessage(null);
    try {
      await apiPost(`/v1/admin/app-party-registrations/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.filename)}`, { decision });
      setMessage({ ok: true, text: w(decision === 'approve' ? 'approved' : 'refused', { app: r.filename, owner: r.owner }) });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err?.message || w('decideFailed') });
    }
    setBusy('');
  };

  if (!state) return html`<${Note} kind="loading" />`;
  const { dsp, parties, regs } = state;
  const apps = regs?.apps || [];
  const waiting = apps.filter((r) => r.state === 'requested');
  const origin = window.location.origin;
  const dcat = `${origin}/v1/catalogue/dcat`;

  return html`
    <${Stack} gap="large" above="section">
      <${SubHeading} rule>${w('dspTitle')}<//>
      ${dsp ? html`<${Facts} rows=${[
        { k: w('dspState'), v: html`<${Mark} kind="status" tone=${dsp.enabled ? 'fine' : 'off'}>${dsp.enabled ? w('on') : w('off')}<//>`, sub: dsp.enabled ? w('dspOnSub') : w('dspOffSub') },
        // The installation's own id (the node id every GHII ends in), read-only: the board's
        // "Installation id"; the id a data space knows this server by is the participant row below.
        getNodeId() && { k: w('installId'), v: getNodeId(), mono: true, sub: w('installIdSub'), action: html`<${Action} small soft copy=${getNodeId()}>${w('copy')}<//>` },
        { k: w('dspParticipant'), v: dsp.participant_id, mono: true },
        { k: w('dspBase'), v: dsp.protocol?.base, mono: true, sub: w('dspVersion', { v: dsp.protocol?.version || '' }) },
        { k: w('dspVersionEndpoint'), v: dsp.protocol?.version_endpoint, mono: true },
        { k: w('dspDid'), v: dsp.did_document, mono: true },
        { k: w('dspAuth'), v: (dsp.auth || []).join(', ') || '—', mono: true },
        (dsp.static_participants || []).length > 0 && { k: w('dspStatic'), v: dsp.static_participants.join(', '), mono: true },
        dsp.tck_mode?.set && { k: w('dspTck'), v: dsp.tck_mode.in_force ? w('on') : w('off'), sub: dsp.tck_mode.refused || '', warn: !dsp.tck_mode.in_force },
      ]} />` : html`<${Note} kind="quiet">${w('readFailed')}<//>`}

      <${SubHeading} rule desc=${w('securitySub')}>${w('securityTitle')}<//>
      <${FigureStrip} items=${[
        { key: 'parties', n: parties ? num(parties.total ?? 0) : '·', label: w('figParties'), sub: w('figPartiesSub') },
        { key: 'refused', n: parties ? num(parties.refused_reads_7d ?? 0) : '·', label: w('figRefused'), sub: w('figRefusedSub'), tone: parties?.refused_reads_7d ? 'notice' : undefined },
        { key: 'stopped', n: parties ? num(parties.stopped_by_operator ?? 0) : '·', label: w('figStopped'), sub: w('figStoppedSub') },
      ]} />

      <${SubHeading} rule desc=${regs ? w('regsSub.' + (regs.effective || 'off')) : undefined}>${w('regsTitle')}<//>
      <${List} cols="name-desc-when-doors" empty=${regs ? w('regsNone') : w('readFailed')} rows=${regs ? apps : []} render=${(r) => html`
        <${Row} key=${`${r.owner}/${r.filename}`} rail=${r.state === 'requested' ? 'warn' : undefined}>
          <${Name} code meta=${r.owner}>${r.filename || r.key}<//>
          <${Desc} sub=${w('regsParties', { n: num(r.parties ?? 0) })}>${w('regState.' + r.state)}<//>
          <${When}>${r.requested_at ? fmtDate(r.requested_at) : ''}<//>
          <${Doors}>
            ${r.state === 'requested' && r.filename ? html`
              <${Loud} control disabled=${!!busy} onClick=${() => decide(r, 'approve')}>${w('approve')}<//>
              <${Action} small disabled=${!!busy} onClick=${() => decide(r, 'refuse')}>${w('refuse')}<//>`
              : r.state === 'open' && r.filename ? html`<${Action} small tone="danger" disabled=${!!busy} onClick=${() => decide(r, 'refuse')}>${w('close')}<//>` : null}
          <//>
        <//>`} />
      ${waiting.length > 0 && regs?.effective === 'off' ? html`<${Note} kind="aside" size="small">${w('regsOff')}<//>` : null}
      ${message ? html`<${Note} kind="message" error=${!message.ok} role="status">${message.text}<//>` : null}

      <${SubHeading} rule>${w('dcatTitle')}<//>
      <${Facts} rows=${[
        { k: w('dcatFeed'), v: dcat, mono: true, sub: w('dcatSub'), action: html`<${Action} small soft href=${dcat} target="_blank" rel="noopener">${w('open')}<//>` },
      ]} />

      <${Note} kind="aside" size="small">${w('aside')}<//>
    <//>`;
}

export default DataOutStatus;
