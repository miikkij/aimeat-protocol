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
    <div class="pf-or-field pf-or-spend-section">
      <label class="pf-or-label">${t('profile.openrouter.budget.title')}</label>
      <div class="pf-or-spend-desc">${t('profile.openrouter.budget.desc')}</div>

      <div class="pf-or-spend-bar-row">
        <div class="pf-or-spend-bar">
          <div class="pf-or-spend-bar-fill ${pct >= 90 ? 'crit' : pct >= 60 ? 'warn' : ''}" style="width:${pct}%"></div>
          <div class="pf-or-spend-bar-label">$${spent.toFixed(4)} / $${budget.toFixed(2)} (${pct}%)</div>
        </div>
        ${editing ? html`
          <input type="number" min="0" max="1000" step="0.10" value=${budgetInput}
                 onInput=${e => setBudgetInput(e.target.value)}
                 class="pf-or-spend-budget-input" />
          <button class="btn-primary btn-sm" onClick=${saveBudget} disabled=${saving}>
            ${saving ? '…' : t('profile.openrouter.save')}
          </button>
          <button class="btn-outline btn-sm" onClick=${() => setEditing(false)}>${t('profile.openrouter.cancel')}</button>
        ` : html`
          <button class="btn-outline btn-sm" onClick=${() => setEditing(true)}>${t('profile.openrouter.budget.change')}</button>
        `}
      </div>

      ${message && html`<div class="pf-or-message pf-or-spend-msg ${message.error ? 'pf-or-message-error' : 'pf-or-message-success'}">${message.text}</div>`}

      ${appNames.length > 0 && html`
        <details class="pf-or-spend-details" open>
          <summary class="pf-or-spend-summary">${t('profile.openrouter.budget.perApp', { n: appNames.length })}</summary>
          <div class="pf-or-spend-hint">${t('profile.openrouter.budget.perAppHint')}</div>
          <table class="pf-or-spend-table">
            <thead>
              <tr>
                <th>${t('profile.openrouter.budget.colApp')}</th>
                <th class="num">${t('profile.openrouter.budget.colSpent')}</th>
                <th class="num">${t('profile.openrouter.budget.colCap')}</th>
                <th class="num">${t('profile.openrouter.budget.colCalls')}</th>
              </tr>
            </thead>
            <tbody>
              ${appNames.map((app) => {
                const s = usage.per_app[app] || { cost_usd: 0, calls: 0 };
                return html`
                <tr key=${app}>
                  <td>${app}</td>
                  <td class="num">$${(s.cost_usd || 0).toFixed(4)}</td>
                  <td class="num">
                    <input type="number" min="0" max="1000" step="0.10"
                      value=${caps[app] ?? ''} placeholder=${budget.toFixed(2)}
                      onInput=${e => setCaps(c => ({ ...c, [app]: e.target.value }))}
                      class="pf-or-spend-cap-input" />
                  </td>
                  <td class="num">${s.calls || 0}</td>
                </tr>`;
              })}
            </tbody>
          </table>
          <div class="pf-or-spend-actions">
            <button class="btn-primary btn-sm" onClick=${saveCaps} disabled=${savingCaps}>
              ${savingCaps ? '…' : t('profile.openrouter.budget.saveCaps')}
            </button>
            ${capsMsg && html`<span class="pf-or-message ${capsMsg.error ? 'pf-or-message-error' : 'pf-or-message-success'}">${capsMsg.text}</span>`}
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
          <button class=${metric === key ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
                  onClick=${() => setMetric(key)}>${label}</button>`;
        return html`
          <div class="pf-or-spend-chart-wrap">
            <div class="pf-or-spend-chart-head">
              <span class="pf-or-spend-chart-title">${t('profile.openrouter.budget.chartTitle')}</span>
              <span class="pf-or-spend-metric-toggle">
                ${btn('cost', t('profile.openrouter.budget.metricCost'))}
                ${btn('tokens', t('profile.openrouter.budget.metricTokens'))}
                ${btn('seconds', t('profile.openrouter.budget.metricSeconds'))}
              </span>
            </div>
            <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${220} yFormat=${yFormat} />
          </div>`;
      })()}

      <div class="pf-or-spend-footnote">${t('profile.openrouter.budget.footnote')}</div>
    </div>
  `;
}
