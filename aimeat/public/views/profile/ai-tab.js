/**
 * @file ai-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: which model answers, on whose key, within what daily budget. The reads
 *   (the owner's provider settings, the AI budget settings, today's usage, the 30-day history, the
 *   catalogue for chat and for transcription, and the chat's own word on who pays for it) and the
 *   handlers (save the provider and key, test with a real completion, remove the key; set one model
 *   role and have it stored at once; the speech language and a measured transcription; the daily
 *   budget; per-app caps written on the rows; the sampling parameters). The render is ai/page.js and
 *   ai/rows.js. The older collapsible panel (openrouter-settings.js) stays for the notebook, which
 *   embeds it inline.
 * @structure AiSettingsTab() — state + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'ai' (alias 'generator')
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Tekoäly-sivu", direction A): one page
 *     instead of a collapsible panel; the image-generation role gets its row (the field had been in
 *     the API since 2026-08-16 with nowhere to set it); a model choice is stored on the row; the
 *     caps table shows what spent, eight rows first; the chat's payer is read from the server
 *     instead of promised.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { renderPage } from './ai/page.js';
import { x, rollup } from './ai/frame.js';

/** Read a File as bare base64 (no data: prefix), the shape /v1/ai/transcribe takes inline. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read failed'));
    fr.onload = () => { const s = String(fr.result || ''); const i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s); };
    fr.readAsDataURL(file);
  });
}

const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 6000); };

export default function AiSettingsTab({ navigate, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [settings, setSettings] = useState(null);
  const [aiSettings, setAiSettings] = useState(null);
  const [usage, setUsage] = useState(null);
  const [history, setHistory] = useState(null);
  const [chat, setChat] = useState(null);
  const [models, setModels] = useState([]);
  const [sttModels, setSttModels] = useState([]);
  const [modelsError, setModelsError] = useState(null);
  const [conn, setConnState] = useState({ provider: 'openrouter', baseUrl: '', apiKey: '' });
  const [openRole, setOpenRole] = useState(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sttResult, setSttResult] = useState(null);
  const [sttError, setSttError] = useState(null);
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [capsEditing, setCapsEditing] = useState(false);
  const [caps, setCaps] = useState({});
  const [showAllApps, setShowAllApps] = useState(false);
  const [metric, setMetric] = useState('cost');
  const [paramsEditing, setParamsEditing] = useState(false);
  const [params, setParamsState] = useState({ temperature: '', top_p: '', max_tokens: '', autoRetry: true, maxRetries: 3 });
  const [busy, setBusy] = useState(false);
  const [connMsg, setConnMsg] = useState(null);
  const [modelsMsg, setModelsMsg] = useState(null);
  const [budgetMsg, setBudgetMsg] = useState(null);
  const [capsMsg, setCapsMsg] = useState(null);
  const [paramsMsg, setParamsMsg] = useState(null);

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');
  const host = window.location.hostname;

  const keyedFor = (s) => !!(s && (s.hasApiKey || (s.provider && s.provider !== 'openrouter')));

  const loadModels = useCallback(async (s) => {
    const cur = s || settings;
    if (!keyedFor(cur)) { setModels([]); setSttModels([]); return; }
    setBusy('models');
    setModelsError(null);
    const [chatList, stt] = await Promise.all([
      apiGet('/v1/openrouter/models').catch((e) => ({ ok: false, error: { message: e?.message } })),
      apiGet('/v1/openrouter/models?modality=transcription').catch((e) => { swallowed('ai: stt models', e); return { ok: false, data: null }; }),
    ]);
    if (chatList && chatList.ok !== false && Array.isArray(chatList.data?.models)) {
      setModels(chatList.data.models);
      if (!chatList.data.models.length) setModelsError(x('modelsEmpty'));
    } else { setModels([]); setModelsError(chatList?.error?.message || x('modelsError')); }
    setSttModels((stt && stt.ok !== false && Array.isArray(stt.data?.models)) ? stt.data.models : []);
    setBusy(false);
  }, [settings]);

  const loadUsage = useCallback(async () => {
    const [u, a, h] = await Promise.all([
      apiGet('/v1/ai/usage').catch((e) => { swallowed('ai: usage', e); return null; }),
      apiGet('/v1/ai/settings').catch((e) => { swallowed('ai: settings', e); return null; }),
      apiGet('/v1/ai/usage/history?days=30').catch((e) => { swallowed('ai: history', e); return null; }),
    ]);
    if (u?.ok !== false && u?.data) setUsage(u.data);
    if (a?.ok !== false && a?.data) { setAiSettings(a.data); setBudgetDraft(String(a.data.daily_budget_usd ?? 1)); setCaps(Object.fromEntries(Object.entries(a.data.app_quotas || {}).map(([app, v]) => [app, v?.daily_usd != null ? String(v.daily_usd) : '']))); }
    if (h?.ok !== false && h?.data) setHistory(h.data);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/openrouter/settings');
      const s = r?.data || {};
      setSettings(s);
      setConnState({ provider: s.provider || 'openrouter', baseUrl: s.baseUrl || '', apiKey: '' });
      setParamsState({ temperature: s.temperature != null ? String(s.temperature) : '', top_p: s.top_p != null ? String(s.top_p) : '', max_tokens: s.max_tokens != null ? String(s.max_tokens) : '', autoRetry: !!s.autoRetry, maxRetries: s.maxRetries || 3 });
      loadModels(s);
    } catch (e) { swallowed('ai: settings', e); setSettings({}); }
    loadUsage();
    // The chat's own word on who pays for it: best effort, and the node's answer rather than a guess.
    try { const c = await apiGet('/v1/chat/status'); if (c?.ok !== false && c?.data) setChat(c.data); } catch (e) { swallowed('ai: chat status', e); }
  }, [loadModels, loadUsage]);
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- mount-only

  const setConn = (patch) => setConnState((c) => ({ ...c, ...patch }));
  const setProvider = (p) => setConnState((c) => ({ ...c, provider: p, baseUrl: p === 'lmstudio' ? 'http://localhost:1234/v1' : p === 'openrouter' ? '' : c.baseUrl }));

  /** Every PUT carries the provider and its address, since the route resets them to OpenRouter otherwise. */
  const put = (fields) => apiPut('/v1/openrouter/settings', { provider: conn.provider, baseUrl: conn.baseUrl, ...fields });

  const saveConnection = async () => {
    setBusy('conn');
    const flash = flashFor(setConnMsg);
    try {
      const body = {};
      if (conn.apiKey) body.apiKey = conn.apiKey;
      const r = await put(body);
      if (r?.ok === false) throw r;
      const next = { ...settings, provider: conn.provider, baseUrl: conn.baseUrl, hasApiKey: settings.hasApiKey || !!conn.apiKey };
      setSettings(next);
      setConnState((c) => ({ ...c, apiKey: '' }));
      flash(conn.apiKey ? x('keySaved') : x('providerSaved'));
      await loadModels(next);
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const testConnection = async () => {
    setBusy('test');
    const flash = flashFor(setConnMsg);
    const started = Date.now();
    try {
      const r = await apiPost('/v1/openrouter/test');
      if (r?.ok === false) {
        const spent = r.error?.code === 'QUOTA_EXHAUSTED' || r.error?.code === 'APP_QUOTA_EXHAUSTED';
        flash((spent ? x('testBudgetSpent') : x('testFail')) + (r.error?.message ? ': ' + r.error.message : ''), true);
      } else {
        flash(x('testOk', { model: r?.data?.model || '', ms: Date.now() - started }));
        toast(x('testOk', { model: r?.data?.model || '', ms: Date.now() - started }));
        loadUsage();
      }
    } catch (e) { flash(`${x('testFail')}: ${errText(e)}`, true); }
    setBusy(false);
  };

  const removeKey = () => {
    confirm(x('confirmRemove'), async () => {
      try {
        await apiDelete('/v1/openrouter/settings');
        setSettings({ hasApiKey: false, provider: 'openrouter', baseUrl: '', autoRetry: true, maxRetries: 3 });
        setConnState({ provider: 'openrouter', baseUrl: '', apiKey: '' });
        setModels([]); setSttModels([]); setModelsError(null); setOpenRole(null);
        toast(x('removedToast'));
      } catch (e) { toast(errText(e), true); }
    }, { danger: true });
  };

  const toggleRole = (id) => { setOpenRole((cur) => (cur === id ? null : id)); setQuery(''); setShowAll(false); };

  const setRole = async (role, id) => {
    setBusy('role');
    const flash = flashFor(setModelsMsg);
    try {
      const r = await put({ [role.field]: id || null });
      if (r?.ok === false) throw r;
      setSettings((s) => ({ ...s, [role.field]: id || null }));
      flash(id ? x('roleSaved', { role: x('role.' + role.id), model: id }) : (role.off === 'default' ? x('roleCleared', { role: x('role.' + role.id) }) : x('roleOffSaved', { role: x('role.' + role.id) })));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const setSttLanguage = async (code) => {
    setBusy('role');
    const flash = flashFor(setModelsMsg);
    try {
      const r = await put({ sttLanguage: code || null });
      if (r?.ok === false) throw r;
      setSettings((s) => ({ ...s, sttLanguage: code || null }));
      flash(x('sttLangSaved'));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const sttTest = async (file) => {
    setBusy('stt'); setSttError(null); setSttResult(null);
    try {
      const audio_base64 = await fileToBase64(file);
      const r = await apiPost('/v1/ai/transcribe', { audio_base64, mime: file.type, filename: file.name, model: settings.sttModel || undefined, language: settings.sttLanguage || undefined, app_id: 'settings-test' });
      if (r?.ok === false) throw new Error(r.error?.message || x('sttFailed'));
      setSttResult(r.data);
      loadUsage();
    } catch (e) { setSttError(errText(e, x('sttFailed'))); }
    setBusy(false);
  };

  const saveBudget = async () => {
    const n = Number(budgetDraft);
    const flash = flashFor(setBudgetMsg);
    if (!Number.isFinite(n) || n < 0 || n > 1000) { flash(x('budgetRange'), true); return; }
    setBusy('budget');
    try {
      const r = await apiPost('/v1/ai/settings', { daily_budget_usd: n });
      if (r?.ok === false) throw r;
      setBudgetEditing(false);
      flash(x('budgetSaved', { n: n.toFixed(2) }));
      await loadUsage();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const setCap = (app, value) => setCaps((c) => ({ ...c, [app]: value }));
  const saveCaps = async () => {
    const flash = flashFor(setCapsMsg);
    const app_quotas = {};
    for (const [app, val] of Object.entries(caps)) {
      const s = String(val ?? '').trim();
      if (s === '') continue;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > 1000) { flash(x('capRange', { app }), true); return; }
      app_quotas[app] = { daily_usd: n };
    }
    setBusy('caps');
    try {
      const r = await apiPost('/v1/ai/settings', { app_quotas });
      if (r?.ok === false) throw r;
      setCapsEditing(false);
      flash(x('capsSaved', { n: Object.keys(app_quotas).length }));
      await loadUsage();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const setParams = (patch) => setParamsState((p) => ({ ...p, ...patch }));
  const saveParams = async () => {
    setBusy('params');
    const flash = flashFor(setParamsMsg);
    try {
      const body = {
        autoRetry: !!params.autoRetry,
        maxRetries: parseInt(params.maxRetries, 10) || 3,
        temperature: params.temperature !== '' ? parseFloat(params.temperature) : null,
        top_p: params.top_p !== '' ? parseFloat(params.top_p) : null,
        max_tokens: params.max_tokens !== '' ? parseInt(params.max_tokens, 10) : null,
      };
      const r = await put(body);
      if (r?.ok === false) throw r;
      setSettings((s) => ({ ...s, ...body }));
      setParamsEditing(false);
      flash(x('paramsSaved'));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const ctx = {
    settings, aiSettings, usage, history, chat, models, sttModels, modelsError, conn, openRole, query, showAll,
    sttResult, sttError, budgetEditing, budgetDraft, capsEditing, caps, showAllApps, metric, paramsEditing, params, busy,
    connMsg, modelsMsg, budgetMsg, capsMsg, paramsMsg,
    keyed: keyedFor(settings), isOpenRouter: (settings?.provider || 'openrouter') === 'openrouter', host,
    quotas: aiSettings?.app_quotas || {},
    roll: history ? rollup(history, usage, aiSettings?.app_quotas) : null,
    navigate, ConfirmUI,
    setConn, setProvider, saveConnection, testConnection, removeKey, loadModels: () => loadModels(settings),
    toggleRole, setQuery, setShowAll, setRole, setSttLanguage, sttTest,
    setBudgetEditing, setBudgetDraft, saveBudget, setCapsEditing, setCap, saveCaps, setShowAllApps, setMetric,
    setParamsEditing, setParams, saveParams,
  };
  return renderPage(ctx);
}
