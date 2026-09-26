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
 *   v1.19.0 -- 2026-09-26 -- The line under a review's context is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.18.0 -- 2026-09-26 -- Every star rating is the library's Rating stars (css/components/rating-stars.css): the reviews, the overall line and a rated row in the shown tone, dark and grey; the inline picker in the tone to give, dark up to the star under the pointer (a unification: Jouni's decision "Rating stars").
 *   v1.17.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger), a unification: Jouni's decision Status.
 *   v1.12.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The custom metrics are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
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
import { num, dateTime as fmtDateTime } from '/js/format.js';

const html = htm.bind(h);

/** An average star value (rounded to the nearest whole star) as the Rating stars' shown tone
 *  (css/components/rating-stars.css): the given stars dark, the others grey. */
function starGlyphs(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return html`<span class="op-stars op-stars--shown" role="img" aria-label=${`${full}/5`}>${[1, 2, 3, 4, 5].map(n => html`<span key=${n} class=${`op-star${n <= full ? ' on' : ''}`} aria-hidden="true">★</span>`)}</span>`;
}

/** Localised context label, falling back to the raw enum value. */
function ctxLabel(ctx) {
  const key = `profile.agents.detail.quality.contexts.${ctx}`;
  const label = t(key);
  return label !== key ? label : ctx;
}

function fmtSeconds(secs) {
  return `${num(Number(secs || 0))}${t('profile.agents.detail.quality.seconds')}`;
}

/** Date + time for a deliverable row — four identical "Iltakirjoitus" rows must be tellable apart. */
function fmtWhen(s) {
  if (!s) return '';
  return fmtDateTime(s, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Inline 1–5 star picker — hovering previews, clicking submits right in the row (no modal hop).
 *  The full modal stays available for re-rates (context/comment edits). */
function InlineStars({ onPick, disabled }) {
  const [hover, setHover] = useState(0);
  return html`
    <span class="op-stars" role="radiogroup" onMouseLeave=${() => setHover(0)}>
      ${[1, 2, 3, 4, 5].map(n => html`
        <button key=${n} class="op-star ${n <= hover ? 'on' : ''}"
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
    return html`<div class="poster-quiet pf-agd-empty loading-mark">${t('profile.loading')}</div>`;
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
      <div class="pf-agd-card pf-agd-card--full poster-row--thing">
      <div class="pf-agd-section-title sub-heading">${t('profile.agents.detail.quality.performanceTitle')}</div>
      <div class="poster-hint pf-agd-quality-desc">${t('profile.agents.detail.quality.performanceDesc')}</div>
      <div class="og-strip pf-figures">
        <div>
          <b>${perf.tasks?.total ?? 0}</b>
          <span>${t('profile.agents.detail.quality.tasksTotal')}</span>
        </div>
        <div>
          <b>${perf.tasks?.completed ?? 0}</b>
          <span>${t('profile.agents.detail.quality.tasksCompleted')}</span>
        </div>
        <div>
          <b>${perf.tasks?.successRate != null ? `${Math.round(perf.tasks.successRate * 100)}%` : '-'}</b>
          <span>${t('profile.agents.detail.quality.successRate')}</span>
        </div>
        <div>
          <b>${fmtSeconds(perf.duration?.avgCompletionSeconds)}</b>
          <span>${t('profile.agents.detail.quality.avgTime')}</span>
        </div>
        <div>
          <b>${perf.events?.total ?? 0}</b>
          <span>${t('profile.agents.detail.quality.events')}</span>
        </div>
      </div>
      ${durKeys.length > 0 && html`
        <div class="pf-agd-quality-durations">
          ${durKeys.map(ctx => html`
            <span key=${ctx} class="poster-chip">
              ${ctxLabel(ctx)}: ${fmtSeconds(durByContext[ctx].avgSeconds)} (${durByContext[ctx].count})
            </span>
          `)}
        </div>
      `}

      </div>

      <!-- Reviews by context -->
      <div class="pf-agd-card poster-row--thing">
      <div class="pf-agd-section-title sub-heading">${t('profile.agents.detail.quality.reviewsTitle')}</div>
      <div class="poster-hint pf-agd-quality-desc">${t('profile.agents.detail.quality.reviewsDesc')}</div>
      ${contextKeys.length === 0
        ? html`<div class="poster-quiet pf-agd-empty">${t('profile.agents.detail.quality.noReviews')}</div>`
        : html`
          <div class="pf-agd-quality-reviews">
            ${contextKeys.map(ctx => {
              const s = byContext[ctx];
              return html`
                <div key=${ctx} class="pf-agd-quality-review-row">
                  <div class="pf-agd-quality-review-head">
                    <span class="pf-agd-quality-ctx">${ctxLabel(ctx)}</span>
                    ${starGlyphs(s.avgStars)}
                    <span class="pf-agd-quality-avg">${Number(s.avgStars).toFixed(1)}</span>
                    <span class="pf-agd-quality-n">${t('profile.agents.detail.quality.ratings', { count: s.n })}</span>
                    ${s.lowConfidence && html`<span class="poster-status poster-status--attention">${t('profile.agents.detail.quality.lowConfidence')}</span>`}
                  </div>
                  <div class="pf-agd-quality-review-meta listing-meta">${t('profile.agents.detail.quality.grounded', { count: s.sourceGroundedN })}</div>
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
      <div class="pf-agd-card poster-row--thing">
      <div class="pf-agd-section-title sub-heading">${t('profile.agents.detail.quality.pendingTitle')}</div>
      <div class="poster-hint pf-agd-quality-desc">${t('profile.agents.detail.quality.pendingDesc')}</div>
      ${doneTasks.length === 0
        ? html`<div class="poster-quiet pf-agd-empty">${t('profile.agents.detail.quality.allRated')}</div>`
        : html`
          <div class="pf-agd-quality-pending">
            ${[...doneTasks].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0)).map(task => html`
              <div key=${task.id} class="pf-agd-quality-pending-row poster-box">
                <span class="pf-agd-quality-pending-title">${task.title || task.id}</span>
                <span class="pf-agd-quality-pending-when poster-time" title=${task.completedAt || ''}>${fmtWhen(task.completedAt || task.updatedAt)}</span>
                ${task.rating
                  ? html`
                    <span class="pf-agd-quality-pending-rated">${starGlyphs(task.rating.stars)} ${ctxLabel(task.rating.context)}</span>
                    <button class="poster-action poster-action--small" onClick=${() => setRateTarget(task)}>${t('profile.agents.tasks.rate.rerate')}</button>`
                  : html`<${InlineStars} onPick=${(n) => handleInlineRate(task, n)} disabled=${sendingRate} />`}
              </div>
            `)}
          </div>
        `}

      </div>

      <!-- Custom metrics -->
      <div class="pf-agd-card pf-agd-card--full poster-row--thing">
      <div class="pf-agd-section-title sub-heading">${t('profile.agents.detail.quality.customTitle')}</div>
      <div class="poster-hint pf-agd-quality-desc">${t('profile.agents.detail.quality.customDesc')}</div>
      ${custom.length === 0
        ? html`<div class="poster-quiet pf-agd-empty">${t('profile.agents.detail.quality.noCustom')}</div>`
        : html`
          <div class="facts">
            ${custom.map(c => html`
              <span class="facts-k poster-label" key=${'k' + c.key}>${c.key}</span>
              <span class="facts-v" key=${c.key}>${typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)}</span>
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
