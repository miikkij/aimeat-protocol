/**
 * @file secretary/use-guided-plan.js
 * @description Phase 3c — guided "do-it-for-you" playbooks. A hook that: (1) turns a user goal into a
 *   short action plan via the owner's OpenRouter key (propose steps), then on approval (2) executes the
 *   automatable part within the Draft band — files the plan into the active context's self-organism +
 *   scouts existing resources via aimeat_discover — and reports the result. Kept as a hook so the main
 *   view stays lean. See docs/plans/2026-06-23-secretary-feature.md (Phase 3 guided playbooks).
 * @structure buildPlanPrompt() · useGuidedPlan({ active, owner, suggestedWsId, wsList, showToast })
 * @usage const plan = useGuidedPlan({...}); ... guidedPlanCard(plan)
 * @version-history
 *   v0.2.0 — 2026-06-24 — P3-B: approving a plan auto-logs a decision contract (the approval is a
 *     real choice) so the learning loop reviews how the plan turned out.
 *   v0.1.0 — 2026-06-24 — Phase 3c: propose steps → approve → execute (file + discover) → result.
 */
import { useState, useCallback } from 'preact/hooks';
import { api, apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';
import { extractJson, buildDecisionRecord } from '/js/services/secretary-helpers.js';

export function buildPlanPrompt(goal, contextName) {
  return `In the "${contextName || 'personal'}" context, the user's goal is:
"""
${goal}
"""
Propose a short, concrete action plan to make progress. Output ONLY a JSON object inside a single code block, EXACTLY this shape:

\`\`\`json
{ "summary": "one line summarizing the plan", "steps": [ { "title": "short step", "detail": "what to do, one sentence" } ] }
\`\`\`

3–6 steps, ordered, concrete and specific to the goal. Output ONLY the JSON code block — no commentary.`;
}

export function useGuidedPlan({ active, suggestedWsId, wsList, showToast }) {
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState(null);    // { summary, steps:[{title,detail}] }
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);   // { wsName, found }

  const planIt = useCallback(async () => {
    const g = goal.trim();
    if (!g || !active) return;
    setPlanning(true);
    try {
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: buildPlanPrompt(g, active.name), app_id: 'secretary-plan' }), timeoutMs: 1_800_000, retries: 0 });
      const content = r && r.data && r.data.content;
      const json = extractJson(content || '');
      if (!json || !Array.isArray(json.steps) || json.steps.length === 0) throw new Error(t('secretary.plan.bad'));
      setSteps({ summary: json.summary || '', steps: json.steps.slice(0, 8) });
      setResult(null);
    } catch (e) {
      showToast(`${t('secretary.plan.error')}: ${e.message}`, true);
    } finally {
      setPlanning(false);
    }
  }, [goal, active, showToast]);

  const runPlan = useCallback(async () => {
    if (!steps || !active) return;
    setRunning(true);
    try {
      let wsName = '';
      // (1) File the plan into the chosen/suggested workspace (Draft band — the user approved it).
      const wsId = suggestedWsId || (wsList[0] && wsList[0].id);
      if (active.organismId && wsId) {
        const id = 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await apiPost('/v1/memory', {
          key: `organism.${active.organismId}.w.${wsId}.plans.${id}`,
          value: { id, title: goal.trim().slice(0, 80), summary: steps.summary, steps: steps.steps, createdAt: new Date().toISOString(), via: 'secretary' },
          visibility: 'private',
        });
        const w = wsList.find((x) => x.id === wsId);
        wsName = w ? w.name : '';
      }
      // (2) Scout existing resources for the goal (scout-before-build).
      let found = 0;
      try {
        const params = new URLSearchParams({ scope: 'public', per_page: '10' });
        params.set('q', goal.trim());
        const d = await apiGet('/v1/discover?' + params.toString());
        found = (d && d.data && Array.isArray(d.data.entries)) ? d.data.entries.length : 0;
      } catch { /* discovery is best-effort */ }
      // (3) P3-B: approving this plan is a real choice — log it as a decision contract so the
      //     learning loop later scores whether the plan actually achieved the goal.
      try {
        const rec = buildDecisionRecord({
          decision: goal.trim().slice(0, 200),
          options: [],
          chosen: t('secretary.plan.decisionChosen'),
          rationale: steps.summary || t('secretary.decisionAutoRationale'),
          expectedOutcome: steps.summary || t('secretary.plan.decisionExpected'),
          revisitDays: 7,
          active,
        });
        await apiPost('/v1/memory', { key: `secretary.decision.${rec.id}`, value: rec, visibility: 'private', tags: ['secretary', 'decision', 'open', (active && active.id) || ''] });
        window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      } catch { /* decision logging is best-effort — never blocks the plan result */ }
      setResult({ wsName, found });
      showToast(t('secretary.plan.ran'));
    } catch (e) {
      showToast(`${t('secretary.plan.error')}: ${e.message}`, true);
    } finally {
      setRunning(false);
    }
  }, [steps, active, suggestedWsId, wsList, goal, showToast]);

  const cancelPlan = useCallback(() => { setSteps(null); setResult(null); }, []);
  const resetPlan = useCallback(() => { setSteps(null); setResult(null); setGoal(''); }, []);

  return { goal, setGoal, steps, planning, planIt, running, runPlan, result, cancelPlan, resetPlan };
}
