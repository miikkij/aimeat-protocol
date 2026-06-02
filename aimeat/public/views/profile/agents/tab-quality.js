/**
 * @file tab-quality.js
 * @description Quality tab for the expanded agent view. Reads the recomputed
 *   GET /v1/agents/:name/statistics rollups and renders three sections:
 *   Performance (task counts, success rate, make-time, durations by context),
 *   Reviews by context (per-context star ratings + sample size + low-confidence
 *   flag), and Custom metrics (whatever the agent published under
 *   agents.<name>.statistics.custom.*). Quality READS statistics + reviews — it
 *   is the evaluative lens over the objective data.
 * @structure default export TabQuality({ agentName })
 * @usage rendered by agent-card.js renderTabContent() for the 'quality' tab
 * @version-history
 *   v1.2.0 -- 2026-06-01 -- Stop the empty flash on refresh: only show the loading
 *     state on first load; live-update refetches swap data in place (and keep the
 *     last good data on a transient error) instead of blanking the tab.
 *   v1.1.0 -- 2026-05-31 -- Add "Rate deliverables" list: completed tasks the owner
 *     can rate inline via the shared RateModal (unrated first); refreshes the
 *     rollups on submit.
 *   v1.0.0 -- 2026-05-31 -- Initial Quality tab (per-context reviews + performance + custom)
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { getAgentStatistics, listTasks, rateTask } from '/js/services/agent-tasks.js';
import RateModal from './rate-modal.js';

const html = htm.bind(h);

/** Glyph row for an average star value (rounded to nearest whole star). */
function starGlyphs(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

/** Localised context label, falling back to the raw enum value. */
function ctxLabel(ctx) {
  const key = `profile.agents.detail.quality.contexts.${ctx}`;
  const label = t(key);
  return label !== key ? label : ctx;
}

function fmtSeconds(secs) {
  return `${Number(secs || 0).toLocaleString()}${t('profile.agents.detail.quality.seconds')}`;
}

export default function TabQuality({ agentName, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doneTasks, setDoneTasks] = useState([]);
  const [rateTarget, setRateTarget] = useState(null); // task being rated, or null
  const [sendingRate, setSendingRate] = useState(false);

  async function loadData() {
    // NB: do NOT blank `data`/`loading` here. The initial render shows the
    // loading state (loading starts true); every later call -- including
    // live-update refetches -- swaps in fresh data in place without flashing an
    // empty tab. A transient error keeps the last good data rather than clearing.
    try {
      const [statsResp, tasksResp] = await Promise.all([
        getAgentStatistics(agentName),
        listTasks(agentName, { status: 'done', per_page: 100 }).catch(() => null),
      ]);
      if (statsResp?.data) setData(statsResp.data);
      setDoneTasks(tasksResp?.data?.tasks || []);
    } catch { /* keep showing the last good data on a transient error */ }
    setLoading(false);
  }

  async function handleSubmitRate(body) {
    if (!rateTarget) return;
    setSendingRate(true);
    try {
      await rateTask(agentName, rateTarget.id, body);
      showToast?.(t('profile.agents.tasks.rate.success'));
      setRateTarget(null);
      await loadData();
    } catch (err) {
      showToast?.(err.message || t('profile.agents.tasks.rate.error'), true);
    }
    setSendingRate(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  // Live updates: refresh when a rating lands or tasks change.
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  const perf = data?.performance || {};
  const reviews = data?.reviews || {};
  const custom = data?.custom || [];
  const byContext = reviews.byContext || {};
  const contextKeys = Object.keys(byContext);
  const durByContext = perf.duration?.byContext || {};
  const durKeys = Object.keys(durByContext);

  return html`
    <div class="pf-agd-quality">
      <!-- Performance -->
      <div class="pf-agd-section-title">${t('profile.agents.detail.quality.performanceTitle')}</div>
      <div class="pf-agd-quality-desc">${t('profile.agents.detail.quality.performanceDesc')}</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card-value">${perf.tasks?.total ?? 0}</div>
          <div class="stat-card-label">${t('profile.agents.detail.quality.tasksTotal')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${perf.tasks?.completed ?? 0}</div>
          <div class="stat-card-label">${t('profile.agents.detail.quality.tasksCompleted')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${perf.tasks?.successRate != null ? `${Math.round(perf.tasks.successRate * 100)}%` : '-'}</div>
          <div class="stat-card-label">${t('profile.agents.detail.quality.successRate')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${fmtSeconds(perf.duration?.avgCompletionSeconds)}</div>
          <div class="stat-card-label">${t('profile.agents.detail.quality.avgTime')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${perf.events?.total ?? 0}</div>
          <div class="stat-card-label">${t('profile.agents.detail.quality.events')}</div>
        </div>
      </div>
      ${durKeys.length > 0 && html`
        <div class="pf-agd-quality-durations">
          ${durKeys.map(ctx => html`
            <span key=${ctx} class="pf-agd-quality-dur-chip">
              ${ctxLabel(ctx)}: ${fmtSeconds(durByContext[ctx].avgSeconds)} (${durByContext[ctx].count})
            </span>
          `)}
        </div>
      `}

      <!-- Reviews by context -->
      <div class="pf-agd-section-title">${t('profile.agents.detail.quality.reviewsTitle')}</div>
      <div class="pf-agd-quality-desc">${t('profile.agents.detail.quality.reviewsDesc')}</div>
      ${contextKeys.length === 0
        ? html`<div class="pf-agd-empty">${t('profile.agents.detail.quality.noReviews')}</div>`
        : html`
          <div class="pf-agd-quality-reviews">
            ${contextKeys.map(ctx => {
              const s = byContext[ctx];
              return html`
                <div key=${ctx} class="pf-agd-quality-review-row">
                  <div class="pf-agd-quality-review-head">
                    <span class="pf-agd-quality-ctx">${ctxLabel(ctx)}</span>
                    <span class="pf-agd-quality-stars">${starGlyphs(s.avgStars)}</span>
                    <span class="pf-agd-quality-avg">${Number(s.avgStars).toFixed(1)}</span>
                    <span class="pf-agd-quality-n">${t('profile.agents.detail.quality.ratings', { count: s.n })}</span>
                    ${s.lowConfidence && html`<span class="pf-agd-quality-lowconf">${t('profile.agents.detail.quality.lowConfidence')}</span>`}
                  </div>
                  <div class="pf-agd-quality-review-meta">${t('profile.agents.detail.quality.grounded', { count: s.sourceGroundedN })}</div>
                </div>
              `;
            })}
            <div class="pf-agd-quality-overall">
              ${t('profile.agents.detail.quality.overall')}: ${starGlyphs(reviews.overall?.avgStars || 0)} ${Number(reviews.overall?.avgStars || 0).toFixed(1)} (${t('profile.agents.detail.quality.ratings', { count: reviews.overall?.n || 0 })})
            </div>
          </div>
        `}

      <!-- Rate deliverables (completed tasks the owner can rate) -->
      <div class="pf-agd-section-title">${t('profile.agents.detail.quality.pendingTitle')}</div>
      <div class="pf-agd-quality-desc">${t('profile.agents.detail.quality.pendingDesc')}</div>
      ${doneTasks.length === 0
        ? html`<div class="pf-agd-empty">${t('profile.agents.detail.quality.allRated')}</div>`
        : html`
          <div class="pf-agd-quality-pending">
            ${[...doneTasks].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0)).map(task => html`
              <div key=${task.id} class="pf-agd-quality-pending-row">
                <span class="pf-agd-quality-pending-title">${task.title || task.id}</span>
                ${task.rating
                  ? html`<span class="pf-agd-quality-pending-rated">${starGlyphs(task.rating.stars)} ${ctxLabel(task.rating.context)}</span>`
                  : html`<span class="pf-agd-quality-pending-unrated">${t('profile.agents.detail.quality.unrated')}</span>`}
                <button class="btn-outline btn-sm" onClick=${() => setRateTarget(task)}>
                  ${task.rating ? t('profile.agents.tasks.rate.rerate') : t('profile.agents.tasks.rate.button')}
                </button>
              </div>
            `)}
          </div>
        `}

      <!-- Custom metrics -->
      <div class="pf-agd-section-title">${t('profile.agents.detail.quality.customTitle')}</div>
      <div class="pf-agd-quality-desc">${t('profile.agents.detail.quality.customDesc')}</div>
      ${custom.length === 0
        ? html`<div class="pf-agd-empty">${t('profile.agents.detail.quality.noCustom')}</div>`
        : html`
          <div class="pf-agd-quality-custom">
            ${custom.map(c => html`
              <div key=${c.key} class="pf-agd-quality-custom-row">
                <span class="pf-agd-quality-custom-key">${c.key}</span>
                <span class="pf-agd-quality-custom-val">${typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)}</span>
              </div>
            `)}
          </div>
        `}

      <${RateModal}
        open=${!!rateTarget}
        onClose=${() => setRateTarget(null)}
        onSubmit=${handleSubmitRate}
        submitting=${sendingRate}
        existing=${rateTarget?.rating}
      />
    </div>
  `;
}
