/**
 * @file agents-services-subtab.js
 * @description Services sub-tab for agent detail view.
 *   Shows published services (actions) that this agent offers on the work exchange.
 *   Displays service name, description, cost, visibility, and call count.
 * @structure
 *   - AgentServicesSubtab (default export) -- main component
 *   - ServiceCard -- individual service display card
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getAgentServices } from '/js/services/agent-services.js';

function ServiceCard({ service }) {
  const name = service.display_name || service.name || service.action_id || 'Unnamed';
  const desc = service.description || '';
  const cost = service.cost != null ? `${service.cost} morsels` : 'Free';
  const visibility = service.visibility || 'public';
  const calls = service.invocation_count || service.call_count || 0;

  return html`
    <div class="agd-service-card">
      <div class="agd-service-name">${name}</div>
      ${desc && html`<div class="agd-service-desc">${desc}</div>`}
      <div class="agd-service-meta">
        <span>${cost}</span>
        <span>${visibility}</span>
        <span>${calls} ${t('profile.agents.services.calls')}</span>
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
      showToast(err.message || 'Failed to load services', true);
    }
    setLoading(false);
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
        ${t('profile.agents.services.info')}
      </div>

      ${services.length === 0 && html`
        <div class="agd-empty">${t('profile.agents.services.empty')}</div>
      `}

      ${services.length > 0 && html`
        <div class="agd-services-list">
          ${services.map(s => html`<${ServiceCard} service=${s} key=${s.action_id || s.name} />`)}
        </div>
      `}
    </div>
  `;
}
