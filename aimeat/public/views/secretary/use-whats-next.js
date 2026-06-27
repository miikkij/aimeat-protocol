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
 *   v0.2.0 — 2026-06-28 — B4: a delegate step creates an agent task for an owner-picked target agent
 *     (POST /v1/agents/:name/tasks, queued, parent_task_id = routine id); checkDelegateResult pulls the
 *     task status back into the routine. delegate removed from the deferred set.
 *   v0.1.0 — 2026-06-27 — B2: Routine entity + "What's next" propose/advance with band-gated, persisted steps.
 */
import { useState, useCallback, useMemo } from 'preact/hooks';
import { api, apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';
import { extractJson, buildDecisionRecord } from '/js/services/secretary-helpers.js';

/** Capabilities a routine step may use (subset of the policy taxonomy the Secretary can plan with). */
export const ROUTINE_CAPABILITIES = ['discover', 'file_intake', 'briefing', 'reminders', 'curate_knowledge', 'create_resource', 'delegate'];
/** Steps that file a note into the self-organism (B2-executable). */
const FILE_CAPS = new Set(['file_intake', 'curate_knowledge', 'briefing', 'reminders']);
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
  const [delegateAgent, setDelegateAgent] = useState(''); // owner's chosen target for the next delegate step
  const [checkingStepId, setCheckingStepId] = useState(null);

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
    if (FILE_CAPS.has(step.capability)) {
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
    // Band routing mirrors the server helper; recompute here from the live policy so a band change applies.
    const band = (typeof step.band === 'string' && ['act', 'draft', 'ask', 'off'].includes(step.band)) ? step.band
      : (typeof bands[step.capability] === 'string' ? bands[step.capability] : 'ask');
    const disposition = band === 'off' ? 'skip' : band === 'act' ? 'run' : 'confirm';
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
      // Delegated steps carry the agent-task ref (taskId + agent) so the result can be checked later.
      const resultObj = { summary: outcome.summary, ts, ...(outcome.taskId ? { taskId: outcome.taskId, agentName: outcome.agentName } : {}) };
      const nextSteps = routine.steps.map((s) => (s.id === step.id ? { ...s, status: outcome.status, result: resultObj } : s));
      const allSettled = nextSteps.every((s) => s.status !== 'pending' && s.status !== 'running');
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

  /** "Advance" from the dashboard: select the routine + scroll the working card into view. */
  const advance = useCallback((routine) => {
    setSelectedId(routine.id);
    const el = document.querySelector('.sec-next');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const nextPendingStep = useCallback((routine) => (routine.steps || []).find((s) => s.status === 'pending') || null, []);

  /** B4: pull a delegated step's agent-task status back into the routine (the result flowing home). */
  const checkDelegateResult = useCallback(async (routine, step) => {
    const ref = step.result || {};
    if (!ref.taskId || !ref.agentName || checkingStepId) return;
    setCheckingStepId(step.id);
    try {
      const r = await apiGet(`/v1/agents/${encodeURIComponent(ref.agentName)}/tasks/${encodeURIComponent(ref.taskId)}`);
      const task = r && r.data && r.data.task;
      const status = (task && task.status) || 'unknown';
      const ts = new Date().toISOString();
      const summary = t('secretary.next.resultDelegateStatus', { agent: ref.agentName, status });
      await patchRoutine(routine.id, (rt) => ({
        ...rt,
        steps: rt.steps.map((s) => (s.id === step.id ? { ...s, result: { ...s.result, summary, checkedAt: ts } } : s)),
        results: [{ ts, summary }, ...(rt.results || [])].slice(0, 20),
      }));
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      showToast(`${t('secretary.next.error')}: ${e.message}`, true);
    } finally {
      setCheckingStepId(null);
    }
  }, [checkingStepId, patchRoutine, showToast]);

  return {
    goal, setGoal, proposing, proposeRoutine,
    routines, activeRoutines, selected, selectedId, setSelectedId,
    busyStepId, approveStep, setRoutineStatus, deleteRoutine, advance, nextPendingStep,
    delegateAgent, setDelegateAgent, checkingStepId, checkDelegateResult,
  };
}
