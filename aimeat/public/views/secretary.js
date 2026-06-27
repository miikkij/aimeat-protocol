/**
 * @file secretary.js
 * @description Secretary view (state + logic + layout). Identity/provisioning (Phase 0) + hire onboarding
 *   & operating model (Phase 1) + MULTI-CONTEXT (Phase 1.5): one Secretary identity (GAII) holds several
 *   "contexts" (hats), each = its own brain (prose directives) + AI-designed self-organism/workspaces +
 *   operating policy (autonomy bands + stop-spending). Phase 2 = chat + resource finder (aimeat_discover)
 *   + teach + routing-suggest. Phase 3 = save-a-note (Draft band) + async inbox decision cards (Ask band).
 *   Presentational cards live in ./secretary/cards.js; pure helpers in /js/services/secretary-helpers.js.
 *   Pure frontend orchestration over generic endpoints (directives + organisms + memory + ai/complete +
 *   agent-messages + discover). Full design: docs/plans/2026-06-23-secretary-feature.md.
 * @structure SECRETARY_ICON · SecretaryView (default) — state, effects, handlers, layout (cards in ./secretary/cards.js + ./secretary/cards-reach.js + dashboard chrome in ./secretary/dashboard.js)
 * @usage routed at /v1/secretary by spa.html (+ portal.ts spaRoutes).
 * @version-history
 *   v0.14.0 — 2026-06-27 — B3 (secretary-view-redesign): dynamic quick actions. useQuickActions manages
 *     per-context quickActions[] — 2–3 brain-seeded shortcuts (active on hire) + secretary-PROPOSED ones
 *     the owner pins. Active dynamic actions render in the quick row (prompt → canned chat message, compose
 *     → focus an input); a ✎ panel (quickActionsManager) pins/dismisses proposals + renames/reorders/removes.
 *     Security: the Secretary may seed/propose only prompt|compose, never a run verb (sanitizeQuickActions).
 *   v0.13.0 — 2026-06-27 — B2 (secretary-view-redesign): Routines + "What's next". The guided plan is
 *     generalised into useWhatsNext — propose a new Routine from a goal OR advance an active one, approve
 *     each step band-gated (act → run · draft|ask → approve + log a decision · off → skip), execute the
 *     automatable part (discover/file; delegation deferred to B4), and persist under
 *     contexts[i].routines[]. Active routines render on the dashboard (routinesCard).
 *   v0.12.0 — 2026-06-27 — B1 (secretary-view-redesign): dashboard-first IA. A core quick-action row
 *     ("Where do things stand?" read-only orientation · Plan/Find/Note focus · Review decisions when
 *     due), a "Today" status strip (reliability · budget · next run · last-scan + stale + refresh) above
 *     the feed/decision-log, chat below, and the set-up-once config cards (brain/operating/crew/knowledge/
 *     access/history/permissions) moved into a collapsed "Manage & setup" disclosure. Chrome in dashboard.js.
 *   v0.11.0 — 2026-06-25 — load() reads OpenRouter settings first (which backfills the Secretary agent
 *     when a key exists) and tracks hasOpenRouterKey, so a pre-configured owner is provisioned on view
 *     load and the "not set up" message correctly distinguishes "no key" from "provisioning".
 *   v0.10.0 — 2026-06-24 — P3: doc/image intake into the chat (chatCard 📎 → intake.handleAttach:
 *     upload → vision summary → file into the active context's self-organism) and auto-logged decision
 *     contracts from answered Ask cards + approved guided plans (learning loop now sees real choices).
 *   v0.9.0 — 2026-06-24 — P2: extract intake to use-intake.js (+ P2-E cross-context auto-routing) and
 *     add the reach cards — create-don't-just-find (A), knowledge custodian (B), access gatekeeper (C),
 *     crew setup (D); new hooks use-create-resource/use-knowledge/use-access/use-crew + cards-reach.js.
 *   v0.8.0 — 2026-06-24 — P1: surface the autonomous tick's remaining daily morsel budget + a self-facing
 *     reliability chip (mean reviewed-decision score); re-fetch config on aimeat-live-update so the tick's
 *     server-written pending decisions appear; applyDecision handles tick-generated `tick-note` cards.
 *   v0.7.0 — 2026-06-24 — Phase 5: learning loop — goals + decision-log contracts + review trigger (useLearning hook, goalsCard/decisionLogCard).
 *   v0.6.0 — 2026-06-24 — Phase 4: autonomous tick + Home feed + calendar (useAutonomy hook, feed/automation cards).
 *   v0.5.0 — 2026-06-24 — Phase 3 cleanup: extract presentational cards to ./secretary/cards.js.
 *   v0.4.0 — 2026-06-23 — Phase 1.5: multiple contexts on one Secretary.
 *   v0.3.0 — 2026-06-23 — Phase 1 complete: operating-model bands + stop-spending, in-app interview, brain versioning.
 *   v0.2.0 — 2026-06-23 — Phase 1: hire onboarding (interview → brain + self-organism).
 *   v0.1.0 — 2026-06-23 — Phase 0 shell: provisioning status + identity.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { api, apiGet, apiPost, apiPut } from '/js/api.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { useToast } from '/components/Toast.js';
import { createOrganism, createWorkspace } from '/js/services/organisms.js';
import { defaultPolicy, mergePolicy } from '/js/services/secretary-policy.js';
import { buildDesignPrompt, extractJson, snapshotOf, genCtxId, migrateConfig, suggestContextId, computeBudgetInfo, computeReliability, sanitizeQuickActions, SECRETARY_AIMEAT_PRIMER } from '/js/services/secretary-helpers.js';
import { contextSwitcher, hirePanel, chatCard, findCard, noteCard, decisionsCard, brainCard, operatingCard, historyCard, metaCard, whatsNextCard, feedCard, automationCard, goalsCard, decisionLogCard } from '/views/secretary/cards.js';
import { createResourceCard, knowledgeCard, accessCard, crewCard } from '/views/secretary/cards-reach.js';
import { quickActionRow, dashStatus, standPanel, routinesCard, quickActionsManager, manageHeader } from '/views/secretary/dashboard.js';
import { useIntake } from '/views/secretary/use-intake.js';
import { useWhatsNext } from '/views/secretary/use-whats-next.js';
import { useQuickActions } from '/views/secretary/use-quick-actions.js';
import { useAutonomy } from '/views/secretary/use-autonomy.js';
import { useLearning } from '/views/secretary/use-learning.js';
import { useCreateResource } from '/views/secretary/use-create-resource.js';
import { useKnowledge } from '/views/secretary/use-knowledge.js';
import { useAccess } from '/views/secretary/use-access.js';
import { useCrew } from '/views/secretary/use-crew.js';

export const SECRETARY_ICON = html`
  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
    <path d="M12 20.6C6.4 16.7 3.4 13.2 3.4 9.2 3.4 6.5 5.4 4.6 7.9 4.6c1.7 0 3.2.9 4.1 2.4.9-1.5 2.4-2.4 4.1-2.4 2.5 0 4.5 1.9 4.5 4.6 0 4-3 7.5-8.6 11.4z"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M16 8l-5.6 5.6M10.4 13.6l-1.5 2.4 2.4-1.5"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export default function SecretaryView() {
  useViewCSS('/css/views/secretary.css');
  const { showToast, ToastContainer } = useToast();
  const [secretary, setSecretary] = useState(undefined); // undefined=loading, null=not provisioned
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false); // owner has an OpenRouter key configured
  const [config, setConfig] = useState(null);            // { contexts:[...], activeContextId }
  const [result, setResult] = useState('');
  const [needs, setNeeds] = useState('');
  const [applying, setApplying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showHire, setShowHire] = useState(false);
  const [hireMode, setHireMode] = useState('new');       // 'new' (add context) | 'edit' (re-run active)
  const [chat, setChat] = useState([]);                  // active context's conversation [{role,content}]
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [findQ, setFindQ] = useState('');                // resource finder (aimeat_discover)
  const [findScope, setFindScope] = useState('public');
  const [findResults, setFindResults] = useState(null);  // null=not searched, []=none, [...]
  const [finding, setFinding] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);   // B1: collapsed "Manage & setup" disclosure
  const [stand, setStand] = useState(null);              // B1: read-only "where things stand" summary { loading } | { text }

  const owner = (secretary && secretary.owner)
    || (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession()?.owner)
    || '';

  const persistConfig = useCallback(async (next) => {
    await apiPost('/v1/memory', { key: 'secretary.config', value: next, visibility: 'private' });
    setConfig(next);
  }, []);

  /** Mirror a context's brain to the agent directives so the GAII's brain reflects the active context. */
  const syncDirectives = useCallback(async (brain) => {
    await apiPut('/v1/agents/secretary/directives', { purpose: brain.purpose, rules: brain.rules || [] }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    // Read OpenRouter settings FIRST: this GET also provisions the Secretary agent when a key exists
    // (backfill for owners who configured OpenRouter before the feature shipped), so by the time we
    // list agents below the agent is present. Also tells us whether to show "configure OpenRouter".
    const settingsResp = await apiGet('/v1/openrouter/settings').catch(() => null);
    setHasOpenRouterKey(!!(settingsResp && settingsResp.data && settingsResp.data.hasApiKey));
    const agentsResp = await apiGet('/v1/agents').catch(() => null);
    const agents = (agentsResp && agentsResp.data && agentsResp.data.agents) || [];
    const sec = agents.find((a) => (a.tags || []).includes('system:secretary'))
      || agents.find((a) => a.name === 'secretary') || null;
    setSecretary(sec);
    if (!sec) return;
    const [dir, cfg] = await Promise.all([
      apiGet('/v1/agents/secretary/directives').catch(() => null),
      apiGet('/v1/memory/secretary.config').catch(() => null),
    ]);
    const rawCfg = (cfg && cfg.data && cfg.data.value) || null;
    const { config: normalized, changed } = migrateConfig(rawCfg, dir && dir.data);
    if (changed) await apiPost('/v1/memory', { key: 'secretary.config', value: normalized, visibility: 'private' }).catch(() => {});
    setConfig(normalized);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch config on server-reported changes: the autonomous tick writes pending decisions + the
  // spend ledger into secretary.config server-side, so the decisions card / budget must refresh.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const contexts = useMemo(() => (config && config.contexts) || [], [config]);
  const active = contexts.find((c) => c.id === (config && config.activeContextId)) || contexts[0] || null;
  const hired = contexts.length > 0;
  const brain = active && active.brain;
  const policy = mergePolicy(active && active.policy);
  const activeId = active && active.id;
  // Cheap, AI-free routing suggestion: does what you're typing belong to another context? (§22)
  const routeSuggestion = useMemo(() => suggestContextId(chatInput, contexts, activeId), [chatInput, contexts, activeId]);

  // Load the active context's conversation (chat is per-context).
  useEffect(() => {
    setStand(null);
    if (!activeId) { setChat([]); return; }
    let cancelled = false;
    setChat([]);
    apiGet(`/v1/memory/${encodeURIComponent('secretary.chat.' + activeId)}`)
      .then((r) => {
        if (cancelled) return;
        const msgs = (r && r.data && r.data.value && Array.isArray(r.data.value.messages)) ? r.data.value.messages : [];
        setChat(msgs);
      })
      .catch(() => { if (!cancelled) setChat([]); });
    return () => { cancelled = true; };
  }, [activeId]);

  // Intake (note composer + Ask cards + P2-E cross-context auto-routing) lives in its own hook.
  const intake = useIntake({ active, contexts, config, persistConfig, owner, showToast });
  const { wsList, suggestedWsId } = intake;

  // B2 — Routines + "What's next" (generalises the guided plan): propose/advance band-gated routines.
  const next = useWhatsNext({ active, config, persistConfig, policy, wsList, suggestedWsId, showToast });
  // B3 — dynamic quick actions (brain-seeded + secretary-proposed, owner-pinned).
  const qa = useQuickActions({ active, config, persistConfig, owner, showToast });
  // Phase 4 — autonomous tick + Home feed + calendar (own hook).
  const auto = useAutonomy({ showToast });
  // Phase 5 — learning loop: goals + decision-log contracts + review trigger (own hook).
  const learn = useLearning({ active, auto, showToast });
  // P2 reach: create-don't-just-find (A), knowledge custodian (B), access gatekeeper (C), crew setup (D).
  const create = useCreateResource({ showToast });
  const knowledge = useKnowledge({ showToast });
  const access = useAccess({ showToast });
  const crew = useCrew({ showToast });

  // P1-C remaining autonomous budget + P1-D self-facing reliability (computed in helpers; see secretary-helpers.js).
  const budgetInfo = useMemo(() => computeBudgetInfo(policy.dailyMorselBudget, config, activeId), [policy.dailyMorselBudget, config, activeId]);
  const reliability = useMemo(() => computeReliability(learn.decisions), [learn.decisions]);

  const applyResult = useCallback(async () => {
    setApplying(true);
    try {
      const json = extractJson(result);
      const b = json.brain || {};
      const org = json.organism || {};
      if (!b.purpose || !org.name || !Array.isArray(org.workspaces) || org.workspaces.length === 0) {
        throw new Error(t('secretary.hireBadShape'));
      }
      const rules = Array.isArray(b.rules) ? b.rules.slice() : [];
      if (!rules.some((r) => /discover|scout|already exist/i.test(r.description || ''))) {
        rules.push({ id: 'scout-before-build', description: 'Before building or delegating anything, first search what already exists (map then find via aimeat_discover) and reuse it.' });
      }
      const newBrain = { purpose: b.purpose, rules };
      const isNew = hireMode === 'new' || !active;

      let next;
      if (isNew) {
        // A new context always gets its own self-organism + workspaces.
        const created = await createOrganism({ name: org.name, description: org.description || '', visibility: 'private', join_policy: 'open' });
        const orgId = created && created.data && created.data.organism && created.data.organism.id;
        const wsSummary = [];
        if (orgId) {
          for (const ws of org.workspaces.slice(0, 12)) {
            const name = String(ws.name || '').trim();
            if (!name) continue;
            const entry = await createWorkspace(orgId, name);
            if (entry && entry.id && ws.purpose) {
              await apiPost('/v1/memory', { key: `organism.${orgId}.w.${entry.id}.meta.readme`, value: `# ${name}\n\n${ws.purpose}`, visibility: 'private' });
            }
            wsSummary.push({ name, purpose: ws.purpose || '' });
          }
        }
        // B3: seed the brain-proposed quick actions — active on hire (run verbs are dropped by the sanitizer).
        const quickActions = sanitizeQuickActions(json.quickActions, 'brain', 'active');
        const ctx = { id: genCtxId(), name: org.name, brain: newBrain, organismId: orgId || null, organismName: org.name, workspaces: wsSummary, policy: defaultPolicy(), brainHistory: [], quickActions };
        next = { contexts: [...contexts, ctx], activeContextId: ctx.id };
      } else {
        // Re-run on the active context: update its brain, snapshot the old one. Keep its organism.
        const prev = snapshotOf(active.brain);
        const history = [prev, ...(active.brainHistory || [])].filter(Boolean).slice(0, 10);
        const updated = { ...active, brain: newBrain, brainHistory: history };
        next = { ...config, contexts: contexts.map((c) => (c.id === active.id ? updated : c)) };
      }
      await persistConfig(next);
      await syncDirectives(newBrain);
      showToast(t('secretary.hireDone'));
      setResult(''); setNeeds(''); setShowHire(false);
    } catch (e) {
      showToast(`${t('secretary.hireError')}: ${e.message}`, true);
    } finally {
      setApplying(false);
    }
  }, [result, hireMode, active, contexts, config, persistConfig, syncDirectives, showToast]);

  const generateInApp = useCallback(async () => {
    if (!needs.trim()) return;
    setGenerating(true);
    try {
      // Long AI completion: low-level api() with a large timeout + no retries (apiPost's 30s would abort a slow model).
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: buildDesignPrompt(owner, needs.trim()), app_id: 'secretary-setup' }), timeoutMs: 1_800_000, retries: 0 });
      const content = r && r.data && r.data.content;
      if (!content) throw new Error(t('secretary.inappEmpty'));
      setResult(content);
      showToast(t('secretary.inappDone'));
    } catch (e) {
      showToast(`${t('secretary.inappError')}: ${e.message}`, true);
    } finally {
      setGenerating(false);
    }
  }, [needs, owner, showToast]);

  /** One chat turn: assemble the active context's brain as the system prompt + the transcript,
   *  complete on the owner's key, append + persist. Per-context conversation (secretary.chat.{id}). */
  const sendChat = useCallback(async (override) => {
    // `override` lets a dynamic quick action (kind:'prompt') send a canned message without touching the input.
    const text = (typeof override === 'string' ? override : chatInput).trim();
    if (!text || !active) return;
    setChatSending(true);
    const history = [...chat, { role: 'user', content: text }];
    setChat(history);
    if (typeof override !== 'string') setChatInput('');
    try {
      const rules = (active.brain.rules || []).map((r) => '- ' + r.description).join('\n');
      const wsNames = (active.workspaces || []).map((w) => w.name).join(', ');
      const sys = `You are ${owner || 'the user'}'s personal Secretary, working in the "${active.name}" context.
${active.brain.purpose}

Operating rules:
${rules || '(none)'}

The user's filing space "${active.organismName || active.name}" has these workspaces: ${wsNames || '(none yet)'}.

Be concise and genuinely helpful, and reply in the user's language. You are advising/conversing — you don't take actions on the user's behalf yet.

${SECRETARY_AIMEAT_PRIMER}`;
      const transcript = history.map((m) => (m.role === 'user' ? 'User' : 'Secretary') + ': ' + m.content).join('\n\n') + '\n\nSecretary:';
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: transcript, systemPrompt: sys, app_id: 'secretary-chat' }), timeoutMs: 1_800_000, retries: 0 });
      const reply = (r && r.data && r.data.content) ? r.data.content.trim() : '';
      const next = [...history, { role: 'assistant', content: reply || '…' }].slice(-50);
      setChat(next);
      await apiPost('/v1/memory', { key: `secretary.chat.${active.id}`, value: { messages: next }, visibility: 'private' });
    } catch (e) {
      setChat(history); // keep the user's message visible
      showToast(`${t('secretary.chatError')}: ${e.message}`, true);
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chat, active, owner, showToast]);

  /** Resource finder = the Secretary's "sensory organ" (aimeat_discover). Scout what already exists. */
  const doFind = useCallback(async () => {
    setFinding(true);
    try {
      const params = new URLSearchParams({ scope: findScope, per_page: '20' });
      const q = findQ.trim();
      if (q) params.set('q', q);
      const r = await apiGet('/v1/discover?' + params.toString());
      setFindResults((r && r.data && r.data.entries) || []);
    } catch (e) {
      showToast(`${t('secretary.findError')}: ${e.message}`, true);
      setFindResults([]);
    } finally {
      setFinding(false);
    }
  }, [findQ, findScope, showToast]);

  // ── B1 dashboard: freshness, refresh, focus-scroll, and the read-only orientation summary ──
  // Last "scan" = newest of the autonomous feed entry / the tick's last run (no new backend in B1);
  // stale once it's older than a daily cadence (28h of slack).
  const lastScan = useMemo(() => {
    const feedTs = (auto.feed[0] && auto.feed[0].ts) ? new Date(auto.feed[0].ts).getTime() : 0;
    const runTs = (auto.schedule && auto.schedule.lastRunAt) ? new Date(auto.schedule.lastRunAt).getTime() : 0;
    const ts = Math.max(feedTs, runTs);
    return ts ? new Date(ts).toISOString() : null;
  }, [auto.feed, auto.schedule]);
  const stale = useMemo(() => !lastScan || (Date.now() - new Date(lastScan).getTime()) > 28 * 3600 * 1000, [lastScan]);

  // Reconcile/scan = refresh the snapshot. Dispatching the live-update event re-fires every hook's
  // listener (config + feed/schedule + goals/decisions) in one shot — no new wiring needed.
  const refreshAll = useCallback(() => { window.dispatchEvent(new CustomEvent('aimeat-live-update')); }, []);

  // Quick-action "focus" verbs: smooth-scroll a working card into view and focus its input.
  const focusInto = useCallback((sel, inputSel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (inputSel) { const i = el.querySelector(inputSel); if (i) setTimeout(() => i.focus(), 250); }
  }, []);

  // "Review decisions" is only offered when an open decision is due for its revisit.
  const decisionsDue = useMemo(() => {
    const now = Date.now();
    return (learn.decisions || []).some((d) => d && d.status === 'open' && d.revisitWhen && new Date(d.revisitWhen).getTime() <= now);
  }, [learn.decisions]);

  // B3: active dynamic quick actions → row items. prompt → send a canned chat message; compose → focus an input.
  const dynamicQuickItems = useMemo(() => qa.activeActions.map((a) => ({
    key: a.id,
    label: a.label,
    title: a.kind === 'prompt' ? a.prompt : `${t('secretary.qa.composeTarget')}: ${a.target}`,
    onClick: a.kind === 'prompt'
      ? () => { focusInto('.sec-chat', null); sendChat(a.prompt); }
      : () => focusInto(a.target === 'find' ? '.sec-find' : a.target === 'note' ? '.sec-note' : '.sec-next', a.target === 'find' ? '.sec-find-in' : 'textarea'),
  })), [qa.activeActions, focusInto, sendChat]);

  // "Where do things stand?" — a read-only orientation summary (NOT the acting tick): no actions, just
  // a status readout grounded in the active context's brain + open goals/decisions + recent activity.
  const runStand = useCallback(async () => {
    if (!active) return;
    setStand({ loading: true });
    try {
      const openGoals = (learn.goals || []).filter((g) => g.status !== 'done').map((g) => '- ' + g.title).join('\n');
      const openDecs = (learn.decisions || []).filter((d) => d.status !== 'reviewed').map((d) => '- ' + d.decision).join('\n');
      const recent = (auto.feed || []).slice(0, 6).map((f) => '- ' + String(f.text || '').replace(/\s+/g, ' ').slice(0, 160)).join('\n');
      const wsNames = (active.workspaces || []).map((w) => w.name).join(', ');
      const sys = `You are ${owner || 'the user'}'s personal Secretary in the "${active.name}" context. Give a SHORT, read-only orientation of where things stand right now and what the user might want to look at next. This is a status readout only — do NOT propose to take actions yourself and do NOT claim to have done anything. 3–6 sentences of plain prose, in the user's language.`;
      const snapshot = `Context purpose: ${active.brain.purpose}\nWorkspaces: ${wsNames || '(none)'}\nOpen goals:\n${openGoals || '(none)'}\nOpen decisions:\n${openDecs || '(none)'}\nRecent autonomous activity:\n${recent || '(none)'}`;
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: snapshot, systemPrompt: sys, app_id: 'secretary-orient' }), timeoutMs: 1_800_000, retries: 0 });
      const text = (r && r.data && r.data.content) ? r.data.content.trim() : '';
      setStand({ text: text || '…' });
    } catch (e) {
      setStand(null);
      showToast(`${t('secretary.dash.standError')}: ${e.message}`, true);
    }
  }, [active, owner, learn.goals, learn.decisions, auto.feed, showToast]);

  const switchContext = useCallback(async (id) => {
    const ctx = contexts.find((c) => c.id === id);
    if (!ctx) return;
    await persistConfig({ ...config, activeContextId: id });
    if (ctx.brain) await syncDirectives(ctx.brain);
  }, [contexts, config, persistConfig, syncDirectives]);

  const updateActivePolicy = (patch) => {
    if (!active) return;
    const updated = { ...active, policy: { ...policy, ...patch } };
    persistConfig({ ...config, contexts: contexts.map((c) => (c.id === active.id ? updated : c)) });
  };
  const setBand = (capId, band) => updateActivePolicy({ bands: { ...policy.bands, [capId]: band } });
  const toggleStop = () => updateActivePolicy({ stopSpending: !policy.stopSpending });
  const setBudget = (v) => updateActivePolicy({ dailyMorselBudget: v === '' ? null : Math.max(0, Math.floor(Number(v) || 0)) });

  const restore = useCallback(async (snap) => {
    if (!active) return;
    setApplying(true);
    try {
      const prev = snapshotOf(active.brain);
      const history = [prev, ...(active.brainHistory || [])].filter(Boolean).slice(0, 10);
      const updated = { ...active, brain: { purpose: snap.purpose, rules: snap.rules || [] }, brainHistory: history };
      await persistConfig({ ...config, contexts: contexts.map((c) => (c.id === active.id ? updated : c)) });
      await syncDirectives(updated.brain);
      showToast(t('secretary.restored'));
    } catch (e) {
      showToast(`${t('secretary.hireError')}: ${e.message}`, true);
    } finally {
      setApplying(false);
    }
  }, [active, config, contexts, persistConfig, syncDirectives, showToast]);

  const openAdd = () => { setHireMode('new'); setResult(''); setNeeds(''); setShowHire(true); };
  const openEdit = () => { setHireMode('edit'); setResult(''); setNeeds(''); setShowHire(true); };
  const cancelHire = () => { setShowHire(false); setResult(''); setNeeds(''); };

  const showHirePanel = (secretary && !hired) || showHire;
  const firstEver = !hired;

  return html`
    <div class="sec">
      <header class="sec-hero">
        <span class="sec-hero-icon">${SECRETARY_ICON}</span>
        <div>
          <h1 class="sec-title">${t('secretary.title')}</h1>
          <p class="sec-desc">${t('secretary.desc')}</p>
        </div>
      </header>

      ${secretary === undefined
        ? html`<div class="sec-empty">…</div>`
        : secretary === null
        ? html`<div class="sec-empty">${hasOpenRouterKey ? t('secretary.provisioning') : t('secretary.notReady')}</div>`
        : html`
            ${hired ? contextSwitcher({ contexts, activeId, switchContext, openAdd }) : null}
            ${showHirePanel ? hirePanel({ firstEver, hireMode, owner, needs, setNeeds, result, setResult, applying, generating, generateInApp, applyResult, onCancel: cancelHire }) : null}
            ${hired && !showHire && active ? html`
              ${/* Quick-action row (core verbs; dynamic actions arrive in B3) */ ''}
              ${quickActionRow({ items: [
                { key: 'stand', label: t('secretary.dash.quickStand'), primary: true, disabled: !!(stand && stand.loading), onClick: runStand },
                { key: 'plan', label: t('secretary.dash.quickPlan'), title: t('secretary.next.title'), onClick: () => focusInto('.sec-next', 'textarea') },
                { key: 'find', label: t('secretary.dash.quickFind'), title: t('secretary.findTitle'), onClick: () => focusInto('.sec-find', '.sec-find-in') },
                { key: 'note', label: t('secretary.dash.quickNote'), title: t('secretary.noteTitle'), hidden: wsList.length === 0, onClick: () => focusInto('.sec-note', 'textarea') },
                { key: 'review', label: t('secretary.dash.quickReview'), title: t('secretary.learn.reviewNow'), hidden: !decisionsDue, onClick: () => focusInto('.sec-decisions-log', null) },
                ...dynamicQuickItems,
                { key: 'manage-qa', label: '✎', title: t('secretary.qa.title'), onClick: qa.toggleManage },
              ] })}
              ${quickActionsManager(qa)}

              ${/* Today / dashboard — where are we + is this current */ ''}
              ${standPanel({ stand, onDismiss: () => setStand(null) })}
              ${dashStatus({ reliability, budgetInfo, schedule: auto.schedule, lastScan, stale, onRefresh: refreshAll })}
              ${routinesCard(next)}
              ${intake.pendingIds.length > 0 ? decisionsCard(intake) : null}
              ${automationCard({ ...auto, budgetInfo })}
              ${feedCard(auto)}
              ${goalsCard(learn)}
              ${decisionLogCard(learn)}

              ${/* Chat (free-form, per context) */ ''}
              ${chatCard({ activeName: active.name, chat, chatSending, chatInput, setChatInput, sendChat, routeSuggestion, switchContext,
                onAttach: intake.handleAttach, attaching: intake.attaching, attachResult: intake.attachResult, canAttach: intake.wsList.length > 0 })}

              ${/* Working area — the inputs the quick verbs focus */ ''}
              ${whatsNextCard({ ...next, agents: crew.agents })}
              ${findCard({ findQ, setFindQ, findScope, setFindScope, finding, doFind, findResults })}
              ${(findResults && findResults.length === 0) || create.draft || create.created ? createResourceCard({ ...create, query: findQ }) : null}
              ${wsList.length > 0 ? noteCard(intake) : null}

              ${/* Manage & setup — collapsed disclosure (set up once) */ ''}
              ${manageHeader({ open: manageOpen, onToggle: () => setManageOpen((v) => !v),
                crewSummary: crew.agents && crew.agents.length ? `${crew.agents.length} ${t('secretary.dash.crewAgents')}` : '' })}
              ${manageOpen ? html`
                ${brainCard({ brain, active, openEdit })}
                ${operatingCard({ policy, toggleStop, setBudget, setBand })}
                ${crewCard(crew)}
                ${knowledgeCard(knowledge)}
                ${accessCard(access)}
                ${(Array.isArray(active.brainHistory) && active.brainHistory.length > 0) ? historyCard({ brainHistory: active.brainHistory, applying, restore }) : null}
                ${metaCard({ secretary, reliability })}
              ` : null}
            ` : null}`}
      <${ToastContainer} />
    </div>`;
}
