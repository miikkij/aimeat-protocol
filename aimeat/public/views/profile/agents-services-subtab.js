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
 *   2026-09-22 -- Unpublish carries the danger tone.
 *   2026-09-22 -- Composed from the shared component set: the info note is an aside Surface, each
 *     service a ListRow (description as its sentence, active/inactive as a Chip, Unpublish as a text
 *     action, the cost/visibility/call figures as mono words under it). The status dot is gone, the
 *     chip says the same. No class of its own is left. Same words, data and handlers.
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
import { ListRow, Chip, Action, Stack, Surface, Text } from '/components/poster-parts.js';

function ServiceCard({ service, onUnpublish }) {
  const name = service.display_name || service.name || service.action_id || t('profile.agents.services.unnamed');
  const desc = service.description || '';
  const cost = service.cost != null ? `${service.cost} ${t('profile.agents.services.morsels')}` : t('profile.agents.services.free');
  const visibility = t('profile.agents.services.visibility.' + (service.visibility || 'public'));
  const isActive = service.active !== false && service.status !== 'inactive';
  const calls = service.invocation_count || service.call_count || 0;
  const successRate = service.success_rate != null ? `${Math.round(service.success_rate)}%` : null;
  const avgResponse = service.avg_response_ms != null ? `${Math.round(service.avg_response_ms)}ms` : null;

  // The status dot and the status badge said the same thing; the chip carries it alone now.
  return html`
    <${ListRow} density="compact" detailKind="text" name=${name} detail=${desc || undefined}
      value=${html`<${Chip} tone=${isActive ? 'sun' : 'muted'}>${isActive ? t('profile.agents.detail.services.active') : t('profile.agents.detail.services.inactive')}<//>`}
      actions=${html`<${Action} kind="text" tone="danger" onClick=${() => onUnpublish(service)}>
        ${t('profile.agents.services.unpublish')}
      <//>`}>
      <${Stack} direction="wrap" density="compact">
        <${Text} kind="mono" tone="muted">${cost}<//>
        <${Text} kind="mono" tone="muted">${visibility}<//>
        <${Text} kind="mono" tone="muted">${calls} ${t('profile.agents.services.calls')}<//>
        ${successRate && html`<${Text} kind="mono" tone="muted">${successRate} ${t('profile.agents.activity.successRate')}<//>`}
        ${avgResponse && html`<${Text} kind="mono" tone="muted">${avgResponse} ${t('profile.agents.services.avg')}<//>`}
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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  return html`
    <${Stack}>
      <${Surface} kind="aside">
        <${Text}>${t('profile.agents.detail.services.info')}<//>
      <//>

      ${services.length === 0 && html`
        <${Text} tone="muted">${t('profile.agents.detail.empty.services')}<//>
      `}

      ${services.length > 0 && html`
        <div>
          ${services.map(s => html`<${ServiceCard} service=${s} key=${s.action_id || s.name} onUnpublish=${handleUnpublish} />`)}
        </div>
      `}
    <//>
  `;
}
