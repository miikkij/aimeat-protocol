/**
 * @file openrouter-settings.js
 * @description AI provider configuration — OpenRouter / LM Studio / custom OpenAI-compatible
 *   endpoint, the API key, the five model roles (default, reasoning, execution, vision,
 *   speech-to-text), sampling parameters, and the AI spend panel.
 *
 *   Four sections, each saving its OWN fields where the user is looking. One Save at the bottom of a
 *   single long form was the standing complaint: the key was typed at the top and the button that
 *   stored it sat ten fields and an entire budget panel below, so "did that save?" had no answer
 *   where it was asked. PUT /v1/openrouter/settings is a partial update, so per-section saving needs
 *   no server change.
 * @structure OpenRouterSettings (container + state) · SttTestPanel · ParamsSection ·
 *   openrouter/model-picker.js · openrouter/pricing.js · openrouter/budget-panel.js
 * @usage import { OpenRouterSettings } from './openrouter-settings.js';
 * @version-history
 *   v3.1.0 — 2026-08-17 — The why-lead (three sentences, shown until a key is saved): what an own
 *     key buys, what it costs (the one-time $10 that lifts OpenRouter's free tier to 1,000
 *     requests/day), and the first model worth picking. The panel asked for a key without ever
 *     saying why anyone would want one, and the tab is reachable at tier 'new' now, so a brand-new
 *     person arriving from the chat's payer line is the ordinary visitor.
 *   v3.0.0 — 2026-08-01 — Sectioned rework. Save-next-to-the-key; searchable model pickers showing
 *     price, context and a link to the model's page (a flat <select> of 336 unlabelled options was
 *     unusable); reasoning + execution pickers surfaced at last (the server has stored those two
 *     since v1.x with no UI to set them); speech-to-text model + language + a MEASURED test
 *     transcription, because an audio model's listed price carries no unit; the spend panel
 *     translated and moved to openrouter/budget-panel.js (it was hardcoded English). The
 *     onSettingsChange contract and the startOpen prop are unchanged for all three callers.
 *   v2.1.0 — 2026-08-01 — TARGET-058 Phase 9 step 0. "Test" distinguishes a spent daily budget from
 *     a failed connection; headlining a 402 as "Connection failed" sent people off to doubt a key
 *     that was working. (Behaviour carried into v3.)
 *   v2.0.0 — 2026-07-18 — Split out of generator-settings.js (SettingsCollectionView removed with
 *     the deleted Generator feature); dropped the generator.js project-settings import.
 *   v1.5.0 — 2026-07-05 — Model dropdown populates for custom OpenAI-compatible providers.
 *   v1.4.0 — 2026-07-05 — AI apps budget panel: per-app stacked usage chart.
 *   v1.2.0 — 2026-06-24 — Vision model selector.
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { useConfirm } from '/components/Modal.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { swallowed } from '/js/swallowed.js';
import { ModelPicker } from './openrouter/model-picker.js';
import { AiAppsBudgetPanel } from './openrouter/budget-panel.js';

/** Language hints offered for transcription. Auto-detect is first and is the right answer for
 *  mixed-language speech; a hint measurably helps when the language is known. */
const STT_LANGS = ['', 'fi', 'en', 'sv', 'de', 'fr', 'es', 'et'];

/** Read a File as bare base64 (no data: prefix) — the shape /v1/ai/transcribe takes inline. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read failed'));
    fr.onload = () => {
      const s = String(fr.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    fr.readAsDataURL(file);
  });
}

export function OpenRouterSettings({ onSettingsChange, startOpen = false }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [collapsed, setCollapsed] = useState(!startOpen);
  const [loaded, setLoaded] = useState(false);

  // connection
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openrouter');
  const [baseUrl, setBaseUrl] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connMsg, setConnMsg] = useState(null);

  // models
  const [model, setModel] = useState('');
  const [reasoningModel, setReasoningModel] = useState('');
  const [executionModel, setExecutionModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [sttModel, setSttModel] = useState('');
  const [sttLanguage, setSttLanguage] = useState('');
  const [models, setModels] = useState([]);
  const [sttModels, setSttModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [savingModels, setSavingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState(null);

  // params
  const [autoRetry, setAutoRetry] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [temperature, setTemperature] = useState('');
  const [topP, setTopP] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [savingParams, setSavingParams] = useState(false);
  const [paramsMsg, setParamsMsg] = useState(null);

  const isOpenRouter = provider === 'openrouter';

  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load; the loaders use stable setters
  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const resp = await apiGet('/v1/openrouter/settings');
      if (resp.ok !== false && resp.data) {
        setHasApiKey(!!resp.data.hasApiKey);
        setModel(resp.data.model || '');
        setReasoningModel(resp.data.reasoningModel || '');
        setExecutionModel(resp.data.executionModel || '');
        setVisionModel(resp.data.visionModel || '');
        setSttModel(resp.data.sttModel || '');
        setSttLanguage(resp.data.sttLanguage || '');
        setAutoRetry(!!resp.data.autoRetry);
        setMaxRetries(resp.data.maxRetries || 3);
        setProvider(resp.data.provider || 'openrouter');
        setBaseUrl(resp.data.baseUrl || '');
        if (resp.data.temperature != null) setTemperature(String(resp.data.temperature));
        if (resp.data.top_p != null) setTopP(String(resp.data.top_p));
        if (resp.data.max_tokens != null) setMaxTokens(String(resp.data.max_tokens));
        if (resp.data.hasApiKey) loadModels();
      }
    } catch (err) { swallowed('openrouter-settings: loadSettings', err); }
    setLoaded(true);
  }

  // Notify parent whenever key settings change
  useEffect(() => {
    if (loaded && onSettingsChange) {
      onSettingsChange({ hasApiKey, autoRetry, maxRetries, provider, baseUrl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSettingsChange is a caller callback, intentionally excluded so it does not re-fire on every parent render
  }, [loaded, hasApiKey, autoRetry, maxRetries, provider, baseUrl]);

  /**
   * Two catalogues, not one filtered twice: OpenRouter's default /models contains no transcription
   * models at all, so the STT picker is empty unless its list is fetched with its own modality.
   */
  async function loadModels() {
    setModelsLoading(true);
    setModelsError(null);
    const [chat, stt] = await Promise.all([
      apiGet('/v1/openrouter/models').catch(e => ({ ok: false, error: { message: e?.message } })),
      apiGet('/v1/openrouter/models?modality=transcription').catch(e => {
        // A provider with no transcription catalogue and a provider that failed to answer look the
        // same from here, so the failure is logged rather than silently read as "none available".
        swallowed('openrouter-settings: stt model list', e);
        return { ok: false, data: null };
      }),
    ]);
    if (chat && chat.ok !== false && Array.isArray(chat.data?.models)) {
      setModels(chat.data.models);
      if (chat.data.models.length === 0) setModelsError(t('profile.openrouter.modelsEmpty'));
    } else {
      setModels([]);
      setModelsError(chat?.error?.message || t('profile.openrouter.modelsError'));
    }
    // A provider with no transcription catalogue is not an error — it simply has none to offer, and
    // the STT section says so instead of showing an empty picker with no explanation.
    setSttModels((stt && stt.ok !== false && Array.isArray(stt.data?.models)) ? stt.data.models : []);
    setModelsLoading(false);
  }

  function flash(setter, text, error = false) {
    setter({ text, error });
    setTimeout(() => setter(null), 5000);
  }

  /** Save ONLY the connection fields, so the answer to "did my key save?" appears beside the key. */
  async function saveKey() {
    setSavingKey(true);
    try {
      const body = { provider, baseUrl };
      if (apiKey) body.apiKey = apiKey;
      const resp = await apiPut('/v1/openrouter/settings', body);
      if (resp.ok === false) {
        flash(setConnMsg, resp.error?.message || t('profile.openrouter.saveFailed'), true);
      } else {
        flash(setConnMsg, apiKey ? t('profile.openrouter.keySaved') : t('profile.openrouter.providerSaved'));
        if (apiKey) setHasApiKey(true);
        setApiKey('');
        // Refetch after every save: the list comes from the just-saved base URL + key, so switching
        // provider refreshes it even when no new key was typed.
        loadModels();
      }
    } catch (e) {
      flash(setConnMsg, e.message, true);
    }
    setSavingKey(false);
  }

  async function saveModels() {
    setSavingModels(true);
    try {
      const resp = await apiPut('/v1/openrouter/settings', {
        model,
        reasoningModel,
        executionModel,
        visionModel: visionModel || null,
        sttModel: sttModel || null,
        sttLanguage: sttLanguage || null,
        provider,
        baseUrl,
      });
      if (resp.ok === false) flash(setModelsMsg, resp.error?.message || t('profile.openrouter.saveFailed'), true);
      else flash(setModelsMsg, t('profile.openrouter.modelsSaved'));
    } catch (e) {
      flash(setModelsMsg, e.message, true);
    }
    setSavingModels(false);
  }

  async function saveParams() {
    setSavingParams(true);
    try {
      const resp = await apiPut('/v1/openrouter/settings', {
        autoRetry,
        maxRetries: parseInt(maxRetries) || 3,
        temperature: temperature !== '' ? parseFloat(temperature) : null,
        top_p: topP !== '' ? parseFloat(topP) : null,
        max_tokens: maxTokens !== '' ? parseInt(maxTokens) : null,
        provider,
        baseUrl,
      });
      if (resp.ok === false) flash(setParamsMsg, resp.error?.message || t('profile.openrouter.saveFailed'), true);
      else flash(setParamsMsg, t('profile.openrouter.paramsSaved'));
    } catch (e) {
      flash(setParamsMsg, e.message, true);
    }
    setSavingParams(false);
  }

  async function handleTest() {
    setTesting(true);
    const started = Date.now();
    try {
      const resp = await apiPost('/v1/openrouter/test');
      if (resp.ok === false) {
        // A refused test is not necessarily a broken connection: the completion chokepoint also
        // refuses when the daily budget is spent. Headlining that "Connection failed" sends someone
        // off to check a key that was never the problem.
        const budgetSpent = resp.error?.code === 'QUOTA_EXHAUSTED' || resp.error?.code === 'APP_QUOTA_EXHAUSTED';
        const head = budgetSpent ? t('profile.openrouter.testBudgetSpent') : t('profile.openrouter.testFail');
        // The provider's own sentence stays: it is the part that says what is actually wrong.
        flash(setConnMsg, head + (resp.error?.message ? ': ' + resp.error.message : ''), true);
      } else {
        flash(setConnMsg, t('profile.openrouter.testOk', {
          model: resp.data?.model || '', ms: Date.now() - started,
        }));
      }
    } catch (e) {
      flash(setConnMsg, `${t('profile.openrouter.testFail')}: ${e.message}`, true);
    }
    setTesting(false);
  }

  function handleDelete() {
    confirm(t('profile.openrouter.deleteConfirm'), async () => {
      try {
        await apiDelete('/v1/openrouter/settings');
        setHasApiKey(false); setApiKey('');
        setModel(''); setReasoningModel(''); setExecutionModel('');
        setVisionModel(''); setSttModel(''); setSttLanguage('');
        setModels([]); setSttModels([]); setModelsError(null);
        setAutoRetry(false); setMaxRetries(3);
        setTemperature(''); setTopP(''); setMaxTokens('');
        flash(setConnMsg, t('profile.openrouter.deleted'));
      } catch (e) {
        flash(setConnMsg, e.message, true);
      }
    }, { danger: true });
  }

  if (!loaded) return null;

  const keyed = hasApiKey || !!apiKey;
  const pickerProps = { models, isOpenRouter, disabled: !keyed };

  return html`
    <div class="pf-or-wrapper">
      <button class="pf-or-toggle" onClick=${() => setCollapsed(!collapsed)}>
        <span class="pf-or-toggle-icon">${collapsed ? '▶' : '▼'}</span>
        <span>${t('profile.openrouter.title')}</span>
        <span class=${hasApiKey ? 'pf-or-status pf-or-status--on' : 'pf-or-status'}>
          ${hasApiKey ? t('profile.openrouter.statusReady') : t('profile.openrouter.statusNoKey')}
        </span>
      </button>

      ${!collapsed && html`
        <div class="pf-or-panel">

          <!-- ── 0. Why an own key — the motivation the panel never carried. A brand-new person
               arrives here from the chat's payer line without knowing what OpenRouter is; the
               three sentences answer why, what it costs, and what to pick first. -->
          ${!hasApiKey && html`
            <section class="pf-or-section pf-or-why">
              <p>${t('profile.openrouter.whyLead')}</p>
              <p>${t('profile.openrouter.whyCost')}</p>
              <p>${t('profile.openrouter.whyModel')}</p>
            </section>`}

          <!-- ── 1. Connection ───────────────────────────────── -->
          <section class="pf-or-section">
            <h4 class="pf-or-section-title">${t('profile.openrouter.section.connection')}</h4>

            <div class="pf-or-field">
              <label class="pf-or-label">${t('profile.openrouter.provider')}</label>
              <div class="pf-or-radio-group">
                ${['openrouter', 'lmstudio', 'custom'].map(p => html`
                  <label class="pf-or-radio-label" key=${p}>
                    <input type="radio" name="ai-provider" value=${p} checked=${provider === p}
                      onChange=${() => {
                        setProvider(p);
                        if (p === 'lmstudio') setBaseUrl('http://localhost:1234/v1');
                        else if (p === 'openrouter') setBaseUrl('');
                      }} />
                    ${t('profile.openrouter.provider_' + p)}
                  </label>`)}
              </div>
            </div>

            ${!isOpenRouter && html`
              <div class="pf-or-field">
                <label class="pf-or-label">${t('profile.openrouter.baseUrl')}</label>
                <input type="url" class="pf-or-input" value=${baseUrl}
                  placeholder=${t('profile.openrouter.baseUrl_hint')}
                  onInput=${e => setBaseUrl(e.target.value)} />
              </div>`}

            <div class="pf-or-field">
              <label class="pf-or-label">${t('profile.openrouter.apiKey')}</label>
              <div class="pf-or-key-row">
                <input type="password" autocomplete="off" data-1p-ignore data-lpignore="true"
                  class="pf-or-input pf-or-key-input"
                  placeholder=${hasApiKey ? t('profile.openrouter.apiKeyMasked') : t('profile.openrouter.apiKeyPlaceholder')}
                  value=${apiKey} onInput=${e => setApiKey(e.target.value)} />
                <button class="btn-primary btn-sm" onClick=${saveKey} disabled=${savingKey}>
                  ${savingKey ? '…' : t('profile.openrouter.saveKey')}
                </button>
                ${hasApiKey && html`
                  <button class="btn-outline btn-sm" onClick=${handleTest} disabled=${testing}>
                    ${testing ? html`<span class="spinner"></span>` : ''}${t('profile.openrouter.testConnection')}
                  </button>
                  <button class="btn-ghost btn-sm pf-or-delete" onClick=${handleDelete}>
                    ${t('profile.openrouter.delete')}
                  </button>`}
              </div>
              ${connMsg && html`<div class=${`pf-or-message ${connMsg.error ? 'pf-or-message-error' : 'pf-or-message-success'}`}>${connMsg.text}</div>`}
              ${isOpenRouter && html`
                <div class="pf-or-links">
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">${t('profile.openrouter.getKeyLink')} ↗</a>
                  <a href="https://openrouter.ai/credits" target="_blank" rel="noopener">${t('profile.openrouter.creditsLink')} ↗</a>
                </div>`}
            </div>
          </section>

          <!-- ── 2. Models ───────────────────────────────────── -->
          <section class="pf-or-section">
            <h4 class="pf-or-section-title">${t('profile.openrouter.section.models')}</h4>
            <div class="pf-or-models-head">
              <button type="button" class="btn-outline btn-sm" onClick=${loadModels}
                      disabled=${modelsLoading || !keyed}>
                ${t('profile.openrouter.modelsRefresh')}${models.length ? ` (${models.length})` : ''}
              </button>
              <span class=${modelsError ? 'pf-or-hint pf-or-hint--error' : 'pf-or-hint'}>
                ${modelsError || t('profile.openrouter.modelsHint')}
              </span>
            </div>

            ${modelsLoading ? html`<div class="pf-or-loading">${t('profile.loading')}</div>` : html`
              <div class="pf-or-field">
                <label class="pf-or-label">${t('profile.openrouter.model.default')}</label>
                <${ModelPicker} ...${pickerProps} value=${model} onChange=${setModel} modality="chat"
                  allowCustom=${!isOpenRouter} />
              </div>

              <details class="pf-or-roles">
                <summary class="pf-or-roles-summary">${t('profile.openrouter.model.rolesSummary')}</summary>
                <div class="pf-or-field">
                  <label class="pf-or-label">${t('profile.openrouter.model.reasoning')}</label>
                  <${ModelPicker} ...${pickerProps} value=${reasoningModel} onChange=${setReasoningModel}
                    modality="chat" allowNone=${true} allowCustom=${!isOpenRouter} />
                  <span class="pf-or-hint">${t('profile.openrouter.model.reasoning_hint')}</span>
                </div>
                <div class="pf-or-field">
                  <label class="pf-or-label">${t('profile.openrouter.model.execution')}</label>
                  <${ModelPicker} ...${pickerProps} value=${executionModel} onChange=${setExecutionModel}
                    modality="chat" allowNone=${true} allowCustom=${!isOpenRouter} />
                  <span class="pf-or-hint">${t('profile.openrouter.model.execution_hint')}</span>
                </div>
              </details>

              <div class="pf-or-field">
                <label class="pf-or-label">${t('profile.openrouter.model.vision')}</label>
                <${ModelPicker} ...${pickerProps} value=${visionModel} onChange=${setVisionModel}
                  modality="vision" allowNone=${true} allowCustom=${!isOpenRouter}
                  noneLabel=${t('profile.openrouter.model.visionNone')} />
                <span class="pf-or-hint">${t('profile.openrouter.model.vision_hint')}</span>
              </div>

              <div class="pf-or-field pf-or-stt">
                <label class="pf-or-label">${t('profile.openrouter.model.stt')}</label>
                ${sttModels.length === 0 && keyed
                  ? html`<div class="pf-or-hint">${t('profile.openrouter.stt.listEmpty')}</div>` : null}
                <${ModelPicker} models=${sttModels} isOpenRouter=${isOpenRouter} disabled=${!keyed}
                  value=${sttModel} onChange=${setSttModel} modality="transcription" allowNone=${true}
                  allowCustom=${!isOpenRouter} noneLabel=${t('profile.openrouter.model.sttNone')} />
                <span class="pf-or-hint">${t('profile.openrouter.model.stt_hint')}</span>

                <div class="pf-or-inline-field">
                  <label class="pf-or-label pf-or-label--inline">${t('profile.openrouter.stt.language')}</label>
                  <select class="pf-or-select pf-or-select--sm" value=${sttLanguage}
                          onChange=${e => setSttLanguage(e.target.value)}>
                    ${STT_LANGS.map(code => html`
                      <option key=${code || 'auto'} value=${code}>
                        ${code ? t('profile.openrouter.stt.lang_' + code) : t('profile.openrouter.stt.languageAuto')}
                      </option>`)}
                  </select>
                  <span class="pf-or-hint">${t('profile.openrouter.stt.language_hint')}</span>
                </div>

                <${SttTestPanel} sttModel=${sttModel} sttLanguage=${sttLanguage} />
              </div>
            `}

            <div class="pf-or-actions">
              <button class="btn-primary" onClick=${saveModels} disabled=${savingModels}>
                ${savingModels ? '…' : t('profile.openrouter.saveModels')}
              </button>
              ${modelsMsg && html`<span class=${`pf-or-message ${modelsMsg.error ? 'pf-or-message-error' : 'pf-or-message-success'}`}>${modelsMsg.text}</span>`}
            </div>
          </section>

          <!-- ── 3. Parameters ───────────────────────────────── -->
          <${ParamsSection}
            autoRetry=${autoRetry} setAutoRetry=${setAutoRetry}
            maxRetries=${maxRetries} setMaxRetries=${setMaxRetries}
            temperature=${temperature} setTemperature=${setTemperature}
            topP=${topP} setTopP=${setTopP}
            maxTokens=${maxTokens} setMaxTokens=${setMaxTokens}
            saving=${savingParams} onSave=${saveParams} message=${paramsMsg} />

          <!-- ── 4. Budget ───────────────────────────────────── -->
          ${hasApiKey && html`
            <section class="pf-or-section">
              <h4 class="pf-or-section-title">${t('profile.openrouter.section.budget')}</h4>
              <${AiAppsBudgetPanel} />
            </section>`}
        </div>`}
      <${ConfirmUI} />
    </div>`;
}

/**
 * Record a few seconds and transcribe them for real.
 *
 * This answers a question the catalogue cannot: what a transcription actually costs. An audio model's
 * listed price carries no unit — the same Whisper Large V3 reports 0.0015 on one provider and 0.111
 * on another, per minute against per hour — so one measured call beats any figure derived from the
 * model list. It also proves the whole chain end to end: microphone, upload, key, model.
 */
function SttTestPanel({ sttModel, sttLanguage }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run(file) {
    setBusy(true); setError(null); setResult(null);
    try {
      const audio_base64 = await fileToBase64(file);
      const resp = await apiPost('/v1/ai/transcribe', {
        audio_base64, mime: file.type, filename: file.name,
        model: sttModel || undefined, language: sttLanguage || undefined, app_id: 'settings-test',
      });
      if (resp.ok === false) throw new Error(resp.error?.message || t('profile.openrouter.stt.testFailed'));
      setResult(resp.data);
    } catch (e) {
      setError(e.message || t('profile.openrouter.stt.testFailed'));
    }
    setBusy(false);
  }

  return html`
    <div class="pf-or-stt-test">
      <div class="pf-or-stt-test-head">
        <${VoiceRecorder} maxSeconds=${30} disabled=${busy || !sttModel}
          label=${t('profile.openrouter.stt.test')} className="btn-outline btn-sm"
          onRecorded=${(file) => run(file)} />
        ${busy ? html`<span class="pf-or-hint">${t('profile.openrouter.stt.testing')}</span>` : null}
        ${!sttModel ? html`<span class="pf-or-hint">${t('profile.openrouter.stt.testNeedsModel')}</span>` : null}
      </div>
      ${error ? html`<div class="pf-or-message pf-or-message-error">${error}</div>` : null}
      ${result ? html`
        <div class="pf-or-stt-result">
          <div class="pf-or-stt-text">${result.text || t('profile.openrouter.stt.testSilent')}</div>
          <div class="pf-or-stt-meta">
            ${t('profile.openrouter.stt.measured', {
              seconds: (Number(result.seconds) || 0).toFixed(1),
              cost: (Number(result.usage?.cost_usd) || 0).toFixed(6),
            })}
            ${result.usage?.cost_exact === false
              ? html` <span class="pf-or-hint">${t('profile.openrouter.stt.costNotReported')}</span>` : null}
          </div>
        </div>` : null}
    </div>`;
}

/** Sampling parameters. Collapsed by default: most owners never touch them, and four rarely-used
 *  numeric fields sitting open is part of what pushed the save button off the screen before. */
function ParamsSection({
  autoRetry, setAutoRetry, maxRetries, setMaxRetries, temperature, setTemperature,
  topP, setTopP, maxTokens, setMaxTokens, saving, onSave, message,
}) {
  return html`
    <section class="pf-or-section">
      <details class="pf-or-params">
        <summary class="pf-or-section-title pf-or-params-summary">${t('profile.openrouter.section.params')}</summary>

        <div class="pf-or-field">
          <label class="pf-or-checkbox">
            <input type="checkbox" checked=${autoRetry} onChange=${e => setAutoRetry(e.target.checked)} />
            ${t('profile.openrouter.autoRetry')}
          </label>
        </div>

        ${autoRetry && html`
          <div class="pf-or-field">
            <label class="pf-or-label">${t('profile.openrouter.maxRetries')}</label>
            <input type="number" class="pf-or-input pf-or-input-sm" min="1" max="10" value=${maxRetries}
              onInput=${e => setMaxRetries(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))} />
          </div>`}

        <div class="pf-or-field">
          <label class="pf-or-label">${t('profile.openrouter.temperature')}</label>
          <div class="pf-or-param-row">
            <input type="number" class="pf-or-input pf-or-input-sm" min="0" max="2" step="0.1"
              placeholder=${t('profile.openrouter.paramDefault')} value=${temperature}
              onInput=${e => setTemperature(e.target.value)} />
            <span class="pf-or-hint">${t('profile.openrouter.temperature_hint')}</span>
          </div>
        </div>

        <div class="pf-or-field">
          <label class="pf-or-label">${t('profile.openrouter.topP')}</label>
          <div class="pf-or-param-row">
            <input type="number" class="pf-or-input pf-or-input-sm" min="0" max="1" step="0.05"
              placeholder=${t('profile.openrouter.paramDefault')} value=${topP}
              onInput=${e => setTopP(e.target.value)} />
            <span class="pf-or-hint">${t('profile.openrouter.topP_hint')}</span>
          </div>
        </div>

        <div class="pf-or-field">
          <label class="pf-or-label">${t('profile.openrouter.maxTokens')}</label>
          <div class="pf-or-param-row">
            <input type="number" class="pf-or-input pf-or-input-sm" min="256" max="128000" step="256"
              placeholder=${t('profile.openrouter.paramDefault')} value=${maxTokens}
              onInput=${e => setMaxTokens(e.target.value)} />
            <span class="pf-or-hint">${t('profile.openrouter.maxTokens_hint')}</span>
          </div>
        </div>

        <div class="pf-or-actions">
          <button class="btn-primary btn-sm" onClick=${onSave} disabled=${saving}>
            ${saving ? '…' : t('profile.openrouter.saveParams')}
          </button>
          ${message && html`<span class=${`pf-or-message ${message.error ? 'pf-or-message-error' : 'pf-or-message-success'}`}>${message.text}</span>`}
        </div>
      </details>
    </section>`;
}
