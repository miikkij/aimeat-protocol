/**
 * @file foundry-settings.js
 * @description Settings components for the service foundry — OpenRouter/LM Studio
 *   AI provider configuration and blueprint-defined service/user settings collection.
 * @structure
 *   - OpenRouterSettings: collapsible panel for AI provider, API key, model, auto-retry
 *   - SettingsCollectionView: renders blueprint-defined settings fields, saves values
 * @usage
 *   import { OpenRouterSettings, SettingsCollectionView } from './foundry-settings.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js (was inline in v5.1.0+)
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { saveProjectSettings, getProjectSettings } from '/js/services/foundry.js';

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
      if (apiKey) body.apiKey = apiKey;
      const resp = await apiPut('/v1/openrouter/settings', body);
      if (resp.ok === false) {
        showMsg(resp.error?.message || t('profile.foundry.openrouter.testFail'), true);
      } else {
        showMsg(t('profile.foundry.openrouter.apiKeySaved'));
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
        showMsg(t('profile.foundry.openrouter.testFail') + (resp.error?.message ? ': ' + resp.error.message : ''), true);
      } else {
        showMsg(t('profile.foundry.openrouter.testSuccess'));
      }
    } catch (e) {
      showMsg(t('profile.foundry.openrouter.testFail') + ': ' + e.message, true);
    }
    setTesting(false);
  }

  async function handleDelete() {
    if (!confirm(t('profile.foundry.openrouter.deleteConfirm'))) return;
    try {
      await apiDelete('/v1/openrouter/settings');
      setHasApiKey(false);
      setApiKey('');
      setModel('');
      setModels([]);
      setAutoRetry(false);
      setMaxRetries(3);
      showMsg(t('profile.foundry.openrouter.delete'));
    } catch (e) {
      showMsg(e.message, true);
    }
  }

  if (!loaded) return null;

  return html`
    <div class="fnd-or-wrapper">
      <button class="fnd-or-toggle" onClick=${() => setCollapsed(!collapsed)}>
        <span class="fnd-or-toggle-icon">${collapsed ? '\u25B6' : '\u25BC'}</span>
        <span>${t('profile.foundry.openrouter.title')}</span>
        ${hasApiKey && html`<span class="fnd-or-status-dot"></span>`}
      </button>
      ${!collapsed && html`
        <div class="fnd-or-panel">
          <!-- Provider selector -->
          <div class="fnd-or-field">
            <label class="fnd-or-label">${t('profile.foundry.openrouter.provider')}</label>
            <div class="fnd-or-radio-group">
              ${['openrouter', 'lmstudio', 'custom'].map(p => html`
                <label class="fnd-or-radio-label">
                  <input type="radio" name="ai-provider" value=${p}
                    checked=${provider === p}
                    onChange=${() => {
                      setProvider(p);
                      if (p === 'lmstudio') setBaseUrl('http://localhost:1234/v1');
                      else if (p === 'openrouter') setBaseUrl('');
                    }} />
                  ${t('profile.foundry.openrouter.provider_' + p)}
                </label>
              `)}
            </div>
          </div>

          <!-- Base URL (lmstudio / custom) -->
          ${provider !== 'openrouter' && html`
            <div class="fnd-or-field">
              <label class="fnd-or-label">${t('profile.foundry.openrouter.baseUrl')}</label>
              <input
                type="url"
                class="fnd-or-input"
                value=${baseUrl}
                placeholder=${t('profile.foundry.openrouter.baseUrl_hint')}
                onInput=${e => setBaseUrl(e.target.value)}
              />
            </div>
          `}

          <!-- API Key -->
          <div class="fnd-or-field">
            <label class="fnd-or-label">${t('profile.foundry.openrouter.apiKey')}</label>
            <input
              type="password"
              autocomplete="off" data-1p-ignore data-lpignore="true"
              class="fnd-or-input"
              placeholder=${hasApiKey ? t('profile.foundry.openrouter.apiKeyMasked') : t('profile.foundry.openrouter.apiKeyPlaceholder')}
              value=${apiKey}
              onInput=${e => setApiKey(e.target.value)}
            />
          </div>

          <!-- Model -->
          <div class="fnd-or-field">
            <label class="fnd-or-label">${t('profile.foundry.openrouter.model')}</label>
            ${modelsLoading
              ? html`<span class="fnd-or-loading">${t('profile.loading')}</span>`
              : html`
                <select
                  class="fnd-or-select"
                  value=${model}
                  onChange=${e => setModel(e.target.value)}
                  disabled=${!hasApiKey && !apiKey}
                >
                  <option value="">${t('profile.foundry.openrouter.modelSelect')}</option>
                  ${models.map(m => html`
                    <option value=${m.id}>${m.name || m.id}</option>
                  `)}
                </select>
              `
            }
          </div>

          <!-- Auto-retry -->
          <div class="fnd-or-field">
            <label class="fnd-or-checkbox">
              <input
                type="checkbox"
                checked=${autoRetry}
                onChange=${e => setAutoRetry(e.target.checked)}
              />
              ${t('profile.foundry.openrouter.autoRetry')}
            </label>
          </div>

          <!-- Max retries (conditional) -->
          ${autoRetry && html`
            <div class="fnd-or-field">
              <label class="fnd-or-label">${t('profile.foundry.openrouter.maxRetries')}</label>
              <input
                type="number"
                class="fnd-or-input fnd-or-input-sm"
                min="1"
                max="10"
                value=${maxRetries}
                onInput=${e => setMaxRetries(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              />
            </div>
          `}

          <!-- Message -->
          ${message && html`
            <div class="fnd-or-message ${message.error ? 'fnd-or-message-error' : 'fnd-or-message-success'}">
              ${message.text}
            </div>
          `}

          <!-- Actions -->
          <div class="fnd-or-actions">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : t('profile.foundry.openrouter.save')}
            </button>
            ${hasApiKey && html`
              <button class="btn-outline" onClick=${handleTest} disabled=${testing}>
                ${testing ? html`<span class="spinner"></span>` : ''}
                ${t('profile.foundry.openrouter.testConnection')}
              </button>
              <button class="btn-outline btn-sm fnd-or-delete" onClick=${handleDelete}>
                ${t('profile.foundry.openrouter.delete')}
              </button>
            `}
          </div>
        </div>
      `}
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
    return html`<p class="fnd-notice">${t('profile.foundry.settings_no_settings')}</p>`;
  }

  const handleSave = async () => {
    setSaving(true);
    setErrors([]);

    // Check required fields
    const missing = serviceSettings.filter(s => s.required && !values[s.key]);
    if (missing.length > 0) {
      setErrors(missing.map(s => s.label + ' ' + t('profile.foundry.settings_required').toLowerCase()));
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

  return html`<div class="fnd-settings-collection">
    <div class="section-title section-title-spaced">${t('profile.foundry.settings_title')}</div>
    <p class="section-desc">${t('profile.foundry.settings_description')}</p>
    ${errors.length > 0 && html`<div class="fnd-errors">
      ${errors.map(e => html`<p class="fnd-error-line">${e}</p>`)}
    </div>`}
    ${allSettings.map(s => html`<div class="fnd-section">
      <label>
        ${s.label}
        ${s.required ? html` <span class="fnd-required">*</span>` : ''}
      </label>
      <input type=${s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : 'text'}
        autocomplete="off" data-1p-ignore data-lpignore="true"
        value=${values[s.key] || s.default || ''}
        placeholder=${s.default ? String(s.default) : ''}
        onInput=${e => setValues(prev => ({ ...prev, [s.key]: e.target.value }))} />
    </div>`)}
    <div class="fnd-actions">
      <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
        ${t('profile.foundry.settings_save')}
      </button>
      <button class="btn-outline" onClick=${() => onComplete({})}>
        ${t('profile.foundry.settings_skip')}
      </button>
    </div>
  </div>`;
}
