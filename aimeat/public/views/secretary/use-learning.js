/**
 * @file secretary/use-learning.js
 * @description Phase 5 — the learning loop (Goals → Decisions → Outcomes). A hook that manages the
 *   Secretary's lightweight goal records (`secretary.goal.{id}`) and the decision-log Memory Contracts
 *   (`secretary.decision.{id}`, see docs/specs/secretary-decision-contract.md). Decisions stay OPEN
 *   after the choice; the autonomous tick's review sweep (services/scheduler.ts) scores them
 *   actual-vs-expected and advances open→reviewed. "Review now" triggers that tick immediately.
 * @structure useLearning({ active, auto, showToast }) -> { goals, decisions, loading, goalForm, decForm, ...handlers }
 * @usage const learn = useLearning({ active, auto, showToast }); goalsCard(learn) / decisionLogCard(learn)
 * @version-history v0.1.0 — 2026-06-24 — Phase 5: goals + decision-log contract + review trigger.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';

const DECISION_SPEC = 'docs/specs/secretary-decision-contract.md';

function genId() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

async function listByPrefix(prefix) {
  // Cache-bust: the list endpoint can be served from the browser HTTP cache, which would hide a
  // just-written score after a review. A unique query param forces a fresh response each load.
  const r = await apiGet(`/v1/memory?prefix=${encodeURIComponent(prefix)}&_=${Date.now()}`).catch(() => null);
  const items = (r && r.data && Array.isArray(r.data.items)) ? r.data.items : [];
  return items.map((it) => it.value).filter(Boolean);
}

export function useLearning({ active, auto, showToast }) {
  const [goals, setGoals] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);

  const [goalForm, setGoalForm] = useState({ open: false, title: '', why: '', saving: false });
  const [decForm, setDecForm] = useState({ open: false, decision: '', goalRef: '', options: '', chosen: '', rationale: '', expectedOutcome: '', revisitDays: 7, saving: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, d] = await Promise.all([listByPrefix('secretary.goal.'), listByPrefix('secretary.decision.')]);
      g.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      d.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setGoals(g);
      setDecisions(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch when the server reports a change (the autonomous tick scores decisions server-side).
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // ── Goals ──
  const addGoal = useCallback(async () => {
    const title = goalForm.title.trim();
    if (!title) return;
    setGoalForm((f) => ({ ...f, saving: true }));
    const id = genId();
    const value = { id, title, why: goalForm.why.trim(), status: 'open', contextId: active?.id || '', contextName: active?.name || '', createdAt: new Date().toISOString() };
    try {
      await apiPost('/v1/memory', { key: `secretary.goal.${id}`, value, visibility: 'private', tags: ['secretary', 'goal', 'open', active?.id || ''] });
      setGoalForm({ open: false, title: '', why: '', saving: false });
      await load();
    } catch (e) {
      showToast(`${t('secretary.learn.error')}: ${e.message}`, true);
      setGoalForm((f) => ({ ...f, saving: false }));
    }
  }, [goalForm, active, load, showToast]);

  const completeGoal = useCallback(async (g) => {
    const value = { ...g, status: g.status === 'done' ? 'open' : 'done' };
    await apiPost('/v1/memory', { key: `secretary.goal.${g.id}`, value, visibility: 'private', tags: ['secretary', 'goal', value.status, g.contextId || ''] });
    await load();
  }, [load]);

  const deleteGoal = useCallback(async (g) => {
    await apiDelete(`/v1/memory/secretary.goal.${g.id}`);
    await load();
  }, [load]);

  // ── Decisions (memory-contract records) ──
  const addDecision = useCallback(async () => {
    const decision = decForm.decision.trim();
    if (!decision) return;
    setDecForm((f) => ({ ...f, saving: true }));
    const id = genId();
    const days = Number(decForm.revisitDays) || 7;
    const revisitWhen = new Date(Date.now() + days * 86400000).toISOString();
    const value = {
      type: 'secretary.decision', spec: DECISION_SPEC, id,
      decision,
      goalRef: decForm.goalRef || null,
      options: decForm.options.split('\n').map((s) => s.trim()).filter(Boolean),
      chosen: decForm.chosen.trim(),
      rationale: decForm.rationale.trim(),
      expectedOutcome: decForm.expectedOutcome.trim(),
      revisitWhen,
      actualOutcome: null, score: null, verdict: null, status: 'open',
      reviewedAt: null, attempts: 0, lastError: null,
      contextId: active?.id || '', contextName: active?.name || '', createdAt: new Date().toISOString(),
    };
    try {
      await apiPost('/v1/memory', { key: `secretary.decision.${id}`, value, visibility: 'private', tags: ['secretary', 'decision', 'open', active?.id || ''] });
      setDecForm({ open: false, decision: '', goalRef: '', options: '', chosen: '', rationale: '', expectedOutcome: '', revisitDays: 7, saving: false });
      await load();
    } catch (e) {
      showToast(`${t('secretary.learn.error')}: ${e.message}`, true);
      setDecForm((f) => ({ ...f, saving: false }));
    }
  }, [decForm, active, load, showToast]);

  const deleteDecision = useCallback(async (d) => {
    await apiDelete(`/v1/memory/secretary.decision.${d.id}`);
    await load();
  }, [load]);

  // Review now = run the autonomous tick immediately (it scores open+due decisions), then reload.
  const reviewNow = useCallback(async () => {
    if (!auto.schedule) { showToast(t('secretary.learn.enableFirst')); return; }
    setReviewing(true);
    try {
      await auto.runTick();
      await load();
      // The tick's score write can land a beat after the trigger response resolves — reload once more
      // shortly after so the score appears in-place without waiting for the next live-update/refresh.
      await new Promise((r) => setTimeout(r, 1200));
      await load();
    } finally {
      setReviewing(false);
    }
  }, [auto, load, showToast]);

  return {
    goals, decisions, loading, reviewing,
    goalForm, setGoalForm, addGoal, completeGoal, deleteGoal,
    decForm, setDecForm, addDecision, deleteDecision, reviewNow,
  };
}
