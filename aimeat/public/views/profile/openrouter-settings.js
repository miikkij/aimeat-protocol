/**
 * @file openrouter-settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   components/ModelPicker.js · openrouter/pricing.js · openrouter/budget-panel.js
 * @usage import { OpenRouterSettings } from './openrouter-settings.js';
 * @version-history
 *   v3.19.0 -- 2026-09-26 -- Every part is a component that gets data (component plan, page group G4): the panel
 *     (Box), its sections (Card section), the fields (TextField, Select, Check radios in a Field group, the
 *     model pickers from components/ModelPicker.js, which replaces openrouter/model-picker.js), the ways on
 *     (Loud, Action, Actions), the messages and hints (Note), the roles' fold (Tab fold, open state kept here as
 *     the details element's was), the status (Mark). The API key keeps main's look: typed hidden with no eye,
 *     password managers kept out (TextField unmanaged). The page writes no class.
 *   v3.18.0 -- 2026-09-26 -- The provider's radio dots and the retry check box carry the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v3.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v3.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v3.15.0 -- 2026-09-26 -- The classic AI settings' links to OpenRouter are the action link's quiet tone, and the ecosystem advisory's Approve and Reject keep the action link's own look (the skin's restyle of them goes); a unification: Jouni's decision Action link.
 *   v3.14.0 -- 2026-09-26 -- A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v3.13.0 -- 2026-09-26 -- The classic AI settings' why-lines are the lead and the Hint, and the scope dialog's reconnect note is the Hint under the section rule; their own looks go (a unification: the look most tabs use).
 *   v3.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v3.11.0 -- 2026-09-25 -- A section that is one row until it is opened is the FoldSection (the folded row with its lead): the AI tab's decide, transparency and compliance cards and the classic AI settings; their own heads, chevrons and body rules go (a unification: the look most tabs use).
 *   v3.10.0 -- 2026-09-25 -- The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v3.9.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v3.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v3.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v3.6.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v3.5.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v3.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v3.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v3.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-13 -- V2v: compose section top rules from poster.css.
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
import { ModelPicker } from '/components/ModelPicker.js';
import { AiAppsBudgetPanel } from './openrouter/budget-panel.js';
import { FoldSection } from '/components/FoldSection.js';
import { Box } from '/components/Box.js';
import { Card } from '/components/Card.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Tab } from '/components/Tabs.js';
import { Row, Stack, Space, Split } from '/components/Layout.js';
import { Spinner } from '/components/Spinner.js';

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
  const [rolesOpen, setRolesOpen] = useState(false);
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
    <${Space} below="large">
      <${FoldSection} num="" title=${t('profile.openrouter.title')} open=${!collapsed} onToggle=${() => setCollapsed(!collapsed)}
        sub=${html`<${Mark} kind="status" tone=${hasApiKey ? 'fine' : 'off'}>${hasApiKey ? t('profile.openrouter.statusReady') : t('profile.openrouter.statusNoKey')}<//>`}>
        <${Box}>

          <!-- ── 0. Why an own key — the motivation the panel never carried. A brand-new person
               arrives here from the chat's payer line without knowing what OpenRouter is; the
               three sentences answer why, what it costs, and what to pick first. -->
          ${!hasApiKey && html`
            <${Card} tone="section">
              <${Note} kind="lead">${t('profile.openrouter.whyLead')}<//>
              <${Note}>${t('profile.openrouter.whyCost')}<//>
              <${Note}>${t('profile.openrouter.whyModel')}<//>
            <//>`}

          <!-- ── 1. Connection ───────────────────────────────── -->
          <${Card} tone="section" title=${t('profile.openrouter.section.connection')}>
            <${Fields}>
              <${Field} label=${t('profile.openrouter.provider')} group>
                ${['openrouter', 'lmstudio', 'custom'].map(p => html`
                  <${Check} radio key=${p} name="ai-provider" value=${p} checked=${provider === p}
                    onChange=${() => {
                      setProvider(p);
                      if (p === 'lmstudio') setBaseUrl('http://localhost:1234/v1');
                      else if (p === 'openrouter') setBaseUrl('');
                    }}>${t('profile.openrouter.provider_' + p)}<//>`)}
              <//>

              ${!isOpenRouter && html`
                <${TextField} type="url" label=${t('profile.openrouter.baseUrl')} value=${baseUrl}
                  placeholder=${t('profile.openrouter.baseUrl_hint')}
                  onInput=${setBaseUrl} />`}

              <${Stack}>
                <${TextField} unmanaged label=${t('profile.openrouter.apiKey')}
                  placeholder=${hasApiKey ? t('profile.openrouter.apiKeyMasked') : t('profile.openrouter.apiKeyPlaceholder')}
                  value=${apiKey} onInput=${setApiKey}
                  actions=${html`
                    <${Loud} control onClick=${saveKey} disabled=${savingKey}>
                      ${savingKey ? '…' : t('profile.openrouter.saveKey')}
                    <//>
                    ${hasApiKey && html`
                      <${Action} small onClick=${handleTest} disabled=${testing}>
                        ${testing ? html`<${Spinner} />` : ''}${t('profile.openrouter.testConnection')}
                      <//>
                      <${Action} small tone="danger" onClick=${handleDelete}>
                        ${t('profile.openrouter.delete')}
                      <//>`}`} />
                ${connMsg && html`<${Note} kind="message" error=${connMsg.error}>${connMsg.text}<//>`}
                ${isOpenRouter && html`
                  <${Actions}>
                    <${Action} small soft href="https://openrouter.ai/keys" newTab>${t('profile.openrouter.getKeyLink')} ↗<//>
                    <${Action} small soft href="https://openrouter.ai/credits" newTab>${t('profile.openrouter.creditsLink')} ↗<//>
                  <//>`}
              <//>
            <//>
          <//>

          <!-- ── 2. Models ───────────────────────────────────── -->
          <${Card} tone="section" title=${t('profile.openrouter.section.models')}>
            <${Row} wrap below="medium">
              <${Action} small onClick=${loadModels} disabled=${modelsLoading || !keyed}>
                ${t('profile.openrouter.modelsRefresh')}${models.length ? ` (${models.length})` : ''}
              <//>
              ${modelsError
                ? html`<${Note} kind="message" error>${modelsError}<//>`
                : html`<${Note} inline>${t('profile.openrouter.modelsHint')}<//>`}
            <//>

            ${modelsLoading ? html`<${Note} kind="loading">${t('profile.loading')}<//>` : html`
              <${Fields}>
                <${ModelPicker} ...${pickerProps} label=${t('profile.openrouter.model.default')}
                  value=${model} onChange=${setModel} modality="chat" allowCustom=${!isOpenRouter} />

                <${Stack}>
                  <${Tab} tone="fold" on=${rolesOpen} expanded=${rolesOpen}
                    onClick=${() => setRolesOpen(o => !o)}>${t('profile.openrouter.model.rolesSummary')}<//>
                  ${rolesOpen && html`
                    <${Fields}>
                      <${ModelPicker} ...${pickerProps} label=${t('profile.openrouter.model.reasoning')}
                        hint=${t('profile.openrouter.model.reasoning_hint')}
                        value=${reasoningModel} onChange=${setReasoningModel}
                        modality="chat" allowNone=${true} allowCustom=${!isOpenRouter} />
                      <${ModelPicker} ...${pickerProps} label=${t('profile.openrouter.model.execution')}
                        hint=${t('profile.openrouter.model.execution_hint')}
                        value=${executionModel} onChange=${setExecutionModel}
                        modality="chat" allowNone=${true} allowCustom=${!isOpenRouter} />
                    <//>`}
                <//>

                <${ModelPicker} ...${pickerProps} label=${t('profile.openrouter.model.vision')}
                  hint=${t('profile.openrouter.model.vision_hint')}
                  value=${visionModel} onChange=${setVisionModel}
                  modality="vision" allowNone=${true} allowCustom=${!isOpenRouter}
                  noneLabel=${t('profile.openrouter.model.visionNone')} />
              <//>

              <${Split}>
                <${Fields}>
                  ${sttModels.length === 0 && keyed
                    ? html`<${Note}>${t('profile.openrouter.stt.listEmpty')}<//>` : null}
                  <${ModelPicker} models=${sttModels} isOpenRouter=${isOpenRouter} disabled=${!keyed}
                    label=${t('profile.openrouter.model.stt')} hint=${t('profile.openrouter.model.stt_hint')}
                    value=${sttModel} onChange=${setSttModel} modality="transcription" allowNone=${true}
                    allowCustom=${!isOpenRouter} noneLabel=${t('profile.openrouter.model.sttNone')} />

                  <${Select} fit label=${t('profile.openrouter.stt.language')}
                    hint=${t('profile.openrouter.stt.language_hint')}
                    value=${sttLanguage} onChange=${setSttLanguage}
                    options=${STT_LANGS.map(code => [code, code ? t('profile.openrouter.stt.lang_' + code) : t('profile.openrouter.stt.languageAuto')])} />

                  <${SttTestPanel} sttModel=${sttModel} sttLanguage=${sttLanguage} />
                <//>
              <//>
            `}

            <${FormActions}>
              <${Loud} control onClick=${saveModels} disabled=${savingModels}>
                ${savingModels ? '…' : t('profile.openrouter.saveModels')}
              <//>
              ${modelsMsg && html`<${Note} kind="message" error=${modelsMsg.error}>${modelsMsg.text}<//>`}
            <//>
          <//>

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
            <${Card} tone="section" title=${t('profile.openrouter.section.budget')}>
              <${AiAppsBudgetPanel} />
            <//>`}
        <//><//>
      <${ConfirmUI} />
    <//>`;
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
    <${Stack}>
      <${Row} wrap>
        <${VoiceRecorder} small maxSeconds=${30} disabled=${busy || !sttModel}
          label=${t('profile.openrouter.stt.test')}
          onRecorded=${(file) => run(file)} />
        ${busy ? html`<${Note} inline>${t('profile.openrouter.stt.testing')}<//>` : null}
        ${!sttModel ? html`<${Note} inline>${t('profile.openrouter.stt.testNeedsModel')}<//>` : null}
      <//>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${result ? html`
        <${Box} tone="row">
          ${result.text || t('profile.openrouter.stt.testSilent')}
          <${Note} kind="meta">
            ${t('profile.openrouter.stt.measured', {
              seconds: (Number(result.seconds) || 0).toFixed(1),
              cost: (Number(result.usage?.cost_usd) || 0).toFixed(6),
            })}
            ${result.usage?.cost_exact === false
              ? html` <${Note} inline>${t('profile.openrouter.stt.costNotReported')}<//>` : null}
          <//>
        <//>` : null}
    <//>`;
}

/** Sampling parameters. Collapsed by default: most owners never touch them, and four rarely-used
 *  numeric fields sitting open is part of what pushed the save button off the screen before. */
function ParamsSection({
  autoRetry, setAutoRetry, maxRetries, setMaxRetries, temperature, setTemperature,
  topP, setTopP, maxTokens, setMaxTokens, saving, onSave, message,
}) {
  const [open, setOpen] = useState(false);
  return html`
    <${FoldSection} num="" title=${t('profile.openrouter.section.params')} open=${open} onToggle=${() => setOpen(o => !o)}>

      <${Fields}>
        <${Check} checked=${autoRetry} onChange=${setAutoRetry}>${t('profile.openrouter.autoRetry')}<//>

        ${autoRetry && html`
          <${TextField} type="number" size="short" label=${t('profile.openrouter.maxRetries')} min="1" max="10" value=${maxRetries}
            onInput=${v => setMaxRetries(Math.min(10, Math.max(1, parseInt(v) || 1)))} />`}

        <${TextField} type="number" size="short" label=${t('profile.openrouter.temperature')}
          hint=${t('profile.openrouter.temperature_hint')} min="0" max="2" step="0.1"
          placeholder=${t('profile.openrouter.paramDefault')} value=${temperature}
          onInput=${setTemperature} />

        <${TextField} type="number" size="short" label=${t('profile.openrouter.topP')}
          hint=${t('profile.openrouter.topP_hint')} min="0" max="1" step="0.05"
          placeholder=${t('profile.openrouter.paramDefault')} value=${topP}
          onInput=${setTopP} />

        <${TextField} type="number" size="short" label=${t('profile.openrouter.maxTokens')}
          hint=${t('profile.openrouter.maxTokens_hint')} min="256" max="128000" step="256"
          placeholder=${t('profile.openrouter.paramDefault')} value=${maxTokens}
          onInput=${setMaxTokens} />
      <//>

      <${FormActions}>
        <${Loud} control onClick=${onSave} disabled=${saving}>
          ${saving ? '…' : t('profile.openrouter.saveParams')}
        <//>
        ${message && html`<${Note} kind="message" error=${message.error}>${message.text}<//>`}
      <//>
    <//>`;
}
