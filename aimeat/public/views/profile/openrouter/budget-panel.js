/**
 * @file budget-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI spend panel: today's total against the daily budget, per-app caps, and a
 *   30-day stacked chart. Moved out of openrouter-settings.js during the settings rework and
 *   translated — every string in it used to be hardcoded English, which made this the one part of
 *   the profile that stayed English in a Finnish session.
 *
 *   Numbers come from the server's own ledger (tokens always exact; cost is provider-reported when
 *   available and a rough estimate otherwise). Transcription spends the SAME budget as text, which is
 *   why the chart has a seconds metric and the footnote says so — a budget eaten by voice messages
 *   should not be a mystery.
 * @structure AiAppsBudgetPanel (default export of the section) · fmtCompact
 * @usage <${AiAppsBudgetPanel} />
 * @version-history
 *   v1.16.0 — 2026-09-26 — The budget part is set off by the split (.og-split, a hairline) instead of its own 2px grey rule (a unification: the lead's ruling on the one 2px grey rule).
 *   v1.15.0 — 2026-09-26 — The figure on the daily budget bar is the Meter's figure (.poster-meter-figure), the Wallet meter's look: small typewriter figures at the left instead of bold 11px in the middle (a unification: the lead's ruling on a figure written on a meter).
 *   v1.14.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 — 2026-09-26 — The last labels over a field, a meter or a chart are the row label (.poster-label): the Decide editors' field labels, the overview's quota names, the AI budget chart's title; their own looks go (a unification: Jouni's decision Row label).
 *   v1.12.0 — 2026-09-26 — A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v1.11.0 — 2026-09-25 — The classic AI settings' daily budget bar is the quota meter (.poster-box--meter.poster-box--quota, is-full from 90 %); its ground, corners and fills go, its place, height and figure stay (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-25 — The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.9.0 — 2026-09-25 — The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — The calendar's month, week and day and the spend chart's cost, tokens and seconds are the Tab (.poster-tab, the chosen one .is-on); their rows take the tabs' row gap (Jouni's decisions "Tabs and filters" and "Choice", a unification).
 *   v1.7.0 — 2026-09-25 — A table of rows is the Listing (css/components/listing.css): the P&L lines, the accountants, the usage report, the AI spend per app, the security overrides and an agent's internal jobs; figures stand at the right of their column (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.0.0 — 2026-08-01 — Extracted from openrouter-settings.js v2.0.0, translated, seconds metric added.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { swallowed } from '/js/swallowed.js';

/** Compact number (73306 → "73.3k") for token axis/labels. */
export function fmtCompact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}

/** Seconds → "1:23" / "12s", for the audio metric. */
function fmtSeconds(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 60) return `${v}s`;
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export function AiAppsBudgetPanel() {
  const [perAppOpen, setPerAppOpen] = useState(true);
  const [usage, setUsage] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('1');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [caps, setCaps] = useState({});          // app → cap input string ('' = use the daily budget)
  const [savingCaps, setSavingCaps] = useState(false);
  const [capsMsg, setCapsMsg] = useState(null);
  const [history, setHistory] = useState(null);  // GET /v1/ai/usage/history — per-day series + rollups
  const [metric, setMetric] = useState('cost');  // 'cost' | 'tokens' | 'seconds'

  useEffect(() => { reload(); }, []);

  async function reload() {
    const [u, s, hist] = await Promise.all([
      apiGet('/v1/ai/usage').catch(err => { swallowed('budget-panel: usage', err); return null; }),
      apiGet('/v1/ai/settings').catch(err => { swallowed('budget-panel: settings', err); return null; }),
      apiGet('/v1/ai/usage/history?days=30').catch(err => { swallowed('budget-panel: history', err); return null; }),
    ]);
    if (hist && hist.ok !== false && hist.data) setHistory(hist.data);
    if (u && u.ok !== false && u.data) setUsage(u.data);
    if (s && s.ok !== false && s.data) {
      setSettings(s.data);
      setBudgetInput(String(s.data.daily_budget_usd ?? 1));
      const q = s.data.app_quotas || {};
      setCaps(Object.fromEntries(Object.entries(q).map(([app, v]) =>
        [app, (v && v.daily_usd != null) ? String(v.daily_usd) : ''])));
    }
  }

  async function saveCaps() {
    setSavingCaps(true); setCapsMsg(null);
    const app_quotas = {};
    for (const [app, val] of Object.entries(caps)) {
      const s = String(val).trim();
      if (s === '') continue;                    // blank = no override → app uses the daily budget
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        setCapsMsg({ text: t('profile.openrouter.budget.capRange', { app }), error: true });
        setSavingCaps(false); return;
      }
      app_quotas[app] = { daily_usd: n };
    }
    try {
      const r = await apiPost('/v1/ai/settings', { app_quotas });
      if (r.ok === false) throw new Error(r.error?.message || t('profile.openrouter.budget.saveFailed'));
      setCapsMsg({ text: t('profile.openrouter.budget.capsSaved') });
      await reload();
    } catch (e) {
      setCapsMsg({ text: e.message || t('profile.openrouter.budget.saveFailed'), error: true });
    }
    setSavingCaps(false);
  }

  async function saveBudget() {
    setSaving(true); setMessage(null);
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      setMessage({ text: t('profile.openrouter.budget.budgetRange'), error: true });
      setSaving(false); return;
    }
    try {
      const r = await apiPost('/v1/ai/settings', { daily_budget_usd: n });
      if (r.ok === false) throw new Error(r.error?.message || t('profile.openrouter.budget.saveFailed'));
      setMessage({ text: t('profile.openrouter.budget.budgetSaved') });
      setEditing(false);
      await reload();
    } catch (e) {
      setMessage({ text: e.message || t('profile.openrouter.budget.saveFailed'), error: true });
    }
    setSaving(false);
  }

  if (!usage || !settings) return null;
  const budget = usage.daily_budget_usd;
  const spent = usage.spent_today_usd;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perAppEntries = Object.entries(usage.per_app || {});
  // Apps to offer a cap for: spent today, OR active in the last 30 days, OR already capped. Without
  // the history apps the table hides itself whenever today's spend is $0, leaving nowhere to set a
  // cap for an app that only ran on earlier days.
  const historyApps = (history && Array.isArray(history.apps)) ? history.apps : [];
  const appNames = Array.from(new Set([...perAppEntries.map(([a]) => a), ...historyApps, ...Object.keys(caps)]));

  return html`
    <div class="pf-or-field pf-or-spend-section og-split">
      <label class="poster-label pf-or-label">${t('profile.openrouter.budget.title')}</label>
      <div class="poster-hint">${t('profile.openrouter.budget.desc')}</div>

      <div class="pf-or-spend-bar-row">
        <div class=${`pf-or-spend-bar poster-box poster-box--meter poster-box--quota ${pct >= 90 ? 'is-full' : ''}`}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width=${pct} height="100" /></svg>
          <div class="poster-meter-figure">$${spent.toFixed(4)} / $${budget.toFixed(2)} (${pct}%)</div>
        </div>
        ${editing ? html`
          <input type="number" min="0" max="1000" step="0.10" value=${budgetInput}
                 onInput=${e => setBudgetInput(e.target.value)}
                 class="og-input pf-or-spend-budget-input" />
          <button class="poster-slab poster-slab--control" onClick=${saveBudget} disabled=${saving}>
            ${saving ? '…' : t('profile.openrouter.save')}
          </button>
          <button class="poster-action poster-action--small" onClick=${() => setEditing(false)}>${t('profile.openrouter.cancel')}</button>
        ` : html`
          <button class="poster-action poster-action--small" onClick=${() => setEditing(true)}>${t('profile.openrouter.budget.change')}</button>
        `}
      </div>

      ${message && html`<div class="form-message ${message.error ? 'form-message--error' : ''}">${message.text}</div>`}

      ${appNames.length > 0 && html`
        <details class="pf-or-spend-details" open onToggle=${(e) => setPerAppOpen(e.currentTarget.open)}>
          <summary class=${`poster-tab poster-tab--fold ${perAppOpen ? 'is-on' : ''}`}>${t('profile.openrouter.budget.perApp', { n: appNames.length })}</summary>
          <div class="poster-hint">${t('profile.openrouter.budget.perAppHint')}</div>
          <div class="listing listing--cols listing--name-n-n-n pf-or-spend-table">
              <div class="listing-row listing-row--head">
                <div class="poster-label">${t('profile.openrouter.budget.colApp')}</div>
                <div class="poster-label listing-n">${t('profile.openrouter.budget.colSpent')}</div>
                <div class="poster-label listing-n">${t('profile.openrouter.budget.colCap')}</div>
                <div class="poster-label listing-n">${t('profile.openrouter.budget.colCalls')}</div>
              </div>
              ${appNames.map((app) => {
                const s = usage.per_app[app] || { cost_usd: 0, calls: 0 };
                return html`
                <div class="listing-row" key=${app}>
                  <div class="listing-name">${app}</div>
                  <div class="listing-n">$${(s.cost_usd || 0).toFixed(4)}</div>
                  <div class="listing-n">
                    <input type="number" min="0" max="1000" step="0.10"
                      value=${caps[app] ?? ''} placeholder=${budget.toFixed(2)}
                      onInput=${e => setCaps(c => ({ ...c, [app]: e.target.value }))}
                      class="og-input pf-or-spend-cap-input" />
                  </div>
                  <div class="listing-n">${s.calls || 0}</div>
                </div>`;
              })}
          </div>
          <div class="pf-or-spend-actions">
            <button class="poster-slab poster-slab--control" onClick=${saveCaps} disabled=${savingCaps}>
              ${savingCaps ? '…' : t('profile.openrouter.budget.saveCaps')}
            </button>
            ${capsMsg && html`<span class="form-message ${capsMsg.error ? 'form-message--error' : ''}">${capsMsg.text}</span>`}
          </div>
        </details>
      `}

      ${history && Array.isArray(history.days) && history.days.length > 0 && (() => {
        const labels = history.days.map((d) => d.date.slice(5));
        const chartApps = history.apps || [];
        const pick = (m) => (metric === 'tokens' ? m.tokens : metric === 'seconds' ? m.audio_seconds : m.cost_usd) || 0;
        const datasets = chartApps.map((app, i) => ({
          label: app,
          data: history.days.map((d) => pick((d.per_app && d.per_app[app]) || {})),
          backgroundColor: colorForIndex(i),
        }));
        const yFormat = metric === 'tokens' ? ((v) => fmtCompact(v))
          : metric === 'seconds' ? ((v) => fmtSeconds(v))
          : ((v) => '$' + (Number(v) < 1 ? Number(v).toFixed(3) : Number(v).toFixed(2)));
        const btn = (key, label) => html`
          <button class=${`poster-tab${metric === key ? ' is-on' : ''}`}
                  onClick=${() => setMetric(key)}>${label}</button>`;
        return html`
          <div class="pf-or-spend-chart-wrap">
            <div class="pf-or-spend-chart-head">
              <span class="poster-label">${t('profile.openrouter.budget.chartTitle')}</span>
              <span class="pf-or-spend-metric-toggle">
                ${btn('cost', t('profile.openrouter.budget.metricCost'))}
                ${btn('tokens', t('profile.openrouter.budget.metricTokens'))}
                ${btn('seconds', t('profile.openrouter.budget.metricSeconds'))}
              </span>
            </div>
            <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${220} yFormat=${yFormat} />
          </div>`;
      })()}

      <div class="poster-hint">${t('profile.openrouter.budget.footnote')}</div>
    </div>
  `;
}
