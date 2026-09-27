/**
 * @file agent-tasks-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for browsing all agent tasks across all owners.
 *   Provides status filtering, pagination, and TODO progress display.
 * @version-history
 *   v1.2.0 -- 2026-09-27 -- On the library components (page group G5): the status filter is the
 *     Select, the refresh the loud action, the table the List with its heading row, the status the
 *     Status mark in its tone (done fine, failed danger, active and stalled attention, queued and
 *     draft off), the pager a Row of action links. The file writes no class and no style.
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
import { dt, Empty, StatsGrid } from './shared.js';
import { apiGet } from '/js/api.js';
import { List, Row, Name, Cell, Num, When } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Select } from '/components/Select.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { Row as Line } from '/components/Layout.js';

const PAGE_SIZE = 20;

const STATUSES = ['', 'draft', 'queued', 'active', 'stalled', 'done', 'failed'];

/** A task status's tone as the Status mark says it; an unknown status is drawn as a draft. */
const STATUS_TONE = { active: 'attention', done: 'fine', failed: 'danger', stalled: 'attention', queued: 'off', draft: 'off' };

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

  // A task status's tone for the Status mark (the colours live in the mark's own tones, so they flip
  // with the theme).
  function statusTone(status) {
    return STATUS_TONE[status] || STATUS_TONE.draft;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const options = [['', `${t('dashboard.agentTasksStatus')} (${t('dashboard.all') || 'All'})`], ...STATUSES.filter(s => s).map(s => [s, s])];
  const head = [t('dashboard.agentTasksAgent'), t('dashboard.agentTasksTitle'), t('dashboard.agentTasksStatus'),
    t('dashboard.agentTasksTodoProgress'), t('dashboard.agentTasksCreated'), t('dashboard.agentTasksLastEvent')];

  return html`
    <!-- Filter bar -->
    <${Line} wrap below="medium">
      <${Select} fit value=${statusFilter} options=${options} ariaLabel=${t('dashboard.agentTasksStatus')}
        onChange=${(v, e) => handleFilterChange(e)} />
      <${Loud} control onClick=${() => loadTasks(1)} disabled=${loading}>
        ${loading ? t('dashboard.loading') : t('dashboard.refresh')}
      <//>
    <//>

    <!-- Stats summary -->
    <${StatsGrid} items=${[{ label: t('dashboard.agentTasksTotal'), value: total }]} />

    <!-- Table -->
    ${tasks.length === 0 && !loading && html`<${Empty} text=${t('dashboard.agentTasksEmpty')} />`}

    ${tasks.length > 0 && html`
      <${List} cols="id-name-state-n-when-when" head=${head} labels>
        ${tasks.map(task => html`
          <${Row} key=${task.id || task.title + task.created_at}>
            <${Cell} meta>${escHtml(task.agent_gaii)}<//>
            <${Name}>${escHtml(task.title)}<//>
            <${Cell}><${Mark} kind="status" tone=${statusTone(task.status)}>${task.status}<//><//>
            <${Num}>
              ${task.todo_progress.total > 0
                ? html`${task.todo_progress.done}/${task.todo_progress.total}`
                : html`<${Tinted} tone="dim">--<//>`
              }
            <//>
            <${When}><${Tinted} tone="dim">${dt(task.created_at)}<//><//>
            <${When}><${Tinted} tone="dim">${dt(task.last_event_at)}<//><//>
          <//>
        `)}
      <//>

      <!-- Pagination -->
      ${totalPages > 1 && html`
        <${Line} gap="large" above="medium">
          <${Action} small disabled=${page <= 1} onClick=${() => loadTasks(page - 1)}>
            ← ${t('dashboard.prev') || 'Prev'}
          <//>
          <${Note} kind="meta" inline mono>${page} / ${totalPages}<//>
          <${Action} small disabled=${page >= totalPages} onClick=${() => loadTasks(page + 1)}>
            ${t('dashboard.next') || 'Next'} →
          <//>
        <//>
      `}
    `}
  `;
}
