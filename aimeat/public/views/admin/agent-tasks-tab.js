/**
 * @file agent-tasks-tab.js
 * @description Admin dashboard tab for browsing all agent tasks across all owners.
 *   Provides status filtering, pagination, and TODO progress display.
 * @version-history
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
import { dt, Empty, Badge, StatsGrid } from './shared.js';
import { apiGet } from '/js/api.js';

const PAGE_SIZE = 20;

const STATUSES = ['', 'draft', 'queued', 'active', 'stalled', 'done', 'failed'];

export default function AgentTasksTab({ data, reload, session }) {
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

  // Map a task status to a tokenized status-tag class (colors live in admin.css,
  // tag--status-* — replaces the former inline hex colors so chips flip in dark mode).
  function statusTagClass(status) {
    const known = ['active', 'done', 'failed', 'stalled', 'queued', 'draft'];
    return known.includes(status) ? `tag tag--status-${status}` : 'tag tag--status-draft';
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return html`
    <div>
      <!-- Filter bar -->
      <div class="adm-mem-filters">
        <select class="adm-input" value=${statusFilter} onChange=${handleFilterChange}>
          <option value="">${t('dashboard.agentTasksStatus')} (${t('dashboard.all') || 'All'})</option>
          ${STATUSES.filter(s => s).map(s => html`
            <option value=${s}>${s}</option>
          `)}
        </select>
        <button class="adm-btn" onClick=${() => loadTasks(1)} disabled=${loading}>
          ${loading ? t('dashboard.loading') : t('dashboard.refresh')}
        </button>
      </div>

      <!-- Stats summary -->
      <${StatsGrid} items=${[{ label: t('dashboard.agentTasksTotal'), value: total }]} />

      <!-- Table -->
      ${tasks.length === 0 && !loading && html`<${Empty} text=${t('dashboard.agentTasksEmpty')} />`}

      ${tasks.length > 0 && html`
        <div class="adm-card">
          <div class="scrollable">
            <table>
              <thead><tr>
                <th>${t('dashboard.agentTasksAgent')}</th>
                <th>${t('dashboard.agentTasksTitle')}</th>
                <th>${t('dashboard.agentTasksStatus')}</th>
                <th>${t('dashboard.agentTasksTodoProgress')}</th>
                <th>${t('dashboard.agentTasksCreated')}</th>
                <th>${t('dashboard.agentTasksLastEvent')}</th>
              </tr></thead>
              <tbody>
                ${tasks.map(task => html`
                  <tr>
                    <td class="mono" style="font-size:.8rem">${escHtml(task.agent_gaii)}</td>
                    <td>${escHtml(task.title)}</td>
                    <td>
                      <span class=${statusTagClass(task.status)}>
                        ${task.status}
                      </span>
                    </td>
                    <td>
                      ${task.todo_progress.total > 0
                        ? html`${task.todo_progress.done}/${task.todo_progress.total}`
                        : html`<span style="color:var(--text-dim)">--</span>`
                      }
                    </td>
                    <td style="color:var(--text-dim)">${dt(task.created_at)}</td>
                    <td style="color:var(--text-dim)">${dt(task.last_event_at)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          ${totalPages > 1 && html`
            <div class="adm-mem-pagination">
              <button class="adm-btn-sm"
                disabled=${page <= 1}
                onClick=${() => loadTasks(page - 1)}>
                ← ${t('dashboard.prev') || 'Prev'}
              </button>
              <span class="adm-mem-page-info">${page} / ${totalPages}</span>
              <button class="adm-btn-sm"
                disabled=${page >= totalPages}
                onClick=${() => loadTasks(page + 1)}>
                ${t('dashboard.next') || 'Next'} →
              </button>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}
