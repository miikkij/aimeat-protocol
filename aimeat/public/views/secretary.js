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
 * @structure SECRETARY_ICON · SecretaryView (default) — state, effects, handlers, layout (cards in ./secretary/cards.js)
 * @usage routed at /v1/secretary by spa.html (+ portal.ts spaRoutes).
 * @version-history
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
import { listMessages } from '/js/services/agent-messages.js';
import { defaultPolicy, mergePolicy } from '/js/services/secretary-policy.js';
import { buildDesignPrompt, extractJson, snapshotOf, genCtxId, migrateConfig, suggestContextId, SECRETARY_AIMEAT_PRIMER } from '/js/services/secretary-helpers.js';
import { contextSwitcher, hirePanel, chatCard, findCard, noteCard, decisionsCard, brainCard, operatingCard, historyCard, metaCard, guidedPlanCard, feedCard, automationCard, goalsCard, decisionLogCard } from '/views/secretary/cards.js';
import { useGuidedPlan } from '/views/secretary/use-guided-plan.js';
import { useAutonomy } from '/views/secretary/use-autonomy.js';
import { useLearning } from '/views/secretary/use-learning.js';

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
  const [noteText, setNoteText] = useState('');          // file-a-note composer
  const [noteWsId, setNoteWsId] = useState('');          // user-picked target workspace (else suggested)
  const [noteSaving, setNoteSaving] = useState(false);
  const [wsList, setWsList] = useState([]);              // [{id,name}] of the active context's organism
  const [decisionAnswers, setDecisionAnswers] = useState({}); // promptId -> chosen answer text (from inbox)

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

  // Load the active context's workspaces (id+name) so notes can be filed into one.
  const activeOrgId = active && active.organismId;
  useEffect(() => {
    if (!activeOrgId) { setWsList([]); return; }
    let cancelled = false;
    apiGet(`/v1/organisms/${encodeURIComponent(activeOrgId)}/workspaces`)
      .then((r) => {
        if (cancelled) return;
        const list = (r && r.data && r.data.workspaces) || [];
        setWsList(list.map((w) => ({ id: w.id, name: w.name || w.id })));
      })
      .catch(() => { if (!cancelled) setWsList([]); });
    setNoteWsId('');
    return () => { cancelled = true; };
  }, [activeOrgId]);

  // Cheap workspace suggestion: pick the workspace whose name best overlaps the note text.
  const suggestedWsId = useMemo(() => {
    if (wsList.length === 0) return '';
    const words = new Set(String(noteText).toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4));
    let best = wsList[0];
    let bestScore = -1;
    for (const w of wsList) {
      const hay = String(w.name).toLowerCase();
      let s = 0;
      for (const word of words) if (hay.includes(word)) s++;
      if (s > bestScore) { bestScore = s; best = w; }
    }
    return best.id;
  }, [noteText, wsList]);
  const effectiveWsId = noteWsId || suggestedWsId;

  // Phase 3c — guided playbook (propose steps → approve → execute). Logic lives in its own hook.
  const plan = useGuidedPlan({ active, suggestedWsId, wsList, showToast });
  // Phase 4 — autonomous tick + Home feed + calendar (own hook).
  const auto = useAutonomy({ showToast });
  // Phase 5 — learning loop: goals + decision-log contracts + review trigger (own hook).
  const learn = useLearning({ active, auto, showToast });

  // Pending Ask-band decisions the Secretary posted to the inbox, awaiting the owner's answer.
  const pendingDecisions = useMemo(() => (config && config.pendingDecisions) || {}, [config]);
  const pendingIds = useMemo(() => Object.keys(pendingDecisions), [pendingDecisions]);
  const pendingKey = pendingIds.join(',');
  // Fetch the owner's inbox answers for any pending decisions (match by prompt_id).
  useEffect(() => {
    if (pendingKey === '') { setDecisionAnswers({}); return; }
    let cancelled = false;
    listMessages('secretary', { perPage: 100, direction: 'inbound' })
      .then((r) => {
        if (cancelled) return;
        const msgs = (r && r.data && r.data.messages) || [];
        const map = {};
        for (const m of msgs) {
          const pa = m.metadata && (m.metadata.promptAnswer || m.metadata.prompt_answer);
          const pid = pa && (pa.promptId || pa.prompt_id);
          if (pid) map[pid] = pa.choice;
        }
        setDecisionAnswers(map);
      })
      .catch(() => { if (!cancelled) setDecisionAnswers({}); });
    return () => { cancelled = true; };
  }, [pendingKey]);

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
        const ctx = { id: genCtxId(), name: org.name, brain: newBrain, organismId: orgId || null, organismName: org.name, workspaces: wsSummary, policy: defaultPolicy(), brainHistory: [] };
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
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !active) return;
    setChatSending(true);
    const history = [...chat, { role: 'user', content: text }];
    setChat(history);
    setChatInput('');
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

  /** File a note into the active context's self-organism (the chosen workspace) — Draft band. */
  const saveNote = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !activeOrgId || !effectiveWsId) return;
    setNoteSaving(true);
    try {
      const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const title = body.split('\n')[0].slice(0, 80);
      await apiPost('/v1/memory', {
        key: `organism.${activeOrgId}.w.${effectiveWsId}.notes.${id}`,
        value: { id, title, body, createdAt: new Date().toISOString(), via: 'secretary' },
        visibility: 'private',
      });
      const ws = wsList.find((w) => w.id === effectiveWsId);
      showToast(`${t('secretary.noteSaved')} ${ws ? ws.name : ''}`.trim());
      setNoteText(''); setNoteWsId('');
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    } finally {
      setNoteSaving(false);
    }
  }, [noteText, activeOrgId, effectiveWsId, wsList, showToast]);

  /** Ask band: post a decision card to the owner's inbox and stash the pending action. */
  const askDecision = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !activeOrgId || wsList.length < 2) return;
    setNoteSaving(true);
    try {
      const promptId = 'notews-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const options = wsList.slice(0, 8).map((w) => w.name);
      await apiPost('/v1/agents/secretary/messages', {
        content: `${t('secretary.askWhereContent')} "${body.slice(0, 80)}"`,
        direction: 'outbound',
        metadata: { prompt: { prompt_id: promptId, question: t('secretary.askWhereQ'), options, allow_other: false } },
      });
      const base = config || {};
      const pending = { ...(base.pendingDecisions || {}), [promptId]: { type: 'file-note', body, organismId: activeOrgId, question: t('secretary.askWhereQ'), createdAt: new Date().toISOString() } };
      await persistConfig({ ...base, pendingDecisions: pending });
      showToast(t('secretary.askedInInbox'));
      setNoteText(''); setNoteWsId('');
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    } finally {
      setNoteSaving(false);
    }
  }, [noteText, activeOrgId, wsList, config, persistConfig, showToast]);

  /** The owner answered a decision card in the inbox → carry out the stashed action + clear it. */
  const applyDecision = useCallback(async (promptId) => {
    const dec = pendingDecisions[promptId];
    const choice = decisionAnswers[promptId];
    if (!dec || !choice) return;
    try {
      const wr = await apiGet(`/v1/organisms/${encodeURIComponent(dec.organismId)}/workspaces`).catch(() => null);
      const list = (wr && wr.data && wr.data.workspaces) || [];
      const ws = list.find((w) => String(w.name || '').toLowerCase() === String(choice).toLowerCase());
      if (dec.type === 'file-note' && ws) {
        const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await apiPost('/v1/memory', {
          key: `organism.${dec.organismId}.w.${ws.id}.notes.${id}`,
          value: { id, title: dec.body.split('\n')[0].slice(0, 80), body: dec.body, createdAt: new Date().toISOString(), via: 'secretary' },
          visibility: 'private',
        });
      }
      const base = config || {};
      const next = { ...(base.pendingDecisions || {}) };
      delete next[promptId];
      await persistConfig({ ...base, pendingDecisions: next });
      showToast(`${t('secretary.noteSaved')} ${ws ? ws.name : choice}`.trim());
    } catch (e) {
      showToast(`${t('secretary.noteError')}: ${e.message}`, true);
    }
  }, [pendingDecisions, decisionAnswers, config, persistConfig, showToast]);

  const dismissDecision = useCallback(async (promptId) => {
    const base = config || {};
    const next = { ...(base.pendingDecisions || {}) };
    delete next[promptId];
    await persistConfig({ ...base, pendingDecisions: next });
  }, [config, persistConfig]);

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
        ? html`<div class="sec-empty">${t('secretary.notReady')}</div>`
        : html`
            ${hired ? contextSwitcher({ contexts, activeId, switchContext, openAdd }) : null}
            ${showHirePanel ? hirePanel({ firstEver, hireMode, owner, needs, setNeeds, result, setResult, applying, generating, generateInApp, applyResult, onCancel: cancelHire }) : null}
            ${hired && !showHire && active ? html`
              ${chatCard({ activeName: active.name, chat, chatSending, chatInput, setChatInput, sendChat, routeSuggestion, switchContext })}
              ${findCard({ findQ, setFindQ, findScope, setFindScope, finding, doFind, findResults })}
              ${wsList.length > 0 ? noteCard({ wsList, noteText, setNoteText, effectiveWsId, setNoteWsId, noteSaving, saveNote, askDecision }) : null}
              ${guidedPlanCard(plan)}
              ${pendingIds.length > 0 ? decisionsCard({ pendingIds, pendingDecisions, decisionAnswers, applyDecision, dismissDecision }) : null}
              ${goalsCard(learn)}
              ${decisionLogCard(learn)}
              ${automationCard(auto)}
              ${feedCard(auto)}
              ${brainCard({ brain, active, openEdit })}
              ${operatingCard({ policy, toggleStop, setBudget, setBand })}
              ${(Array.isArray(active.brainHistory) && active.brainHistory.length > 0) ? historyCard({ brainHistory: active.brainHistory, applying, restore }) : null}
              ${metaCard({ secretary })}
            ` : null}`}
      <${ToastContainer} />
    </div>`;
}
