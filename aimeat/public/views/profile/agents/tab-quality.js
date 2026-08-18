/**
 * @file tab-quality.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.5.0 -- 2026-07-17 -- Card layout: performance full-width, reviews|rate side by
 *     side, custom metrics full-width (shared pf-agd-card-grid scheme).
 *   v1.4.0 -- 2026-07-16 -- Mount folds statistics + done-tasks into GET /v1/agents/:name/quality/overview
 *     (getQualityOverview); individual statistics + done-tasks reads kept as fallback.
 *   v1.3.0 -- 2026-06-10 -- Deliverable rows show date+time (identical titles must be
 *     tellable apart) and unrated rows rate via INLINE stars (click submits immediately);
 *     the modal remains for re-rates (context/comment).
 *   v1.2.0 -- 2026-06-01 -- Stop the empty flash on refresh: only show the loading
 *     state on first load; live-update refetches swap data in place (and keep the
 *     last good data on a transient error) instead of blanking the tab.
 *   v1.1.0 -- 2026-05-31 -- Add "Rate deliverables" list: completed tasks the owner
 *     can rate inline via the shared RateModal (unrated first); refreshes the
 *     rollups on submit.
 *   v1.0.0 -- 2026-05-31 -- Initial Quality tab (per-context reviews + performance + custom)
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { getAgentStatistics, getQualityOverview, listTasks, rateTask } from '/js/services/agent-tasks.js';
import RateModal from './rate-modal.js';
import { swallowed } from '/js/swallowed.js';

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

/** Date + time for a deliverable row — four identical "Iltakirjoitus" rows must be tellable apart. */
function fmtWhen(s) {
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Inline 1–5 star picker — hovering previews, clicking submits right in the row (no modal hop).
 *  The full modal stays available for re-rates (context/comment edits). */
function InlineStars({ onPick, disabled }) {
  const [hover, setHover] = useState(0);
  return html`
    <span class="pf-agd-inline-stars" role="radiogroup" onMouseLeave=${() => setHover(0)}>
      ${[1, 2, 3, 4, 5].map(n => html`
        <button key=${n} class="pf-agd-inline-star ${n <= hover ? 'pf-agd-inline-star--hot' : ''}"
          disabled=${disabled} aria-label=${String(n)}
          onMouseEnter=${() => setHover(n)}
          onClick=${() => onPick(n)}>★</button>
      `)}
    </span>`;
}

export default function TabQuality({ agentName, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doneTasks, setDoneTasks] = useState([]);
  const [rateTarget, setRateTarget] = useState(null); // task being rated, or null
  const [sendingRate, setSendingRate] = useState(false);

  const loadData = useCallback(async () => {
    // NB: do NOT blank `data`/`loading` here. The initial render shows the
    // loading state (loading starts true); every later call -- including
    // live-update refetches -- swaps in fresh data in place without flashing an
    // empty tab. A transient error keeps the last good data rather than clearing.
    try {
      // Mount fold: ONE composite (recomputed statistics + done tasks). On failure, fall back to the
      // individual two-request fan-out.
      const ov = await getQualityOverview(agentName);
      if (ov) {
        if (ov.statistics) setData(ov.statistics);
        setDoneTasks(ov.done_tasks || []);
      } else {
        const [statsResp, tasksResp] = await Promise.all([
          getAgentStatistics(agentName),
          listTasks(agentName, { status: 'done', per_page: 100 }).catch(err => { swallowed('tab-quality: TabQuality', err); return null; }),
        ]);
        if (statsResp?.data) setData(statsResp.data);
        setDoneTasks(tasksResp?.data?.tasks || []);
      }
    } catch (err) { swallowed('tab-quality: TabQuality', err); }
    setLoading(false);
  }, [agentName]);

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

  // Inline star click — submit immediately with the task's context (or 'other'); the modal
  // remains the path for context/comment edits via re-rate.
  async function handleInlineRate(task, stars) {
    setSendingRate(true);
    try {
      await rateTask(agentName, task.id, { stars, context: task.context || 'other', source_grounded: false });
      showToast?.(t('profile.agents.tasks.rate.success'));
      await loadData();
    } catch (err) {
      showToast?.(err.message || t('profile.agents.tasks.rate.error'), true);
    }
    setSendingRate(false);
  }

  useEffect(() => { loadData(); }, [loadData]);

  // Live updates: refresh when a rating lands or tasks change.
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['agents'], () => loadRef.current()), []);

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
    <div class="pf-agd-quality pf-agd-card-grid">
      <!-- Performance -->
      <div class="pf-agd-card pf-agd-card--full">
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

      </div>

      <!-- Reviews by context -->
      <div class="pf-agd-card">
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

      </div>

      <!-- Rate deliverables (completed tasks the owner can rate) -->
      <div class="pf-agd-card">
      <div class="pf-agd-section-title">${t('profile.agents.detail.quality.pendingTitle')}</div>
      <div class="pf-agd-quality-desc">${t('profile.agents.detail.quality.pendingDesc')}</div>
      ${doneTasks.length === 0
        ? html`<div class="pf-agd-empty">${t('profile.agents.detail.quality.allRated')}</div>`
        : html`
          <div class="pf-agd-quality-pending">
            ${[...doneTasks].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0)).map(task => html`
              <div key=${task.id} class="pf-agd-quality-pending-row">
                <span class="pf-agd-quality-pending-title">${task.title || task.id}</span>
                <span class="pf-agd-quality-pending-when" title=${task.completedAt || ''}>${fmtWhen(task.completedAt || task.updatedAt)}</span>
                ${task.rating
                  ? html`
                    <span class="pf-agd-quality-pending-rated">${starGlyphs(task.rating.stars)} ${ctxLabel(task.rating.context)}</span>
                    <button class="btn-ghost btn-sm" onClick=${() => setRateTarget(task)}>${t('profile.agents.tasks.rate.rerate')}</button>`
                  : html`<${InlineStars} onPick=${(n) => handleInlineRate(task, n)} disabled=${sendingRate} />`}
              </div>
            `)}
          </div>
        `}

      </div>

      <!-- Custom metrics -->
      <div class="pf-agd-card pf-agd-card--full">
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

      </div>

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
