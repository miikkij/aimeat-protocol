/**
 * @file public/js/services/agent-ties.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the home's agent pages do with an agent's ties: tie an app to it or take the
 *   tie away, say which workspace its finished work is shared with, draft three apps that could
 *   show its work, and compose the text a person hands to the AI that builds one.
 *
 *   THE NODE HOLDS THE FACTS, THIS FILE ASKS. The tie is a row of the app's data map and the
 *   workplace is a record under the owner (src/services/agent-ties.ts); both come back on
 *   GET /v1/home/agents (services/agent-draft.js readHomeAgents) as `apps` and `work_goes_to`.
 *
 *   THE DRAFT follows the agent draft (services/agent-draft.js): the person's own model answers one
 *   request with JSON, the answer is checked before the page shows it, and a model that does not
 *   answer leaves the person with one plain option built from their own sentence, so the way to
 *   the build prompt never closes.
 *
 *   THE BUILD PROMPT comes in two lengths. An AI connected to this AIMEAT reads the agent section
 *   and the build specification itself, so it gets a short request that names both. An AI that
 *   cannot connect gets the whole text, because it has no way to ask for more.
 * @structure tieApp · untieApp · setWorkplace · clearWorkplace · readTieChoices ·
 *   draftAppOptions · plainOption · buildRequest · readFullBuildPrompt · WHO
 * @usage import { draftAppOptions, buildRequest } from '/js/services/agent-ties.js';
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const enc = encodeURIComponent;

/** State that an app shows an agent's work (PUT /v1/datamap/apps/:owner/:filename/agents/:agent). */
export async function tieApp(owner, filename, agent, { madeFor = false } = {}) {
  const resp = await api(`/v1/datamap/apps/${enc(owner)}/${enc(filename)}/agents/${enc(agent)}`, {
    method: 'PUT', body: JSON.stringify({ made_for: madeFor }),
  });
  return resp?.data ?? null;
}

/** Take the tie away. The agent, its work and the app stay as they are. */
export async function untieApp(owner, filename, agent) {
  const resp = await api(`/v1/datamap/apps/${enc(owner)}/${enc(filename)}/agents/${enc(agent)}`, { method: 'DELETE' });
  return resp?.data ?? null;
}

/** Name the workspace an agent's finished work is shared with (PUT /v1/agents/:name/workplace). */
export async function setWorkplace(agent, organismId, workspaceId) {
  const resp = await api(`/v1/agents/${enc(agent)}/workplace`, {
    method: 'PUT', body: JSON.stringify({ organism_id: organismId, workspace_id: workspaceId }),
  });
  return resp?.data ?? null;
}

/** Back to the default: the work stays in the agent's own memory. */
export async function clearWorkplace(agent) {
  const resp = await api(`/v1/agents/${enc(agent)}/workplace`, { method: 'DELETE' });
  return resp?.data ?? null;
}

/**
 * What the person can pick for an agent's ties, in one read (GET /v1/home/agents/choices):
 * `places`, the workspaces of the organisms they are in, and `apps`, their own apps.
 */
export async function readTieChoices() {
  const resp = await apiGet('/v1/home/agents/choices');
  return { places: resp?.data?.places ?? [], apps: resp?.data?.apps ?? [] };
}

/** Who may open the app, as the request says it to the builder. English: an AI reads it. */
export const WHO = {
  me: 'Only me. Keep it private.',
  members: 'The members of one of my organisms. Ask me which one before you publish.',
  anyone: 'Anyone who has the address. Publish it as public.',
};

const draftPrompt = (worker) => `You propose small web apps that show the work of one AI agent to its owner.

The agent is called "${worker.display_name || worker.name}". What it is for: ${worker.description || 'not stated'}.
It works ${worker.when === 'clock' ? 'on a schedule' : worker.when === 'talk' ? 'when someone writes to it' : worker.when === 'always' ? 'all the time' : 'when its owner asks'}.

The owner says what they want to see. Propose exactly three different apps for that, each a different way of showing the agent's work (for example: the newest result first, a list over time, one item at a time to share). Write in the language of the owner's sentence.

Answer with JSON only, in this shape:
{"options":[{"name":"<a short name for the app, at most 4 words>","shows":"<one or two sentences: what a person sees when they open it>"}]}`;

/** The first JSON object in a model's answer, or null. */
function firstJson(text) {
  const s = String(text ?? '');
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { return JSON.parse(s.slice(from, to + 1)); }
  catch (err) { swallowed('agent ties: the model answered with something that is not JSON', err); return null; }
}

/**
 * Three apps that could show this agent's work, written by the person's own model. Throws an
 * Error with `code` (the node's own code, or NO_JSON / BAD_DRAFT) when the answer cannot be used.
 */
export async function draftAppOptions(worker, sentence) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({
      prompt: sentence || 'Propose what would be most useful to see.',
      systemPrompt: draftPrompt(worker), modelRole: 'execution', app_id: 'home-agents',
    }),
    timeoutMs: 300_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  const parsed = firstJson(resp?.data?.content);
  if (!parsed) { const e = new Error('NO_JSON'); e.code = 'NO_JSON'; throw e; }
  const options = (Array.isArray(parsed.options) ? parsed.options : [])
    .map((o) => ({ name: String(o?.name ?? '').trim().slice(0, 60), shows: String(o?.shows ?? '').trim().slice(0, 400) }))
    .filter((o) => o.name && o.shows)
    .slice(0, 3);
  if (options.length === 0) { const e = new Error('BAD_DRAFT'); e.code = 'BAD_DRAFT'; throw e; }
  return options;
}

/** One option made from the person's own words, for when no model answered. */
export function plainOption(worker, sentence) {
  return {
    name: (worker.display_name || worker.name).slice(0, 60),
    shows: sentence || `The newest finished work of ${worker.display_name || worker.name}, and its earlier work by date.`,
  };
}

/**
 * The request a person gives to an AI that is connected to this AIMEAT. Short on purpose: the AI
 * reads the agent section and the build specification itself. English: an AI reads it.
 */
export function buildRequest(option, worker, who) {
  return [
    `Build an AIMEAT app named "${option.name}" on my AIMEAT.`,
    '',
    `What it shows: ${option.shows}`,
    `Who opens it: ${WHO[who] ?? WHO.me}`,
    `It shows the work of my agent "${worker.name}".`,
    '',
    'Read two things first, in this order:',
    `1. aimeat_handbook_get { tier: "build-app/agent/${worker.name}" } : the agent, how to read its work, what its latest result looks like, and the data map row that ties the app to it.`,
    '2. aimeat_handbook_get { tier: "build-app" } : the build specification of this AIMEAT.',
    '',
    'Then build the app, publish it, and write its data map with the row from step 1. Give me the address of the app when it is open.',
  ].join('\n');
}

/**
 * The whole text for an AI that cannot connect: the request, the agent section and the build
 * specification (GET /v1/prompts/build-app/agent/:name), and how the result comes back.
 */
export async function readFullBuildPrompt(option, worker, who) {
  const resp = await apiGet(`/v1/prompts/build-app/agent/${enc(worker.name)}?idea=${enc(`${option.name}: ${option.shows}`.slice(0, 480))}`);
  const spec = resp?.data?.prompt ?? '';
  return [
    `Build an AIMEAT app named "${option.name}".`,
    '',
    `What it shows: ${option.shows}`,
    `Who opens it: ${WHO[who] ?? WHO.me}`,
    '',
    'You are not connected to my AIMEAT, so everything you need is below: first the agent whose work the app shows, then the build specification. Write the whole app as one HTML file and give me the file. I add it to my AIMEAT myself.',
    '',
    spec,
  ].join('\n');
}
