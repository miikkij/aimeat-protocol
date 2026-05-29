/**
 * @file generator-settings.js
 * @description Settings components for the service generator — OpenRouter/LM Studio
 *   AI provider configuration and blueprint-defined service/user settings collection.
 * @structure
 *   - OpenRouterSettings: collapsible panel for AI provider, API key, model, auto-retry
 *   - SettingsCollectionView: renders blueprint-defined settings fields, saves values
 * @usage
 *   import { OpenRouterSettings, SettingsCollectionView } from './generator-settings.js';
 * @version-history
 *   v1.1.0 — 2026-04-01 — Add temperature, top_p, max_tokens model parameter fields
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js (was inline in v5.1.0+)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { saveProjectSettings, getProjectSettings } from '/js/services/generator.js';

/* ── OpenRouter / LM Studio / Custom Settings ────────── */

export function OpenRouterSettings({ onSettingsChange }) {
  const [collapsed, setCollapsed] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [autoRetry, setAutoRetry] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [provider, setProvider] = useState('openrouter');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState('');
  const [topP, setTopP] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { text, error }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const resp = await apiGet('/v1/openrouter/settings');
      if (resp.ok !== false && resp.data) {
        setHasApiKey(!!resp.data.hasApiKey);
        setModel(resp.data.model || '');
        setAutoRetry(!!resp.data.autoRetry);
        setMaxRetries(resp.data.maxRetries || 3);
        setProvider(resp.data.provider || 'openrouter');
        setBaseUrl(resp.data.baseUrl || '');
        if (resp.data.temperature != null) setTemperature(String(resp.data.temperature));
        if (resp.data.top_p != null) setTopP(String(resp.data.top_p));
        if (resp.data.max_tokens != null) setMaxTokens(String(resp.data.max_tokens));
        if (resp.data.hasApiKey) loadModels();
      }
    } catch { /* no settings yet */ }
    setLoaded(true);
  }

  // Notify parent whenever key settings change
  useEffect(() => {
    if (loaded && onSettingsChange) {
      onSettingsChange({ hasApiKey: hasApiKey, autoRetry, maxRetries, provider, baseUrl });
    }
  }, [loaded, hasApiKey, autoRetry, maxRetries, provider, baseUrl]);

  async function loadModels() {
    setModelsLoading(true);
    try {
      const resp = await apiGet('/v1/openrouter/models');
      if (resp.ok !== false && resp.data?.models) {
        setModels(resp.data.models);
      }
    } catch { /* couldn't fetch models */ }
    setModelsLoading(false);
  }

  function showMsg(text, error = false) {
    setMessage({ text, error });
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = { model, autoRetry, maxRetries: parseInt(maxRetries) || 3, provider, baseUrl };
      body.temperature = temperature !== '' ? parseFloat(temperature) : null;
      body.top_p = topP !== '' ? parseFloat(topP) : null;
      body.max_tokens = maxTokens !== '' ? parseInt(maxTokens) : null;
      if (apiKey) body.apiKey = apiKey;
      const resp = await apiPut('/v1/openrouter/settings', body);
      if (resp.ok === false) {
        showMsg(resp.error?.message || t('profile.generator.openrouter.testFail'), true);
      } else {
        showMsg(t('profile.generator.openrouter.apiKeySaved'));
        setHasApiKey(true);
        setApiKey('');
        if (apiKey) loadModels();
      }
    } catch (e) {
      showMsg(e.message, true);
    }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const resp = await apiPost('/v1/openrouter/test');
      if (resp.ok === false) {
        showMsg(t('profile.generator.openrouter.testFail') + (resp.error?.message ? ': ' + resp.error.message : ''), true);
      } else {
        showMsg(t('profile.generator.openrouter.testSuccess'));
      }
    } catch (e) {
      showMsg(t('profile.generator.openrouter.testFail') + ': ' + e.message, true);
    }
    setTesting(false);
  }

  async function handleDelete() {
    if (!confirm(t('profile.generator.openrouter.deleteConfirm'))) return;
    try {
      await apiDelete('/v1/openrouter/settings');
      setHasApiKey(false);
      setApiKey('');
      setModel('');
      setModels([]);
      setAutoRetry(false);
      setMaxRetries(3);
      setTemperature('');
      setTopP('');
      setMaxTokens('');
      showMsg(t('profile.generator.openrouter.delete'));
    } catch (e) {
      showMsg(e.message, true);
    }
  }

  if (!loaded) return null;

  return html`
    <div class="pf-gen-or-wrapper">
      <button class="pf-gen-or-toggle" onClick=${() => setCollapsed(!collapsed)}>
        <span class="pf-gen-or-toggle-icon">${collapsed ? '\u25B6' : '\u25BC'}</span>
        <span>${t('profile.generator.openrouter.title')}</span>
        ${hasApiKey && html`<span class="pf-gen-or-status-dot"></span>`}
      </button>
      ${!collapsed && html`
        <div class="pf-gen-or-panel">
          <!-- Provider selector -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.provider')}</label>
            <div class="pf-gen-or-radio-group">
              ${['openrouter', 'lmstudio', 'custom'].map(p => html`
                <label class="pf-gen-or-radio-label">
                  <input type="radio" name="ai-provider" value=${p}
                    checked=${provider === p}
                    onChange=${() => {
                      setProvider(p);
                      if (p === 'lmstudio') setBaseUrl('http://localhost:1234/v1');
                      else if (p === 'openrouter') setBaseUrl('');
                    }} />
                  ${t('profile.generator.openrouter.provider_' + p)}
                </label>
              `)}
            </div>
          </div>

          <!-- Base URL (lmstudio / custom) -->
          ${provider !== 'openrouter' && html`
            <div class="pf-gen-or-field">
              <label class="pf-gen-or-label">${t('profile.generator.openrouter.baseUrl')}</label>
              <input
                type="url"
                class="pf-gen-or-input"
                value=${baseUrl}
                placeholder=${t('profile.generator.openrouter.baseUrl_hint')}
                onInput=${e => setBaseUrl(e.target.value)}
              />
            </div>
          `}

          <!-- API Key -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.apiKey')}</label>
            <input
              type="password"
              autocomplete="off" data-1p-ignore data-lpignore="true"
              class="pf-gen-or-input"
              placeholder=${hasApiKey ? t('profile.generator.openrouter.apiKeyMasked') : t('profile.generator.openrouter.apiKeyPlaceholder')}
              value=${apiKey}
              onInput=${e => setApiKey(e.target.value)}
            />
          </div>

          <!-- Model -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.model')}</label>
            ${modelsLoading
              ? html`<span class="pf-gen-or-loading">${t('profile.loading')}</span>`
              : html`
                <select
                  class="pf-gen-or-select"
                  value=${model}
                  onChange=${e => setModel(e.target.value)}
                  disabled=${!hasApiKey && !apiKey}
                >
                  <option value="">${t('profile.generator.openrouter.modelSelect')}</option>
                  ${models.map(m => html`
                    <option value=${m.id}>${m.name || m.id}</option>
                  `)}
                </select>
              `
            }
          </div>

          <!-- Auto-retry -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-checkbox">
              <input
                type="checkbox"
                checked=${autoRetry}
                onChange=${e => setAutoRetry(e.target.checked)}
              />
              ${t('profile.generator.openrouter.autoRetry')}
            </label>
          </div>

          <!-- Max retries (conditional) -->
          ${autoRetry && html`
            <div class="pf-gen-or-field">
              <label class="pf-gen-or-label">${t('profile.generator.openrouter.maxRetries')}</label>
              <input
                type="number"
                class="pf-gen-or-input pf-gen-or-input-sm"
                min="1"
                max="10"
                value=${maxRetries}
                onInput=${e => setMaxRetries(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              />
            </div>
          `}

          <!-- Model Parameters -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.temperature')}</label>
            <div class="pf-gen-or-param-row">
              <input
                type="number"
                class="pf-gen-or-input pf-gen-or-input-sm"
                min="0"
                max="2"
                step="0.1"
                placeholder="default"
                value=${temperature}
                onInput=${e => setTemperature(e.target.value)}
              />
              <span class="pf-gen-or-param-hint">${t('profile.generator.openrouter.temperature_hint')}</span>
            </div>
          </div>

          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.topP')}</label>
            <div class="pf-gen-or-param-row">
              <input
                type="number"
                class="pf-gen-or-input pf-gen-or-input-sm"
                min="0"
                max="1"
                step="0.05"
                placeholder="default"
                value=${topP}
                onInput=${e => setTopP(e.target.value)}
              />
              <span class="pf-gen-or-param-hint">${t('profile.generator.openrouter.topP_hint')}</span>
            </div>
          </div>

          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.maxTokens')}</label>
            <div class="pf-gen-or-param-row">
              <input
                type="number"
                class="pf-gen-or-input pf-gen-or-input-sm"
                min="256"
                max="128000"
                step="256"
                placeholder="default"
                value=${maxTokens}
                onInput=${e => setMaxTokens(e.target.value)}
              />
              <span class="pf-gen-or-param-hint">${t('profile.generator.openrouter.maxTokens_hint')}</span>
            </div>
          </div>

          <!-- Message -->
          ${message && html`
            <div class="pf-gen-or-message ${message.error ? 'pf-gen-or-message-error' : 'pf-gen-or-message-success'}">
              ${message.text}
            </div>
          `}

          <!-- Apps AI budget — apps reach this key via /v1/ai/complete -->
          ${hasApiKey && html`<${AiAppsBudgetPanel} />`}

          <!-- Actions -->
          <div class="pf-gen-or-actions">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : t('profile.generator.openrouter.save')}
            </button>
            ${hasApiKey && html`
              <button class="btn-outline" onClick=${handleTest} disabled=${testing}>
                ${testing ? html`<span class="spinner"></span>` : ''}
                ${t('profile.generator.openrouter.testConnection')}
              </button>
              <button class="btn-outline btn-sm pf-gen-or-delete" onClick=${handleDelete}>
                ${t('profile.generator.openrouter.delete')}
              </button>
            `}
          </div>
        </div>
      `}
    </div>
  `;
}

/**
 * Budget + spend panel for app-level AI use (/v1/ai/complete). Shows today's
 * total spend and per-app breakdown, lets the user set the daily USD cap.
 *
 * Numbers come from the server's tracked usage (token counts always exact,
 * cost is OpenRouter-reported when available, rough estimate otherwise).
 * Per-app quotas + allowlist editing is out of scope for v1 — set via API.
 */
function AiAppsBudgetPanel() {
  const [usage, setUsage] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('1');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => { reload(); }, []);

  async function reload() {
    const [u, s] = await Promise.all([
      apiGet('/v1/ai/usage').catch(() => null),
      apiGet('/v1/ai/settings').catch(() => null),
    ]);
    if (u && u.ok !== false && u.data) setUsage(u.data);
    if (s && s.ok !== false && s.data) {
      setSettings(s.data);
      setBudgetInput(String(s.data.daily_budget_usd ?? 1));
    }
  }

  async function saveBudget() {
    setSaving(true); setMessage(null);
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      setMessage({ text: 'Budget must be a number between 0 and 1000.', error: true });
      setSaving(false); return;
    }
    try {
      const r = await apiPost('/v1/ai/settings', { daily_budget_usd: n });
      if (r.ok === false) throw new Error(r.error?.message || 'Save failed');
      setMessage({ text: 'Budget saved.' });
      setEditing(false);
      await reload();
    } catch (e) {
      setMessage({ text: e.message || 'Save failed', error: true });
    }
    setSaving(false);
  }

  if (!usage || !settings) return null;
  const budget = usage.daily_budget_usd;
  const spent = usage.spent_today_usd;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perAppEntries = Object.entries(usage.per_app || {});

  return html`
    <div class="pf-gen-or-field" style="border-top:2px solid var(--cl-ink,#e5e5e5);padding-top:14px;margin-top:14px;">
      <label class="pf-gen-or-label">💸 AI apps daily budget</label>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">
        Apps that call <code>AIMEAT.ai.complete()</code> use this key. When today's
        spend hits the budget, further calls return <code>QUOTA_EXHAUSTED</code>.
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;background:#f5f5f5;border-radius:4px;height:20px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:0;left:0;bottom:0;width:${pct}%;background:${pct >= 90 ? '#ef4444' : pct >= 60 ? '#f59e0b' : '#22c55e'};transition:width .3s;"></div>
          <div style="position:relative;text-align:center;font-size:11px;line-height:20px;font-weight:700;">
            $${spent.toFixed(4)} / $${budget.toFixed(2)} (${pct}%)
          </div>
        </div>
        ${editing ? html`
          <input type="number" min="0" max="1000" step="0.10" value=${budgetInput}
                 onInput=${e => setBudgetInput(e.target.value)}
                 style="width:90px;padding:4px 6px;font-size:13px;" />
          <button class="btn-primary btn-sm" onClick=${saveBudget} disabled=${saving}>
            ${saving ? '...' : 'Save'}
          </button>
          <button class="btn-outline btn-sm" onClick=${() => setEditing(false)}>Cancel</button>
        ` : html`
          <button class="btn-outline btn-sm" onClick=${() => setEditing(true)}>Change</button>
        `}
      </div>

      ${message && html`<div class="pf-gen-or-message ${message.error ? 'pf-gen-or-message-error' : 'pf-gen-or-message-success'}" style="margin-top:8px;">${message.text}</div>`}

      ${perAppEntries.length > 0 && html`
        <details style="margin-top:10px;">
          <summary style="cursor:pointer;font-size:12px;color:#666;">
            Per-app breakdown (${perAppEntries.length} app${perAppEntries.length === 1 ? '' : 's'})
          </summary>
          <table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid #e5e5e5;">
                <th style="text-align:left;padding:4px;">App</th>
                <th style="text-align:right;padding:4px;">Cost</th>
                <th style="text-align:right;padding:4px;">Calls</th>
                <th style="text-align:right;padding:4px;">Tokens</th>
              </tr>
            </thead>
            <tbody>
              ${perAppEntries.map(([app, s]) => html`
                <tr>
                  <td style="padding:4px;">${app}</td>
                  <td style="text-align:right;padding:4px;">$${(s.cost_usd || 0).toFixed(4)}</td>
                  <td style="text-align:right;padding:4px;">${s.calls || 0}</td>
                  <td style="text-align:right;padding:4px;">${s.tokens || 0}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </details>
      `}

      <div style="font-size:11px;color:#999;margin-top:8px;">
        Cost is estimated when the provider doesn't report it (LM Studio, custom). Your
        OpenRouter dashboard has the authoritative bill.
      </div>
    </div>
  `;
}

/* ── Settings Collection ─────────────────────────────── */

export function SettingsCollectionView({ project, blueprint, onComplete, showToast }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const serviceSettings = blueprint?.settings?.service || [];
  const userSettingsDef = blueprint?.settings?.user || [];
  const allSettings = [...serviceSettings, ...userSettingsDef];
  const noSettings = allSettings.length === 0;

  // Load previously saved settings
  useEffect(() => {
    if (noSettings || loaded) return;
    getProjectSettings(project.projectId).then(saved => {
      if (saved && Object.keys(saved).length > 0) {
        // Merge saved values with defaults (saved values take priority)
        const merged = {};
        for (const s of allSettings) {
          merged[s.key] = saved[s.key] !== undefined ? saved[s.key] : (s.default || '');
        }
        setValues(merged);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [project.projectId]);

  // Auto-skip when no settings needed (hook always called, respecting rules of hooks)
  useEffect(() => {
    if (noSettings) onComplete({});
  }, [noSettings]);

  if (noSettings) {
    return html`<p class="pf-gen-notice">${t('profile.generator.settings_no_settings')}</p>`;
  }

  const handleSave = async () => {
    setSaving(true);
    setErrors([]);

    // Check required fields
    const missing = serviceSettings.filter(s => s.required && !values[s.key]);
    if (missing.length > 0) {
      setErrors(missing.map(s => s.label + ' ' + t('profile.generator.settings_required').toLowerCase()));
      setSaving(false);
      return;
    }

    // Identify secret keys for encryption
    const secretKeys = allSettings.filter(s => s.type === 'secret').map(s => s.key);

    try {
      await saveProjectSettings(project.projectId, values, secretKeys);
      onComplete(values);
    } catch (e) {
      showToast?.(e.message, true);
    }
    setSaving(false);
  };

  return html`<div class="pf-gen-settings-collection">
    <div class="section-title section-title-spaced">${t('profile.generator.settings_title')}</div>
    <p class="section-desc">${t('profile.generator.settings_description')}</p>
    ${errors.length > 0 && html`<div class="pf-gen-errors">
      ${errors.map(e => html`<p class="pf-gen-error-line">${e}</p>`)}
    </div>`}
    ${allSettings.map(s => html`<div class="pf-gen-section">
      <label>
        ${s.label}
        ${s.required ? html` <span class="pf-gen-required">*</span>` : ''}
      </label>
      <input type=${s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : 'text'}
        autocomplete="off" data-1p-ignore data-lpignore="true"
        value=${values[s.key] || s.default || ''}
        placeholder=${s.default ? String(s.default) : ''}
        onInput=${e => setValues(prev => ({ ...prev, [s.key]: e.target.value }))} />
    </div>`)}
    <div class="pf-gen-actions">
      <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
        ${t('profile.generator.settings_save')}
      </button>
      <button class="btn-outline" onClick=${() => onComplete({})}>
        ${t('profile.generator.settings_skip')}
      </button>
    </div>
  </div>`;
}
