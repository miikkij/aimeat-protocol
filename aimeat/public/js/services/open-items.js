/**
 * @file public/js/services/open-items.js
 * @description Client for open items — the one list of what you are going to do here.
 *
 *   Thin over /v1/open-items. The one piece of logic it owns is handing an item to an agent, which
 *   uses the SAME branch `offers.js` uses to decide whether an agent takes queued work
 *   (`takesTasks`), because two surfaces answering "can this agent be handed something" differently
 *   is how one of them ends up offering a name that never does anything.
 *
 *   Switching an item OFF is `switchOff`, not a status change. On the list and off the list are the
 *   two positions of one control, and the API says the same: DELETE.
 * @structure listOpenItems · openItemsCount · addOpenItem · patchOpenItem · switchOff ·
 *   reachableAgents · handToAgent
 * @usage
 *   import { addOpenItem } from '/js/services/open-items.js';
 *   await addOpenItem({ title, prompt_ref: 'build-app', origin: 'home.rooms.create' });
 * @version-history
 *   v1.0.0 — 2026-08-09 — Replaces services/intents.js. One key on the server, a flipped state
 *     instead of open→done, and a count endpoint the header can poll cheaply.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { createTask } from '/js/services/agent-tasks.js';
import { takesTasks } from '/js/services/offers.js';

/** What is switched on. Satisfied suggestions are already dropped by the server. */
export async function listOpenItems() {
  const r = await apiGet('/v1/open-items');
  return r?.data?.items ?? [];
}

/** Just the number, for the header. One key read on the server; safe to call on every page. */
export async function openItemsCount() {
  const r = await apiGet('/v1/open-items/count');
  return Number(r?.data?.count ?? 0);
}

/**
 * @param {{ title: string, kind?: string, prompt_ref?: string, prompt_args?: object,
 *   origin?: string, object?: { type: string, id: string }, closes_when?: { check: string } }} input
 */
export async function addOpenItem(input) {
  const r = await apiPost('/v1/open-items', input);
  return r?.data?.item ?? null;
}

export async function patchOpenItem(id, patch) {
  const r = await apiPatch(`/v1/open-items/${encodeURIComponent(id)}`, patch);
  return r?.data?.item ?? null;
}

/** Switch it off. The same control that switched it on, the other way. */
export async function switchOff(id) {
  const r = await apiDelete(`/v1/open-items/${encodeURIComponent(id)}`);
  return r?.ok !== false;
}

/**
 * The agents this list can actually hand something to.
 *
 * An interactive agent has no queue it drains by itself, so a task addressed to one waits for a
 * human to go and start it. Offering that name is a graveyard, not a feature.
 */
export async function reachableAgents() {
  const r = await apiGet('/v1/agents');
  return (r?.data?.agents ?? []).filter(a => takesTasks(a) && a?.health?.state !== 'problem');
}

/**
 * Hand an item to an agent: a real task through the normal route, and the link BOTH ways.
 *
 * `resources.memoryKeys` carries `open-items.list#<id>`. The key is one and the items are many, so
 * the id rides in a fragment; an agent reading the key gets the list and finds its own item by the
 * id it was handed. The item is NOT switched off here: it goes off when the task completes, on the
 * server, which is the only writer that can be trusted to know.
 */
export async function handToAgent(item, agentEntry) {
  const created = await createTask(agentEntry.agent ?? agentEntry.name, {
    title: item.title,
    description: item.prompt_ref
      ? `From your open items. The prompt for this is served at /v1/prompts/${item.prompt_ref}.`
      : 'From your open items.',
    status: 'queued',
    // snake_case: the route reads body.resources.memory_keys (routes/agent-tasks/create-read.ts).
    resources: { memory_keys: [`open-items.list#${item.id}`] },
    scope: [
      { name: 'kind', value: 'open-item', type: 'text' },
      { name: 'item_id', value: item.id, type: 'text' },
      ...(item.prompt_ref ? [{ name: 'prompt_ref', value: item.prompt_ref, type: 'text' }] : []),
    ],
  });
  const taskId = created?.data?.task?.id || created?.data?.id || null;
  if (!taskId) return { ok: false, error: created?.error };
  const updated = await patchOpenItem(item.id, {
    status: 'working',
    agent: agentEntry.gaii ?? agentEntry.agent ?? null,
  });
  return { ok: true, taskId, item: updated };
}
