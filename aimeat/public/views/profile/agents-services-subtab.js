/**
 * @file agents-services-subtab.js
 * @description Services sub-tab for agent detail view.
 *   Shows published services (actions) that this agent offers on the work exchange.
 *   Displays service name, description, cost, visibility, and call count.
 * @structure
 *   - AgentServicesSubtab (default export) -- main component
 *   - ServiceCard -- individual service display card
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Fix locale keys; add status dots and active/inactive labels
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getAgentServices } from '/js/services/agent-services.js';

function ServiceCard({ service, onUnpublish }) {
  const name = service.display_name || service.name || service.action_id || t('profile.agents.services.unnamed');
  const desc = service.description || '';
  const cost = service.cost != null ? `${service.cost} ${t('profile.agents.services.morsels')}` : t('profile.agents.services.free');
  const visibility = service.visibility || 'public';
  const isActive = service.active !== false && service.status !== 'inactive';
  const calls = service.invocation_count || service.call_count || 0;
  const successRate = service.success_rate != null ? `${Math.round(service.success_rate)}%` : null;
  const avgResponse = service.avg_response_ms != null ? `${Math.round(service.avg_response_ms)}ms` : null;

  return html`
    <div class="agd-service-card">
      <div class="agd-service-name">
        <span class="pf-agd-status-dot ${isActive ? 'pf-agd-status-dot--active' : 'pf-agd-status-dot--inactive'}"></span>
        ${name}
      </div>
      ${desc && html`<div class="agd-service-desc">${desc}</div>`}
      <div class="agd-service-meta">
        <span>${cost}</span>
        <span>${visibility}</span>
        <span class="pf-agd-badge ${isActive ? 'pf-agd-badge--active' : 'pf-agd-badge--inactive'}">${isActive ? t('profile.agents.detail.services.active') : t('profile.agents.detail.services.inactive')}</span>
        <span>${calls} ${t('profile.agents.services.calls')}</span>
        ${successRate && html`<span>${successRate} ${t('profile.agents.activity.successRate')}</span>`}
        ${avgResponse && html`<span>${avgResponse} ${t('profile.agents.services.avg')}</span>`}
      </div>
      <div class="agd-service-actions">
        <button class="btn-ghost btn-sm" onClick=${() => onUnpublish(service)}>
          ${t('profile.agents.services.unpublish')}
        </button>
      </div>
    </div>
  `;
}

export default function AgentServicesSubtab({ agentName, session, showToast }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadServices() {
    setLoading(true);
    try {
      const res = await getAgentServices(agentName);
      setServices(res.actions || []);
    } catch (err) {
      showToast(err.message || t('profile.agents.services.loadError'), true);
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
        showToast(t('profile.agents.services.unpublish') + ': OK');
        loadServices();
      } else {
        const body = await resp.json().catch(() => ({}));
        showToast(body.error?.message || t('profile.agents.services.unpublishError'), true);
      }
    } catch (err) {
      showToast(err.message || t('profile.agents.services.unpublishError'), true);
    }
  }

  useEffect(() => { loadServices(); }, [agentName]);

  useEffect(() => {
    const handler = () => { loadServices(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [agentName]);

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  return html`
    <div>
      <div class="agd-services-info">
        ${t('profile.agents.detail.services.info')}
      </div>

      ${services.length === 0 && html`
        <div class="agd-empty">${t('profile.agents.detail.empty.services')}</div>
      `}

      ${services.length > 0 && html`
        <div class="agd-services-list">
          ${services.map(s => html`<${ServiceCard} service=${s} key=${s.action_id || s.name} onUnpublish=${handleUnpublish} />`)}
        </div>
      `}
    </div>
  `;
}
