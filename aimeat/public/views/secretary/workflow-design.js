/**
 * @file secretary/workflow-design.js
 * @description Phase 3 — the Secretary DESIGNS an Agent Workflow toward a desired outcome. It reads the
 *   owner's available workflow-compatible offers (specialists + any shared/external agents), composes a
 *   chain (a DAG of agent+offer steps) with the reasoning model, proposes how to arm it
 *   (manual = callable / schedule = cron / event), and saves it via PUT /v1/workflows/:id. The model may
 *   only chain REAL offers from the catalogue — it never invents a step.
 * @structure
 *   - fetchWorkflowOffers() -> [{ agent, offer, title, ask, produces }]  (workflow-compatible only)
 *   - designWorkflow({ outcome, offers, locale }) -> { ok, def?, error? } (normalized WorkflowDef draft)
 *   - saveDesignedWorkflow(id, def) -> { ok, errors? }  (PUT, surfaces validation errors)
 *   - slugifyWorkflowId(text) -> a lowercase workflow id
 * @usage const offers = await fetchWorkflowOffers(); const r = await designWorkflow({ outcome, offers, locale });
 * @version-history
 *   v0.1.0 — 2026-06-28 — Phase 3: design a workflow from available offers (reasoning) + save/arm.
 */
import { apiGet, apiPut } from '/js/api.js';
import { getLocale } from '/js/i18n.js';
import { reasonJson, getAiCapability } from '/views/secretary/quality.js';

const lang = (locale) => (locale === 'fi' ? 'Finnish' : 'English');

/** An offer is workflow-compatible iff it declares success_signal + required_to_function + location.key. */
function isWorkflowCompatible(o) {
  return !!(o && o.success_signal && o.required_to_function !== undefined && o.deliverable && o.deliverable.location && o.deliverable.location.key);
}

/** The owner's available workflow-compatible offers (specialists + shared/external), flattened. */
export async function fetchWorkflowOffers() {
  const r = await apiGet('/v1/offers').catch(() => null);
  const agents = (r && r.data && r.data.agents) || [];
  const out = [];
  for (const a of agents) {
    for (const o of (a.offers || [])) {
      if (!isWorkflowCompatible(o)) continue;
      out.push({ agent: a.agent, offer: o.id, title: o.title || o.id, ask: o.ask || '', produces: o.deliverable.location.key });
    }
  }
  return out;
}

export function slugifyWorkflowId(text) {
  return ('wf-' + String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 60) || 'wf-' + Date.now().toString(36);
}

const designSys = (locale) => `You design an Agent Workflow — a DAG of steps that chains agents to reach the owner's desired OUTCOME. Return ONLY JSON:
{"title":"short title","description":"one line","trigger":{...},"steps":[{"id":"s1","agent":"<agent>","offer":"<offerId>","description":"what this step does","after":[]}]}
RULES:
- Each step MUST use an (agent, offer) pair from the "Available building blocks" list — NEVER invent an agent or offer.
- Order with "after": a step that needs an earlier step's output lists that step's id in "after". Steps with the same/no "after" and no mutual dependency run in parallel.
- "trigger": choose how to arm it — {"kind":"manual"} (run on demand), or {"kind":"schedule","cron":"<5-field cron>"} (e.g. "0 18 * * *" = every evening) if the outcome implies a cadence, or {"kind":"event","on":"memory.write","match":{}} if it should react to new data.
- 1–8 steps. Keep ids short (s1, s2, …). Write title/description in ${lang(locale)}.
- If NO building block fits the outcome, return {"steps":[]} with a title explaining what's missing.`;

const designUser = (outcome, offers) => {
  const blocks = offers.length
    ? offers.map((o) => `- agent="${o.agent}" offer="${o.offer}": ${o.title} — ${o.ask} (produces ${o.produces})`).join('\n')
    : '(none available)';
  return `Desired outcome:\n${outcome}\n\nAvailable building blocks (use ONLY these):\n${blocks}`;
};

/** Compose a WorkflowDef draft from the outcome + available offers (reasoning model, ≥200k gate). */
export async function designWorkflow({ outcome, offers, locale }) {
  const cap = await getAiCapability();
  if (!cap.bigEnough) return { ok: false, error: 'needModel' };
  const loc = locale || getLocale();
  /** @type {any} */
  const draft = (await reasonJson(designSys(loc), designUser(outcome, offers), 'secretary-workflow-design')) || {};
  const valid = new Set(offers.map((o) => `${o.agent}::${o.offer}`));
  const rawSteps = Array.isArray(draft.steps) ? draft.steps : [];
  // Keep only steps that reference a real (agent, offer); re-id sequentially; sanitize `after`.
  const kept = rawSteps
    .filter((s) => s && valid.has(`${s.agent}::${s.offer}`))
    .slice(0, 8)
    .map((s, i) => ({ id: `s${i + 1}`, agent: String(s.agent), offer: String(s.offer), description: String(s.description || s.offer || '').slice(0, 500), _origId: String(s.id || `s${i + 1}`) }));
  // Remap `after` from original ids → new sequential ids (drop dangling refs).
  const idMap = new Map(rawSteps.map((s, i) => [String(s.id || `s${i + 1}`), null]));
  kept.forEach((s) => idMap.set(s._origId, s.id));
  kept.forEach((s, i) => {
    const orig = rawSteps.find((r) => String(r.id || '') === s._origId) || rawSteps[i] || {};
    const after = (Array.isArray(orig.after) ? orig.after : []).map((a) => idMap.get(String(a))).filter((x) => x && x !== s.id);
    s.after = [...new Set(after)];
    delete s._origId;
  });
  if (!kept.length) return { ok: false, error: 'noSteps', title: String(draft.title || '').slice(0, 120) };
  const trig = draft.trigger && ['manual', 'schedule', 'event'].includes(draft.trigger.kind) ? draft.trigger : { kind: 'manual' };
  const trigger = trig.kind === 'schedule'
    ? { kind: 'schedule', cron: String(trig.cron || '0 9 * * *').slice(0, 120) }
    : trig.kind === 'event'
      ? { kind: 'event', on: trig.on === 'offer.ordered' ? 'offer.ordered' : 'memory.write', match: (trig.match && typeof trig.match === 'object') ? trig.match : {} }
      : { kind: 'manual' };
  const def = {
    title: String(draft.title || outcome).slice(0, 120),
    description: String(draft.description || '').slice(0, 500),
    trigger,
    vars: [],
    steps: kept,
    on_step_fail: 'inspect',
  };
  return { ok: true, def };
}

/** Save (create) the designed workflow — PUT validates against the offer contract + DAG. */
export async function saveDesignedWorkflow(id, def) {
  try {
    await apiPut(`/v1/workflows/${encodeURIComponent(id)}`, def);
    return { ok: true };
  } catch (e) {
    const errs = (e && e.data && e.data.errors) || (e && e.body && e.body.error && e.body.error.details && e.body.error.details.errors);
    return { ok: false, errors: errs || [e.message || 'save failed'] };
  }
}
