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
import { timeAgo } from '/js/utils.js';
import { listAgentSchedules, setScheduleEnabled, triggerSchedule, deleteSchedule } from '/js/services/schedules.js';
import { CreateForm } from '../scheduler-tab.js';

const html = htm.bind(h);

const KIND_LABEL = { ai: 'profile.scheduler.kind.ai', agent_task: 'profile.scheduler.kind.agent_task', extension: 'profile.scheduler.kind.extension', core: 'profile.scheduler.kind.core' };

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

  const onToggle = async (j) => { try { await setScheduleEnabled(j.id, !j.enabled); await loadData(); } catch (e) { showToast?.(e.message, true); } };
  const onTrigger = async (j) => { try { await triggerSchedule(j.id); showToast?.(t('profile.scheduler.triggered')); await loadData(); } catch (e) { showToast?.(e.message, true); } };
  const onCancel = async (j) => {
    if (!window.confirm(t('profile.scheduler.confirmCancel'))) return;
    try { await deleteSchedule(j.id); showToast?.(t('profile.scheduler.cancelled')); await loadData(); } catch (e) { showToast?.(e.message, true); }
  };

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
          : html`<table class="sch-table"><thead><tr>
              <th>${t('profile.scheduler.col.name')}</th>
              <th>${t('profile.scheduler.col.kind')}</th>
              <th>${t('profile.scheduler.col.cron')}</th>
              <th>${t('profile.scheduler.col.lastRun')}</th>
              <th>${t('profile.scheduler.col.nextRun')}</th>
              <th></th>
            </tr></thead><tbody>
            ${managed.map(j => html`<tr key=${j.id}>
              <td><div class="sch-name">${j.displayName || j.name}</div>${j.createdByAgent && html`<span class="sch-tag">${t('profile.scheduler.byAgent')}</span>`}</td>
              <td><span class="sch-badge sch-badge--${j.type === 'ai' ? 'ai' : j.type === 'extension' ? 'ext' : 'agent'}">${t(KIND_LABEL[j.type] || KIND_LABEL.core)}</span></td>
              <td><code class="sch-cron">${j.cron}</code>${j.timezone && html`<div class="sch-muted">${j.timezone}</div>`}</td>
              <td>${j.lastRunAt ? timeAgo(j.lastRunAt) : html`<span class="sch-muted">${t('profile.scheduler.never')}</span>`} ${j.lastRunResult ? html`<span class="sch-badge ${j.lastRunResult === 'error' ? 'sch-badge--err' : 'sch-badge--ok'}">${j.lastRunResult}</span>` : ''}</td>
              <td>${j.nextRunAt ? timeAgo(j.nextRunAt) : html`<span class="sch-muted">—</span>`}</td>
              <td class="sch-actions">
                <button class="btn-ghost sch-btn" onClick=${() => onToggle(j)}>${j.enabled ? t('profile.scheduler.pause') : t('profile.scheduler.resume')}</button>
                <button class="btn-ghost sch-btn" onClick=${() => onTrigger(j)}>${t('profile.scheduler.runNow')}</button>
                <button class="btn-danger sch-btn" onClick=${() => onCancel(j)}>${t('profile.scheduler.cancel')}</button>
              </td>
            </tr>`)}
          </tbody></table>`}
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
