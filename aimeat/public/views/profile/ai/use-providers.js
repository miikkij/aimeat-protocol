/**
 * @file public/views/profile/ai/use-providers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The state and handlers behind the AI page's providers, routing and model policy
 *   sections: the reads (GET /v1/ai/providers, GET /v1/ai/policy) and the writes (add or change a
 *   provider, set or remove its key, test it for one capability, delete it; the ordered providers
 *   per capability and the routing rules; the model policy and whose calls it covers). Every write
 *   is the owner's and applies at once. The render is ai/providers.js.
 * @structure useProviders() → pv (state + handlers) · CAPS · PROVIDER_TYPES · slug
 * @usage const pv = useProviders(); … renderProviders(ctx) reads ctx.pv
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (System 2): the page for the providers, the routing and the model
 *     policy the node has had since V2 to V6, on the page's existing components.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { x } from './frame.js';

/** The capabilities in the order the page lists them (services/ai/providers.ts ALL_CAPABILITIES). */
export const CAPS = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];

/** The types an owner can add, and what each serves (services/ai/providers.ts TYPE_CAPABILITIES). */
export const PROVIDER_TYPES = {
  openrouter: CAPS,
  openai: CAPS,
  anthropic: ['text', 'vision', 'files'],
  mistral: ['text', 'vision', 'files', 'transcription', 'embed'],
  xai: ['text', 'vision', 'image', 'transcription'],
  local: ['text', 'vision', 'image', 'speech', 'transcription', 'embed'],
  'openai-compatible': ['text', 'vision', 'image', 'speech', 'transcription', 'embed'],
  extension: CAPS,
};

/** A provider id from a name: lower-case letters, digits and '-', 2 to 63 characters. */
export function slug(title) {
  const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return s.length >= 2 ? s : '';
}

const EMPTY_DRAFT = { type: 'openrouter', title: '', baseUrl: '', extension: '', apiKey: '', caps: { text: true } };
const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 6000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback;

/** A provider as the PUT body takes it back: its fields, with the capabilities as the record keeps them. */
function bodyOf(p, capabilities) {
  return {
    title: p.title, type: p.type,
    ...(p.type === 'local' || p.type === 'openai-compatible' ? { baseUrl: p.base_url } : {}),
    ...(p.extension ? { extension: p.extension } : {}),
    auth: { type: p.auth?.type === 'none' ? 'none' : 'key' },
    capabilities,
  };
}

/** The capability config without the view's own additions (model_status, model_retires_at). */
function capsOf(p) {
  const out = {};
  for (const [c, v] of Object.entries(p.capabilities || {})) {
    if (!v) continue;
    const cfg = { ...v };
    delete cfg.model_status;
    delete cfg.model_retires_at;
    out[c] = cfg;
  }
  return out;
}

export function useProviders({ confirm, toast }) {
  const [view, setView] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraftState] = useState(EMPTY_DRAFT);
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState({});
  const [testCap, setTestCap] = useState('text');
  const [routeDraft, setRouteDraft] = useState(null);
  const [rulesDraft, setRulesDraft] = useState(null);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [addMsg, setAddMsg] = useState(null);
  const [routeMsg, setRouteMsg] = useState(null);
  const [policyMsg, setPolicyMsg] = useState(null);

  const load = useCallback(async () => {
    const [v, p] = await Promise.all([
      apiGet('/v1/ai/providers').catch((e) => ({ ok: false, error: { message: e?.message } })),
      apiGet('/v1/ai/policy').catch((e) => { swallowed('ai: policy', e); return null; }),
    ]);
    if (v && v.ok !== false && v.data) { setView(v.data); setError(null); } else setError(errText(v, x('pv.loadFailed')));
    if (p && p.ok !== false && p.data) setPolicy(p.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const providers = view?.providers || [];
  const owned = providers.filter((p) => p.source === 'owner');
  const find = (id) => providers.find((p) => p.id === id);

  const toggle = (id) => {
    setOpenId((cur) => (cur === id ? null : id));
    setKeyDraft('');
    const p = find(id);
    setModelDraft(Object.fromEntries(Object.entries(p?.capabilities || {}).map(([c, v]) => [c, v?.model || ''])));
  };

  const setDraft = (patch) => setDraftState((d) => {
    const next = { ...d, ...patch };
    // A type change keeps only the capabilities the new type serves.
    if (patch.type) next.caps = Object.fromEntries(Object.entries(next.caps).filter(([c]) => PROVIDER_TYPES[patch.type].includes(c)));
    if (patch.type === 'local' && !d.baseUrl) next.baseUrl = 'http://127.0.0.1:1234/v1';
    return next;
  });
  const toggleDraftCap = (c, on) => setDraftState((d) => ({ ...d, caps: { ...d.caps, [c]: on } }));

  const add = async () => {
    const flash = flashFor(setAddMsg);
    const id = slug(draft.title || (draft.type === 'extension' ? draft.extension : draft.type));
    if (!id) { flash(x('pv.nameNeeded'), true); return; }
    if (find(id)) { flash(x('pv.nameTaken', { id }), true); return; }
    const capabilities = Object.fromEntries(Object.entries(draft.caps).filter(([, on]) => on).map(([c]) => [c, { enabled: true }]));
    if (!Object.keys(capabilities).length) { flash(x('pv.capNeeded'), true); return; }
    setBusy('add');
    try {
      const body = {
        title: draft.title.trim() || id, type: draft.type, capabilities,
        ...(draft.type === 'local' || draft.type === 'openai-compatible' ? { baseUrl: draft.baseUrl.trim() } : {}),
        ...(draft.type === 'extension' ? { extension: draft.extension.trim() } : {}),
        auth: { type: draft.type === 'local' || (draft.type === 'openai-compatible' && !draft.apiKey) ? 'none' : 'key' },
      };
      const r = await apiPut(`/v1/ai/providers/${id}`, body);
      if (r?.ok === false) throw r;
      if (draft.apiKey && body.auth.type === 'key') {
        const k = await apiPut(`/v1/ai/providers/${id}/key`, { api_key: draft.apiKey });
        if (k?.ok === false) throw k;
      }
      setAdding(false);
      setDraftState(EMPTY_DRAFT);
      toast(x('pv.added', { name: body.title }));
      await load();
      setOpenId(id);
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const saveKey = async (id) => {
    const flash = flashFor(setMsg);
    if (!keyDraft.trim()) { flash(x('pv.keyEmpty'), true); return; }
    setBusy('key');
    try {
      const r = await apiPut(`/v1/ai/providers/${id}/key`, { api_key: keyDraft.trim() });
      if (r?.ok === false) throw r;
      setKeyDraft('');
      flash(x('keySaved'));
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const removeKey = (id) => {
    confirm(x('pv.confirmRemoveKey'), async () => {
      try {
        const r = await apiDelete(`/v1/ai/providers/${id}/key`);
        if (r?.ok === false) throw r;
        toast(x('removedToast'));
        await load();
      } catch (e) { toast(errText(e, x('saveFailed')), true); }
    }, { danger: true });
  };

  /** Turn one capability on or off, or give it a model, and store the provider at once. */
  const saveCap = async (p, c, patch) => {
    const flash = flashFor(setMsg);
    const caps = capsOf(p);
    const cur = caps[c] || { enabled: false };
    const next = { ...cur, ...patch };
    // A capability with a model joins the owner's pool, so routing can pick it by capability alone
    // (services/ai/route-plan.ts inPool); the server refuses a pool entry with no model.
    if (next.model) next.pool = true;
    else { delete next.model; next.pool = false; }
    caps[c] = next;
    setBusy('cap');
    try {
      const r = await apiPut(`/v1/ai/providers/${p.id}`, bodyOf(p, caps));
      if (r?.ok === false) throw r;
      flash(r?.data?.warnings?.length ? r.data.warnings.join(' ') : x('pv.capSaved', { cap: x('cap.' + c) }), !!r?.data?.warnings?.length);
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const test = async (p, acceptCost = false) => {
    const flash = flashFor(setMsg);
    setBusy('test');
    try {
      const r = await apiPost(`/v1/ai/providers/${p.id}/test`, { capability: testCap, accept_cost: acceptCost });
      if (r?.ok === false) throw r;
      const d = r.data || {};
      flash(x('pv.testOk', { cap: x('cap.' + testCap), model: d.model || '', ms: d.latency_ms ?? 0, cost: d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(4)}` : '–' }));
      await load();
    } catch (e) {
      if (e?.error?.code === 'AI_TEST_COSTS_MONEY') {
        setBusy(false);
        confirm(`${e.error.message} ${x('pv.testCostAsk')}`, () => test(p, true));
        return;
      }
      flash(`${x('testFail')}: ${errText(e, '')}`, true);
      await load();
    }
    setBusy(false);
  };

  const remove = (p) => {
    confirm(x('pv.confirmDelete', { name: p.title }), async () => {
      try {
        const r = await apiDelete(`/v1/ai/providers/${p.id}`);
        if (r?.ok === false) throw r;
        setOpenId(null);
        toast(x('pv.deleted', { name: p.title }));
        await load();
      } catch (e) { toast(errText(e, x('saveFailed')), true); }
    }, { danger: true });
  };

  /* ── Routing ── */
  const editRouting = (on) => {
    if (!on) { setRouteDraft(null); setRulesDraft(null); return; }
    setRouteDraft(Object.fromEntries(CAPS.map((c) => [c, [...(view?.routing?.defaults?.[c] || [])]])));
    setRulesDraft({ ...(view?.routing?.rules || {}) });
  };
  /** Put a provider at a place in one capability's order ('' at a place drops that place and those after it). */
  const setRoute = (c, i, id) => setRouteDraft((d) => {
    const list = [...(d[c] || [])].slice(0, id ? undefined : i);
    if (id) { const at = list.indexOf(id); if (at >= 0) list.splice(at, 1); list.splice(Math.min(i, list.length), 0, id); }
    return { ...d, [c]: list.slice(0, 3) };
  });
  const setRule = (patch) => setRulesDraft((r) => ({ ...r, ...patch }));
  const saveRouting = async () => {
    const flash = flashFor(setRouteMsg);
    const max = Number(rulesDraft.maxAttempts);
    const cost = String(rulesDraft.maxCostPerCallUsd ?? '').trim();
    if (!Number.isInteger(max) || max < 1 || max > 5) { flash(x('rt.attemptsRange'), true); return; }
    if (cost !== '' && !(Number(cost) >= 0)) { flash(x('rt.costRange'), true); return; }
    setBusy('routing');
    try {
      // Every capability, an empty list included: the server merges the change into what is stored
      // (services/ai/routing.ts), so a capability left out would keep its old order.
      const defaults = Object.fromEntries(CAPS.map((c) => [c, routeDraft[c] || []]));
      const rules = { ...rulesDraft, maxAttempts: max, maxCostPerCallUsd: cost === '' ? null : Number(cost) };
      const r = await apiPut('/v1/ai/routing', { routing: { defaults, rules } });
      if (r?.ok === false) throw r;
      editRouting(false);
      flash(x('rt.saved'));
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  /* ── Model policy ── */
  const editPolicy = (on) => {
    if (!on) { setPolicyDraft(null); return; }
    const p = policy?.policy || {};
    setPolicyDraft({ mode: p.mode || 'open', allow: (p.allow || []).join('\n'), appliesTo: { owner: true, chat: true, agents: true, apps: true, ...(p.appliesTo || {}) } });
  };
  const setPolicyField = (patch) => setPolicyDraft((d) => ({ ...d, ...patch }));
  const savePolicy = async () => {
    const flash = flashFor(setPolicyMsg);
    const allow = policyDraft.allow.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (policyDraft.mode === 'custom' && !allow.length) { flash(x('pol.allowNeeded'), true); return; }
    setBusy('policy');
    try {
      const r = await apiPut('/v1/ai/policy', { policy: { mode: policyDraft.mode, ...(policyDraft.mode === 'custom' ? { allow } : {}), appliesTo: policyDraft.appliesTo } });
      if (r?.ok === false) throw r;
      editPolicy(false);
      flash(x('pol.saved'));
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  return {
    view, policy, error, providers, owned, openId, adding, draft, keyDraft, modelDraft, testCap,
    routeDraft, rulesDraft, policyDraft, busy, msg, addMsg, routeMsg, policyMsg,
    load, toggle, setAdding, setDraft, toggleDraftCap, add, setKeyDraft, saveKey, removeKey,
    setModelDraft: (c, v) => setModelDraft((d) => ({ ...d, [c]: v })), saveCap, setTestCap, test, remove,
    editRouting, setRoute, setRule, saveRouting, editPolicy, setPolicyField, savePolicy,
  };
}
