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
 *   v0.15.0 — 2026-06-28 — B5 (secretary-view-redesign): action-items. The autonomous tick now advances
 *     active routines band-driven (act-band file steps auto-run; draft/ask/delegate → action-items) and
 *     writes contexts[i].actionItems[]; the dashboard renders them (actionItemsCard) with a one-click
 *     handle (open the routine / check a delegated result) or dismiss. Handlers in useWhatsNext.
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
import { t, getLocale } from '/js/i18n.js';
import { api, apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { useToast } from '/components/Toast.js';
import { createOrganism, createWorkspace } from '/js/services/organisms.js';
import { defaultPolicy, mergePolicy } from '/js/services/secretary-policy.js';
import { buildDesignPrompt, extractJson, snapshotOf, genCtxId, migrateConfig, suggestContextId, computeBudgetInfo, computeReliability, sanitizeQuickActions, SECRETARY_AIMEAT_PRIMER } from '/js/services/secretary-helpers.js';
import { contextSwitcher, hirePanel, chatCard, findCard, noteCard, decisionsCard, brainCard, operatingCard, historyCard, metaCard, whatsNextCard, feedCard, automationCard, goalsCard, decisionLogCard } from '/views/secretary/cards.js';
import { createResourceCard, knowledgeCard, accessCard, crewCard } from '/views/secretary/cards-reach.js';
import { quickActionRow, dashStatus, standPanel, whatsNextPanel, actionItemsCard, routinesCard, triggersCard, quickActionsManager, manageHeader, workflowDesignPanel } from '/views/secretary/dashboard.js';
import { fetchWorkflowOffers, designWorkflow, saveDesignedWorkflow, slugifyWorkflowId } from '/views/secretary/workflow-design.js';
import { useIntake } from '/views/secretary/use-intake.js';
import { useWhatsNext } from '/views/secretary/use-whats-next.js';
import { useQuickActions } from '/views/secretary/use-quick-actions.js';
import { useFreshness } from '/views/secretary/use-freshness.js';
import { useAutonomy } from '/views/secretary/use-autonomy.js';
import { useCalendar, calendarCard } from '/views/secretary/calendar.js';
import { useTriggers } from '/views/secretary/use-triggers.js';
import { useLayout, LayoutCard } from '/views/secretary/use-layout.js';
import { produceDeliverable, getAiCapability, reasonJson } from '/views/secretary/quality.js';
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
  const [nextAns, setNextAns] = useState(null);          // "What's next?" — the Secretary's forward answer { loading } | { text }
  const [pasteDrafts, setPasteDrafts] = useState({});    // prompt-driven path: pasted-back result text, keyed by action id
  const [wfDesign, setWfDesign] = useState(null);        // "Design a workflow" flow: null | { outcome, designing, draft, trigger, error, saving, saved, errors }
  const [brainDraft, setBrainDraft] = useState(null);    // C2: direct brain editor draft { purpose, rules[] } | null
  const [savingBrain, setSavingBrain] = useState(false);

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
    setNextAns(null);
    if (!activeId) { setChat([]); return; }
    let cancelled = false;
    setChat([]);
    // Restore the last "where things stand" so it persists across reloads (with its timestamp).
    apiGet(`/v1/memory/${encodeURIComponent('secretary.stand.' + activeId)}`)
      .then((r) => { const v = r && r.data && r.data.value; if (!cancelled && v && v.text) setStand({ text: v.text, generatedAt: v.generatedAt }); })
      .catch(() => {});
    // Restore the last "What's next" list (with its do/skip state) so leaving and coming back keeps it.
    apiGet(`/v1/memory/${encodeURIComponent('secretary.next.' + activeId)}`)
      .then((r) => { const v = r && r.data && r.data.value; if (!cancelled && v && Array.isArray(v.actions) && v.actions.length) setNextAns(v); })
      .catch(() => {});
    apiGet(`/v1/memory/${encodeURIComponent('secretary.chat.' + activeId)}`)
      .then((r) => {
        if (cancelled) return;
        const msgs = (r && r.data && r.data.value && Array.isArray(r.data.value.messages)) ? r.data.value.messages : [];
        setChat(msgs);
      })
      .catch(() => { if (!cancelled) setChat([]); });
    return () => { cancelled = true; };
  }, [activeId]);

  // Persist the "What's next" list (and its do/skip state) so navigating away and back keeps it.
  // Stamped with ctxId so a context switch never writes the old list under the new context's key.
  useEffect(() => {
    if (!activeId || !nextAns || !Array.isArray(nextAns.actions) || nextAns.ctxId !== activeId) return;
    apiPost('/v1/memory', { key: `secretary.next.${activeId}`, value: nextAns, visibility: 'private' }).catch(() => {});
  }, [nextAns, activeId]);

  // Intake (note composer + Ask cards + P2-E cross-context auto-routing) lives in its own hook.
  // Triggers (Slice 3/4) — declared before intake so a filed note can ask the Secretary to auto-propose a trigger.
  const trig = useTriggers({ active, showToast });
  const intake = useIntake({ active, contexts, config, persistConfig, owner, showToast, onNoteFiled: trig.proposeTriggerFromText });
  const { wsList, suggestedWsId } = intake;

  // B2 — Routines + "What's next" (generalises the guided plan): propose/advance band-gated routines.
  const next = useWhatsNext({ active, config, persistConfig, policy, wsList, suggestedWsId, showToast });
  // B3 — dynamic quick actions (brain-seeded + secretary-proposed, owner-pinned).
  const qa = useQuickActions({ active, config, persistConfig, owner, showToast });
  // Phase 4 — autonomous tick + Home feed + calendar (own hook).
  const auto = useAutonomy({ showToast });
  // Decision B — real calendar (month/week/day) of feed (past) + tick & routine cadence (future).
  const cal = useCalendar();
  const lay = useLayout();   // customizable dashboard layout (pin to column / reorder / hide; persisted)
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

  /** C3: seed the hire-proposed goals as standalone goal records (so the learning loop isn't empty). */
  const seedGoals = useCallback(async (goals, contextId, contextName) => {
    const arr = Array.isArray(goals) ? goals.slice(0, 4) : [];
    for (const g of arr) {
      const title = String((g && g.title) || '').trim();
      if (!title) continue;
      const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      await apiPost('/v1/memory', { key: `secretary.goal.${gid}`, value: { id: gid, title: title.slice(0, 200), why: String((g && g.why) || '').trim().slice(0, 300), status: 'open', contextId, contextName, createdAt: new Date().toISOString() }, visibility: 'private', tags: ['secretary', 'goal', 'open', contextId] }).catch(() => {});
    }
  }, []);

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
        // C3: seed the proposed goals so the learning loop starts populated (not "no goals yet").
        await seedGoals(json.goals, ctx.id, ctx.name);
      } else {
        // Re-run on the active context (reshape): update its brain, snapshot the old one, KEEP its
        // organism. C1: ADD any newly-proposed workspaces (additive — never rename/remove existing;
        // removal stays a manual decision in the Organisms view, so no data is ever auto-deleted).
        const prev = snapshotOf(active.brain);
        const history = [prev, ...(active.brainHistory || [])].filter(Boolean).slice(0, 10);
        const existingNames = new Set((active.workspaces || []).map((w) => String(w.name).toLowerCase()));
        const addedWs = [];
        if (active.organismId && Array.isArray(org.workspaces)) {
          for (const ws of org.workspaces.slice(0, 12)) {
            const name = String(ws.name || '').trim();
            if (!name || existingNames.has(name.toLowerCase())) continue;
            const entry = await createWorkspace(active.organismId, name);
            if (entry && entry.id && ws.purpose) {
              await apiPost('/v1/memory', { key: `organism.${active.organismId}.w.${entry.id}.meta.readme`, value: `# ${name}\n\n${ws.purpose}`, visibility: 'private' });
            }
            addedWs.push({ name, purpose: ws.purpose || '' });
          }
        }
        const updated = { ...active, brain: newBrain, brainHistory: history, workspaces: [...(active.workspaces || []), ...addedWs] };
        next = { ...config, contexts: contexts.map((c) => (c.id === active.id ? updated : c)) };
      }
      await persistConfig(next);
      await syncDirectives(newBrain);
      window.dispatchEvent(new CustomEvent('aimeat-live-update')); // refresh goals/learning + cards
      showToast(t('secretary.hireDone'));
      setResult(''); setNeeds(''); setShowHire(false);
    } catch (e) {
      showToast(`${t('secretary.hireError')}: ${e.message}`, true);
    } finally {
      setApplying(false);
    }
  }, [result, hireMode, active, contexts, config, persistConfig, syncDirectives, seedGoals, showToast]);

  // C2 — direct brain editor: edit the active context's purpose + rules in place (no AI re-run).
  const startBrainEdit = useCallback(() => {
    if (!active) return;
    setBrainDraft({ purpose: (active.brain && active.brain.purpose) || '', rules: ((active.brain && active.brain.rules) || []).map((r) => ({ id: r.id, description: r.description })) });
  }, [active]);
  const cancelBrainEdit = useCallback(() => setBrainDraft(null), []);
  const saveBrain = useCallback(async () => {
    if (!active || !brainDraft) return;
    const purpose = String(brainDraft.purpose || '').trim();
    if (!purpose) { showToast(t('secretary.brainEmptyPurpose'), true); return; }
    const rules = (brainDraft.rules || [])
      .map((r) => ({ id: r.id || ('r' + Math.random().toString(36).slice(2, 6)), description: String(r.description || '').trim() }))
      .filter((r) => r.description);
    setSavingBrain(true);
    try {
      const newBrain = { purpose, rules };
      const prev = snapshotOf(active.brain);
      const history = [prev, ...(active.brainHistory || [])].filter(Boolean).slice(0, 10);
      const updated = { ...active, brain: newBrain, brainHistory: history };
      await persistConfig({ ...config, contexts: contexts.map((c) => (c.id === active.id ? updated : c)) });
      await syncDirectives(newBrain);
      setBrainDraft(null);
      showToast(t('secretary.brainSaved'));
    } catch (e) {
      showToast(`${t('secretary.hireError')}: ${e.message}`, true);
    } finally {
      setSavingBrain(false);
    }
  }, [active, brainDraft, config, contexts, persistConfig, syncDirectives, showToast]);

  const generateInApp = useCallback(async () => {
    if (!needs.trim()) return;
    setGenerating(true);
    try {
      // Long AI completion: low-level api() with a large timeout + no retries (apiPost's 30s would abort a slow model).
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: buildDesignPrompt(owner, needs.trim(), hireMode === 'edit' ? active : null), app_id: 'secretary-setup' }), timeoutMs: 1_800_000, retries: 0 });
      const content = r && r.data && r.data.content;
      if (!content) throw new Error(t('secretary.inappEmpty'));
      setResult(content);
      showToast(t('secretary.inappDone'));
    } catch (e) {
      showToast(`${t('secretary.inappError')}: ${e.message}`, true);
    } finally {
      setGenerating(false);
    }
  }, [needs, owner, hireMode, active, showToast]);

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

  // ── B1/G3 dashboard freshness (lastScan + stale + the real discover Reconcile) — in its own hook ──
  const { lastScan, stale, scanning, reconcile } = useFreshness({ active, config, contexts, persistConfig, auto, showToast });

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

  // Read what's ACTUALLY in the active context's workspaces (recent items per workspace) so the
  // Secretary's answers reflect real content — not just goals/decisions/feed. One memory-list call.
  const loadSpaceSnapshot = useCallback(async () => {
    if (!active || !active.organismId) return '';
    const r = await apiGet(`/v1/memory?prefix=${encodeURIComponent('organism.' + active.organismId + '.w.')}&_=${Date.now()}`).catch(() => null);
    const items = (r && r.data && r.data.items) || [];
    const byWs = {};
    for (const it of items) {
      const m = String(it.key || '').match(/\.w\.([^.]+)\.([^.]+)\./);
      if (!m || m[2] === 'meta') continue; // skip per-workspace readme/meta records
      const v = it.value || {};
      const title = String(v.title || v.name || (v.body ? String(v.body).slice(0, 60) : '') || '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      (byWs[m[1]] = byWs[m[1]] || []).push(title);
    }
    return (wsList || []).map((w) => `- ${w.name}: ${(byWs[w.id] || []).slice(0, 6).join('; ') || '(empty)'}`).join('\n');
  }, [active, wsList]);

  // "Where do things stand?" — read-only orientation grounded in the brain + open goals/decisions +
  // recent activity AND the real workspace content. No actions taken.
  const runStand = useCallback(async () => {
    if (!active) return;
    setStand({ loading: true });
    try {
      // Quality policy: orientation needs a ≥200k model too (it reads the whole space). No big model →
      // tell the owner instead of running a degraded read.
      const cap = await getAiCapability();
      if (!cap.bigEnough) { setStand({ needModel: true }); return; }
      const openGoals = (learn.goals || []).filter((g) => g.status !== 'done').map((g) => '- ' + g.title).join('\n');
      const openDecs = (learn.decisions || []).filter((d) => d.status !== 'reviewed').map((d) => '- ' + d.decision).join('\n');
      const recent = (auto.feed || []).slice(0, 6).map((f) => '- ' + String(f.text || '').replace(/\s+/g, ' ').slice(0, 160)).join('\n');
      const space = await loadSpaceSnapshot();
      const wsUrl = (wsId) => (active.organismId ? `/v1/profile?tab=organisms&org=${encodeURIComponent(active.organismId)}${wsId ? `&ws=${encodeURIComponent(wsId)}` : ''}` : '');
      const wsLinks = active.organismId ? (wsList || []).map((w) => `- "${w.name}" → ${wsUrl(w.id)}`).join('\n') : '';
      const sys = `You are ${owner || 'the user'}'s personal Secretary in the "${active.name}" context. Give a SHORT, ORGANIZED orientation of where things stand right now. Use Markdown with 2–4 short sections or bullet groups (e.g. In progress / Open items / Needs attention / Recent) — NOT one long paragraph. Ground it in what's ACTUALLY in the workspaces below; do NOT say the space is empty if a workspace has content. When you mention a workspace, write it as a Markdown link using the "Workspace links" below so the owner can jump to it. Do NOT propose actions or claim to have done anything. Reply in ${getLocale() === 'fi' ? 'Finnish' : 'English'}.`;
      const snapshot = `Context purpose: ${active.brain.purpose}\nWorkspace contents:\n${space || '(no workspaces)'}\nWorkspace links:\n${wsLinks || '(none)'}\nOpen goals:\n${openGoals || '(none)'}\nOpen decisions:\n${openDecs || '(none)'}\nRecent autonomous activity:\n${recent || '(none)'}`;
      // Fact-based read → execution model, low temperature.
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: snapshot, systemPrompt: sys, modelRole: 'execution', temperature: 0.2, app_id: 'secretary-orient' }), timeoutMs: 1_800_000, retries: 0 });
      const text = ((r && r.data && r.data.content) || '…').trim();
      // Verify the orientation against the facts (reasoning, temp 0) — flag any invented progress/items.
      const check = await reasonJson('You fact-check a status orientation against the facts it was given. Return ONLY JSON {"ok":boolean,"issues":[string]}. ok=false if it states any progress, item, number, or outcome NOT present in the facts. Bracketed [placeholders] are fine.', `Facts:\n${snapshot}\n\nOrientation:\n${text}`, 'secretary-orient-verify');
      const issues = (check && check.ok === false && Array.isArray(check.issues)) ? check.issues.slice(0, 5) : [];
      const generatedAt = new Date().toISOString();
      setStand({ text, generatedAt, issues });
      // Persist so it stays visible across reloads (with its timestamp) — no need to regenerate each time.
      if (active.id) await apiPost('/v1/memory', { key: `secretary.stand.${active.id}`, value: { text, generatedAt, issues }, visibility: 'private' }).catch(() => {});
    } catch (e) {
      setStand(null);
      showToast(`${t('secretary.dash.standError')}: ${e.message}`, true);
    }
  }, [active, owner, learn.goals, learn.decisions, auto.feed, wsList, loadSpaceSnapshot, showToast]);

  // "What's next?" — the Secretary proposes CONCRETE next actions it can DO (each with Do it / Skip),
  // grounded in the real workspace content + goals/decisions/routines/follow-ups. Not prose to read —
  // an actionable list. Doing one runs it (gather/file/surface); skipping drops it.
  const NEXT_CAPS = ['discover', 'file_intake', 'curate_knowledge', 'briefing', 'reminders', 'create_resource', 'delegate'];
  const runWhatsNext = useCallback(async () => {
    if (!active) return;
    setNextAns({ loading: true });
    try {
      // Deciding the next actions is a reasoning task → requires a ≥200k model. No big model → notice.
      const cap = await getAiCapability();
      if (!cap.bigEnough) { setNextAns({ needModel: true }); return; }
      const openGoals = (learn.goals || []).filter((g) => g.status !== 'done').map((g) => '- ' + g.title).join('\n');
      const dueDecs = (learn.decisions || []).filter((d) => d.status !== 'reviewed').map((d) => '- ' + d.decision).join('\n');
      const routines = (next.activeRoutines || []).map((r) => { const s = next.nextPendingStep(r); return `- ${r.title}${s ? ` (next: ${s.summary})` : ''}`; }).join('\n');
      const followups = (next.actionItems || []).map((a) => '- ' + (a.summary || a.text || '')).join('\n');
      const space = await loadSpaceSnapshot();
      const sys = `You are ${owner || 'the user'}'s personal Secretary in the "${active.name}" context. Propose the concrete NEXT ACTIONS to take now, grounded in the real workspace content + goals/decisions/routines/follow-ups below. Each action is something the owner can approve with one click. Return ONLY a JSON object EXACTLY like {"actions":[{"summary":"a short imperative action (in the user's language)","capability":"discover","why":"one short line why, in the user's language"}]}. Propose 2–5 actions. "capability" MUST be one of: ${NEXT_CAPS.join(', ')} — prefer "discover" to gather info on something, "file_intake"/"curate_knowledge" to record a plan/note, "reminders"/"briefing" to flag something. Do NOT invent capabilities. CRUCIAL: do NOT propose anything already present in the workspace content above — if a deliverable already exists there, propose the genuine NEXT step instead (use, refine, or move it forward), never redo it. Write every "summary" and "why" in ${getLocale() === 'fi' ? 'Finnish' : 'English'}. Output ONLY the JSON object.`;
      const snapshot = `Context purpose: ${active.brain.purpose}\nWorkspace contents:\n${space || '(no workspaces)'}\nOpen goals:\n${openGoals || '(none)'}\nOpen decisions:\n${dueDecs || '(none)'}\nActive routines:\n${routines || '(none)'}\nOpen follow-ups:\n${followups || '(none)'}`;
      // Reasoning/decision task → reasoning model, temperature 0 for sound, repeatable choices.
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: snapshot, systemPrompt: sys, modelRole: 'reasoning', temperature: 0, app_id: 'secretary-next' }), timeoutMs: 1_800_000, retries: 0 });
      let parsed = null;
      try { parsed = extractJson((r && r.data && r.data.content) || ''); } catch { /* fall through */ }
      const raw = (parsed && Array.isArray(parsed.actions)) ? parsed.actions : [];
      const actions = raw.slice(0, 6).map((a) => ({
        id: 'na-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        summary: String((a && a.summary) || '').trim(),
        capability: NEXT_CAPS.includes(a && a.capability) ? a.capability : 'file_intake',
        why: String((a && a.why) || '').trim(),
        status: 'open',
      })).filter((a) => a.summary);
      setNextAns({ actions, ctxId: active.id });
    } catch (e) {
      setNextAns(null);
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    }
  }, [active, owner, learn.goals, learn.decisions, next, loadSpaceSnapshot, showToast]);

  // Carry out one proposed "What's next" action (band-spirit: gather/record/surface). Marks it done.
  // ── Phase 3: "Design a workflow" — the Secretary composes a chain of agent+offer steps toward an
  // outcome, proposes how to arm it, and saves it. ──
  const openWfDesign = useCallback(() => setWfDesign((s) => s || { outcome: '' }), []);
  const discardWfDesign = useCallback(() => setWfDesign(null), []);
  const redoWfDesign = useCallback(() => setWfDesign((s) => ({ outcome: (s && s.outcome) || '' })), []);
  const setWfOutcome = useCallback((v) => setWfDesign((s) => ({ ...(s || {}), outcome: v })), []);
  const setWfTrigKind = useCallback((kind) => setWfDesign((s) => ({ ...s, trigger: kind === 'schedule' ? { kind: 'schedule', cron: (s.trigger && s.trigger.cron) || '0 9 * * *' } : kind === 'event' ? { kind: 'event', on: 'memory.write', match: {} } : { kind: 'manual' } })), []);
  const setWfCron = useCallback((cron) => setWfDesign((s) => ({ ...s, trigger: { kind: 'schedule', cron } })), []);
  const runWfDesign = useCallback(async () => {
    const outcome = ((wfDesign && wfDesign.outcome) || '').trim();
    if (!outcome) return;
    setWfDesign((s) => ({ ...s, designing: true, error: null, draft: null }));
    try {
      const offers = await fetchWorkflowOffers();
      const r = await designWorkflow({ outcome, offers, locale: getLocale() });
      if (!r.ok) { setWfDesign((s) => ({ ...s, designing: false, error: r.error, title: r.title })); return; }
      setWfDesign((s) => ({ ...s, designing: false, draft: r.def, trigger: r.def.trigger, errors: null }));
    } catch (e) { setWfDesign((s) => ({ ...s, designing: false, error: 'fail' })); showToast(e.message, true); }
  }, [wfDesign, showToast]);
  const saveWfDesign = useCallback(async () => {
    const d = wfDesign && wfDesign.draft;
    if (!d) return;
    setWfDesign((s) => ({ ...s, saving: true, errors: null }));
    const id = slugifyWorkflowId(d.title || (wfDesign && wfDesign.outcome) || 'workflow');
    const r = await saveDesignedWorkflow(id, { ...d, trigger: (wfDesign && wfDesign.trigger) || d.trigger });
    if (!r.ok) { setWfDesign((s) => ({ ...s, saving: false, errors: r.errors })); return; }
    setWfDesign((s) => ({ ...s, saving: false, saved: id }));
    window.dispatchEvent(new CustomEvent('aimeat-live-update'));
  }, [wfDesign]);

  const doProposedAction = useCallback(async (action) => {
    if (!active) return;
    const patch = (st, extra) => setNextAns((s) => (s && s.actions) ? { ...s, actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: st, ...extra } : a)) } : s);
    patch('doing');
    // Append a visible line to the Home feed ("What I've done") so every Do-it leaves a trail — with a
    // link to where the result landed when there is one.
    const feedLog = async (text, href) => {
      const fr = await apiGet('/v1/memory/secretary.feed').catch(() => null);
      const items = (fr && fr.data && fr.data.value && Array.isArray(fr.data.value.items)) ? fr.data.value.items : [];
      const entry = { id: 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), ts: new Date().toISOString(), kind: 'act', contextId: active.id, contextName: active.name || '', text, ...(href ? { href } : {}) };
      await apiPost('/v1/memory', { key: 'secretary.feed', value: { items: [entry, ...items].slice(0, 50) }, visibility: 'private' });
    };
    // Best-matching workspace for the action (by word overlap with its summary).
    const pickWs = () => {
      const wsl = intake.wsList || [];
      const words = new Set(String(action.summary).toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4));
      let ws = wsl[0]; let best = -1;
      for (const w of wsl) { let sc = 0; const hay = String(w.name).toLowerCase(); for (const wd of words) if (hay.includes(wd)) sc++; if (sc > best) { best = sc; ws = w; } }
      return ws;
    };
    // Deep link that opens the organism + the exact workspace in Profile › Organisms (new tab).
    const spaceUrl = (wsId) => (active.organismId ? `/v1/profile?tab=organisms&org=${encodeURIComponent(active.organismId)}${wsId ? `&ws=${encodeURIComponent(wsId)}` : ''}` : null);
    const fileNote = async (ws, title, body) => {
      const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const key = `organism.${active.organismId}.w.${ws.id}.notes.${id}`;
      await apiPost('/v1/memory', { key, value: { id, title: String(title).slice(0, 80), body, createdAt: new Date().toISOString(), via: 'secretary-next' }, visibility: 'private' });
      return key;
    };
    try {
      const cap = action.capability;
      let resultMsg = ''; let href = null; let preview = ''; let noteKey = null;
      if (cap === 'discover') {
        // Scout AND KEEP the results: file the top hits as a list the owner can open.
        const d = await apiGet('/v1/discover?scope=public&per_page=10&q=' + encodeURIComponent(action.summary)).catch(() => null);
        const entries = (d && d.data && Array.isArray(d.data.entries)) ? d.data.entries : [];
        const ws = pickWs();
        if (active.organismId && ws && entries.length) {
          const list = entries.slice(0, 10).map((e) => `- ${e.title || e.id}${e.type ? ` (${e.type})` : ''}${e.url ? ` — ${e.url}` : ''}`).join('\n');
          preview = `Found ${entries.length}:\n\n${list}`;
          noteKey = await fileNote(ws, `Scouted: ${action.summary}`, preview);
          resultMsg = t('secretary.next.didScoutedSaved', { n: entries.length, ws: ws.name }); href = spaceUrl(ws.id);
        } else {
          resultMsg = t('secretary.next.didDiscover', { n: entries.length });
        }
        await feedLog(`🔎 ${action.summary} — ${t('secretary.next.didDiscover', { n: entries.length })}`, href);
      } else if (cap === 'briefing' || cap === 'reminders') {
        await feedLog(`⚑ ${action.summary}`);
        resultMsg = t('secretary.next.didSurface');
      } else {
        // file_intake / curate_knowledge / create_resource → run the multi-step QUALITY pipeline
        // (triage → gather → produce → verify) on a ≥200k model, grounded + no fabrication. If no big
        // model is configured, hand the owner a copy-paste prompt for the prompt-driven path instead.
        const ws = pickWs();
        const space = await loadSpaceSnapshot();
        const runDiscover = async (q) => {
          const d = await apiGet('/v1/discover?scope=public&per_page=10&q=' + encodeURIComponent(q)).catch(() => null);
          const es = (d && d.data && Array.isArray(d.data.entries)) ? d.data.entries : [];
          return es.slice(0, 10).map((e) => `- ${e.title || e.id}${e.type ? ` (${e.type})` : ''}${e.url ? ` — ${e.url}` : ''}`).join('\n');
        };
        const out = await produceDeliverable({ action, owner, contextName: active.name, locale: getLocale(), space, runDiscover });
        if (out.mode === 'clarify') {
          // Missing facts only the owner has → ask in the inbox (batch questions); the tick produces the
          // deliverable once answered. Never guess.
          await apiPost('/v1/secretary/clarify', { contextId: active.id, contextName: active.name || '', action: { summary: action.summary, why: action.why || '' }, questions: out.questions, facts: out.facts || space, organismId: active.organismId || '', wsId: (ws && ws.id) || '' });
          patch('asked', {});
          window.dispatchEvent(new CustomEvent('aimeat-live-update'));
          return;
        }
        if (out.mode === 'prompt-driven') {
          // No ≥200k model — never run a degraded completion; show the composed multi-step prompt to
          // copy into a big AI chat, with a paste-back box to save the result.
          patch('prompt', { promptText: out.prompt, expanded: true });
          return;
        }
        preview = out.content;
        const issues = (out.verify && out.verify.ok === false && Array.isArray(out.verify.issues)) ? out.verify.issues.slice(0, 6) : [];
        if (active.organismId && ws) {
          noteKey = await fileNote(ws, action.summary, out.content);
          resultMsg = t('secretary.next.didDrafted', { ws: ws.name }); href = spaceUrl(ws.id);
          await feedLog(`✍️ ${action.summary} — ${t('secretary.next.didDrafted', { ws: ws.name })}`, href);
          patch('done', { result: resultMsg, href, preview, expanded: true, noteKey, issues });
          window.dispatchEvent(new CustomEvent('aimeat-live-update'));
          return;
        }
        resultMsg = t('secretary.next.didNoted');
      }
      patch('done', { result: resultMsg, href, preview, expanded: true, noteKey });
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      patch('open');
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    }
  }, [active, owner, intake.wsList, loadSpaceSnapshot, showToast]);

  const skipProposedAction = useCallback((action) => {
    setNextAns((s) => (s && s.actions) ? { ...s, actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: 'skipped' } : a)) } : s);
  }, []);

  // Show/hide the produced deliverable inline under a done action (no navigation needed).
  const togglePreview = useCallback((action) => {
    setNextAns((s) => (s && s.actions) ? { ...s, actions: s.actions.map((a) => (a.id === action.id ? { ...a, expanded: !a.expanded } : a)) } : s);
  }, []);

  const setPasteDraft = useCallback((id, v) => setPasteDrafts((m) => ({ ...m, [id]: v })), []);

  // Prompt-driven path: file the result the owner pasted back from their big AI chat, as a note.
  const savePromptResult = useCallback(async (action) => {
    const text = (pasteDrafts[action.id] || '').trim();
    if (!text || !active) return;
    const wsl = intake.wsList || [];
    const words = new Set(String(action.summary).toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4));
    let ws = wsl[0]; let best = -1;
    for (const w of wsl) { let sc = 0; const hay = String(w.name).toLowerCase(); for (const wd of words) if (hay.includes(wd)) sc++; if (sc > best) { best = sc; ws = w; } }
    let noteKey = null;
    if (active.organismId && ws) {
      const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      noteKey = `organism.${active.organismId}.w.${ws.id}.notes.${id}`;
      await apiPost('/v1/memory', { key: noteKey, value: { id, title: action.summary.slice(0, 80), body: text, createdAt: new Date().toISOString(), via: 'secretary-next' }, visibility: 'private' }).catch(() => {});
    }
    const href = active.organismId && ws ? `/v1/profile?tab=organisms&org=${encodeURIComponent(active.organismId)}&ws=${encodeURIComponent(ws.id)}` : null;
    setNextAns((s) => (s && s.actions) ? { ...s, actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: 'done', promptText: '', preview: text, expanded: true, noteKey, result: ws ? t('secretary.next.didDrafted', { ws: ws.name }) : t('secretary.next.didNoted'), href } : a)) } : s);
    setPasteDraft(action.id, '');
    window.dispatchEvent(new CustomEvent('aimeat-live-update'));
  }, [pasteDrafts, active, intake.wsList, setPasteDraft]);

  // Discard a produced deliverable that's no good (e.g. an off-base draft): delete the filed note and
  // clear the result from the list.
  const discardProposedAction = useCallback(async (action) => {
    if (action.noteKey) await apiDelete(`/v1/memory/${encodeURIComponent(action.noteKey)}`).catch(() => {});
    setNextAns((s) => (s && s.actions) ? { ...s, actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: 'discarded', preview: '', result: '', href: null, noteKey: null, expanded: false } : a)) } : s);
  }, []);

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
            ${showHirePanel ? hirePanel({ firstEver, hireMode, owner, current: hireMode === 'edit' ? active : null, needs, setNeeds, result, setResult, applying, generating, generateInApp, applyResult, onCancel: cancelHire }) : null}
            ${hired && !showHire && active ? html`
              ${/* Quick-action row (core verbs; dynamic actions arrive in B3) */ ''}
              ${quickActionRow({ items: [
                { key: 'next', label: t('secretary.next.title'), primary: true, disabled: !!(nextAns && nextAns.loading), title: t('secretary.next.hint'), onClick: runWhatsNext },
                { key: 'stand', label: t('secretary.dash.quickStand'), disabled: !!(stand && stand.loading), onClick: runStand },
                { key: 'find', label: t('secretary.dash.quickFind'), title: t('secretary.findTitle'), onClick: () => focusInto('.sec-find', '.sec-find-in') },
                { key: 'note', label: t('secretary.dash.quickNote'), title: t('secretary.noteTitle'), hidden: wsList.length === 0, onClick: () => focusInto('.sec-note', 'textarea') },
                { key: 'review', label: t('secretary.dash.quickReview'), title: t('secretary.learn.reviewNow'), hidden: !decisionsDue, onClick: () => focusInto('.sec-decisions-log', null) },
                { key: 'design-wf', label: t('secretary.wf.quick'), title: t('secretary.wf.title'), onClick: openWfDesign },
                ...dynamicQuickItems,
                { key: 'manage-qa', label: '✎', title: t('secretary.qa.title'), onClick: qa.toggleManage },
              ] })}
              ${quickActionsManager(qa)}
              ${workflowDesignPanel({ state: wfDesign, onOutcome: setWfOutcome, onDesign: runWfDesign, onTrigKind: setWfTrigKind, onCron: setWfCron, onSave: saveWfDesign, onRedo: redoWfDesign, onDiscard: discardWfDesign })}

              ${/* Today — full-width status band, always on top */ ''}
              ${dashStatus({ reliability, budgetInfo, schedule: auto.schedule, lastScan, stale, onReconcile: reconcile, scanning })}

              ${/* Customizable two-column dashboard (pin to column / reorder / hide per card; persisted). */ ''}
              ${(() => {
                const nodes = {
                  whatsNext: whatsNextPanel({ answer: nextAns, onDo: doProposedAction, onSkip: skipProposedAction, onTogglePreview: togglePreview, onDiscard: discardProposedAction, pasteDrafts, onPasteInput: setPasteDraft, onSavePrompt: savePromptResult, onDismiss: () => { setNextAns(null); if (activeId) apiDelete(`/v1/memory/${encodeURIComponent('secretary.next.' + activeId)}`).catch(() => {}); } }),
                  stand: standPanel({ stand, onRefresh: runStand, onDismiss: () => setStand(null) }),
                  actionItems: actionItemsCard(next),
                  routines: routinesCard(next),
                  decisions: intake.pendingIds.length > 0 ? decisionsCard(intake) : null,
                  automation: automationCard({ ...auto, budgetInfo }),
                  triggers: triggersCard({ ...trig, goals: learn.goals, routines: next.routines }),
                  calendar: calendarCard({ ...cal, feed: auto.feed, schedule: auto.schedule, routines: next.routines, triggers: trig.armed }),
                  feed: feedCard(auto),
                  goals: goalsCard(learn),
                  decisionLog: decisionLogCard(learn),
                  chat: chatCard({ activeName: active.name, chat, chatSending, chatInput, setChatInput, sendChat, routeSuggestion, switchContext,
                    onAttach: intake.handleAttach, attaching: intake.attaching, attachResult: intake.attachResult, canAttach: intake.wsList.length > 0 }),
                  whatsNextCard: whatsNextCard({ ...next, agents: crew.agents }),
                  find: findCard({ findQ, setFindQ, findScope, setFindScope, finding, doFind, findResults }),
                  createResource: ((findResults && findResults.length === 0) || create.draft || create.created) ? createResourceCard({ ...create, query: findQ }) : null,
                  note: wsList.length > 0 ? noteCard(intake) : null,
                };
                const present = lay.layout.filter((e) => nodes[e.key] != null && !e.hidden);
                const mainCol = present.filter((e) => e.col === 'main');
                const rightCol = present.filter((e) => e.col === 'right');
                const renderCol = (list) => list.map((e, i) => LayoutCard({ entry: e, node: nodes[e.key], prevKey: i > 0 ? list[i - 1].key : null, nextKey: i < list.length - 1 ? list[i + 1].key : null, onSwap: lay.swap, onMoveCol: lay.moveCol, onHide: lay.hide }));
                return html`
                  <div class="sec-grid">
                    <div class="sec-col sec-col-main">${renderCol(mainCol)}</div>
                    <aside class="sec-col sec-col-right">${renderCol(rightCol)}</aside>
                  </div>
                  <div class="sec-layout-bar">
                    ${lay.hidden.map((e) => html`<button class="sec-chip" key=${e.key} onClick=${() => lay.unhide(e.key)}>+ ${t('secretary.layout.section.' + e.key)}</button>`)}
                    <button class="sec-linkbtn" onClick=${lay.reset}>${t('secretary.layout.reset')}</button>
                  </div>`;
              })()}

              ${/* Manage & setup — collapsed disclosure (set up once) */ ''}
              ${manageHeader({ open: manageOpen, onToggle: () => setManageOpen((v) => !v),
                crewSummary: crew.agents && crew.agents.length ? `${crew.agents.length} ${t('secretary.dash.crewAgents')}` : '' })}
              ${manageOpen ? html`
                ${brainCard({ brain, active, openEdit, brainDraft, setBrainDraft, startBrainEdit, saveBrain, cancelBrainEdit, savingBrain })}
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
