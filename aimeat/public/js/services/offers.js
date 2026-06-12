/**
 * @file offers.js
 * @description Frontend service for the Agent Offers surface ("what can I do with my agents"). Reads
 *   the owner aggregate feed + per-agent offers, and the mode-aware Ask: a schedule-born offer triggers
 *   its schedule; a task-runner/autonomous agent runs a task; an interactive/workstation agent gets a
 *   paste-ready prompt (AIMEAT's prompt-driven flow). See docs/plans/2026-06-12-agent-offers-*.md.
 * @structure listOffers / getAgentOffers / publishOffers · ask(agentEntry, offer, inputs) · buildAskPrompt
 * @usage import * as offers from '/js/services/offers.js';
 * @version-history
 *   v1.0.0 -- 2026-06-12 -- Initial: Do feed + mode-aware Ask (run / copy-prompt / schedule-trigger).
 *   v1.1.0 -- 2026-06-12 -- Billable offers: setOfferBilling (patch one offer's price + visibility).
 */
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';
import { createTask, rateTask } from '/js/services/agent-tasks.js';

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
export async function setOfferBilling(name, offerId, { price, visibility }) {
  const cur = await getAgentOffers(name);
  const offers = (cur?.data?.offers || []).map(o => o.id === offerId
    ? { ...o, ...(price !== undefined ? { price } : {}), ...(visibility !== undefined ? { visibility } : {}) }
    : o);
  return publishOffers(name, { offers });
}

/** The Inbox feed: everything that came back across all agents (non-draft tasks, newest first). */
export async function listDeliverables() {
  return apiGet('/v1/deliverables');
}

/** Fetch a deliverable's content by its memory key (for inline rendering). */
export async function getDeliverableContent(key) {
  return apiGet(`/v1/memory/${encodeURIComponent(key)}`);
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
export async function ask(agentEntry, offer, inputs) {
  const scheduleId = scheduleIdOf(offer);
  if (scheduleId) {
    const r = await apiPost(`/v1/schedules/${encodeURIComponent(scheduleId)}/trigger`, {});
    return { kind: 'triggered', ok: r?.ok !== false, error: r?.error };
  }

  const mode = agentEntry.mode || 'interactive';
  if (mode === 'task-runner' || mode === 'autonomous') {
    const r = await createTask(agentEntry.agent, {
      title: offer.title,
      description: [offer.ask, offer.example ? `Example: ${offer.example}` : '', inputs ? `Request: ${String(inputs).trim()}` : ''].filter(Boolean).join('\n'),
      status: 'queued',   // REQUIRED so a task-runner auto-activates it (other modes keep the owner-start gate)
      scope: [
        { name: 'kind', value: 'offer', type: 'text' },
        { name: 'offer_id', value: offer.id, type: 'text' },
      ],
    });
    return { kind: 'task', taskId: r?.data?.task?.id || r?.data?.id, agent: agentEntry.agent, ok: r?.ok !== false, error: r?.error };
  }

  // interactive / workstation → prompt-driven
  const prompt = buildAskPrompt(agentEntry, offer, inputs);
  await copyToClipboard(prompt);
  return { kind: 'prompt', copied: true, prompt };
}
