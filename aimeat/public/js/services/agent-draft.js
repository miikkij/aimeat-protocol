/**
 * @file public/js/services/agent-draft.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description From one sentence to an agent at work: the draft the home's "make an agent" pages
 *   show, and the calls that start it.
 *
 *   THE WORK IS IN THE PROMPT. A person writes what they want in one sentence. Their own AI model
 *   on this AIMEAT (POST /v1/ai/complete, their key, their budget) turns it into a draft: a name, a
 *   purpose a person can decide from, what the agent does in plain steps, when it works, how far it
 *   reaches, and the crew definition it runs. The page shows the draft and the person changes what
 *   they want before anything exists. A person with no model set here copies the same request into
 *   their own AI, which proposes the agent with aimeat_agent_propose, and the proposal arrives on
 *   the home to approve.
 *
 *   NOTHING IS CREATED BY A DRAFT. Starting is the two calls the Agents page already makes: propose
 *   (creates nothing) and approve (the owner's own press), with the machine the person chose, and
 *   then one schedule when the agent works on a clock.
 * @structure WHEN_KINDS · DEFAULT_TOOLS · draftPrompt(tools) · parseDraft(text) · draftAgent(sentence, opts) ·
 *   templateDraft(id) · ownAiRequest(sentence, connectorName) · cronFor(days, hhmm) · startAgent(draft, choice) ·
 *   approveProposal(id, name, draft, choice) · scheduleFor(name, draft, choice) · runtimeTools(agents) ·
 *   readHomeAgents(limit)
 * @usage
 *   const draft = await draftAgent('Gather the industry news every weekday morning', { tools });
 *   const out = await startAgent(draft, { when: 'clock', cron: '0 7 * * 1-5', connector: id });
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { api, apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { buildTemplate } from '/views/profile/agents/crew-templates.js';
import { SCOPE_TEMPLATES } from '/views/profile/agents/scope-model.js';

/** When an agent works, as the pages offer it. */
export const WHEN_KINDS = ['ask', 'clock', 'talk', 'always'];

/**
 * The tool names a definition may use when no runtime could be asked. Every one of them has been in
 * the crew runtime's registry since before 2026-09; a newer runtime offers more, and runtimeTools()
 * reads its own list when one of the person's agents is connected.
 */
export const DEFAULT_TOOLS = ['web', 'article_fetch', 'memory', 'dm', 'image', 'schedule'];

const NAME_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** The system instructions for the one-shot draft. English: it is read by a model. */
export function draftPrompt(tools) {
  return `You design one agent for a person's AIMEAT from one sentence the person wrote.
Answer with one JSON object and nothing else, in this shape:
{
  "name": "an id of 3 to 40 characters: lowercase letters, digits and hyphens, starting with a letter and ending with a letter or a digit",
  "display_name": "the agent's name as a person says it, at most four words",
  "purpose": "one sentence a person can decide from: what the agent does and on what",
  "does": ["two to four short sentences: what the agent does, step by step, in plain words"],
  "when": { "kind": "ask or clock or talk", "cron": "a five-field cron expression, for clock only" },
  "reach": "readonly or standard",
  "crew_def": {
    "agent_name": "the same id as name",
    "process": "sequential",
    "listen_for": ["tasks"],
    "agents": [{ "name": "an id", "role": "...", "goal": "...", "backstory": "...", "tools": ["tool ids"], "allow_delegation": false }],
    "tasks": [{ "id": "an id", "description": "... {{ctx.prompt}} ...", "expected_output": "...", "agent": "the name of one of the agents", "context": [] }]
  }
}
When: choose "clock" when the sentence names a time or a rhythm (every morning, each week, hourly) and write the cron for it, with weekdays as 1-5. Choose "talk" when the agent answers people who write to it. Choose "ask" for everything else.
Reach: choose "standard" when the agent stores or changes something of the person's (notes, records, files). Choose "readonly" when it reads and reports.
The crew definition is what the agent runs. Use one to three agents and one to three tasks. Each task's "agent" is the "name" of one of the agents. The first task's description contains {{ctx.prompt}}, which becomes the text of each piece of work the agent is given. "context" lists the ids of earlier tasks whose results this task reads. Give each agent only the tools its role needs, from this list: ${tools.join(', ')}. For "talk", set "listen_for" to ["tasks", "messages", "dms"] and give one agent the "dm" tool.
Write "display_name", "purpose" and "does" in the language of the person's sentence. Write the crew definition in English.`;
}

/** The first JSON object in a model's answer, with any code fence or prose around it removed. */
function firstObject(text) {
  const stripped = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(stripped); } catch (err) { swallowed('agent-draft: whole answer is not JSON', err); }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('NO_JSON');
  return JSON.parse(m[0]);
}

/** A cron of five fields, or ''. */
const cronOf = (v) => (typeof v === 'string' && v.trim().split(/\s+/).length === 5 ? v.trim() : '');

/**
 * A model's answer as a draft the pages can show, or a thrown Error whose message is a code:
 * NO_JSON, or BAD_DRAFT when the definition could not run. The checks are the ones the propose
 * route makes, so a draft that passes here is not refused there for its shape.
 */
export function parseDraft(text) {
  const raw = firstObject(text);
  const def = raw?.crew_def;
  const agents = Array.isArray(def?.agents) ? def.agents : [];
  const tasks = Array.isArray(def?.tasks) ? def.tasks : [];
  const keys = new Set(agents.map((a) => a?.name || a?.role).filter(Boolean));
  const runs = agents.length > 0 && tasks.length > 0
    && tasks.some((x) => typeof x?.description === 'string' && x.description.includes('{{ctx.prompt}}'))
    && tasks.every((x) => keys.has(x?.agent));
  const name = String(raw?.name || '').trim().toLowerCase();
  if (!runs || !NAME_SHAPE.test(name)) throw new Error('BAD_DRAFT');
  const kind = ['ask', 'clock', 'talk'].includes(raw?.when?.kind) ? raw.when.kind : 'ask';
  const cron = cronOf(raw?.when?.cron);
  return {
    name,
    displayName: String(raw.display_name || name).trim().slice(0, 60),
    purpose: String(raw.purpose || '').trim(),
    does: (Array.isArray(raw.does) ? raw.does : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4),
    when: kind === 'clock' && !cron ? 'ask' : kind,
    cron,
    reach: raw.reach === 'readonly' ? 'readonly' : 'standard',
    crewDef: { ...def, agent_name: name },
  };
}

/**
 * Ask the person's own model for a draft. Throws an Error with `code`: NO_API_KEY when no model is
 * set here, the node's own code for a spent budget, or NO_JSON / BAD_DRAFT for an answer that
 * cannot be used.
 */
export async function draftAgent(sentence, { tools = DEFAULT_TOOLS } = {}) {
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt: sentence, systemPrompt: draftPrompt(tools), modelRole: 'execution', app_id: 'home-agents' }),
    timeoutMs: 300_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  try { return parseDraft(resp?.data?.content); }
  catch (err) { const e = new Error(err.message); e.code = err.message; throw e; }
}

/** A draft from one of the three ready definitions the Agents page offers; the person names it. */
export function templateDraft(id) {
  return {
    name: '', displayName: '', purpose: '', does: [],
    when: id === 'scheduledWatch' ? 'clock' : 'ask',
    cron: id === 'scheduledWatch' ? '0 7 * * *' : '',
    reach: 'standard',
    template: id,
    crewDef: null,
  };
}

/** What a person says to their own AI to have it propose the same agent. English: an AI reads it. */
export function ownAiRequest(sentence, connectorName) {
  const where = connectorName ? ` It runs on my machine called "${connectorName}": read my machines with aimeat_connector_list and pass that one as connector.` : '';
  return `Make me an agent on my AIMEAT: ${sentence}\n\nRead what I keep there that it will work on (aimeat_organism_list, aimeat_workspace_list), then propose the agent with aimeat_agent_propose and its crew_def.${where} Give me the address where I approve it.`;
}

/** The cron for "these days at this time": days is 'weekdays' or 'daily', hhmm is "07:00". */
export function cronFor(days, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${min} ${h} * * ${days === 'weekdays' ? '1-5' : '*'}`;
}

/** The definition a draft starts with, shaped by when it works. */
function definitionFor(draft, when) {
  const def = draft.crewDef ? { ...draft.crewDef, agent_name: draft.name } : buildTemplate(draft.template || 'researcher', draft.name);
  const hears = new Set(Array.isArray(def.listen_for) && def.listen_for.length ? def.listen_for : ['tasks']);
  if (when === 'talk' || when === 'always') { hears.add('messages'); hears.add('dms'); }
  return { ...def, listen_for: [...hears] };
}

/**
 * Approve a proposal for the chosen machine, and add its schedule when it works on a clock.
 * `choice`: { when, cron, connector }. Returns the approve answer's data with `schedule_problem`
 * when the agent was made and its schedule was not.
 */
export async function approveProposal(id, name, draft, choice) {
  const body = choice.connector ? { install_id: choice.connector } : {};
  const approved = await apiPost(`/v1/agents/v2/agent-proposals/${encodeURIComponent(id)}/approve`, body);
  const data = { ...(approved?.data ?? {}) };
  if (choice.when === 'clock' && choice.cron) {
    try { await scheduleFor(name, draft, choice); }
    catch (err) { swallowed('agent-draft: schedule', err); data.schedule_problem = err?.message || String(err); }
  }
  return data;
}

/** The schedule that gives a clock agent its work: one task per fire, in the reader's time zone. */
export function scheduleFor(name, draft, choice) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return apiPost(`/v1/agents/${encodeURIComponent(name)}/schedules`, {
    kind: 'agent_task',
    cron: choice.cron,
    ...(zone ? { timezone: zone } : {}),
    display_name: draft.displayName || name,
    task_title: draft.displayName || name,
    task_description: draft.purpose,
  });
}

/**
 * Make the agent a draft describes: propose it, then approve it, as the person pressing.
 * `choice`: { when, cron, connector }.
 */
export async function startAgent(draft, choice) {
  const always = choice.when === 'always';
  const proposed = await apiPost('/v1/agents/v2/agent-proposals', {
    name: draft.name,
    display_name: draft.displayName || draft.name,
    purpose: draft.purpose,
    scopes: SCOPE_TEMPLATES[draft.reach] ?? SCOPE_TEMPLATES.standard,
    // A task-runner's task starts without asking the owner each time, which is what an agent that
    // works on a clock or answers people needs.
    mode: 'task-runner',
    run_mode: always ? 'resident' : 'spawn',
    crew_def: definitionFor(draft, choice.when),
    ...(choice.connector ? { connector: choice.connector } : {}),
  });
  const id = proposed?.data?.proposal?.id;
  if (!id) throw new Error('NO_PROPOSAL');
  return approveProposal(id, draft.name, draft, choice);
}

/**
 * The tool names the person's runtime resolves, asked from the first connected agent of theirs.
 * Falls back to DEFAULT_TOOLS when nobody answers within a few seconds: a draft is worth more now
 * than a longer tool list later.
 */
export async function runtimeTools(agentNames) {
  for (const name of (agentNames ?? []).slice(0, 2)) {
    try {
      const resp = await api(`/v1/agents/${encodeURIComponent(name)}/crew/menu`, { timeoutMs: 8_000, retries: 0 });
      const ids = (resp?.data?.tools ?? []).map((x) => x?.id).filter((x) => typeof x === 'string' && !x.includes(':') && !x.startsWith('exchange_'));
      if (resp?.data?.source === 'runtime' && ids.length) return ids;
    } catch (err) { swallowed('agent-draft: runtime tools', err); }
  }
  return DEFAULT_TOOLS;
}

/** The home's read of the person's agents: proposals, workers and machines (GET /v1/home/agents). */
export async function readHomeAgents(limit, agent) {
  const q = agent ? `?agent=${encodeURIComponent(agent)}` : (limit ? `?limit=${limit}` : '');
  const resp = await apiGet('/v1/home/agents' + q);
  return resp?.data ?? null;
}

/** Send one agent to another machine (POST /v1/agents/v2/agents/:name/move). */
export async function moveAgent(name, connectorId) {
  const resp = await apiPost(`/v1/agents/v2/agents/${encodeURIComponent(name)}/move`, { install_id: connectorId });
  return resp?.data ?? null;
}
