/**
 * @file calibrator-llm-editor.js
 * @description LLM configuration editor component for the Prompt Calibrator.
 *   Supports OpenRouter, LM Studio, and custom providers.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Extracted from calibrator-tab.js
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';

// ── LLM Config Editor (provider + key + model) ──

export default function LlmConfigEditor({ config, onChange, onRemove, label }) {
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [sharedKeyExists, setSharedKeyExists] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [collapsed, setCollapsed] = useState(!!config.modelId);
  const [dirty, setDirty] = useState(false);

  // Local draft state — only persisted on Save
  const [draft, setDraft] = useState({ ...config });
  useEffect(() => { setDraft({ ...config }); setDirty(false); }, [config.id]);

  const provider = draft.provider || 'openrouter';
  const baseUrl = draft.baseUrl || '';
  const modelId = draft.modelId || '';

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiGet('/v1/openrouter/settings');
        const hasSharedKey = !!resp.data?.hasApiKey;
        setSharedKeyExists(hasSharedKey);
        if (hasSharedKey) loadModels();
      } catch { /* no shared settings */ }
    })();
  }, []);

  const hasKey = (draft.apiKeyRef === 'shared' && sharedKeyExists) || !!draft.hasApiKey;

  async function loadModels() {
    setModelsLoading(true);
    try {
      const resp = await apiGet('/v1/openrouter/models');
      if (resp.data?.models) setModels(resp.data.models);
    } catch { setModels([]); }
    setModelsLoading(false);
  }

  function updateDraft(fields) {
    setDraft(prev => ({ ...prev, ...fields }));
    setDirty(true);
  }

  const [saveMsg, setSaveMsg] = useState(false);

  function handleSave() {
    onChange(draft);
    setDirty(false);
    setSaveMsg(true);
    setTimeout(() => setSaveMsg(false), 3000);
  }

  function handleProviderChange(p) {
    const updates = { provider: p };
    if (p === 'lmstudio') { updates.baseUrl = 'http://localhost:1234/v1'; updates.apiKeyRef = null; }
    else if (p === 'openrouter') { updates.baseUrl = 'https://openrouter.ai/api/v1'; updates.apiKeyRef = 'shared'; }
    else { updates.baseUrl = ''; updates.apiKeyRef = null; }
    updateDraft(updates);
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) return;
    try {
      await apiPut('/v1/openrouter/settings', { apiKey: apiKeyInput, provider, baseUrl });
      setSharedKeyExists(true);
      updateDraft({ apiKeyRef: 'shared', hasApiKey: true });
      setApiKeyInput('');
      loadModels();
    } catch (e) {
      console.warn('Failed to save key:', e.message);
    }
  }

  const displayLabel = config.label || config.modelId || label || t('profile.calibrator.selectModel');

  return html`
    <div class="fnd-cal-model-row" style="flex-direction:column;align-items:stretch;gap:0.5rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="cursor:pointer;font-size:0.8rem;" onClick=${() => setCollapsed(!collapsed)}>${collapsed ? '\u25B6' : '\u25BC'}</span>
        <span class="fnd-cal-model-label" style="flex:1;">${displayLabel}</span>
        <span style="font-size:0.7rem;color:var(--text-dim);">${provider}</span>
        ${onRemove && html`<button class="fnd-cal-model-remove" onClick=${onRemove}>\u2715</button>`}
      </div>

      ${!collapsed && html`
        <div style="display:flex;flex-direction:column;gap:0.5rem;padding-left:1.25rem;">
          <!-- Provider -->
          <div style="display:flex;gap:0.75rem;font-size:0.8rem;">
            ${['openrouter', 'lmstudio', 'custom'].map(p => html`
              <label style="display:flex;align-items:center;gap:0.25rem;cursor:pointer;">
                <input type="radio" name=${'provider-' + config.id} value=${p}
                  checked=${provider === p}
                  onChange=${() => handleProviderChange(p)} />
                ${p === 'openrouter' ? 'OpenRouter' : p === 'lmstudio' ? 'LM Studio' : 'Custom'}
              </label>
            `)}
          </div>

          <!-- Base URL (non-openrouter) -->
          ${provider !== 'openrouter' && html`
            <input type="url" placeholder="Base URL (e.g. http://localhost:1234/v1)"
              value=${baseUrl}
              onInput=${e => updateDraft({ baseUrl: e.target.value })}
              style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;"
            />
          `}

          <!-- API Key -->
          ${!hasKey && html`
            <div style="display:flex;gap:0.35rem;">
              <input type="password" placeholder=${provider === 'openrouter' ? 'OpenRouter API Key' : 'API Key'} autocomplete="off"
                value=${apiKeyInput}
                onInput=${e => setApiKeyInput(e.target.value)}
                onKeyDown=${e => e.key === 'Enter' && handleSaveKey()}
                style="flex:1;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;"
              />
              <button class="btn-primary btn-sm" onClick=${handleSaveKey} disabled=${!apiKeyInput.trim()}>
                ${t('profile.calibrator.save')}
              </button>
            </div>
          `}
          ${hasKey && html`
            <div style="font-size:0.75rem;color:var(--success);">
              ${draft.apiKeyRef === 'shared' ? 'Using shared API key (from OpenRouter settings)' : 'API key configured'}
            </div>
          `}

          <!-- Model dropdown + pricing -->
          ${modelsLoading
            ? html`<span style="font-size:0.8rem;color:var(--text-dim);">Loading models...</span>`
            : html`
              <select value=${modelId}
                onChange=${e => updateDraft({ modelId: e.target.value, label: e.target.selectedOptions[0]?.text || e.target.value })}
                style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;">
                <option value="">${t('profile.calibrator.selectModel')}</option>
                ${models.map(m => {
                  const p = m.pricing;
                  const priceTag = p ? ` — $${(parseFloat(p.prompt) * 1e6).toFixed(2)}/$${(parseFloat(p.completion) * 1e6).toFixed(2)} /M` : '';
                  return html`<option value=${m.id}>${(m.name || m.id)}${priceTag}</option>`;
                })}
              </select>
              ${(() => {
                const sel = models.find(m => m.id === modelId);
                if (!sel?.pricing) return null;
                const inPrice = (parseFloat(sel.pricing.prompt) * 1e6).toFixed(2);
                const outPrice = (parseFloat(sel.pricing.completion) * 1e6).toFixed(2);
                return html`<div style="font-size:0.7rem;color:var(--text-dim);">$${inPrice} input / $${outPrice} output per 1M tokens</div>`;
              })()}
            `
          }

          <!-- Parameters: temperature, top_p, max_tokens -->
          <div class="fnd-cal-model-params">
            <label class="fnd-cal-model-param">
              <span>Temperature</span>
              <input type="number" min="0" max="2" step="0.1"
                value=${draft.temperature ?? ''}
                placeholder="0.3"
                onInput=${e => updateDraft({ temperature: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
            </label>
            <label class="fnd-cal-model-param">
              <span>Top P</span>
              <input type="number" min="0" max="1" step="0.05"
                value=${draft.top_p ?? ''}
                placeholder="1.0"
                onInput=${e => updateDraft({ top_p: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
            </label>
            <label class="fnd-cal-model-param">
              <span>Max tokens</span>
              <input type="number" min="100" max="128000" step="100"
                value=${draft.max_tokens ?? ''}
                placeholder="auto"
                onInput=${e => updateDraft({ max_tokens: e.target.value === '' ? undefined : parseInt(e.target.value) })} />
            </label>
          </div>

          <!-- Save button -->
          <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem;">
            <button class="btn-primary btn-sm" onClick=${handleSave} disabled=${!dirty}>
              Save settings
            </button>
            ${saveMsg && html`<span style="font-size:0.8rem;color:var(--success);">Settings saved</span>`}
          </div>
        </div>
      `}
    </div>
  `;
}
