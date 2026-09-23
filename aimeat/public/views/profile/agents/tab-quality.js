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
 *   2026-09-22 -- Composed from the shared component set: sections, a small numeral band, list rows
 *     and key-value rows; the stars are drawn as inline SVG instead of typed glyphs.
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
import { Stack, Section, Columns, ListRow, NumeralBand, KeyValue, Chip, Action, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

const STAR_PATH = 'M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.8l-5.2 2.8 1-5.8L1.5 7.7l5.9-.9z';

/** One star as an inline SVG: filled when `on`, outlined when not. */
function starSvg(on, size = 14) {
  return html`<svg viewBox="0 0 20 20" width=${size} height=${size} aria-hidden="true"
    fill=${on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.4"><path d=${STAR_PATH} /></svg>`;
}

/** A row of five stars for an average star value (rounded to nearest whole star). Drawn, not typed,
 *  because the only glyphs in text are the four the design language allows. */
function Stars({ value }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return html`<span role="img" aria-label=${String(full) + '/5'}>${[1, 2, 3, 4, 5].map(n => html`<span key=${n}>${starSvg(n <= full)}</span>`)}</span>`;
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

/** Inline 1-5 star picker: hovering previews, clicking submits right in the row (no modal hop).
 *  The full modal stays available for re-rates (context/comment edits). */
function InlineStars({ onPick, disabled }) {
  const [hover, setHover] = useState(0);
  return html`
    <span role="radiogroup" onMouseLeave=${() => setHover(0)}>
      ${[1, 2, 3, 4, 5].map(n => html`
        <span key=${n} onMouseEnter=${() => setHover(n)}>
          <${Action} kind="icon" selected=${n <= hover} disabled=${disabled} label=${String(n)}
            onClick=${() => onPick(n)}>${starSvg(n <= hover, 16)}<//>
        </span>
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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  const perf = data?.performance || {};
  const reviews = data?.reviews || {};
  const custom = data?.custom || [];
  const byContext = reviews.byContext || {};
  const contextKeys = Object.keys(byContext);
  const durByContext = perf.duration?.byContext || {};
  const durKeys = Object.keys(durByContext);

  return html`
    <${Stack}>
      <${Section} size="small" density="compact" title=${t('profile.agents.detail.quality.performanceTitle')}
        description=${t('profile.agents.detail.quality.performanceDesc')}>
        <${NumeralBand} size="small" tone="plain" items=${[
          { id: 'total', label: t('profile.agents.detail.quality.tasksTotal'), value: perf.tasks?.total ?? 0 },
          { id: 'completed', label: t('profile.agents.detail.quality.tasksCompleted'), value: perf.tasks?.completed ?? 0 },
          { id: 'rate', label: t('profile.agents.detail.quality.successRate'), value: perf.tasks?.successRate != null ? `${Math.round(perf.tasks.successRate * 100)}%` : '-' },
          { id: 'time', label: t('profile.agents.detail.quality.avgTime'), value: fmtSeconds(perf.duration?.avgCompletionSeconds) },
          { id: 'events', label: t('profile.agents.detail.quality.events'), value: perf.events?.total ?? 0 },
        ]} />
        ${durKeys.length > 0 && html`
          <${Stack} direction="wrap" density="compact">
            ${durKeys.map(ctx => html`
              <${Chip} key=${ctx}>${ctxLabel(ctx)}: ${fmtSeconds(durByContext[ctx].avgSeconds)} (${durByContext[ctx].count})<//>
            `)}
          <//>
        `}
      <//>

      <${Columns} layout="equal" collapse="900">
        <${Section} size="small" density="compact" title=${t('profile.agents.detail.quality.reviewsTitle')}
          description=${t('profile.agents.detail.quality.reviewsDesc')}>
          ${contextKeys.length === 0
            ? html`<${Text} tone="muted">${t('profile.agents.detail.quality.noReviews')}<//>`
            : html`
              ${contextKeys.map(ctx => {
                const s = byContext[ctx];
                return html`
                  <${ListRow} key=${ctx} density="compact" name=${ctxLabel(ctx)} detailKind="text"
                    detail=${html`${t('profile.agents.detail.quality.ratings', { count: s.n })} · ${t('profile.agents.detail.quality.grounded', { count: s.sourceGroundedN })}`}
                    value=${html`<${Stack} direction="horizontal" align="center" density="compact">
                      <${Stars} value=${s.avgStars} />
                      <${Text} kind="mono">${Number(s.avgStars).toFixed(1)}<//>
                      ${s.lowConfidence && html`<${Chip} tone="muted">${t('profile.agents.detail.quality.lowConfidence')}<//>`}
                    <//>`} />
                `;
              })}
              <${Text}>
                ${t('profile.agents.detail.quality.overall')}: <${Stars} value=${reviews.overall?.avgStars || 0} /> ${Number(reviews.overall?.avgStars || 0).toFixed(1)} (${t('profile.agents.detail.quality.ratings', { count: reviews.overall?.n || 0 })})
              <//>
            `}
        <//>

        <${Section} size="small" density="compact" title=${t('profile.agents.detail.quality.pendingTitle')}
          description=${t('profile.agents.detail.quality.pendingDesc')}>
          ${doneTasks.length === 0
            ? html`<${Text} tone="muted">${t('profile.agents.detail.quality.allRated')}<//>`
            : [...doneTasks].sort((a, b) => (a.rating ? 1 : 0) - (b.rating ? 1 : 0)).map(task => html`
              <${ListRow} key=${task.id} density="compact" name=${task.title || task.id}
                detail=${html`<span title=${task.completedAt || ''}>${fmtWhen(task.completedAt || task.updatedAt)}</span>`}
                value=${task.rating && html`<${Stack} direction="horizontal" align="center" density="compact">
                  <${Stars} value=${task.rating.stars} /><${Text} kind="caption">${ctxLabel(task.rating.context)}<//>
                <//>`}
                actions=${task.rating
                  ? html`<${Action} kind="text" onClick=${() => setRateTarget(task)}>${t('profile.agents.tasks.rate.rerate')}<//>`
                  : html`<${InlineStars} onPick=${(n) => handleInlineRate(task, n)} disabled=${sendingRate} />`} />
            `)}
        <//>
      <//>

      <${Section} size="small" density="compact" title=${t('profile.agents.detail.quality.customTitle')}
        description=${t('profile.agents.detail.quality.customDesc')}>
        ${custom.length === 0
          ? html`<${Text} tone="muted">${t('profile.agents.detail.quality.noCustom')}<//>`
          : custom.map(c => html`
            <${KeyValue} key=${c.key} label=${c.key} mono
              value=${typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)} />
          `)}
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
