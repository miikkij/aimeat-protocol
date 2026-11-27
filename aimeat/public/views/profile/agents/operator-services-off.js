/**
 * @file views/profile/agents/operator-services-off.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The services the person turned off for themselves, at the end of section 01 of the
 *   Agents page. An operator service (agents.operator_services) is an outside service the operator
 *   switched on for the accounts it covers: it gets an agent in each of them with no approval. Removing that agent
 *   turns the service off for the person and is remembered; this list is where they turn it on again
 *   (POST /v1/operator-services/{id}/me). Read from GET /v1/operator-services, the person's own state
 *   with each service. Nothing is drawn when no service is off for them, so a server without operator
 *   services shows nothing here.
 * @structure OperatorServicesOff({ showToast })
 * @usage html`<${OperatorServicesOff} showToast=${showToast} />`
 * @version-history
 *   v1.2.0 — 2026-11-27 — A service the operator turned off for the person shows the operator's reason under
 *     that line (`operator_off_reason`), when the operator gave one.
 *   v1.1.0 — 2026-11-26 — A service the operator turned off for the person shows with a line that says so
 *     and no button; one that does not cover them is not shown; the private read and its reason are stated.
 *   v1.0.1 — 2026-11-26 — Turn on again is the small action with its touch size (Action `control`, 44 px).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';

const html = htm.bind(h);

export function OperatorServicesOff({ showToast }) {
  const [off, setOff] = useState([]);
  const [busy, setBusy] = useState(null);

  const read = useCallback(async () => {
    try {
      const resp = await apiGet('/v1/operator-services');
      const services = resp?.data?.services ?? [];
      // Off for this person: turned off by them (`removed`, they may turn it on again) or by the operator
      // for their account (`operator_off`, no button). A disabled entry, and one that does not cover
      // them (`in_audience` false), is not theirs to see here.
      setOff(services.filter((s) => (s.state === 'removed' || s.state === 'operator_off') && s.enabled !== false && s.in_audience !== false));
    } catch (err) {
      // A server without the routes, or a session that may not read them: nothing to offer.
      swallowed('operator-services-off: read', err);
      setOff([]);
    }
  }, []);

  useEffect(() => { read(); }, [read]);
  // Removing the service's agent on a card is an `agents` change; the service's own changes ride
  // `operator-services`.
  useEffect(() => onLiveUpdate(['agents', 'operator-services'], read), [read]);

  const turnOn = async (s) => {
    setBusy(s.id);
    try {
      await apiPost(`/v1/operator-services/${encodeURIComponent(s.id)}/me`, {});
      showToast(t('profile.agents.operatorService.turnedOn', { service: s.display_name }));
      await read();
    } catch (err) {
      swallowed('operator-services-off: turn on', err);
      showToast(t('profile.agents.operatorService.turnOnError', { service: s.display_name }), true);
    } finally {
      setBusy(null);
    }
  };

  if (!off.length) return null;
  return html`
    <${SubHeading} level=${4}>${t('profile.agents.operatorService.offTitle')}<//>
    <${Note} kind="hint">${t('profile.agents.operatorService.offLede')}<//>
    <${List} cols="name-doors">
      ${off.map((s) => html`
        <${Row} key=${s.id}>
          <${Name} desc=${[s.description || null,
            s.private_read && s.private_read_reason ? t('notiftext.operator_service_on.private_read', { reason: s.private_read_reason }) : null,
            s.state === 'operator_off' ? t('profile.agents.operatorService.operatorOff') : null,
            // The operator's reason for turning it off for this account, when the operator gave one.
            s.state === 'operator_off' && typeof s.operator_off_reason === 'string' && s.operator_off_reason.trim()
              ? t('profile.agents.operatorService.operatorOffReason', { reason: s.operator_off_reason.trim() }) : null].filter(Boolean)}>${s.display_name}<//>
          <${Doors}>
            ${s.state === 'removed' && s.may_turn_off !== false
              ? html`<${Action} small control disabled=${busy === s.id} onClick=${() => turnOn(s)}>${t('profile.agents.operatorService.turnOn')}<//>`
              : null}
          <//>
        <//>`)}
    <//>
  `;
}

export default OperatorServicesOff;
