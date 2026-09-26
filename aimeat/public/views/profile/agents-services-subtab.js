/**
 * @file agents-services-subtab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Services sub-tab for agent detail view.
 *   Shows published services (actions) that this agent offers on the work exchange.
 *   Displays service name, description, cost, visibility, and call count.
 * @structure
 *   - AgentServicesSubtab (default export) -- main component
 *   - ServiceCard -- individual service display card
 * @version-history
 *   v1.9.0 -- 2026-09-26 -- A service is the List's row (page group G1a): the state dot before its name,
 *     the state word after it, what it does under it, price, visibility, calls, success and time on
 *     the typewriter line, Unpublish at the row's end; the loading, the hint and the empty line are Note.
 *   v1.8.0 -- 2026-09-26 -- The line under a service's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-26 -- What the Services tab is for is the Hint (.poster-hint); its own grey box goes (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- A dot that says a state (active, inactive, running, something unseen) is the status dot (css/components/status-dot.css), a unification: the look most tabs use.
 *   v1.3.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.1.0 -- 2026-05-24 -- Fix locale keys; add status dots and active/inactive labels
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getAgentServices } from '/js/services/agent-services.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';

function ServiceCard({ service, onUnpublish }) {
  const name = service.display_name || service.name || service.action_id || t('profile.agents.services.unnamed');
  const desc = service.description || '';
  const cost = service.cost != null ? `${service.cost} ${t('profile.agents.services.morsels')}` : t('profile.agents.services.free');
  const visibility = t('profile.agents.services.visibility.' + (service.visibility || 'public'));
  const isActive = service.active !== false && service.status !== 'inactive';
  const calls = service.invocation_count || service.call_count || 0;
  const successRate = service.success_rate != null ? `${Math.round(service.success_rate)}%` : null;
  const avgResponse = service.avg_response_ms != null ? `${Math.round(service.avg_response_ms)}ms` : null;

  // One service is one row: the state dot and the state word by its name, what it does under it, then
  // its price, who sees it, its calls and how it has done on the typewriter line.
  const meta = [
    cost,
    visibility,
    `${calls} ${t('profile.agents.services.calls')}`,
    successRate && `${successRate} ${t('profile.agents.activity.successRate')}`,
    avgResponse && `${avgResponse} ${t('profile.agents.services.avg')}`,
  ].filter(Boolean).join(' · ');
  return html`
    <${Row}>
      <${Name} dot=${isActive ? 'active' : 'inactive'} desc=${desc || null} meta=${meta}
        after=${html`<${Mark} kind="status" tone=${isActive ? 'fine' : 'off'}>${isActive ? t('profile.agents.detail.services.active') : t('profile.agents.detail.services.inactive')}<//>`}>
        ${name}
      <//>
      <${Doors}>
        <${Action} small row onClick=${() => onUnpublish(service)}>
          ${t('profile.agents.services.unpublish')}
        <//>
      <//>
    <//>
  `;
}

export default function AgentServicesSubtab({ agentName, session, showToast }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadServices({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      const res = await getAgentServices(agentName);
      setServices(res.actions || []);
    } catch (err) {
      if (showSpinner) showToast(err.message || t('profile.agents.services.loadError'), true);
    }
    setLoading(false);
  }

  async function handleUnpublish(service) {
    try {
      const actionId = service.action_id || service.id;
      const resp = await fetch(`/v1/actions/${encodeURIComponent(actionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.token}` },
      });
      if (resp.ok) {
        showToast(t('profile.agents.services.unpublished'));
        loadServices();
      } else {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error already being reported
        const body = await resp.json().catch(() => ({}));
        showToast(body.error?.message || t('profile.agents.services.unpublishError'), true);
      }
    } catch (err) {
      showToast(err.message || t('profile.agents.services.unpublishError'), true);
    }
  }

  // Reload when the selected agent changes. loadServices is recreated each render (it closes over the
  // showToast prop); depending on it would refetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadServices(); }, [agentName]);

  useEffect(() => {
    // Silent refetch on live-update so the tab doesn't flash blank.
    return onLiveUpdate(['agents'], () => loadServices({ showSpinner: false }));
    // Re-subscribe only on agent switch; loadServices is recreated each render (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  if (loading) {
    return html`<${Note} kind="loading" />`;
  }

  return html`
    <div>
      <${Note}>${t('profile.agents.detail.services.info')}<//>
      <${List} cols="name-doors" empty=${t('profile.agents.detail.empty.services')}>
        ${services.map(s => html`<${ServiceCard} service=${s} key=${s.action_id || s.name} onUnpublish=${handleUnpublish} />`)}
      <//>
    </div>
  `;
}
