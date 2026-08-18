/**
 * @file offers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service for the Agent Offers surface ("what can I do with my agents"). Reads
 *   the owner aggregate feed + per-agent offers, and the mode-aware Ask: a schedule-born offer triggers
 *   its schedule; a task-runner/autonomous agent runs a task; an interactive/workstation agent gets a
 *   paste-ready prompt (AIMEAT's prompt-driven flow). See docs/plans/2026-06-12-agent-offers-*.md.
 * @structure listOffers / getAgentOffers / publishOffers · ask(agentEntry, offer, inputs) · buildAskPrompt
 * @usage import * as offers from '/js/services/offers.js';
 * @version-history
 *   v1.0.0 -- 2026-06-12 -- Initial: Do feed + mode-aware Ask (run / copy-prompt / schedule-trigger).
 *   v1.1.0 -- 2026-06-12 -- Billable offers: setOfferBilling (patch one offer's price + visibility).
 *   v1.2.0 -- 2026-06-12 -- Inbox fixes: deliverable read from the AGENT namespace (prefix + task-tag
 *     fallback, returns a string); Ask task title carries the user's request (findable in the queue).
 *   v1.3.0 -- 2026-06-12 -- Offer task carries ONLY the user's request (title + description); the offer
 *     is referenced via scope.offer_id/offer_title — no more restuffing offer.ask/example (which made
 *     the agent treat its own boilerplate as the request).
 *   v1.4.0 -- 2026-06-16 -- listOfferRuns (per-offer run history from the deliverables aggregate) for
 *     the richer Offerings card. (Bundle navigation is event-based in the tab, no service call.)
 *   v1.5.0 -- 2026-06-16 -- AI need-router: aiAvailable() + rankOffersByNeed() (maps a free-text need
 *     to fitting offers via the owner's OpenRouter, with a crew-forge brief when nothing fits).
 */
import { api, apiGet, apiPost, apiPut } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';
import { createTask, rateTask } from '/js/services/agent-tasks.js';
import { swallowed } from '/js/swallowed.js';

/** The goal-first feed: every agent's offers + mode/availability. */
export async function listOffers() {
  return apiGet('/v1/offers');
}

/** One agent's published offers. */
export async function getAgentOffers(name) {
  return apiGet(`/v1/agents/${encodeURIComponent(name)}/offers`);
}

/** Publish/replace an agent's offers (agent self or owner). */
export async function publishOffers(name, doc) {
  return apiPut(`/v1/agents/${encodeURIComponent(name)}/offers`, doc);
}

/** Owner edits ONE offer's billing fields (price + visibility), preserving the rest of the doc.
 *  Re-reads the agent's current offers first (avoid clobbering a stale feed), patches, re-publishes.
 *  `price` is `{ morsels, unit }` or `null` (not for sale); `visibility` is private|unlisted|public. */
/**
 * @param {string} name
 * @param {string} offerId
 * @param {{ price?: any, priceMoney?: any, visibility?: string }} billing
 */
export async function setOfferBilling(name, offerId, { price, priceMoney, visibility } = {}) {
  const cur = await getAgentOffers(name);
  const offers = (cur?.data?.offers || []).map(o => o.id === offerId
    ? { ...o, ...(price !== undefined ? { price } : {}), ...(priceMoney !== undefined ? { priceMoney } : {}), ...(visibility !== undefined ? { visibility } : {}) }
    : o);
  return publishOffers(name, { offers });
}

/** The Inbox feed: everything that came back across all agents (non-draft tasks, newest first). */
export async function listDeliverables() {
  return apiGet('/v1/deliverables');
}

/** This offer's OWN recent runs: filter the deliverables aggregate by the offer + agent it ran for
 *  (the Ask flow stamps scope.offer_id, surfaced as `offer_id`). Newest first, capped at `limit`. */
export async function listOfferRuns({ agent, offerId, limit = 5 }) {
  const r = await listDeliverables().catch(err => { swallowed('offers: listOfferRuns', err); return null; });
  const all = r?.data?.deliverables || [];
  return all.filter(d => d.offer_id === offerId && d.agent === agent).slice(0, limit);
}

// ── AI need-router (Phase 2): map a free-text NEED → the offers that fit ─────────
// Layers on top of the deterministic facets/grouping. Uses the owner's OpenRouter key via the generic
// /v1/ai/complete endpoint (spend-safe, consent-gated) — runs ONLY on explicit submit, never on every
// keystroke. When nothing fits, it returns noMatch + a one-line brief for crew-forge (close the loop).

/** True when the owner has an OpenRouter key configured (gates the "find by need" button). */
export async function aiAvailable() {
  try {
    const r = await apiGet('/v1/openrouter/settings');
    return !!(r?.ok && r.data && (r.data.hasApiKey || r.data.has_api_key));
  } catch (err) { swallowed('offers: aiAvailable', err); return false; }
}

/**
 * Rank the offer catalogue against a free-text need. `items` is the flattened [{ agent, offer }] feed.
 * Returns { ranked:[{ item, why }], noMatch, brief }. Sends only compact metadata (no secrets). Throws
 * an Error with .code (NO_API_KEY / QUOTA_EXHAUSTED / …) on failure so the UI can message precisely.
 */
export async function rankOffersByNeed(needText, items) {
  const catalogue = items.map((it, i) => ({
    n: i, id: it.offer.id, agent: it.agent,
    title: it.offer.title, ask: it.offer.ask,
    outcome: it.offer.deliverable?.format,
    cost: it.offer.cost, speed: it.offer.latency, verified: it.offer.verification,
  }));
  const systemPrompt = 'You match a user NEED to a catalogue of AI-agent offers. Choose the few offers '
    + 'that genuinely fit the need, best first (usually 1–5; fewer is better than padding). If nothing '
    + 'fits well, set noMatch=true and write a one-sentence brief describing the agent that SHOULD exist '
    + 'for this need. Reply ONLY as JSON, no prose, no fences: '
    + '{"ranked":[{"n":<catalogue index>,"why":"<short reason in the SAME language as the need>"}],"noMatch":<bool>,"brief":"<string|empty>"}';
  const prompt = `NEED: ${needText}\n\nCATALOGUE (${catalogue.length} offers):\n${JSON.stringify(catalogue)}`;
  const r = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt, systemPrompt, modelRole: 'execution', app_id: 'offers-need-router' }),
    timeoutMs: 120_000, retries: 0,
  });
  if (!r?.ok) { const e = new Error(r?.error?.message || 'AI call failed'); e.code = r?.error?.code || 'UNKNOWN'; throw e; }
  const content = r.data?.content || '';
  const m = /\{[\s\S]*\}/.exec(content);
  let parsed = null;
  try { parsed = JSON.parse(m ? m[0] : content); } catch { /* unparseable */ }   // eslint-disable-line aimeat/no-silent-catch -- unparseable
  if (!parsed) { const e = new Error('AI returned unparseable JSON'); e.code = 'JSON_PARSE_FAILED'; throw e; }
  const ranked = (Array.isArray(parsed.ranked) ? parsed.ranked : [])
    .map(x => ({ item: items[x.n], why: typeof x.why === 'string' ? x.why : '' }))
    .filter(x => x.item);
  return { ranked, noMatch: !!parsed.noMatch, brief: typeof parsed.brief === 'string' ? parsed.brief : '' };
}

/** Fetch a task's deliverable from the AGENT's memory namespace (owner→agent read).
 *  Deliverables live under the agent's GAII, not the owner's, so we read via
 *  `?agent=<gaii>`. Primary handle is the recorded `deliverableKey`; fallback is the
 *  `task:<id>` tag the runner stamps on every write (works even when the agent never
 *  set deliverableKey — e.g. CrewAI agents that only publish to memory). Returns the
 *  deliverable value as a string, or null if nothing was found. Mirrors the proven
 *  read in agents-tasks-subtab.js. */
export async function getDeliverableContent({ agentGaii, deliverableKey, taskId }) {
  if (!agentGaii) return null;
  const enc = encodeURIComponent;
  const reqs = [];
  if (deliverableKey) reqs.push(apiGet(`/v1/memory?agent=${enc(agentGaii)}&prefix=${enc(deliverableKey)}&per_page=5`).catch(err => { swallowed('offers', err); return null; }));
  if (taskId) reqs.push(apiGet(`/v1/memory?agent=${enc(agentGaii)}&tags=${enc('task:' + taskId)}&per_page=50`).catch(err => { swallowed('offers', err); return null; }));
  const results = await Promise.all(reqs);
  const items = [];
  const seen = new Set();
  for (const r of results) {
    const list = r?.data?.items || r?.data || [];
    for (const it of (Array.isArray(list) ? list : [])) {
      if (it.key && !seen.has(it.key)) { seen.add(it.key); items.push(it); }
    }
  }
  if (!items.length) return null;
  const len = (v) => (typeof v === 'string' ? v.length : 0);
  // Prefer the exact deliverableKey, then an *output key, then the longest text value.
  const pick = items.find(i => i.key === deliverableKey)
    || items.find(i => /(latest_)?output$/.test(i.key))
    || items.slice().sort((a, b) => len(b.value) - len(a.value))[0];
  const v = pick?.value;
  if (v == null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

/** Rate a done task's deliverable via the LOCKED rate endpoint (→ agents.<agent>.statistics.*).
 *  Owner ratings bypass source-grounding; we still send source_grounded:true (the owner saw it). */
export async function rateDeliverable(agent, taskId, { stars, comment, context = 'other' }) {
  return rateTask(agent, taskId, { stars, context, comment, source_grounded: true });
}

/** Compose the paste-ready prompt for an interactive/workstation agent (prompt-driven Ask). */
export function buildAskPrompt(agentEntry, offer, inputs) {
  const lines = [
    `You are the agent "${agentEntry.agent}". I'm asking you to perform one of your offers.`,
    ``,
    `OFFER: ${offer.title}`,
    `WHAT I'M ASKING: ${offer.ask}`,
  ];
  if (offer.example) lines.push(`EXAMPLE OF A REQUEST LIKE THIS: ${offer.example}`);
  if (inputs && String(inputs).trim()) lines.push(``, `MY REQUEST: ${String(inputs).trim()}`);
  if (offer.deliverable?.format) lines.push(``, `DELIVER: a ${offer.deliverable.format}${offer.deliverable.location?.space ? ` in ${offer.deliverable.location.space}` : ''}.`);
  lines.push(``, `Do exactly this offer and nothing outside its scope. When done, write the deliverable and tell me where it is.`);
  return lines.join('\n');
}

function scheduleIdOf(offer) {
  const sb = offer?.availability?.scheduleBorn;
  if (!sb) return null;
  return typeof sb === 'object' ? (sb.scheduleId || null) : null;   // string form is a human label only
}

/**
 * Mode-aware Ask. Branch order: schedule-born first (independent of mode), then by agent mode.
 * Returns one of:
 *   { kind: 'triggered' }                              — schedule-born → ran the schedule now
 *   { kind: 'task', taskId, agent }                    — task-runner/autonomous → created a queued task
 *   { kind: 'prompt', copied: true, prompt }           — interactive/workstation → copied a paste-ready prompt
 */
/**
 * Which way an agent takes work: a queue it drains itself, or a prompt a person carries.
 *
 * The branch `ask()` has always made, named so a second caller can make the SAME one rather than
 * inventing a parallel rule. The intent pool's "give this to an agent" needs exactly this decision
 * and nothing else about offers — and two places deciding "can this agent be handed work" by
 * different tests is how one of them ends up offering a graveyard.
 *
 * A schedule-born offer is `ask()`'s own special case and stays there; it has no meaning for an
 * intent, which is a piece of work rather than a published capability.
 */
export function dispatchMode(agentEntry) {
  const mode = agentEntry?.mode || 'interactive';
  return (mode === 'task-runner' || mode === 'autonomous') ? 'task' : 'prompt';
}

/** True when this agent can be handed work without a person carrying it. */
export function takesTasks(agentEntry) {
  return dispatchMode(agentEntry) === 'task';
}

export async function ask(agentEntry, offer, inputs) {
  const scheduleId = scheduleIdOf(offer);
  if (scheduleId) {
    const r = await apiPost(`/v1/schedules/${encodeURIComponent(scheduleId)}/trigger`, {});
    return { kind: 'triggered', ok: r?.ok !== false, error: r?.error };
  }

  if (dispatchMode(agentEntry) === 'task') {
    // The agent ALREADY owns the offer (it published it). Do NOT restuff offer.ask/example into the
    // task — that makes the agent treat its own boilerplate as the request (e.g. jokes ABOUT four
    // comedians instead of jokes on the topic). The task carries ONLY the user's request as title +
    // description; the offer is referenced structurally via scope (the runtime resolves it by offer_id).
    const reqText = inputs ? String(inputs).trim() : '';
    const title = reqText ? (reqText.length > 80 ? reqText.slice(0, 80) + '…' : reqText) : offer.title;
    const r = await createTask(agentEntry.agent, {
      title,
      description: reqText,
      status: 'queued',   // REQUIRED so a task-runner auto-activates it (other modes keep the owner-start gate)
      scope: [
        { name: 'kind', value: 'offer', type: 'text' },
        { name: 'offer_id', value: offer.id, type: 'text' },
        { name: 'offer_title', value: offer.title, type: 'text' },
      ],
    });
    return { kind: 'task', taskId: r?.data?.task?.id || r?.data?.id, agent: agentEntry.agent, ok: r?.ok !== false, error: r?.error };
  }

  // interactive / workstation → prompt-driven
  const prompt = buildAskPrompt(agentEntry, offer, inputs);
  await copyToClipboard(prompt);
  return { kind: 'prompt', copied: true, prompt };
}
