/**
 * @file public/views/admin/scheduler-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Scheduler tab — lists scheduled jobs with summary stats and lets the
 *   operator run a job now, toggle enabled/disabled, or delete it.
 *
 * @structure
 *   - default SchedulerTab({ data, reload }): stats grid (total/active/disabled/failed) + jobs table
 *   - handleRunNow / handleToggleEnabled / handleDelete: per-job actions calling the admin service
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, DataTable, Empty, useToast, Toast } from './shared.js';
import { triggerSchedulerJob, updateSchedulerJob, deleteSchedulerJob } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function SchedulerTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const jobs = data.schedulerJobs?.jobs || [];

  const totalJobs = jobs.length;
  const enabledJobs = jobs.filter(j => j.enabled).length;
  const disabledJobs = totalJobs - enabledJobs;
  const failedJobs = jobs.filter(j => j.lastResult === 'error').length;

  async function handleRunNow(id) {
    try {
      await triggerSchedulerJob(id);
      reload();
    } catch (e) {
      showErr(e.message);
    }
  }

  async function handleToggleEnabled(id, currentEnabled) {
    try {
      await updateSchedulerJob(id, { enabled: !currentEnabled });
      reload();
    } catch (e) {
      showErr(e.message);
    }
  }

  function handleDelete(id) {
    confirm(t('dashboard.deleteLabel') + ': ' + id + '?', async () => {
      try {
        await deleteSchedulerJob(id);
        reload();
      } catch (e) {
        showErr(e.message);
      }
    }, { danger: true });
  }

  const statsItems = [
    { label: t('dashboard.schedulerTotal'), value: totalJobs },
    { label: t('dashboard.schedulerActive'), value: enabledJobs, color: 'var(--green, #22c55e)' },
    { label: t('dashboard.disabled'), value: disabledJobs, color: 'var(--text-dim)' },
    { label: t('dashboard.schedulerFailed'), value: failedJobs, color: failedJobs > 0 ? 'var(--red, #ef4444)' : 'var(--text-dim)' },
  ];

  if (!jobs.length) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${StatsGrid} items=${statsItems} />
      <${Empty} text=${t('dashboard.schedulerNoJobs')} />
      <${ConfirmUI} />
    `;
  }

  const resultBadgeType = (result) => {
    if (result === 'success') return 'healthy';
    if (result === 'error') return 'critical';
    return 'unknown';
  };

  const headers = [
    t('dashboard.name'),
    t('dashboard.schedulerType'),
    t('dashboard.schedulerCron'),
    t('dashboard.schedulerLastRun'),
    t('dashboard.schedulerResult'),
    t('dashboard.schedulerNextRun'),
    t('dashboard.schedulerEnabled'),
    t('dashboard.actions'),
  ];

  const rows = jobs.map(job => [
    escHtml(job.name || job.id),
    html`<${Badge} type=${job.type || 'core'} />`,
    html`<code>${escHtml(job.cron || '')}</code>`,
    dt(job.lastRun),
    job.lastResult
      ? html`<${Badge} type=${resultBadgeType(job.lastResult)} />`
      : '\u2014',
    dt(job.nextRun),
    html`<input type="checkbox" checked=${job.enabled}
      onChange=${() => handleToggleEnabled(job.id, job.enabled)} />`,
    html`<div style="display:flex;gap:4px">
      <button class="adm-btn-sm" onClick=${() => handleRunNow(job.id)}>
        ${t('dashboard.schedulerRunNow')}
      </button>
      ${job.type === 'extension' && html`
        <button class="adm-btn-sm adm-btn-danger" onClick=${() => handleDelete(job.id)}>
          ${t('dashboard.deleteLabel')}
        </button>
      `}
    </div>`,
  ]);

  // ── Execution History ──
  const logEntries = data.schedulerLog?.entries || data.schedulerLog?.data?.entries || [];

  const logResultBadge = (result) => {
    if (result === 'success') return 'healthy';
    if (result === 'error') return 'critical';
    if (result === 'skipped') return 'unknown';
    return 'unknown';
  };

  const logTriggerBadge = (trigger) => {
    if (trigger === 'cron') return 'core';
    if (trigger === 'manual') return 'extension';
    return 'unknown';
  };

  const logHeaders = [
    t('dashboard.schedulerLogTime'),
    t('dashboard.schedulerLogJob'),
    t('dashboard.schedulerLogTrigger'),
    t('dashboard.schedulerResult'),
    t('dashboard.schedulerLogDuration'),
    t('dashboard.schedulerLogMemory'),
  ];

  const logRows = logEntries.map(entry => [
    dt(entry.startedAt || entry.createdAt),
    escHtml(entry.jobName || entry.jobId || ''),
    html`<${Badge} type=${logTriggerBadge(entry.trigger)} />`,
    html`<${Badge} type=${logResultBadge(entry.result)} />`,
    entry.durationMs != null ? `${entry.durationMs}ms` : '\u2014',
    entry.memoryRead != null || entry.memoryWritten != null
      ? `${entry.memoryRead || 0} / ${entry.memoryWritten || 0}`
      : '\u2014',
  ]);

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${StatsGrid} items=${statsItems} />
    <h3 style="margin:16px 0 8px">${t('dashboard.schedulerJobs')}</h3>
    <${DataTable} headers=${headers} rows=${rows} scroll=${true} />
    <h3 style="margin:24px 0 8px">${t('dashboard.schedulerLogTitle')}</h3>
    ${logRows.length
      ? html`<${DataTable} headers=${logHeaders} rows=${logRows} scroll=${true} />`
      : html`<${Empty} text="No execution history" />`}
    <${ConfirmUI} />
  `;
}
