/**
 * @file notebook-plan.js
 * @description Notebook stage 2 client service — enrichment PLAN generation + step execution. The plan
 *   itself is produced server-side (POST /v1/librarian/plan, the user's own OpenRouter model reasoning
 *   over the note); each step is then EXECUTED here over the generic AI + librarian APIs (no-SSR), and
 *   the result is folded back into the note with a structured Sources/References trail. Phase 1 runs
 *   two self-fulfilled step kinds: `llm_reason` (expand using only the note) and `librarian_assess`
 *   (summarise the user's OWN existing material found via the librarian).
 * @structure
 *   - buildCatalogue(feed) — compact [{agent,offerId,title,ask,latency,cost}] from the /v1/offers feed
 *   - generatePlan(text, catalogue) — POST /v1/librarian/plan (slow AI call; full timeout, no retry)
 *   - runStep(step, ctx) — execute one plan step → EnrichmentResult { stepId, kind, markdown, sources }
 *   - composeEnrichedMarkdown(noteText, enrichments) — note + folded results + Sources section
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial (Phase 1): plan generate + reason/librarian-assess execution.
 *   v1.1.0 — 2026-06-21 — Phase 2: `delegate` execution — dispatch a fleet agent offer via offers.ask(),
 *     await the task (SSE + poll), read the deliverable back, fold it in with agent provenance.
 */
import { api } from '/js/api.js';
import { librarianSearch } from '/js/services/memory.js';
import * as offers from '/js/services/offers.js';
import { getTask } from '/js/services/agent-tasks.js';

const ASSESS_HITS = 6;          // how many librarian hits to feed the assessor
const AI_TIMEOUT_MS = 1_800_000; // 30 min — same as the classify call; the model may think a while
const DELEGATE_TIMEOUT_MS = 900_000; // 15 min — fleet offers are "minutes" to "long-running"

/** Build the compact offer catalogue the planner grounds delegate steps against, from the /v1/offers
 *  envelope (offers.listOffers()). Online agents first; bounded to keep the prompt small. */
export function buildCatalogue(feed) {
  const agents = feed?.data?.agents || feed?.agents || [];
  const rows = [];
  for (const a of agents) {
    for (const o of (a.offers || [])) {
      rows.push({ agent: a.agent, offerId: o.id, title: o.title, ask: o.ask, latency: o.latency, cost: o.cost, _online: !!a.online });
    }
  }
  rows.sort((x, y) => (y._online === x._online) ? 0 : (y._online ? 1 : -1));
  return rows.slice(0, 60).map(({ _online, ...r }) => r);
}

/** Ask the backend planner what enrichment steps a note would benefit from. `catalogue` is the compact
 *  offer list (buildCatalogue) so the planner can ground delegate steps. Returns { plan, context, model }.
 *  Slow AI call — full timeout, no retry (a 30s abort would re-fire the still-running model). */
export async function generatePlan(text, catalogue) {
  const resp = await api('/v1/librarian/plan', {
    method: 'POST',
    body: JSON.stringify({ text, catalogue: Array.isArray(catalogue) ? catalogue : [] }),
    timeoutMs: AI_TIMEOUT_MS,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'Plan failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || null;
}

/** Await a dispatched task to a terminal state, refreshing on the live-update event and polling as a
 *  fallback. Resolves the task record on 'done'; throws on failed/stalled/timeout.
 *  @param {string} agentName
 *  @param {string} taskId
 *  @param {{ onStatus?: (status: string) => void }} [opts] */
function awaitTask(agentName, taskId, opts = {}) {
  const { onStatus } = opts;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + DELEGATE_TIMEOUT_MS;
    let settled = false;
    const cleanup = () => { clearInterval(timer); window.removeEventListener('aimeat-live-update', onLive); };
    async function check() {
      if (settled) return;
      let task = null;
      try { const r = await getTask(agentName, taskId); task = r?.data?.task || r?.data || null; } catch { /* transient */ }
      const status = task?.status;
      if (status) onStatus?.(status);
      if (status === 'done') { settled = true; cleanup(); resolve(task); return; }
      if (status === 'failed' || status === 'stalled') { settled = true; cleanup(); reject(new Error('Agent task ' + status)); return; }
      if (Date.now() > deadline) { settled = true; cleanup(); reject(new Error('TIMEOUT')); }
    }
    const onLive = (e) => { const d = e.detail?.domains; if (d && !d.has('agent-tasks')) return; check(); };
    const timer = setInterval(check, 5000);
    window.addEventListener('aimeat-live-update', onLive);
    check();
  });
}

/** One AI completion via the user's own key (budget-enforced server-side). Returns { content, model }. */
async function aiComplete(prompt, systemPrompt) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt, systemPrompt, app_id: 'notebook' }),
    timeoutMs: AI_TIMEOUT_MS,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp.error?.message || 'AI completion failed'); e.code = resp.error?.code; throw e; }
  return resp?.data || { content: '', model: '' };
}

function priorBlock(priorEnrichments) {
  if (!priorEnrichments?.length) return '';
  return '\n\nResults from earlier enrichment steps:\n\n' +
    priorEnrichments.map((e, i) => `### Step ${i + 1}\n${e.markdown}`).join('\n\n');
}

/** Execute one plan step. ctx = { noteText, priorEnrichments }. Returns an EnrichmentResult. */
export async function runStep(step, ctx) {
  const noteText = ctx?.noteText || '';
  const prior = ctx?.priorEnrichments || [];
  const retrievedAt = new Date().toISOString();

  if (step.kind === 'librarian_assess') {
    const hits = await librarianSearch(step.query, ASSESS_HITS, 'own');
    if (!hits.length) {
      return {
        stepId: step.id, kind: step.kind, producedAt: retrievedAt,
        markdown: `_No related material found in your own organisms for "${step.query}"._`,
        sources: [],
      };
    }
    const hitList = hits.map((h, i) =>
      `${i + 1}. **${h.title || h.key}** — ${h.snippet || ''} _(${h.key})_`).join('\n');
    const system = 'You assess a user\'s OWN existing notes/documents against a note they just captured. ' +
      'Summarise what they already have that is relevant, what is missing, and how the existing material relates. ' +
      'Output clean markdown only — no preamble, no invented facts beyond what is listed.';
    const prompt = `The captured note:\n\n"""\n${noteText}\n"""\n\nRelevant existing material from the user's own organisms:\n\n${hitList}\n\nWrite a short assessment.`;
    const { content } = await aiComplete(prompt, system);
    return {
      stepId: step.id, kind: step.kind, producedAt: retrievedAt,
      markdown: (content || '').trim(),
      sources: hits.map(h => ({
        producer: h.producer || null,
        origin: h.key,
        label: h.title || h.key,
        retrievedAt,
      })),
    };
  }

  if (step.kind === 'delegate') {
    const feed = ctx?.offersFeed || await offers.listOffers();
    const agents = feed?.data?.agents || feed?.agents || [];
    let agentEntry = agents.find(a => a.agent === step.agent);
    let offer = agentEntry?.offers?.find(o => o.id === step.offerId);
    // Fallback: the planner's pick is gone/renamed — rank the live catalogue against the request.
    if (!offer) {
      const items = agents.flatMap(a => (a.offers || []).map(o => ({ agent: a.agent, offer: o })));
      const { ranked } = await offers.rankOffersByNeed(step.query, items).catch(() => ({ ranked: [] }));
      const top = ranked?.[0]?.item;
      if (top) { agentEntry = agents.find(a => a.agent === top.agent); offer = top.offer; }
    }
    if (!agentEntry || !offer) throw new Error('No matching agent offer for this step');

    ctx?.onStatus?.(step.id, 'dispatching');
    const dispatch = await offers.ask(agentEntry, offer, step.query);
    if (dispatch.kind !== 'task' || !dispatch.taskId) {
      // Interactive/schedule-only agents can't be auto-awaited from here.
      throw new Error(dispatch.kind === 'prompt' ? 'This agent is interactive — ask it from the Offerings tab' : 'Could not dispatch a task to this agent');
    }
    const task = await awaitTask(agentEntry.agent, dispatch.taskId, { onStatus: (s) => ctx?.onStatus?.(step.id, s) });
    const content = await offers.getDeliverableContent({
      agentGaii: agentEntry.gaii,
      deliverableKey: task?.deliverableKey || task?.deliverable_key,
      taskId: dispatch.taskId,
    });
    return {
      stepId: step.id, kind: step.kind, producedAt: retrievedAt,
      markdown: (content || '_The agent completed the task but returned no readable deliverable._').trim(),
      sources: [{
        producer: agentEntry.gaii,
        origin: task?.deliverableKey || task?.deliverable_key || ('task:' + dispatch.taskId),
        label: `${offer.title} (${agentEntry.agent})`,
        retrievedAt,
      }],
    };
  }

  // llm_reason — expand using only the note + prior step results.
  const system = 'You enrich a user\'s rough note by reasoning about it. Follow the instruction exactly. ' +
    'Output clean markdown only — no preamble. Do not invent external facts; reason from what is given.';
  const prompt = `The captured note:\n\n"""\n${noteText}\n"""${priorBlock(prior)}\n\nInstruction: ${step.query}`;
  const { content, model } = await aiComplete(prompt, system);
  return {
    stepId: step.id, kind: step.kind, producedAt: retrievedAt,
    markdown: (content || '').trim(),
    sources: [{ producer: model || 'ai', origin: null, label: 'AI reasoning', retrievedAt }],
  };
}

/** Compose the enriched note body: original note + each enrichment + a Sources/References section.
 *  This is what gets filed (classify/materialize) once the user is happy. */
export function composeEnrichedMarkdown(noteText, enrichments) {
  if (!enrichments?.length) return noteText;
  const parts = [noteText.trim()];
  const allSources = [];
  for (const e of enrichments) {
    if (!e?.markdown) continue;
    parts.push('', '---', '', e.markdown.trim());
    for (const s of (e.sources || [])) allSources.push(s);
  }
  if (allSources.length) {
    const seen = new Set();
    const lines = [];
    for (const s of allSources) {
      const key = `${s.label}|${s.origin || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const where = s.origin ? ` — \`${s.origin}\`` : '';
      const who = s.producer ? ` _(${String(s.producer).split('@')[0]})_` : '';
      lines.push(`- ${s.label}${where}${who}`);
    }
    if (lines.length) parts.push('', '## Sources / References', '', ...lines);
  }
  return parts.join('\n');
}
