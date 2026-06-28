/**
 * @file secretary/use-whats-next.js
 * @description B2 — Routines + "What's next". Generalises the Phase-3c guided plan into the Secretary's
 *   forward-driver: it either PROPOSES a new Routine (a named, recurring, multi-step workflow it tracks)
 *   from a goal via the owner's OpenRouter key, or ADVANCES an active one — approving each step
 *   band-gated (act → run · draft|ask → approve first + log a decision contract · off → skip), executing
 *   the automatable part (discover = scout, file/briefing/reminders = file a note into the self-organism),
 *   recording the result, and persisting the routine under `secretary.config.contexts[i].routines[]`.
 *   Delegation/create steps are proposed + band-gated but their execution is DEFERRED to B4 (marked
 *   deferred, never fake-acted). Band routing is the pure `routeRoutineStep` helper (services/secretary-tick),
 *   shared with the autonomous tick + asserted in e2e-secretary. Redesign: docs/internal/2026-06-25-secretary-view-redesign.md (B2).
 * @structure ROUTINE_CAPABILITIES · buildRoutinePrompt · useWhatsNext({ active, config, persistConfig, policy, wsList, suggestedWsId, showToast })
 * @usage const next = useWhatsNext({...}); whatsNextCard(next) / routinesCard(next)
 * @version-history
 *   v0.6.0 — 2026-06-28 — G7: a delegate step can run an Agent Workflow (chaining specialists) instead of a
 *     single agent task — loads the owner's workflows, POST /v1/workflows/:id/run, tracks the runId; checkDelegateResult polls it.
 *   v0.5.0 — 2026-06-28 — G4: split FILE_CAPS into NOTE_CAPS (file a note) + FEED_CAPS (briefing/reminders
 *     surface in the Home feed), mirroring actionKind() — consistent with the tick + legacy action-loop.
 *   v0.4.0 — 2026-06-28 — G2: recurring routines — setRoutineCadence (none/daily/weekly); the tick
 *     re-arms a completed routine once its cadence elapses (services/secretary-tick.ts).
 *   v0.3.0 — 2026-06-28 — B5: action-items — handle (advance routine / check delegate) + dismiss the
 *     follow-ups the tick derived (active context's actionItems[]); delegated steps stay active until done.
 *   v0.2.0 — 2026-06-28 — B4: a delegate step creates an agent task for an owner-picked target agent
 *     (POST /v1/agents/:name/tasks, queued, parent_task_id = routine id); checkDelegateResult pulls the
 *     task status back into the routine. delegate removed from the deferred set.
 *   v0.1.0 — 2026-06-27 — B2: Routine entity + "What's next" propose/advance with band-gated, persisted steps.
 */
import { useState, useCallback, useMemo, useEffect } from 'preact/hooks';
import { api, apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';
import { extractJson, buildDecisionRecord } from '/js/services/secretary-helpers.js';
import { routeRoutineStep } from '/js/services/secretary-rules.js';

/** Capabilities a routine step may use (subset of the policy taxonomy the Secretary can plan with). */
export const ROUTINE_CAPABILITIES = ['discover', 'file_intake', 'briefing', 'reminders', 'curate_knowledge', 'create_resource', 'delegate'];
// G4: the capability→kind split MIRRORS actionKind() in services/secretary-tick.ts — keep in sync.
// NOTE caps file a note into the self-organism; FEED caps (briefing/reminders are nudges, not documents)
// surface in the Home feed — exactly how the tick + the legacy action-loop treat them.
const NOTE_CAPS = new Set(['file_intake', 'curate_knowledge']);
const FEED_CAPS = new Set(['briefing', 'reminders']);
/** Steps proposed + band-gated but whose execution is still deferred (create lands later; spend/messaging are Enterprise). */
const DEFERRED_CAPS = new Set(['create_resource', 'resource_invoke', 'third_party_message', 'spend']);

function genId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function buildRoutinePrompt(goal, contextName) {
  return `In the "${contextName || 'personal'}" context, the user's goal is:
"""
${goal}
"""
Design a short, repeatable ROUTINE (a named, multi-step workflow the Secretary can run and track) that makes progress on this goal. Output ONLY a JSON object inside a single code block, EXACTLY this shape:

\`\`\`json
{ "title": "short routine name", "purpose": "one line — what this routine achieves", "steps": [ { "capability": "discover", "summary": "what this step does, one sentence" } ] }
\`\`\`

Rules:
- 3–6 steps, ordered, concrete and specific to the goal.
- Each step's "capability" MUST be one of: ${ROUTINE_CAPABILITIES.join(', ')}.
- Prefer starting with "discover" (scout what already exists) before any "create_resource"/"delegate".
- Output ONLY the JSON code block — no commentary.`;
}

export function useWhatsNext({ active, config, persistConfig, policy, wsList, suggestedWsId, showToast }) {
  const [goal, setGoal] = useState('');
  const [proposing, setProposing] = useState(false);
  const [selectedId, setSelectedId] = useState(null); // routine being walked in the card
  const [busyStepId, setBusyStepId] = useState(null);
  const [delegateAgent, setDelegateAgent] = useState(''); // owner's chosen agent target for the next delegate step
  const [delegateWorkflow, setDelegateWorkflow] = useState(''); // G7: owner's chosen workflow to run for a delegate step
  const [checkingStepId, setCheckingStepId] = useState(null);
  const [workflows, setWorkflows] = useState([]); // G7: the owner's Agent Workflows (delegate can run one)

  // G7: load the owner's workflows so a delegate step can run one (chaining specialists) instead of a single agent task.
  useEffect(() => {
    let cancelled = false;
    apiGet('/v1/workflows').then((r) => { if (!cancelled) setWorkflows((r && r.data && r.data.workflows) || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const routines = useMemo(() => (active && Array.isArray(active.routines)) ? active.routines : [], [active]);
  const activeRoutines = useMemo(() => routines.filter((r) => r.status === 'active'), [routines]);
  const selected = useMemo(() => routines.find((r) => r.id === selectedId) || null, [routines, selectedId]);
  const bands = useMemo(() => (policy && policy.bands) || {}, [policy]);

  /** Read-modify-write the active context's routines list into a fresh config and persist. */
  const writeRoutines = useCallback(async (nextRoutines) => {
    if (!active) return;
    const next = { ...config, contexts: (config.contexts || []).map((c) => (c.id === active.id ? { ...c, routines: nextRoutines } : c)) };
    await persistConfig(next);
  }, [active, config, persistConfig]);

  const patchRoutine = useCallback(async (routineId, updater) => {
    const nextRoutines = routines.map((r) => (r.id === routineId ? updater(r) : r));
    await writeRoutines(nextRoutines);
  }, [routines, writeRoutines]);

  /** Propose (and save) a NEW routine from the goal — the "What's next: something new" path. */
  const proposeRoutine = useCallback(async () => {
    const g = goal.trim();
    if (!g || !active) return;
    setProposing(true);
    try {
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: buildRoutinePrompt(g, active.name), app_id: 'secretary-routine' }), timeoutMs: 1_800_000, retries: 0 });
      const json = extractJson((r && r.data && r.data.content) || '');
      if (!json || !Array.isArray(json.steps) || json.steps.length === 0) throw new Error(t('secretary.next.bad'));
      const steps = json.steps.slice(0, 8).map((s) => {
        const capability = ROUTINE_CAPABILITIES.includes(s.capability) ? s.capability : 'file_intake';
        return { id: genId('s'), capability, summary: String(s.summary || '').slice(0, 200), band: (typeof bands[capability] === 'string' ? bands[capability] : 'ask'), status: 'pending', result: null };
      });
      const routine = {
        id: genId('r'), title: String(json.title || g).slice(0, 80), purpose: String(json.purpose || '').slice(0, 200),
        steps, cadence: null, status: 'active', lastRunAt: null, nextRunAt: null,
        results: [], createdBy: 'owner', createdAt: new Date().toISOString(),
      };
      await writeRoutines([routine, ...routines]);
      setSelectedId(routine.id);
      setGoal('');
      showToast(t('secretary.next.proposed'));
    } catch (e) {
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    } finally {
      setProposing(false);
    }
  }, [goal, active, bands, routines, writeRoutines, showToast]);

  /** Carry out one step's capability (B2: discover scouts, file caps file a note; B4: delegate creates an agent task). */
  const performStep = useCallback(async (step, opts = {}) => {
    if (step.capability === 'delegate' && opts.workflowId) {
      // G7: run an Agent Workflow (chaining specialists) instead of a single agent task. The run executes
      // server-side over the workflow's steps; the routine tracks its runId (checkDelegateResult polls it).
      const resp = await apiPost(`/v1/workflows/${encodeURIComponent(opts.workflowId)}/run`, { mode: 'full' });
      const runId = resp && resp.data && resp.data.runId;
      return { status: 'delegated', summary: t('secretary.next.resultWorkflow', { wf: opts.workflowName || opts.workflowId }), workflowId: opts.workflowId, runId: runId || null };
    }
    if (step.capability === 'delegate') {
      // B4: hand the step off to one of the owner's other agents as an agent task (queued so it's runnable;
      // parent_task_id links it back to this routine). The owner picked the target when approving.
      const agentName = String(opts.agentName || '').trim();
      if (!agentName) throw new Error(t('secretary.next.delegateNoAgent'));
      const ctxLine = opts.routinePurpose ? `${opts.routinePurpose}\n\n` : '';
      const resp = await apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks`, {
        title: step.summary.slice(0, 200),
        description: `${ctxLine}${step.summary}`.slice(0, 2000),
        status: 'queued',
        parent_task_id: opts.routineId || undefined,
      });
      const taskId = resp && resp.data && resp.data.task && resp.data.task.id;
      return { status: 'delegated', summary: t('secretary.next.resultDelegated', { agent: agentName }), taskId: taskId || null, agentName };
    }
    if (step.capability === 'discover') {
      const params = new URLSearchParams({ scope: 'public', per_page: '10' });
      if (step.summary) params.set('q', step.summary);
      let found = 0;
      try {
        const d = await apiGet('/v1/discover?' + params.toString());
        found = (d && d.data && Array.isArray(d.data.entries)) ? d.data.entries.length : 0;
      } catch { /* discovery is best-effort */ }
      return { status: 'done', summary: t('secretary.next.resultFound', { n: found }) || `Found ${found}` };
    }
    if (NOTE_CAPS.has(step.capability)) {
      const wsId = suggestedWsId || (wsList[0] && wsList[0].id);
      if (active.organismId && wsId) {
        const id = genId('n');
        await apiPost('/v1/memory', {
          key: `organism.${active.organismId}.w.${wsId}.notes.${id}`,
          value: { id, title: step.summary.slice(0, 80), body: step.summary, createdAt: new Date().toISOString(), via: 'secretary-routine' },
          visibility: 'private',
        });
        const w = wsList.find((x) => x.id === wsId);
        return { status: 'done', summary: t('secretary.next.resultFiled', { ws: (w && w.name) || '' }) || `Filed into ${(w && w.name) || ''}` };
      }
      return { status: 'done', summary: t('secretary.next.resultNoted') || 'Noted' };
    }
    if (FEED_CAPS.has(step.capability)) {
      // G4: briefing/reminders surface in the Home feed (newest first, cap 50) — same shape as the tick's appendFeed.
      const r = await apiGet('/v1/memory/secretary.feed').catch(() => null);
      const existing = (r && r.data && r.data.value && Array.isArray(r.data.value.items)) ? r.data.value.items : [];
      const entry = { id: genId('f'), ts: new Date().toISOString(), kind: 'act', contextId: active.id, contextName: active.name || '', text: step.summary };
      await apiPost('/v1/memory', { key: 'secretary.feed', value: { items: [entry, ...existing].slice(0, 50) }, visibility: 'private' });
      return { status: 'done', summary: t('secretary.next.resultSurfaced') || 'Surfaced in the feed' };
    }
    if (DEFERRED_CAPS.has(step.capability)) {
      return { status: 'deferred', summary: t('secretary.next.resultDeferred') || 'Deferred' };
    }
    // Unknown capability → safest is to note it rather than fake-act.
    return { status: 'done', summary: t('secretary.next.resultNoted') || 'Noted' };
  }, [active, wsList, suggestedWsId]);

  /**
   * Approve + run a step, band-gated. Skip (off) marks it skipped without acting; confirm (draft|ask)
   * also logs a decision contract so the learning loop later scores how the routine turned out.
   */
  const approveStep = useCallback(async (routine, step, opts = {}) => {
    if (!active || busyStepId) return;
    // Band routing via the shared rules module (proven equal to the server's secretary-tick.ts by the G6
    // parity test) — recomputed from the live policy so a band change applies before approval.
    const { disposition } = routeRoutineStep(step, bands);
    setBusyStepId(step.id);
    try {
      let outcome;
      if (disposition === 'skip') {
        outcome = { status: 'skipped', summary: t('secretary.next.resultSkipped') || 'Skipped (off)' };
      } else {
        outcome = await performStep(step, { ...opts, routineId: routine.id, routinePurpose: routine.purpose });
        if (disposition === 'confirm') {
          // The approval is a real choice — log a decision contract (reuses the Phase-5 learning loop).
          try {
            const rec = buildDecisionRecord({
              decision: `${routine.title}: ${step.summary}`.slice(0, 200), options: [],
              chosen: t('secretary.next.decisionChosen') || 'Approved this routine step',
              rationale: routine.purpose || '', expectedOutcome: step.summary, revisitDays: 7, active,
            });
            await apiPost('/v1/memory', { key: `secretary.decision.${rec.id}`, value: rec, visibility: 'private', tags: ['secretary', 'decision', 'open', active.id || ''] });
          } catch { /* decision logging is best-effort */ }
        }
      }
      const ts = new Date().toISOString();
      // Delegated steps carry the agent-task ref (taskId + agent) OR the workflow run ref (G7) for later checking.
      const resultObj = { summary: outcome.summary, ts,
        ...(outcome.taskId ? { taskId: outcome.taskId, agentName: outcome.agentName } : {}),
        ...(outcome.workflowId ? { workflowId: outcome.workflowId, runId: outcome.runId } : {}) };
      const nextSteps = routine.steps.map((s) => (s.id === step.id ? { ...s, status: outcome.status, result: resultObj } : s));
      // B4/B5 fix: a 'delegated' step is NOT settled (its task is still out) — keep the routine active
      // (on the dashboard) until checkDelegateResult marks it done once the delegated task completes.
      const allSettled = nextSteps.every((s) => s.status !== 'pending' && s.status !== 'running' && s.status !== 'delegated');
      const updater = (r) => ({
        ...r, steps: nextSteps, lastRunAt: ts,
        results: outcome.status === 'skipped' ? r.results : [{ ts, summary: outcome.summary }, ...(r.results || [])].slice(0, 20),
        status: allSettled ? 'done' : r.status,
      });
      await patchRoutine(routine.id, updater);
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    } finally {
      setBusyStepId(null);
    }
  }, [active, bands, busyStepId, performStep, patchRoutine, showToast]);

  const setRoutineStatus = useCallback((routine, status) => patchRoutine(routine.id, (r) => ({ ...r, status })), [patchRoutine]);
  const deleteRoutine = useCallback((routine) => writeRoutines(routines.filter((r) => r.id !== routine.id)), [routines, writeRoutines]);
  // G2: set a routine's cadence (recurrence). The tick re-arms a completed routine once its cadence
  // elapses (services/secretary-tick.ts routineDueForRearm); '' clears it back to run-once.
  const setRoutineCadence = useCallback((routine, cadence) => patchRoutine(routine.id, (r) => ({ ...r, cadence: cadence || null })), [patchRoutine]);

  /** "Advance" from the dashboard: select the routine + scroll the working card into view. */
  const advance = useCallback((routine) => {
    setSelectedId(routine.id);
    const el = document.querySelector('.sec-next');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const nextPendingStep = useCallback((routine) => (routine.steps || []).find((s) => s.status === 'pending') || null, []);

  /**
   * B4: pull a delegated step's agent-task status back into the routine (the result flowing home).
   * `closeItemId` (B5) optionally marks an action-item done in the SAME config write — one persist, so a
   * handled "check result" action-item can't clobber the routine update with a stale second write.
   */
  const checkDelegateResult = useCallback(async (routine, step, closeItemId = null) => {
    const ref = step.result || {};
    const isWorkflow = !!(ref.workflowId && ref.runId);
    if ((!isWorkflow && (!ref.taskId || !ref.agentName)) || checkingStepId) return;
    setCheckingStepId(step.id);
    try {
      let status; let summary;
      if (isWorkflow) {
        // G7: poll the workflow run's outcome.
        const r = await apiGet(`/v1/workflows/${encodeURIComponent(ref.workflowId)}/runs/${encodeURIComponent(ref.runId)}`);
        const run = (r && r.data) || {};
        status = run.status || run.outcome || 'unknown';
        summary = t('secretary.next.resultWorkflowStatus', { wf: ref.workflowId, status });
      } else {
        const r = await apiGet(`/v1/agents/${encodeURIComponent(ref.agentName)}/tasks/${encodeURIComponent(ref.taskId)}`);
        const task = r && r.data && r.data.task;
        status = (task && task.status) || 'unknown';
        summary = t('secretary.next.resultDelegateStatus', { agent: ref.agentName, status });
      }
      const ts = new Date().toISOString();
      // B4/B5/G7: once the delegated task / workflow run reaches a terminal state, settle the step.
      const done = ['completed', 'done', 'closed', 'failed', 'cancelled', 'partial', 'error'].includes(String(status).toLowerCase());
      const next = { ...config, contexts: (config.contexts || []).map((c) => {
        if (!active || c.id !== active.id) return c;
        const nextRoutines = (c.routines || []).map((rt) => {
          if (rt.id !== routine.id) return rt;
          const steps = (rt.steps || []).map((s) => (s.id === step.id ? { ...s, status: done ? 'done' : s.status, result: { ...s.result, summary, checkedAt: ts } } : s));
          const allSettled = steps.every((s) => s.status !== 'pending' && s.status !== 'running' && s.status !== 'delegated');
          return { ...rt, steps, results: [{ ts, summary }, ...(rt.results || [])].slice(0, 20), status: allSettled ? 'done' : rt.status };
        });
        const nextItems = closeItemId ? (c.actionItems || []).map((a) => (a.id === closeItemId ? { ...a, status: 'done' } : a)) : c.actionItems;
        return { ...c, routines: nextRoutines, actionItems: nextItems };
      }) };
      await persistConfig(next);
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    } finally {
      setCheckingStepId(null);
    }
  }, [active, config, persistConfig, checkingStepId, showToast]);

  // ── B5: action-items (the tick-derived follow-ups) live on the active context; handle/dismiss them ──
  const allActionItems = useMemo(() => (active && Array.isArray(active.actionItems)) ? active.actionItems : [], [active]);
  const actionItems = useMemo(() => allActionItems.filter((a) => a.status === 'open'), [allActionItems]);
  const writeActionItems = useCallback(async (nextItems) => {
    if (!active) return;
    const next = { ...config, contexts: (config.contexts || []).map((c) => (c.id === active.id ? { ...c, actionItems: nextItems } : c)) };
    await persistConfig(next);
  }, [active, config, persistConfig]);
  const dismissActionItem = useCallback((item) => writeActionItems(allActionItems.map((a) => (a.id === item.id ? { ...a, status: 'done' } : a))), [allActionItems, writeActionItems]);
  /** One-click handle: 'advance' opens the routine here (local state) then dismisses the item; 'check-delegate'
   *  pulls the task result home AND closes the item in one config write (no stale-config clobber). */
  const handleActionItem = useCallback(async (item) => {
    const sa = item.suggestedAction || {};
    const routine = routines.find((r) => r.id === sa.routineId);
    if (sa.kind === 'check-delegate' && routine) {
      const step = (routine.steps || []).find((s) => s.id === sa.stepId);
      if (step && step.result && step.result.taskId) { await checkDelegateResult(routine, step, item.id); return; }
    }
    if (sa.kind === 'advance' && routine) advance(routine); // local state only — no persist before the dismiss
    await dismissActionItem(item);
  }, [routines, advance, checkDelegateResult, dismissActionItem]);

  return {
    goal, setGoal, proposing, proposeRoutine,
    routines, activeRoutines, selected, selectedId, setSelectedId,
    busyStepId, approveStep, setRoutineStatus, deleteRoutine, setRoutineCadence, advance, nextPendingStep,
    delegateAgent, setDelegateAgent, checkingStepId, checkDelegateResult,
    workflows, delegateWorkflow, setDelegateWorkflow,
    actionItems, handleActionItem, dismissActionItem,
  };
}
