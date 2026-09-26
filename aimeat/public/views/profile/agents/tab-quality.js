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
 *   v1.20.0 -- 2026-09-26 -- Onto the components: section Cards in a CardGrid, the figures the
 *     FigureStrip (lead), the durations Marks, the reviews and the deliverables to rate a List (the
 *     count and the context word the meta Note), every star rating the Stars (shown, or to give: the
 *     pointer preview is the sheet's hover rule), the custom metrics the Facts, the lines the Note. The file
 *     writes no class any more.
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
import { Card, CardGrid } from '/components/Card.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Stars } from '/components/Stars.js';

const html = htm.bind(h);

/** An average star value (rounded to the nearest whole star) as the Rating stars' shown tone. */
function starGlyphs(value) {
  return html`<${Stars} value=${value} />`;
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
    return html`<${Note} kind="loading" />`;
  }

  const perf = data?.performance || {};
  const reviews = data?.reviews || {};
  const custom = data?.custom || [];
  const byContext = reviews.byContext || {};
  const contextKeys = Object.keys(byContext);
  const durByContext = perf.duration?.byContext || {};
  const durKeys = Object.keys(durByContext);

  return html`
    <${CardGrid} cols="sections">
      <!-- Performance -->
      <${Card} tone="section" wide title=${t('profile.agents.detail.quality.performanceTitle')}>
        <${Note}>${t('profile.agents.detail.quality.performanceDesc')}<//>
        <${FigureStrip} lead items=${[
          { key: 'total', n: perf.tasks?.total ?? 0, label: t('profile.agents.detail.quality.tasksTotal') },
          { key: 'done', n: perf.tasks?.completed ?? 0, label: t('profile.agents.detail.quality.tasksCompleted') },
          { key: 'rate', n: perf.tasks?.successRate != null ? `${Math.round(perf.tasks.successRate * 100)}%` : '-', label: t('profile.agents.detail.quality.successRate') },
          { key: 'avg', n: fmtSeconds(perf.duration?.avgCompletionSeconds), label: t('profile.agents.detail.quality.avgTime') },
          { key: 'events', n: perf.events?.total ?? 0, label: t('profile.agents.detail.quality.events') },
        ]} />
        ${durKeys.length > 0 && html`
          <${Marks}>
            ${durKeys.map(ctx => html`
              <${Mark} key=${ctx}>${ctxLabel(ctx)}: ${fmtSeconds(durByContext[ctx].avgSeconds)} (${durByContext[ctx].count})<//>
            `)}
          <//>
        `}
      <//>

      <!-- Reviews by context -->
      <${Card} tone="section" title=${t('profile.agents.detail.quality.reviewsTitle')}>
        <${Note}>${t('profile.agents.detail.quality.reviewsDesc')}<//>
        ${contextKeys.length === 0
          ? html`<${Note} kind="quiet">${t('profile.agents.detail.quality.noReviews')}<//>`
          : html`
            <${List} cols="name">
              ${contextKeys.map(ctx => {
                const s = byContext[ctx];
                return html`
                  <${Row} key=${ctx}>
                    <${Name} meta=${t('profile.agents.detail.quality.grounded', { count: s.sourceGroundedN })}
                      after=${html` ${starGlyphs(s.avgStars)} <b>${Number(s.avgStars).toFixed(1)}</b> <${Note} kind="meta" inline>${t('profile.agents.detail.quality.ratings', { count: s.n })}<//>${s.lowConfidence ? html` <${Mark} kind="status" tone="attention">${t('profile.agents.detail.quality.lowConfidence')}<//>` : null}`}>
                      ${ctxLabel(ctx)}
                    <//>
                  <//>
                `;
              })}
            <//>
            <${Note}>
              ${t('profile.agents.detail.quality.overall')}: ${starGlyphs(reviews.overall?.avgStars || 0)} ${Number(reviews.overall?.avgStars || 0).toFixed(1)} (${t('profile.agents.detail.quality.ratings', { count: reviews.overall?.n || 0 })})
            <//>
          `}
      <//>

      <!-- Rate deliverables (completed tasks the owner can rate) -->
      <${Card} tone="section" title=${t('profile.agents.detail.quality.pendingTitle')}>
        <${Note}>${t('profile.agents.detail.quality.pendingDesc')}<//>
        <${List} cols="name-doors" dense empty=${t('profile.agents.detail.quality.allRated')}>
          ${[...doneTasks].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0)).map(task => html`
            <${Row} key=${task.id}>
              <${Name} title=${task.completedAt || ''} meta=${fmtWhen(task.completedAt || task.updatedAt)}>${task.title || task.id}<//>
              <${Doors}>
                ${task.rating
                  ? html`
                    ${starGlyphs(task.rating.stars)} <${Note} kind="meta" inline>${ctxLabel(task.rating.context)}<//>
                    <${Action} small onClick=${() => setRateTarget(task)}>${t('profile.agents.tasks.rate.rerate')}<//>`
                  : html`<${Stars} onPick=${(n) => handleInlineRate(task, n)} disabled=${sendingRate} />`}
              <//>
            <//>
          `)}
        <//>
      <//>

      <!-- Custom metrics -->
      <${Card} tone="section" wide title=${t('profile.agents.detail.quality.customTitle')}>
        <${Note}>${t('profile.agents.detail.quality.customDesc')}<//>
        ${custom.length === 0
          ? html`<${Note} kind="quiet">${t('profile.agents.detail.quality.noCustom')}<//>`
          : html`<${Facts} rows=${custom.map(c => ({ key: c.key, k: c.key, v: typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value) }))} />`}
      <//>

      <${RateModal}
        open=${!!rateTarget}
        onClose=${() => setRateTarget(null)}
        onSubmit=${handleSubmitRate}
        submitting=${sendingRate}
        existing=${rateTarget?.rating}
      />
    <//>
  `;
}
