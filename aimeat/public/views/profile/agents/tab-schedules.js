/**
 * @file tab-schedules.js
 * @description Agent detail › Schedules sub-tab. Shows this agent's schedules in
 *   two groups: AIMEAT-dispatched (server-managed; full controls) and Agent
 *   internal (the agent's self-reported mirror, read-only). Lets the owner create
 *   a new schedule targeting this agent (reusing the master view's CreateForm).
 * @version-history
 *   v1.1.0 -- 2026-07-17 -- Style unification: canonical agent-detail section headers
 *     (pf-agd-section-header/-title) instead of scheduler-view headings, pf-agd-empty
 *     empty states, and the Tasks-tab "+ New" outline button pattern.
 *   v1.0.0 -- 2026-06-03 -- Initial agent Schedules sub-tab
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
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
    return onLiveUpdate(['schedules', 'agent-tasks'], () => loadRef.current());
  }, [loadData]);

  if (loading) return html`<div class="sch-loading">${t('profile.scheduler.loading')}</div>`;

  return html`
    <div class="sch-tab">
      <div class="pf-agd-section-header">
        <span class="pf-agd-section-title">${t('profile.agents.detail.tabs.schedules')}${managed.length + internal.length > 0 ? ` (${managed.length + internal.length})` : ''}</span>
        <button class="btn-outline btn-sm" onClick=${() => setShowForm(v => !v)}>
          ${showForm ? '-' : '+'} ${t('profile.scheduler.newSchedule')}
        </button>
      </div>
      <div class="section-desc">${t('profile.scheduler.agentDesc')}</div>

      ${showForm && html`<${CreateForm} agents=${allAgents} lockedAgent=${agentName} showToast=${showToast}
        onCreated=${() => { setShowForm(false); loadData(); }} />`}

      <div class="sch-section">
        <div class="pf-agd-section-title">${t('profile.scheduler.dispatchedTitle')}</div>
        ${managed.length === 0
          ? html`<div class="pf-agd-empty">${t('profile.scheduler.noDispatched')}</div>`
          : html`<div class="sch-card-list">${managed.map(j => html`<${ScheduleItem} key=${j.id} schedule=${j} onChanged=${loadData} showToast=${showToast} />`)}</div>`}
      </div>

      <div class="sch-section">
        <div class="pf-agd-section-title">${t('profile.scheduler.internalTitle')}</div>
        <div class="sch-muted sch-internal-note">${t('profile.scheduler.internalNote')}</div>
        ${internal.length === 0
          ? html`<div class="pf-agd-empty">${t('profile.scheduler.noInternal')}</div>`
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
