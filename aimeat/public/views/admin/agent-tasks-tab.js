/**
 * @file agent-tasks-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for browsing all agent tasks across all owners.
 *   Provides status filtering, pagination, and TODO progress display.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: the filter is a shared Field in a Toolbar,
 *     the table the shared Table, the status a Chip in its tone, the pager shared Actions; no
 *     classes or inline styles of its own.
 *   v1.1.0 -- 2026-06-02 -- Component unification (#16): replace inline hex status
 *     colors with tokenized .tag--status-* classes (admin.css) so status tags flip
 *     correctly in dark mode.
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, StatsGrid, DataTable } from './shared.js';
import { apiGet } from '/js/api.js';
import { Stack, Toolbar, Field, Action, Chip, Text } from '/components/poster-parts.js';

/** The chip tone each task status reads as; an unknown status reads as a draft. */
const STATUS_TONE = { active: 'sun', done: 'success', failed: 'danger', stalled: 'coral', queued: 'plain', draft: 'muted' };

const PAGE_SIZE = 20;

const STATUSES = ['', 'draft', 'queued', 'active', 'stalled', 'done', 'failed'];

export default function AgentTasksTab() {
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const loadTasks = useCallback(async (p = 1, { showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('per_page', String(PAGE_SIZE));
      if (statusFilter) params.set('status', statusFilter);
      const r = await apiGet('/v1/admin/agent-tasks?' + params.toString());
      if (r.data) {
        setTasks(r.data.tasks || []);
        setTotal(r.data.total || 0);
        setPage(p);
      }
    } catch (e) {
      console.warn('Failed to load agent tasks:', e.message);
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadTasks(1); }, [loadTasks]);

  // Listen for live updates
  useEffect(() => onLiveUpdate(['agent-tasks'], () => loadTasks(page, { showSpinner: false })), [loadTasks, page]);

  function handleFilterChange(e) {
    setStatusFilter(e.target.value);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const options = [
    { value: '', label: `${t('dashboard.agentTasksStatus')} (${t('dashboard.all') || 'All'})` },
    ...STATUSES.filter(s => s).map(s => ({ value: s, label: s })),
  ];

  const headers = [
    t('dashboard.agentTasksAgent'), t('dashboard.agentTasksTitle'), t('dashboard.agentTasksStatus'),
    t('dashboard.agentTasksTodoProgress'), t('dashboard.agentTasksCreated'), t('dashboard.agentTasksLastEvent'),
  ];
  const rows = tasks.map(task => [
    { text: escHtml(task.agent_gaii), mono: true },
    escHtml(task.title),
    html`<${Chip} tone=${STATUS_TONE[task.status] || 'muted'}>${task.status}<//>`,
    task.todo_progress.total > 0
      ? { text: `${task.todo_progress.done}/${task.todo_progress.total}`, mono: true }
      : html`<${Text} kind="mono" tone="muted">--<//>`,
    dt(task.created_at),
    dt(task.last_event_at),
  ]);

  return html`
    <${Stack}>
      <${Toolbar} label=${t('dashboard.agentTasksStatus')}
        actions=${html`<${Action} onClick=${() => loadTasks(1)} disabled=${loading}>
          ${loading ? t('dashboard.loading') : t('dashboard.refresh')}<//>`}>
        <${Field} type="select" ariaLabel=${t('dashboard.agentTasksStatus')} value=${statusFilter}
          onChange=${handleFilterChange} options=${options} />
      <//>

      <${StatsGrid} items=${[{ label: t('dashboard.agentTasksTotal'), value: total }]} />

      ${tasks.length === 0 && !loading && html`<${Empty} text=${t('dashboard.agentTasksEmpty')} />`}

      ${tasks.length > 0 && html`<${DataTable} headers=${headers} rows=${rows} />`}

      ${tasks.length > 0 && totalPages > 1 && html`
        <${Stack} direction="horizontal" align="center">
          <${Action} disabled=${page <= 1} onClick=${() => loadTasks(page - 1)}>${t('dashboard.prev') || 'Prev'}<//>
          <${Text} kind="mono">${page} / ${totalPages}<//>
          <${Action} disabled=${page >= totalPages} onClick=${() => loadTasks(page + 1)}>${t('dashboard.next') || 'Next'} →<//>
        <//>`}
    <//>
  `;
}
