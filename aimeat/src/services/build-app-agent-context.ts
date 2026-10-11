/**
 * @file src/services/build-app-agent-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of an app's build instructions that is about ONE agent: which agent's work
 *   the app shows, how to read that work, what its latest result looks like, and the data map row
 *   that ties the app to the agent.
 *
 *   WHY THE NODE WRITES IT. The build specification (services/build-app-prompt.ts) says how any app
 *   reads what agents produce. It cannot say which agent, and the idea field holds one sentence. A
 *   builder told only "show my news agent's work" has to find the agent, guess what its results
 *   look like and remember to state the tie. This text gives all three as facts read from the
 *   owner's own account, and it is composed here once so the page that hands a prompt to a person
 *   and the tool that hands it to their AI say the same thing.
 *
 *   IT IS ADDED IN FRONT OF THE SPECIFICATION AND CHANGES NOTHING IN IT.
 *
 *   THE RESULT'S STRUCTURE, NOT ITS CONTENT. The latest finished result is described by its shape:
 *   field names and value types, and for a text only that it is text and how long. A builder needs
 *   to know there is a `headlines` list of objects with `title` and `url`; it does not need the
 *   headlines. The result is loaded through the caller's classification reader, so a result the
 *   caller may not read is not described at all.
 * @structure buildAppAgentContext(deps, owner, agentName) · describeShape(value)
 * @usage const ctx = await buildAppAgentContext({ config, storage }, owner, 'morning-news');
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import { buildGAII, isValidAgentName } from '../utils/gaii.js';
import { presentMemory } from './classification/present-memory.js';
import type { ContentReader } from './classification/reader.js';

export type AgentContextResult =
  | { ok: true; agent: { name: string; display_name: string; gaii: string }; has_result: boolean; text: string }
  | { ok: false; status: number; code: string; message: string };

const SHAPE_LIMIT = 1400;
const DEPTH = 4;

/**
 * A value as its structure: field names and value types, a list shown by its first item. No text
 * of the result is carried over, only that a field is text and how long it is.
 */
export function describeShape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const kind = /^\s*(#{1,6}\s|[-*]\s|\*\*|\d+\.\s)/m.test(value) ? 'markdown text' : 'text';
    return `(${kind}, ${value.length} characters)`;
  }
  if (typeof value === 'number') return '(number)';
  if (typeof value === 'boolean') return '(true or false)';
  if (typeof value !== 'object') return `(${typeof value})`;
  if (depth >= DEPTH) return Array.isArray(value) ? `[list of ${value.length}]` : '{…}';
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [describeShape(value[0], depth + 1), ...(value.length > 1 ? [`… ${value.length - 1} more`] : [])];
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 24)) out[k] = describeShape(v, depth + 1);
  return out;
}

/** The newest finished task of an agent, from its most recent tasks. */
async function latestDone(storage: Storage, gaii: string): Promise<AgentTaskRecord | null> {
  const { tasks } = await storage.listAgentTasks(gaii, { status: 'done', perPage: 20 });
  const stamp = (t: AgentTaskRecord) => Date.parse(t.completedAt ?? t.updatedAt ?? '') || 0;
  return tasks.reduce<AgentTaskRecord | null>((best, t) => (!best || stamp(t) > stamp(best) ? t : best), null);
}

/**
 * The result of one finished task as THIS reader may see it: the key the task named, else what the
 * run tagged with it. Loaded through the classification presenter, so a result the reader may not
 * read is left out and reads as "no result" rather than as a structure.
 */
async function resultOf(storage: Storage, task: AgentTaskRecord, reader: ContentReader): Promise<unknown> {
  const named = task.deliverableKey ? await storage.getMemory(task.agentGaii, task.deliverableKey) : null;
  const record = named ?? (await storage.listMemory(task.agentGaii, { tags: [`task:${task.id}`] }))[0];
  if (!record) return undefined;
  return (await presentMemory(reader, record))?.value;
}

/**
 * The agent section of the build instructions, for one of the caller's own agents. Another
 * account's agent answers as not found. `reader` is the caller's classification reader
 * (services/classification/reader.ts): it decides whether the latest result may be described.
 */
export async function buildAppAgentContext(
  deps: { config: AimeatConfig; storage: Storage }, owner: string, agentName: string, reader: ContentReader,
): Promise<AgentContextResult> {
  const { config, storage } = deps;
  if (!isValidAgentName(agentName)) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Name one of your own agents.' };
  }
  const gaii = buildGAII(agentName, owner, config.nodeId);
  const agent = await storage.getAgent(gaii);
  if (!agent || agent.owner !== owner) {
    return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `You have no agent called "${agentName}".` };
  }
  const displayName = agent.displayName ?? agent.name;
  const done = await latestDone(storage, gaii);
  const result = done ? await resultOf(storage, done, reader) : undefined;
  const shape = result === undefined ? '' : JSON.stringify(describeShape(result), null, 2).slice(0, SHAPE_LIMIT);

  const row = {
    what: `agent:${agent.name}`,
    holds: `the finished work of the agent ${displayName}`,
    kind: 'ai-generated',
    usedFor: 'user-returns-to-read',
    where: 'owner-memory-private',
    whereExactly: `the tasks and results of the owner's agent ${agent.name}, in that agent's own memory`,
    owner: 'person',
    readers: 'owner-and-their-agents',
    writers: ['an-agent'],
    shape: 'one-per-thing',
    keptFor: 'until-deleted',
    lossRisk: 'only-copy',
    personalData: 'unstated',
    why: 'The agent produces it and keeps it; the app reads it from the agent each time and stores no copy.',
    agent: agent.name,
    madeFor: true,
  };

  let text = '';
  text += `## This app shows the work of one agent: ${displayName}\n\n`;
  text += `The owner's agent **${displayName}** (name \`${agent.name}\`, full identity \`${gaii}\`) produces the content this app shows.`;
  text += agent.description ? ` What the agent is for: ${agent.description}\n\n` : '\n\n';
  text += '### How to read its work\n';
  text += `- Its tasks, newest first: \`GET /v1/agents/${agent.name}/tasks\`. A finished task has \`status: "done"\`; one in progress is \`active\`, one that waits is \`queued\`, and \`failed\` or \`declined\` say the work did not happen.\n`;
  text += `- One task: \`GET /v1/agents/${agent.name}/tasks/<id>\` answers with the task and \`outcome\`, the agent's own words about what it did.\n`;
  text += `- A finished task's result is a memory record in the AGENT'S namespace (\`${gaii}\`), not in the owner's. The served library \`aimeat-agents\` reads it: \`AIMEAT.agents.deliverable("${agent.name}", taskId)\` uses the task's \`deliverableKey\` when it has one and otherwise the record tagged \`task:<id>\`. Load the library instead of writing these calls by hand; its document is in the libraries list (GET /v1/libs).\n`;
  text += '- Read the work from the agent every time the app opens, and show what is there. The app keeps no copy: the agent\'s memory is the one place the work lives.\n';
  text += '- Say how old the newest work is, from the task\'s own time, so a person sees when the agent has produced nothing new. A task that is `active` or `queued` means new work is on its way.\n\n';
  if (shape) {
    text += '### What its latest finished result looks like\n';
    text += 'Structure only: field names and value types, with no text of the result. Build the screens for this structure, and keep them working when a field is missing.\n';
    text += '```json\n' + shape + '\n```\n\n';
  } else {
    text += '### Its results\n';
    text += 'This agent has no finished work yet, so there is no structure to show. Read one finished task before you design the screens, or build a screen that shows any result as text and say that the first work has not arrived.\n\n';
  }
  text += '### State the tie in the data map\n';
  text += `The app's data map carries one \`held\` row that names the agent. With it the agent's page lists this app and the app's page lists the agent. The row grants nothing; it is a statement. Add it to the map you write with \`aimeat_datamap_set\` (or PUT /v1/datamap/apps/<owner>/<filename>):\n`;
  text += '```json\n' + JSON.stringify(row, null, 2) + '\n```\n';
  text += 'Rewrite `holds` and `why` in your own words when the app does something else with the work. Keep `agent` and `madeFor` as they are.\n';

  return { ok: true, agent: { name: agent.name, display_name: displayName, gaii }, has_result: shape !== '', text };
}
