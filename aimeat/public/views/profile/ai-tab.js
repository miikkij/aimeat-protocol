/**
 * @file ai-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: which providers answer, as which roles, under which model policy and within
 *   what daily budget. The reads (the owner's connection, the AI budget settings, today's usage,
 *   the 30-day history, and the chat's own word on who pays for it) and the handlers (save the
 *   connection and key, test it, remove the key; the daily budget; per-app caps written on the rows).
 *   The connection goes through the legacy routes (/v1/openrouter/settings and /test) while the node
 *   answers them, exactly as before node 4.0.0; when one answers 410 GONE (node 4.0.0, or an operator
 *   who switched them off), it is the owner's provider `openrouter`, `lmstudio` or `custom`, read and
 *   written through the provider routes by js/services/ai-connection.js (legacyOr there is the switch).
 *   The providers, the routing and the model policy are ai/use-providers.js; the roles and the app
 *   roles' bindings are ai/use-roles.js. The render is ai/page.js. The older collapsible panel
 *   (openrouter-settings.js) stays for the notebook, which embeds it inline.
 * @structure AiSettingsTab() — state + handlers (each a legacy call, and the provider call on a 410) → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'ai' (alias 'generator')
 * @version-history
 *   v1.5.0 — 2026-10-13 — Legacy route first, provider path on 410 (js/services/ai-connection.js
 *     legacyOr): on 3.x the connection section calls /v1/openrouter/settings and /test as it did before
 *     v1.4.0, so the providers table, who pays for the chat, the test and the removal are as they were.
 *     On the provider path a removal reads the connection again, since a retired one can stay.
 *   v1.4.0 — 2026-10-12 — The connection section reads and writes the owner's provider through
 *     /v1/ai/providers (js/services/ai-connection.js): node 4.0.0 removes /v1/openrouter/settings and
 *     /v1/openrouter/test, which it called. The same section, words and controls on 3.x and 4.0.0.
 *   v1.3.0 — 2026-09-28 — AI roles (wish-tekoalyn-roolit): the six fixed model roles and the fine-tuning
 *     leave this page. A capability's model and fine-tuning are set on its provider, which the owner
 *     orders in the routing; what a model is used for is a role (ai/use-roles.js). The catalogue of
 *     OpenRouter models is no longer read here, since no picker on the page uses it.
 *   v1.2.0 — 2026-09-28 — The providers, the routing and the model policy (System 2) are sections of
 *     this page: their state and handlers are ai/use-providers.js, passed to the render as ctx.pv.
 *   v1.1.0 — 2026-09-09 — The parameters section carries the reasoning setting: one word on the
 *     page (default, off, light, medium, deep), OpenRouter's object on the wire. Exists because a
 *     reasoning model behind a token limit spends the limit thinking and answers with nothing.
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
import {
  legacyOr, legacyGone, readConnection, saveConnection as saveConnectionTo, testConnection as testConnectionOf, removeConnection,
} from '/js/services/ai-connection.js';
import { renderPage } from './ai/page.js';
import { x, rollup } from './ai/frame.js';
import { useProviders } from './ai/use-providers.js';
import { useRoles } from './ai/use-roles.js';

const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 6000); };

export default function AiSettingsTab({ navigate, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [settings, setSettings] = useState(null);
  const [current, setCurrent] = useState(null);
  const [aiSettings, setAiSettings] = useState(null);
  const [usage, setUsage] = useState(null);
  const [history, setHistory] = useState(null);
  const [chat, setChat] = useState(null);
  const [conn, setConnState] = useState({ provider: 'openrouter', baseUrl: '', apiKey: '' });
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [capsEditing, setCapsEditing] = useState(false);
  const [caps, setCaps] = useState({});
  const [showAllApps, setShowAllApps] = useState(false);
  const [metric, setMetric] = useState('cost');
  const [busy, setBusy] = useState(false);
  const [connMsg, setConnMsg] = useState(null);
  const [budgetMsg, setBudgetMsg] = useState(null);
  const [capsMsg, setCapsMsg] = useState(null);

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const pv = useProviders({ confirm, toast });
  const rl = useRoles({ confirm, toast, reloadProviders: pv.load });
  const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');
  const host = window.location.hostname;

  const keyedFor = (s) => !!(s && (s.hasApiKey || (s.provider && s.provider !== 'openrouter')));

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

  /** The connection from the provider routes (node 4.0.0): the owner's provider, as settings. */
  const loadConnection = async () => {
    const r = await readConnection();
    setCurrent(r.current);
    setSettings(r.settings);
    setConnState({ provider: r.settings.provider, baseUrl: r.settings.baseUrl, apiKey: '' });
  };

  const load = useCallback(async () => {
    try {
      await legacyOr(async () => {
        const r = await apiGet('/v1/openrouter/settings');
        const s = r?.data || {};
        setSettings(s);
        setConnState({ provider: s.provider || 'openrouter', baseUrl: s.baseUrl || '', apiKey: '' });
      }, loadConnection);
    } catch (e) { swallowed('ai: settings', e); setSettings({}); }
    loadUsage();
    // The chat's own word on who pays for it: best effort, and the node's answer rather than a guess.
    try { const c = await apiGet('/v1/chat/status'); if (c?.ok !== false && c?.data) setChat(c.data); } catch (e) { swallowed('ai: chat status', e); }
  }, [loadUsage]);
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- mount-only
  useEffect(() => {
    const handler = () => loadUsage();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadUsage]);

  const setConn = (patch) => setConnState((c) => ({ ...c, ...patch }));
  const setProvider = (p) => setConnState((c) => ({ ...c, provider: p, baseUrl: p === 'lmstudio' ? 'http://localhost:1234/v1' : p === 'openrouter' ? '' : c.baseUrl }));

  /** Every legacy PUT carries the provider and its address, since the route resets them to OpenRouter otherwise. */
  const put = (fields) => apiPut('/v1/openrouter/settings', { provider: conn.provider, baseUrl: conn.baseUrl, ...fields });

  const saveConnection = async () => {
    setBusy('conn');
    const flash = flashFor(setConnMsg);
    try {
      await legacyOr(async () => {
        const body = {};
        if (conn.apiKey) body.apiKey = conn.apiKey;
        const r = await put(body);
        if (r?.ok === false) throw r;
        const next = { ...settings, provider: conn.provider, baseUrl: conn.baseUrl, hasApiKey: settings.hasApiKey || !!conn.apiKey };
        setSettings(next);
      }, async () => {
        // The owner's provider `openrouter`, `lmstudio` or `custom` (js/services/ai-connection.js).
        await saveConnectionTo(current, { provider: conn.provider, baseUrl: conn.baseUrl, apiKey: conn.apiKey });
        const r = await readConnection();
        setCurrent(r.current);
        setSettings(r.settings);
      });
      setConnState((c) => ({ ...c, apiKey: '' }));
      flash(conn.apiKey ? x('keySaved') : x('providerSaved'));
      pv.load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const testConnection = async () => {
    setBusy('test');
    const flash = flashFor(setConnMsg);
    const started = Date.now();
    try {
      await legacyOr(async () => {
        const r = await apiPost('/v1/openrouter/test');
        if (r?.ok === false) {
          const spent = r.error?.code === 'QUOTA_EXHAUSTED' || r.error?.code === 'APP_QUOTA_EXHAUSTED';
          flash((spent ? x('testBudgetSpent') : x('testFail')) + (r.error?.message ? ': ' + r.error.message : ''), true);
        } else {
          flash(x('testOk', { model: r?.data?.model || '', ms: Date.now() - started }));
          toast(x('testOk', { model: r?.data?.model || '', ms: Date.now() - started }));
          loadUsage();
        }
      }, async () => {
        const r = await testConnectionOf(current);
        flash(x('testOk', { model: r.model, ms: Date.now() - started }));
        toast(x('testOk', { model: r.model, ms: Date.now() - started }));
        loadUsage();
        pv.load();
      });
    } catch (e) {
      if (!legacyGone()) flash(`${x('testFail')}: ${errText(e)}`, true);
      else {
        // A spent budget is not a broken connection, and the head says which it was.
        const spent = e?.code === 'QUOTA_EXHAUSTED' || e?.code === 'APP_QUOTA_EXHAUSTED';
        const why = e?.response?.error?.message || e?.message || '';
        flash((spent ? x('testBudgetSpent') : x('testFail')) + (why ? ': ' + why : ''), true);
      }
    }
    setBusy(false);
  };

  const removeKey = () => {
    confirm(x('confirmRemove'), async () => {
      try {
        await legacyOr(async () => {
          await apiDelete('/v1/openrouter/settings');
          setSettings({ hasApiKey: false, provider: 'openrouter', baseUrl: '', autoRetry: true, maxRetries: 3 });
          setConnState({ provider: 'openrouter', baseUrl: '', apiKey: '' });
        }, async () => {
          await removeConnection(current);
          // A connection an agent keeps a key for stays, without the owner's key and out of use.
          await loadConnection();
        });
        toast(x('removedToast'));
        pv.load();
      } catch (e) { toast(errText(e), true); }
    }, { danger: true });
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

  const ctx = {
    settings, aiSettings, usage, history, chat, conn,
    budgetEditing, budgetDraft, capsEditing, caps, showAllApps, metric, busy,
    connMsg, budgetMsg, capsMsg,
    keyed: keyedFor(settings), host,
    quotas: aiSettings?.app_quotas || {},
    roll: history ? rollup(history, usage, aiSettings?.app_quotas) : null,
    navigate, ConfirmUI, pv, rl,
    setConn, setProvider, saveConnection, testConnection, removeKey,
    setBudgetEditing, setBudgetDraft, saveBudget, setCapsEditing, setCap, saveCaps, setShowAllApps, setMetric,
  };
  return renderPage(ctx);
}
