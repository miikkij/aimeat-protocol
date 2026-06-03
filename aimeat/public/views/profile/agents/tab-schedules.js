/**
 * @file tab-schedules.js
 * @description Agent detail › Schedules sub-tab. Shows this agent's schedules in
 *   two groups: AIMEAT-dispatched (server-managed; full controls) and Agent
 *   internal (the agent's self-reported mirror, read-only). Lets the owner create
 *   a new schedule targeting this agent (reusing the master view's CreateForm).
 * @version-history
 *   v1.0.0 -- 2026-06-03 -- Initial agent Schedules sub-tab
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { listAgentSchedules } from '/js/services/schedules.js';
import { CreateForm } from '../scheduler-tab.js';
import ScheduleItem from '../schedule-item.js';

const html = htm.bind(h);

export default function TabSchedules({ agentName, allAgents = [], showToast }) {
  const [managed, setManaged] = useState([]);
  const [internal, setInternal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await listAgentSchedules(agentName);
      setManaged(res?.data?.managed || []);
      setInternal(res?.data?.agentInternal || []);
    } catch (e) {
      showToast?.(e.message, true);
    } finally { setLoading(false); }
  }, [agentName, showToast]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    loadData();
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    const poller = setInterval(() => loadRef.current(), 15000);
    return () => { window.removeEventListener('aimeat-live-update', handler); clearInterval(poller); };
  }, [loadData]);

  if (loading) return html`<div class="sch-loading">${t('profile.scheduler.loading')}</div>`;

  return html`
    <div class="sch-tab">
      <div class="sch-head">
        <div class="section-desc">${t('profile.scheduler.agentDesc')}</div>
        <button class="btn-primary" onClick=${() => setShowForm(v => !v)}>
          ${showForm ? t('profile.scheduler.close') : t('profile.scheduler.newSchedule')}
        </button>
      </div>

      ${showForm && html`<${CreateForm} agents=${allAgents} lockedAgent=${agentName} showToast=${showToast}
        onCreated=${() => { setShowForm(false); loadData(); }} />`}

      <div class="sch-section">
        <h3 class="sch-section-title">${t('profile.scheduler.dispatchedTitle')}</h3>
        ${managed.length === 0
          ? html`<div class="sch-empty">${t('profile.scheduler.noDispatched')}</div>`
          : html`<div class="sch-card-list">${managed.map(j => html`<${ScheduleItem} key=${j.id} schedule=${j} onChanged=${loadData} showToast=${showToast} />`)}</div>`}
      </div>

      <div class="sch-section">
        <h3 class="sch-section-title">${t('profile.scheduler.internalTitle')}</h3>
        <div class="sch-muted sch-internal-note">${t('profile.scheduler.internalNote')}</div>
        ${internal.length === 0
          ? html`<div class="sch-empty">${t('profile.scheduler.noInternal')}</div>`
          : html`<table class="sch-table"><tbody>
            ${internal.map((e, i) => html`<tr key=${e.id || i}>
              <td>${e.name}${e.purpose && html`<div class="sch-muted">${e.purpose}</div>`}</td>
              <td><code class="sch-cron">${e.cron || e.schedule || '—'}</code>${e.timezone && html`<div class="sch-muted">${e.timezone}</div>`}</td>
              <td>${e.status || 'active'}</td>
            </tr>`)}
          </tbody></table>`}
      </div>
    </div>`;
}
