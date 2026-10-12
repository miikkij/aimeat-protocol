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
 *
 *   THE MODEL IS TOLD WHAT THE PERSON KEEPS HERE: what each tool is for, the tools the person's own
 *   apps publish and the person's workspaces (services/agent-draft-known.js). A definition names
 *   an app tool by its sku and a workspace by its id, and the page reads those back to show which
 *   apps and workspaces the agent uses before the person approves.
 * @structure WHEN_KINDS · DEFAULT_TOOLS · draftPrompt(tools, known, features) · parseDraft(text, opts) · draftAgent(sentence, opts) ·
 *   scopesFor(draft, choice) · templateDraft(id) · ownAiRequest(sentence, connectorName) · cronFor(days, hhmm) ·
 *   definitionFor(draft, when, watch) · startAgent(draft, choice) · approveProposal(id, name, draft, choice) ·
 *   scheduleFor(name, draft, choice) · runtimeMenu(agents) · runtimeToolMenu(agents) · runtimeTools(agents) ·
 *   readHomeAgents(limit) · moveAgent(name, connectorId) · setAgentStopped(name, stop)
 * @usage
 *   const tools = await runtimeToolMenu(online);
 *   const draft = await draftAgent('Sort my incoming mail and draft the answers', { tools, known: { apps, places } });
 *   const out = await startAgent(draft, { when: 'clock', cron: '0 7 * * 1-5', connector: id });
 * @version-history
 *   v1.5.0 — 2026-10-12 — An agent can work when a record is published in a workspace ("records").
 *     runtimeMenu() reads the runtime's `features` beside its tools; the draft prompt describes the
 *     kind only when the runtime names `record_spaces` (additive: the text follows what was there);
 *     a draft carries `watch`, the workspace the model named; the definition gets `record_spaces`
 *     and "records" in `listen_for` from what the person chose on the form, and loses both for any
 *     other "when"; such an agent is proposed with organism:read
 *     (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 *   v1.4.0 — 2026-10-12 — The draft prompt gets one line per tool id, the tools the person's apps
 *     publish and the person's workspaces. Additive to the prompt: the text of v1.3.1 is unchanged
 *     and the new text follows it. The draft carries `named`, the apps and workspaces its
 *     definition names. A definition that names one and gives no member the tool for it gets the
 *     tool on its first member. An agent that reads only gets "workspace" in place of
 *     "workspace_write", and an agent that reads a workspace is proposed with organism:read. The
 *     tool list used when no runtime answers gains app_tools, workspace and workspace_write
 *     (wish-kodin-agenttiluonnos-tuntee-ty-kalujen-kuvaukset-omistajan-s).
 *   v1.3.1 — 2026-10-11 — The offer's `example` is one real request and not an input with its
 *     result: the node gives it to the new agent as its first work. The offer's id follows the short
 *     name when the person changes it on the form.
 *   v1.3.0 — 2026-10-11 — The draft carries one offer (title, ask, example), which goes into the
 *     definition's `offers`: the crew runtime publishes it when the agent starts, so the agent
 *     shows on the Offerings page. offerShown(crewDef) reads it back for the proposal page.
 *     Additive to the prompt: one field and one sentence.
 *   v1.2.0 — 2026-10-11 — setAgentStopped(name, stop): stop an agent and start it again.
 *   v1.1.0 — 2026-10-11 — A definition that listens for direct messages gets the `dm` tool on its
 *     first member when no member has it. An agent made as "when someone writes to it" or "always
 *     on" from a ready definition read a message and could not answer.
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { api, apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { buildTemplate } from '/views/profile/agents/crew-templates.js';
import { SCOPE_TEMPLATES } from '/views/profile/agents/scope-model.js';
import {
  DEFAULT_TOOL_MENU, knownBlock, namedIn, withNeededTools, readOnlyTools, extraScopes,
  RECORDS_FEATURE, recordsBlock, watchedPlace, withRecordSpaces,
} from '/js/services/agent-draft-known.js';

/** When an agent works, as the pages offer it. */
export const WHEN_KINDS = ['ask', 'clock', 'talk', 'always', 'records'];

/**
 * The tool names a definition may use when no runtime could be asked (agent-draft-known.js
 * DEFAULT_TOOL_MENU says since when the runtime has had each). A newer runtime offers more, and
 * runtimeToolMenu() reads its own list when one of the person's agents is connected.
 */
export const DEFAULT_TOOLS = DEFAULT_TOOL_MENU.map((x) => x.id);

const NAME_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * What the draft is told about the person, as GET /v1/home/agents/choices?include=tools answers:
 * their apps with the tools each publishes, and their workspaces.
 * @typedef {{
 *   apps?: Array<{ filename: string, name: string, tools?: Array<{ name: string, sku: string, description?: string }> }>,
 *   places?: Array<{ organism_id: string, organism_name: string, workspace_id: string, workspace_name: string }>,
 * }} Known
 */

/** A tool list as { id, purpose } rows: a list of ids is taken as tools with no description. */
const menuOf = (tools) => (Array.isArray(tools) ? tools : []).map((x) => (typeof x === 'string' ? { id: x, purpose: '' } : x)).filter((x) => x && typeof x.id === 'string');

/**
 * The system instructions for the one-shot draft. English: it is read by a model. `tools` is the
 * tools a definition may use, as ids or as { id, purpose }; `known` is the person's apps with
 * their tools and the person's workspaces. What is known is added after the instructions.
 * `features` is what the runtime says it honours beyond its tools (runtimeMenu): the kind "records"
 * is described only to a model whose answer the runtime can run.
 */
export function draftPrompt(tools, known, features) {
  const menu = menuOf(tools);
  return draftInstructions(menu.map((x) => x.id)) + knownBlock(menu, known) + recordsBlock(known, features);
}

function draftInstructions(tools) {
  return `You design one agent for a person's AIMEAT from one sentence the person wrote.
Answer with one JSON object and nothing else, in this shape:
{
  "name": "an id of 3 to 40 characters: lowercase letters, digits and hyphens, starting with a letter and ending with a letter or a digit",
  "display_name": "the agent's name as a person says it, at most four words",
  "purpose": "one sentence a person can decide from: what the agent does and on what",
  "does": ["two to four short sentences: what the agent does, step by step, in plain words"],
  "when": { "kind": "ask or clock or talk", "cron": "a five-field cron expression, for clock only" },
  "reach": "readonly or standard",
  "offer": { "title": "what the agent offers, at most eight words", "ask": "one or two sentences: what to give it, what it returns, and what it does not do", "example": "one real request, written as the person would send it to the agent, with a sample of what they would give it. The request only, not the result" },
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
The offer is how the agent's work reads on the person's list of what their agents do: say it as an invitation, in plain words.
Write "display_name", "purpose", "does" and "offer" in the language of the person's sentence. Write the crew definition in English.`;
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
 *
 * With `known` (the person's apps and workspaces) the draft carries `named`, the ones its
 * definition names, and a definition that names one has a member that can reach it; `offered` is
 * the tool ids the runtime resolves. With `features` naming the runtime's record feature, a draft
 * may work on records: its `watch` is then the workspace the model named, one of the person's own.
 * A "records" answer that names no such workspace, or comes for a runtime without the feature, is
 * a draft that works when asked.
 * @param {string} text
 * @param {{ known?: Known, offered?: Set<string> | string[], features?: string[] }} [opts]
 */
export function parseDraft(text, { known, offered, features } = {}) {
  const raw = firstObject(text);
  const written = raw?.crew_def;
  const named = namedIn(written, known);
  const def = withNeededTools(written, named, offered instanceof Set ? offered : new Set(offered ?? []));
  const agents = Array.isArray(def?.agents) ? def.agents : [];
  const tasks = Array.isArray(def?.tasks) ? def.tasks : [];
  const keys = new Set(agents.map((a) => a?.name || a?.role).filter(Boolean));
  const runs = agents.length > 0 && tasks.length > 0
    && tasks.some((x) => typeof x?.description === 'string' && x.description.includes('{{ctx.prompt}}'))
    && tasks.every((x) => keys.has(x?.agent));
  const name = String(raw?.name || '').trim().toLowerCase();
  if (!runs || !NAME_SHAPE.test(name)) throw new Error('BAD_DRAFT');
  const watch = Array.isArray(features) && features.includes(RECORDS_FEATURE) ? watchedPlace(raw?.when, known) : null;
  const kind = watch ? 'records' : ['ask', 'clock', 'talk'].includes(raw?.when?.kind) ? raw.when.kind : 'ask';
  const cron = cronOf(raw?.when?.cron);
  return {
    name,
    displayName: String(raw.display_name || name).trim().slice(0, 60),
    purpose: String(raw.purpose || '').trim(),
    does: (Array.isArray(raw.does) ? raw.does : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4),
    when: kind === 'clock' && !cron ? 'ask' : kind,
    cron,
    // The workspace a records draft watches. Its spaces are the person's choice on the page.
    watch,
    // A definition that writes a workspace is not a reader, whatever the model answered for reach.
    reach: raw.reach === 'readonly' && !writesWorkspace(def) ? 'readonly' : 'standard',
    named,
    // The offer the model wrote goes into the definition, where the crew runtime publishes it from
    // when the agent starts. A draft without one is completed by the node at approval, from the
    // agent's name and purpose (src/services/agent-default-offer.ts).
    crewDef: { ...def, agent_name: name, ...(offerOf(raw.offer, name) ? { offers: [offerOf(raw.offer, name)] } : {}) },
  };
}

/** Whether a member of the definition has the tool that writes a workspace. */
const writesWorkspace = (def) => (Array.isArray(def?.agents) ? def.agents : []).some((m) => Array.isArray(m?.tools) && m.tools.includes('workspace_write'));

/**
 * The permissions a draft's agent is proposed with: the reach the person chose, and what the
 * definition's tools ask beyond it. The page shows the same list before the person approves.
 * `choice` is what the person chose on the form: an agent that works on a workspace's records
 * (`when: 'records'`) reads that workspace, whatever its tools are, because the node sends a record
 * only to an agent that may read the workspace it is in.
 */
export function scopesFor(draft, choice) {
  const base = SCOPE_TEMPLATES[draft?.reach] ?? SCOPE_TEMPLATES.standard;
  const def = draft?.reach === 'readonly' ? readOnlyTools(draft?.crewDef) : draft?.crewDef;
  return [...new Set([...base, ...extraScopes(def), ...(choice?.when === 'records' ? ['organism:read'] : [])])];
}

/** The model's offer as one entry of a definition's `offers`, or null when it wrote none. */
function offerOf(raw, name) {
  const title = String(raw?.title || '').trim().slice(0, 120);
  const ask = String(raw?.ask || '').trim().slice(0, 500);
  if (!title || !ask) return null;
  return { id: name, title, ask, example: String(raw?.example || '').trim().slice(0, 1000) };
}

/** What a draft or a proposal's definition offers, for the page that shows the agent before it is made. */
export function offerShown(crewDef) {
  const first = Array.isArray(crewDef?.offers) ? crewDef.offers.find((o) => o && typeof o === 'object') : null;
  return first && first.title ? { title: String(first.title), ask: String(first.ask || '') } : null;
}

/**
 * Ask the person's own model for a draft. Throws an Error with `code`: NO_API_KEY when no model is
 * set here, the node's own code for a spent budget, or NO_JSON / BAD_DRAFT for an answer that
 * cannot be used. `tools` is the tools a definition may use and `features` what the runtime honours
 * beyond them (runtimeMenu), `known` the person's apps with their tools and the person's
 * workspaces (readTieChoices with tools).
 * @param {string} sentence
 * @param {{ tools?: Array<string | { id: string, purpose: string }>, known?: Known, features?: string[] }} [opts]
 */
export async function draftAgent(sentence, { tools = DEFAULT_TOOL_MENU, known, features } = {}) {
  const menu = menuOf(tools);
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt: sentence, systemPrompt: draftPrompt(menu, known, features), modelRole: 'execution', app_id: 'home-agents' }),
    timeoutMs: 300_000,
    retries: 0,
  });
  if (resp?.ok === false) { const e = new Error(resp?.error?.message || 'AI call failed'); e.code = resp?.error?.code; throw e; }
  try { return parseDraft(resp?.data?.content, { known, offered: new Set(menu.map((x) => x.id)), features }); }
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
  const where = connectorName ? ` It runs on my computer called "${connectorName}": read my computers with aimeat_connector_list and pass that one as connector.` : '';
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

/**
 * A draft's offers under the name the agent is made with. The offer was written with the name the
 * model proposed as its id; when the person changed the short name on the form, the id follows it,
 * so the offer is not published under a name no agent has. An id the model did not derive from the
 * drafted name is left as written.
 */
function offersUnder(crewDef, name) {
  const drafted = crewDef?.agent_name;
  if (!Array.isArray(crewDef?.offers) || !drafted || drafted === name) return {};
  return { offers: crewDef.offers.map((o) => (o && typeof o === 'object' && o.id === drafted ? { ...o, id: name } : o)) };
}

/**
 * The definition a draft starts with, shaped by when it works. `watch` is what an agent that works
 * on records watches: { organism_id, workspace_id, spaces }. For every other "when" the definition
 * names no space and does not listen for records, whatever the model wrote.
 */
export function definitionFor(draft, when, watch) {
  // An agent the person lets read only is given the read tool for a workspace, never the write tool.
  const written = draft.crewDef && draft.reach === 'readonly' ? readOnlyTools(draft.crewDef) : draft.crewDef;
  const named = written
    ? { ...written, agent_name: draft.name, ...offersUnder(written, draft.name) }
    : buildTemplate(draft.template || 'researcher', draft.name);
  const def = withRecordSpaces(named, when === 'records' ? watch : null);
  const hears = new Set(Array.isArray(def.listen_for) && def.listen_for.length ? def.listen_for : ['tasks']);
  if (when === 'talk' || when === 'always') { hears.add('messages'); hears.add('dms'); }
  // AN AGENT THAT HEARS A MESSAGE MUST BE ABLE TO ANSWER IT. The `dm` tool is what sends a reply, and
  // a definition that listens for direct messages without it reads the message and says nothing
  // (measured on aimeat.io, 2026-10-11). A ready definition and a draft whose "when" the person
  // changed on the form have no such tool, so the first member gets it.
  const members = Array.isArray(def.agents) ? def.agents : [];
  const canReply = members.some((m) => Array.isArray(m?.tools) && m.tools.includes('dm'));
  const agents = hears.has('dms') && !canReply && members.length
    ? members.map((m, i) => (i === 0 ? { ...m, tools: [...(Array.isArray(m.tools) ? m.tools : []), 'dm'] } : m))
    : members;
  return { ...def, agents, listen_for: [...hears] };
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
 * `choice`: { when, cron, connector, watch }, where `watch` is what an agent that works on records
 * watches: { organism_id, workspace_id, spaces }.
 */
export async function startAgent(draft, choice) {
  const always = choice.when === 'always';
  const proposed = await apiPost('/v1/agents/v2/agent-proposals', {
    name: draft.name,
    display_name: draft.displayName || draft.name,
    purpose: draft.purpose,
    scopes: scopesFor(draft, choice),
    // A task-runner's task starts without asking the owner each time, which is what an agent that
    // works on a clock, answers people or works on records needs.
    mode: 'task-runner',
    run_mode: always ? 'resident' : 'spawn',
    crew_def: definitionFor(draft, choice.when, choice.watch),
    ...(choice.connector ? { connector: choice.connector } : {}),
  });
  const id = proposed?.data?.proposal?.id;
  if (!id) throw new Error('NO_PROPOSAL');
  return approveProposal(id, draft.name, draft, choice);
}

/**
 * What the person's runtime offers, asked from the first connected agent of theirs that answers:
 * `tools`, the tools it resolves with its own words for what each is for, and `features`, what it
 * says it honours beyond them. Falls back to DEFAULT_TOOL_MENU and no feature when nobody answers
 * within a few seconds: a draft is worth more now than a longer tool list later, and a feature
 * nobody named is not offered.
 */
export async function runtimeMenu(agentNames) {
  for (const name of (agentNames ?? []).slice(0, 2)) {
    try {
      const resp = await api(`/v1/agents/${encodeURIComponent(name)}/crew/menu`, { timeoutMs: 8_000, retries: 0 });
      const rows = (resp?.data?.tools ?? [])
        .filter((x) => typeof x?.id === 'string' && !x.id.includes(':') && !x.id.startsWith('exchange_'))
        .map((x) => ({ id: x.id, purpose: typeof x.purpose === 'string' ? x.purpose : '' }));
      if (resp?.data?.source === 'runtime' && rows.length) {
        return { tools: rows, features: (resp.data.features ?? []).filter((f) => typeof f === 'string') };
      }
    } catch (err) { swallowed('agent-draft: runtime menu', err); }
  }
  return { tools: DEFAULT_TOOL_MENU, features: [] };
}

/** The tools of runtimeMenu(), for a caller that asks nothing else. */
export async function runtimeToolMenu(agentNames) {
  return (await runtimeMenu(agentNames)).tools;
}

/** The ids of runtimeToolMenu(), for a caller that needs the names only. */
export async function runtimeTools(agentNames) {
  return (await runtimeToolMenu(agentNames)).map((x) => x.id);
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

/**
 * Stop one agent, or start it again (POST /v1/agents/:name/stop and /start). A stopped agent
 * starts no new work; the answer's `released` says how many waiting tasks a start began.
 */
export async function setAgentStopped(name, stop) {
  const resp = await apiPost(`/v1/agents/${encodeURIComponent(name)}/${stop ? 'stop' : 'start'}`, {});
  return resp?.data ?? null;
}
