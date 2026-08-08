/**
 * @file public/js/services/intents.js
 * @description Client for the intent pool — the list of what you mean to do here.
 *
 *   Thin over /v1/intents, plus the one piece of logic the pool owns: promoting an intent to a real
 *   task on a real agent. That uses the SAME branch `offers.js` uses to decide whether an agent
 *   takes queued work (`takesTasks`), because two surfaces answering "can this agent be handed
 *   something" differently is how one of them ends up offering a name that never does anything.
 * @structure listIntents · createIntent · updateIntent · deleteIntent · promoteIntent ·
 *   reachableAgents
 * @usage
 *   import { createIntent } from '/js/services/intents.js';
 *   await createIntent({ title, prompt_ref: 'build-app', origin: 'home.rooms.create' });
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 2-3).
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { createTask } from '/js/services/agent-tasks.js';
import { takesTasks } from '/js/services/offers.js';

/** The pool. Satisfied suggestions are already dropped by the server. */
export async function listIntents() {
  const r = await apiGet('/v1/intents');
  return r?.data?.intents ?? [];
}

/**
 * @param {{ title: string, kind?: string, prompt_ref?: string, prompt_args?: object,
 *   origin?: string, object?: { type: string, id: string }, closes_when?: { check: string } }} input
 */
export async function createIntent(input) {
  const r = await apiPost('/v1/intents', input);
  return r?.data?.intent ?? null;
}

export async function updateIntent(id, patch) {
  const r = await apiPatch(`/v1/intents/${encodeURIComponent(id)}`, patch);
  return r?.data?.intent ?? null;
}

export async function deleteIntent(id) {
  const r = await apiDelete(`/v1/intents/${encodeURIComponent(id)}`);
  return r?.ok !== false;
}

/**
 * The agents this pool can actually hand something to.
 *
 * "Give it to an agent" must not list a name that will sit there forever: an interactive agent has
 * no queue it drains by itself, so a task addressed to one waits for a human to go and start it.
 */
export async function reachableAgents() {
  const r = await apiGet('/v1/agents');
  return (r?.data?.agents ?? []).filter(a => takesTasks(a) && a?.health?.state !== 'problem');
}

/**
 * Hand an intent to an agent: a real task through the normal route, and the link BOTH ways.
 *
 * `resources.memoryKeys` carries `intent.<id>` so the task can say where it came from — the field
 * already exists in the schema and nothing read it before this. The intent keeps the task id, so
 * the pool row can show who is doing it. The intent is NOT closed here: it closes when the task
 * completes, on the server, which is the only writer that can be trusted to know.
 */
export async function promoteIntent(intent, agentEntry) {
  const created = await createTask(agentEntry.agent ?? agentEntry.name, {
    title: intent.title,
    description: intent.prompt_ref
      ? `From your intent pool. The prompt for this is served at /v1/prompts/${intent.prompt_ref}.`
      : 'From your intent pool.',
    status: 'queued',
    // snake_case: the route reads body.resources.memory_keys (routes/agent-tasks/create-read.ts).
    resources: { memory_keys: [`intent.${intent.id}`] },
    scope: [
      { name: 'kind', value: 'intent', type: 'text' },
      { name: 'intent_id', value: intent.id, type: 'text' },
      ...(intent.prompt_ref ? [{ name: 'prompt_ref', value: intent.prompt_ref, type: 'text' }] : []),
    ],
  });
  const taskId = created?.data?.task?.id || created?.data?.id || null;
  if (!taskId) return { ok: false, error: created?.error };
  const updated = await updateIntent(intent.id, {
    status: 'working',
    agent: agentEntry.gaii ?? agentEntry.agent ?? null,
    taskId,
  });
  return { ok: true, taskId, intent: updated };
}
