/**
 * @file public/views/profile/ai/use-providers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The state and handlers behind the AI page's providers, routing and model policy
 *   sections: the reads (GET /v1/ai/providers, GET /v1/ai/policy, and the Content Classifier's state
 *   from GET /v1/ai/capabilities, the decision providers from GET /v1/ai/decide/providers) and the
 *   writes (add or change a provider, set or remove its key, test it for one capability, delete it;
 *   the ordered providers per capability, the routing rules and the Content Classifier's model,
 *   which is the owner's classification policy; the model policy and whose calls it covers). Every
 *   write is the owner's and applies at once. The render is ai/providers.js.
 * @structure useProviders() → pv (state + handlers) · CAPS · PROVIDER_TYPES · slug · classifierValue ·
 *   askedFor · testableCapOf · untestedIn
 * @usage const pv = useProviders(); … renderProviders(ctx) reads ctx.pv
 * @version-history
 *   v1.5.0 — 2026-10-02 — untestedIn: the providers of one capability's routing list that "Only tested
 *     providers" skips (an owner's, on, never tested), for the routing row's warning and its Test now.
 *   v1.4.0 — 2026-10-02 — The way to a test (Jouni: the person was not led to it): a settingsUrl
 *     (`?open=ai-provider-<id>&test=<capability>`) opens that provider at its test and scrolls to it;
 *     testNow runs an untested or failing provider's test from its row; `off` lists the capabilities
 *     that are off for a reason the person can fix here, from GET /v1/ai/capabilities, and `failing`
 *     the ones whose provider failed its last test. A failed form message stays until the next one.
 *   v1.3.0 — 2026-09-29 — The Content Classifier's choice in the routing editor (ccDraft, the decision
 *     providers from GET /v1/ai/decide/providers): Save stores it in the owner's classification policy
 *     (the classifier's type and provider) when it changed (Jouni's review, TARGET-082 V5).
 *   v1.2.0 — 2026-09-29 — pv.classifier: the Content Classifier's state (content_classifier of GET
 *     /v1/ai/capabilities), for its row among the capabilities (TARGET-082 V5).
 *   v1.1.0 — 2026-09-28 — A capability's editor holds its model and the settings its kind takes: the
 *     speech voice, the transcription language, OpenRouter's PDF engine, and the default fine-tuning
 *     of text, vision and files (AI roles).
 *   v1.0.0 — 2026-09-28 — Initial (System 2): the page for the providers, the routing and the model
 *     policy the node has had since V2 to V6, on the page's existing components.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { readPolicy, writePolicy } from '/js/services/classification.js';
import { x } from './frame.js';

/**
 * The Content Classifier's choice as the routing editor's select holds it: "<type>:<provider id>",
 * the id empty for the default (jev: the owner's default decision provider; llm: the text routing).
 * @param {{ type?: string, provider?: string|null }|null} cc
 * @returns {string|null}
 */
export const classifierValue = (cc) => (cc ? `${cc.type === 'llm' ? 'llm' : 'jev'}:${cc.provider || ''}` : null);

/**
 * Store the owner's Content Classifier choice in their classification policy: the stored layer is
 * read, its classifier gets the type and provider, and the whole layer goes back (the server takes a
 * level whole). What else the layer holds (the switch, labels, rules, kinds judged on write) stays.
 * @param {string} value "<type>:<provider id>"
 */
async function saveClassifierChoice(value) {
  const at = value.indexOf(':');
  const type = value.slice(0, at) === 'llm' ? 'llm' : 'jev';
  const provider = value.slice(at + 1) || null;
  const cur = await readPolicy('owner');
  const stored = { ...(cur?.stored || {}) };
  stored.classifier = { ...(stored.classifier || {}), type, provider };
  await writePolicy('owner', stored);
}

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
/** A form's message: a success goes after six seconds, a failure stays until the next message, so
 *  the person can read what went wrong (a failed test said why for six seconds only). */
const flashFor = (setter) => (text, error = false) => {
  const m = { text, error };
  setter(m);
  if (!error) setTimeout(() => setter((cur) => (cur === m ? null : cur)), 6000);
};
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

/** What the editor holds for one capability: its model and the settings its kind takes, as text. */
function capDraftOf(v) {
  const p = v?.params || {};
  const s = (n) => (n != null ? String(n) : '');
  return {
    model: v?.model || '', voice: v?.voice || '', language: v?.language || '', parser: v?.parser || '',
    temperature: s(p.temperature), top_p: s(p.top_p), max_tokens: s(p.max_tokens), reasoning: p.reasoning || '',
  };
}

/** The patch a capability's editor saves: the model, and the settings of its kind. */
export function capPatchOf(c, d, type) {
  const patch = { model: d.model.trim() };
  if (c === 'speech') patch.voice = d.voice.trim() || undefined;
  if (c === 'transcription') patch.language = d.language || undefined;
  if (c === 'files' && type === 'openrouter') patch.parser = d.parser || undefined;
  if (c === 'text' || c === 'vision' || c === 'files') {
    const num = (v) => (String(v).trim() === '' ? undefined : Number(v));
    const params = { temperature: num(d.temperature), top_p: num(d.top_p), max_tokens: num(d.max_tokens), reasoning: d.reasoning || undefined };
    patch.params = Object.values(params).some((v) => v !== undefined) ? params : undefined;
  }
  return patch;
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

/**
 * A link that opens one provider at its test, `?open=ai-provider-<id>&test=<capability>`, or the
 * providers section, `?open=ai-providers` (or `#ai-providers` on a cold load). The node gives this
 * address as `settingsUrl` with every AI refusal (services/ai/ai-fix-words.ts). Read once at mount:
 * the profile view rewrites the address to `?tab=ai` right after.
 */
function askedFor() {
  const q = new URLSearchParams(window.location.search);
  const open = q.get('open') || window.location.hash.slice(1);
  const test = q.get('test');
  return {
    open: open === 'ai-providers' || open.startsWith('ai-provider-') ? open : null,
    test: CAPS.includes(test) ? test : null,
  };
}

/** The model drafts an opened provider's capability editors start from. */
const modelDraftsOf = (p) => Object.fromEntries(Object.entries(p?.capabilities || {}).map(([c, v]) => [c, capDraftOf(v)]));

/** The enabled capability of an owner's provider that is not tested yet, or failed its last test (a
 *  refused key, say), or null: a test is what the person does next for it. Untested first. */
export function testableCapOf(p) {
  if (p.source !== 'owner') return null;
  const on = CAPS.filter((c) => p.capabilities?.[c]?.enabled);
  const status = (c) => p.health?.[c]?.status || 'untested';
  return on.find((c) => status(c) === 'untested') || on.find((c) => status(c) === 'failing') || null;
}

/**
 * The providers in one capability's routing list that the node skips under "Only tested providers":
 * an owner's provider whose capability is on and has never been tested (services/ai/route-plan.ts
 * rejects exactly those, 'untested'; a failing one is still tried). Empty when the rule is off.
 * @param {any} pv @param {string[]} list provider ids in routing order @param {string} cap @param {boolean} onlyTested
 * @returns {any[]} the providers, in the list's order
 */
export function untestedIn(pv, list, cap, onlyTested) {
  if (!onlyTested) return [];
  return (list || []).map((id) => pv.find(id)).filter((p) => p && p.source === 'owner'
    && p.capabilities?.[cap]?.enabled && (p.health?.[cap]?.status || 'untested') === 'untested');
}

/** Why a capability is off, worth a line above the providers. Text is the AI, so any reason is. For
 *  the others only what the person set up and is not working (a test, a key, a retired model): one
 *  nobody set up is not news, since most people never add speech or pictures. */
const SET_UP_BUT_OFF = ['UNTESTED', 'NO_KEY', 'RETIRED_MODEL'];
const worthALine = (cap, s) => s && s.on === false && s.reason !== 'APP_NOT_ALLOWED' && (cap === 'text' || SET_UP_BUT_OFF.includes(s.reason));

export function useProviders({ confirm, toast }) {
  const [asked] = useState(askedFor);
  const landed = useRef(false);
  const [view, setView] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [classifier, setClassifier] = useState(null);
  const [caps, setCaps] = useState(null);
  const [decideProviders, setDecideProviders] = useState([]);
  const [ccDraft, setCcDraft] = useState(null);
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
    // The Content Classifier's state is read on its own, so the providers never wait for it.
    apiGet('/v1/ai/capabilities')
      .then((c) => {
        if (!c || c.ok === false || !c.data) return;
        if (c.data.content_classifier) setClassifier(c.data.content_classifier);
        if (c.data.capabilities) setCaps(c.data.capabilities);
      })
      .catch((e) => swallowed('ai: capabilities', e));
    // The decision providers name the classifier's choices; none listed (the decision model off, or
    // no access) leaves the default decision model as its one decision choice.
    apiGet('/v1/ai/decide/providers')
      .then((d) => { if (d && d.ok !== false && Array.isArray(d.data?.providers)) setDecideProviders(d.data.providers); })
      .catch((e) => swallowed('ai: decide providers', e));
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
    setModelDraft(modelDraftsOf(find(id)));
  };
  /** Open one provider's panel (never close it), with its test set to a capability. */
  const openAt = (p, cap) => {
    if (openId !== p.id) toggle(p.id);
    if (cap) setTestCap(cap);
  };

  // Arriving by a settingsUrl lands ON the provider, open at its test, or on the providers section.
  // Once, when the providers first arrive: a later reload must not pull the page back.
  useEffect(() => {
    if (landed.current || !view || !asked.open) return;
    landed.current = true;
    const id = asked.open.startsWith('ai-provider-') ? asked.open.slice('ai-provider-'.length) : null;
    const p = id ? (view.providers || []).find((x) => x.id === id && x.source === 'owner') : null;
    if (p) {
      setOpenId(p.id);
      setKeyDraft('');
      setModelDraft(modelDraftsOf(p));
      const cap = asked.test || testableCapOf(p);
      if (cap) setTestCap(cap);
    }
    // The page draws its sections only once its own settings have arrived as well, so the target is
    // looked for until it is there, for five seconds at most. With a provider the target is its test
    // (the capability select), at the foot of the opened panel, the only one open; else the
    // providers section.
    let tries = 0;
    const timer = setInterval(() => {
      const el = p ? document.querySelector(`[aria-label="${CSS.escape(x('pv.testCap'))}"]`) : document.getElementById('ai-providers');
      if (el || ++tries > 50) {
        clearInterval(timer);
        el?.scrollIntoView({ block: p ? 'center' : 'start' });
      }
    }, 100);
  }, [view, asked]);

  /** What is off and worth a line above the providers, in the capabilities' order. */
  const off = caps ? CAPS.filter((c) => worthALine(c, caps[c])).map((c) => ({ cap: c, ...caps[c] })) : [];
  /** An owner's provider whose capability failed its last test (a refused key): the node still tries
   *  it when nothing else is left, so the capability reads as on, and only this line says it is not
   *  working. One line per capability, after the ones above. */
  const failing = (view?.providers || []).flatMap((p) => (p.source !== 'owner' ? [] : CAPS
    .filter((c) => p.capabilities?.[c]?.enabled && p.health?.[c]?.status === 'failing' && !off.some((o) => o.cap === c))
    .map((c) => ({ cap: c, provider: p }))))
    .filter((f, i, all) => all.findIndex((g) => g.cap === f.cap) === i);

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
    for (const k of ['voice', 'language', 'parser', 'params']) if (next[k] === undefined) delete next[k];
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

  const test = async (p, acceptCost = false, cap = testCap) => {
    const flash = flashFor(setMsg);
    setBusy('test');
    try {
      const r = await apiPost(`/v1/ai/providers/${p.id}/test`, { capability: cap, accept_cost: acceptCost });
      if (r?.ok === false) throw r;
      const d = r.data || {};
      flash(x('pv.testOk', { cap: x('cap.' + cap), model: d.model || '', ms: d.latency_ms ?? 0, cost: d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(4)}` : '–' }));
      await load();
    } catch (e) {
      if (e?.error?.code === 'AI_TEST_COSTS_MONEY') {
        setBusy(false);
        confirm(`${e.error.message} ${x('pv.testCostAsk')}`, () => test(p, true, cap));
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
    if (!on) { setRouteDraft(null); setRulesDraft(null); setCcDraft(null); return; }
    setRouteDraft(Object.fromEntries(CAPS.map((c) => [c, [...(view?.routing?.defaults?.[c] || [])]])));
    setRulesDraft({ ...(view?.routing?.rules || {}) });
    setCcDraft(classifierValue(classifier));
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
      // The Content Classifier's choice lives in the owner's classification policy, written only when
      // it changed.
      if (ccDraft && ccDraft !== classifierValue(classifier)) await saveClassifierChoice(ccDraft);
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

  /** Test now: the provider opens at that capability's test, which runs, so its answer shows there. */
  const testNow = (p, cap) => { openAt(p, cap); test(p, false, cap); };

  return {
    view, policy, classifier, decideProviders, ccDraft, setCcDraft, error, providers, owned, openId, adding, draft, keyDraft, modelDraft, testCap,
    routeDraft, rulesDraft, policyDraft, busy, msg, addMsg, routeMsg, policyMsg, off, failing,
    load, toggle, setAdding, setDraft, toggleDraftCap, add, setKeyDraft, saveKey, removeKey,
    setModelDraft: (c, patch) => setModelDraft((d) => ({ ...d, [c]: { ...(d[c] || capDraftOf(null)), ...patch } })), saveCap, setTestCap, test, testNow, remove, find,
    editRouting, setRoute, setRule, saveRouting, editPolicy, setPolicyField, savePolicy,
  };
}
