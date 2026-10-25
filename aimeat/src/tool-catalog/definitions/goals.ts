/**
 * @file goals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the agent goal tools (services/goals/): aimeat_goal_get reads,
 *   aimeat_goal_set makes and changes a goal, aimeat_goal_work moves its works, aimeat_goal_answer
 *   answers a person's step. Four names with an `action` each, as the compliance tools do, because
 *   every name has to stay in step on three surfaces.
 * @structure goalTools — the four definitions · GOAL_SET_ACTIONS · GOAL_WORK_ACTIONS
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.1.0 — 2026-10-25 — aimeat_goal_set and aimeat_goal_work take the goal's and the work's fields at
 *     the top level, as the REST routes read them (GOAL_INPUT_FIELDS, WORK_INPUT_FIELDS); `input` and
 *     `work` still work. The four are on the agent surface (and full); the chat surface stays at its
 *     twenty tools and finds them with aimeat_tools_find (test/unit/mcp-surfaces.test.ts).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const GOAL_SET_ACTIONS = ['propose', 'create', 'update', 'preview', 'pause', 'resume', 'stop', 'done', 'renew', 'start_round', 'attach', 'decline', 'delete'] as const;
export const GOAL_WORK_ACTIONS = ['available', 'claim', 'release', 'add', 'leave', 'reroute', 'reject'] as const;

/**
 * The goal's fields aimeat_goal_set takes at the top level, the same keys POST and PATCH /v1/goals
 * read from the body. They were first only inside `input`; a field the tool does not declare at the
 * top level is one the field-reach gate cannot match to the route, so both shapes are taken and
 * `input` wins on a clash.
 */
export const GOAL_INPUT_FIELDS = [
  'statement', 'title', 'done_when', 'done_kind', 'mode', 'coordinator', 'substitute', 'agents', 'skills',
  'any_agent', 'limits', 'ends_at', 'workplace', 'plan_workflow_id', 'parent_goal_id', 'works', 'reactions',
  'rounds', 'this_round_only', 'kind', 'ref',
] as const;

/** A work's fields aimeat_goal_work takes at the top level for add and leave, as POST /v1/goals/{id}/works reads them; `work` wins on a clash. */
export const WORK_INPUT_FIELDS = [
  'title', 'description', 'kind', 'human_kind', 'options', 'links', 'texts', 'prompt', 'runner', 'model', 'after', 'final',
] as const;

export const goalTools = [
  {
    name: 'aimeat_goal_get',
    description: 'Read the owner\'s agent goals: what the person wants done, how far it is, who works on it now, what waits for the person, and what was spent. No goal_id: the list (status running|active|paused|done|stopped|expired filters it). With goal_id: the whole goal, its works with their status and results, its material, its log of what happened and why, and its changes. waiting=true: every step across the goals that waits for the person, and the open work no agent took. READ A GOAL BEFORE YOU ACT IN IT, and when the person asks "how is it going", answer from this.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Agent goals: read', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'task:read',
    surfaces: ['agent'],
    input: {
      goal_id: { type: 'string', description: 'One goal (g-…). Omit for the list.' },
      status: { type: 'string', enum: ['running', 'active', 'paused', 'done', 'stopped', 'expired'], description: 'For the list: which goals.' },
      waiting: { type: 'boolean', description: 'true: what waits for the person across every goal.' },
    },
  },
  {
    name: 'aimeat_goal_set',
    description: 'Give the person\'s agents a goal and steer it. PROPOSE FIRST: action="propose" takes the same fields as create and makes the goal wait on the person\'s home as a proposal they approve with one press; nothing moves before that. Use create only when the person said yes in this conversation; "decline" removes a proposal you made. Plan for what the person has: read their agents (aimeat_agents_list) and give a work to an agent that fits, as open work for a skill, or, when no agent or computer fits, to the node\'s own model with runner "model" (the person\'s key, inside the goal\'s spending limit; no tools). action="create" with the goal\'s fields at the top level (an `input` object holding them works too) { statement (what the person wants, their words), title?, done_when? (a sentence), done_kind? human|check|all-done, mode? single (one agent takes the whole goal; the default), coordinator (an agent carries it: plans, hands out work, makes subgoals, asks the person) or plan (fixed steps), coordinator? (agent name; any of the person\'s agents: their Claude chat, an outside Grok bot, a crewaimeat concierge, an agent on any OpenRouter model), substitute? node|wait|{agent}, agents? [names], skills? [tags an agent needs], any_agent?, limits? { usd, hops (default 5), tasks_per_day (50), fix_rounds (4), claim_minutes (30) }, ends_at? (default 30 days), workplace? { organism_id, workspace_id }, works? [ { title, description?, kind? agent|human, human_kind? choose|approve|answer|do|provide, options? [{id,label}], links?, texts?, prompt?, agent?, wants? [skills], after? [work ids or "#1" for the first work given] } ], reactions? [ { when: { works? [ids] | wants? skill }, then: { title, agent?, wants?, kind?, human_kind?, final? } } ], rounds? { trigger manual|clock|condition, cron?, timezone?, condition?, works? }, parent_goal_id? (a subgoal; spends from its parent), reason? }. Default for a capable agent: give the whole goal as ONE open work (do not cut it into small steps); agents leave the next work for each other with aimeat_goal_work action "leave". Use fixed steps (mode plan, works with after) only for narrow tool agents. Give the person\'s choices, approvals and things they do themselves as works of kind "human": a "do" step carries links and ready texts (for example X threads to post in), so nothing is a dead end. action="update" with goal_id and the fields to change (the same fields; this_round_only for one round of a round goal) changes it; action="preview" answers what an update would end and what that cost, before you change it: SAY IT TO THE PERSON FIRST. action="pause" (agents save where they are), "resume", "stop" (running work finishes, nothing new starts), "done", "renew" (a round goal runs 90 more days), "start_round", "attach" with { kind file|memory|link|text, ref, title } adds material every agent in the goal reads, "delete" removes a finished goal. Give the reason field with every change: it is shown to the person.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Agent goals: make and steer', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'task:write',
    surfaces: ['agent'],
    input: {
      action: { type: 'string', required: true, enum: [...GOAL_SET_ACTIONS], description: 'What to do. Start with "propose".' },
      goal_id: { type: 'string', description: 'The goal, for every action but create.' },
      reason: { type: 'string', description: 'Why, in a sentence: shown to the person in the goal\'s log.' },
      statement: { type: 'string', description: 'For create and update: what the person wants done, in their words.' },
      title: { type: 'string', description: 'For create, update and attach: a short name.' },
      done_when: { type: 'string', description: 'When the goal is done, in a sentence.' },
      done_kind: { type: 'string', enum: ['human', 'check', 'all-done'], description: 'Who says it is done: the person, a check, or every work done.' },
      mode: { type: 'string', enum: ['single', 'coordinator', 'plan'], description: 'How the work is shared.' },
      coordinator: { type: 'string', description: 'The agent that leads the goal (mode coordinator).' },
      substitute: { type: 'string', description: 'When the coordinator is away: node, wait, or an agent name.' },
      permissions: { type: 'object', description: 'What the coordinator may do without asking: { subgoals, assign, own_ai, workflows, app_tools, propose_agent, raise_limits, change_done_when } (true or false). The coordinator itself may not change this.' },
      agents: { type: 'array', description: 'The agents that may take part, by name.' },
      skills: { type: 'array', description: 'The tags an agent needs to take part.' },
      any_agent: { type: 'boolean', description: 'true: any of the person\'s agents may take part.' },
      limits: { type: 'object', description: '{ usd, hops, tasks_per_day, fix_rounds, claim_minutes }.' },
      ends_at: { type: 'string', description: 'When the goal ends (ISO time).' },
      workplace: { type: 'object', description: '{ organism_id, workspace_id } where results are kept.' },
      plan_workflow_id: { type: 'string', description: 'A saved workflow that holds the fixed plan.' },
      parent_goal_id: { type: 'string', description: 'For create: makes a subgoal that spends from this goal.' },
      works: { type: 'array', description: 'The works, as listed in the description.' },
      reactions: { type: 'array', description: 'When this is done, which work starts, as listed in the description.' },
      rounds: { type: 'object', description: '{ trigger manual|clock|condition, cron?, timezone?, condition?, works? }.' },
      this_round_only: { type: 'boolean', description: 'For update of a round goal: the change holds for this round only.' },
      kind: { type: 'string', enum: ['file', 'memory', 'link', 'text'], description: 'For attach: what the material is.' },
      ref: { type: 'string', description: 'For attach: the storage key, the record key, the address or the text.' },
      input: { type: 'object', description: 'The same fields as one object, as earlier clients send them; a field here wins over the same field above.' },
    },
  },
  {
    name: 'aimeat_goal_work',
    description: 'Move the works of an agent goal. An agent: action="available" lists the open work it may take (its tags hold a skill the work wants); action="claim" with goal_id and work_id takes one, and the node gives it a task (complete that task as usual, with what you produced); action="leave" with goal_id and the work\'s fields { title, description?, agent? or wants? [skills] } (at the top level, or inside `work`) hands the next work to another agent (never to yourself; the chain is counted and stops at the goal\'s limit to ask the person); action="release" with reason gives a taken work back. The owner or the goal\'s coordinator: action="add" with work adds a work (an agent\'s, or a person\'s step with kind "human"); action="reroute" with work_id and agent or wants moves a work, nothing done is lost; action="reject" with work_id and reason asks a finished result again, and the next agent reads the reason.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Agent goals: works', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'task:write',
    surfaces: ['agent'],
    input: {
      action: { type: 'string', required: true, enum: [...GOAL_WORK_ACTIONS], description: 'What to do.' },
      goal_id: { type: 'string', description: 'The goal, for every action but available.' },
      work_id: { type: 'string', description: 'The work, for claim, release, reroute and reject.' },
      title: { type: 'string', description: 'For add and leave: what the work is.' },
      description: { type: 'string', description: 'For add and leave: what to do, and what it builds on.' },
      kind: { type: 'string', enum: ['agent', 'human'], description: 'For add and leave: an agent\'s work, or a step for the person.' },
      human_kind: { type: 'string', enum: ['choose', 'approve', 'answer', 'do', 'provide'], description: 'For a person\'s step: what the person does.' },
      options: { type: 'array', description: 'For a choose step: [{ id, label }].' },
      links: { type: 'array', description: 'For a do step: [{ url, title }] the person opens.' },
      texts: { type: 'array', description: 'For a do step: ready texts the person copies.' },
      prompt: { type: 'string', description: 'For a do step: a prompt the person gives their own AI.' },
      runner: { type: 'string', enum: ['model'], description: 'For add and leave: "model" lets the node\'s own model do the work with the person\'s key, inside the goal\'s spending limit (no agent, no tools: writing, a summary, research from what the model knows).' },
      model: { type: 'string', description: 'For a model work: the model to use; omit it and the person\'s own default model is used.' },
      after: { type: 'array', description: 'For add: the work ids this work waits for.' },
      final: { type: 'boolean', description: 'For add and leave: when this work is done, the goal is done.' },
      agent: { type: 'string', description: 'For add, leave and reroute: the agent the work is for.' },
      wants: { type: 'array', description: 'For add, leave and reroute: the skills, when the work is open work.' },
      work: { type: 'object', description: 'The work\'s fields as one object, as earlier clients send them; a field here wins over the same field above.' },
      reason: { type: 'string', description: 'For release and reject (required for reject): why.' },
    },
  },
  {
    name: 'aimeat_goal_answer',
    description: 'Answer a step of an agent goal that waits for the person, when the person told you their answer: choose (option or options), approve (approve true or false, and reason when false: the next agent reads it), answer (text), do (the person did it; text optional), provide (kind file|memory|text and ref: a storage key, a record key or the text). Read the waiting steps with aimeat_goal_get waiting=true. Only the owner, or their own AI in a conversation with them, answers; an agent never answers the question it asked itself.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Agent goals: answer a step', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'task:write',
    surfaces: ['agent'],
    input: {
      goal_id: { type: 'string', required: true, description: 'The goal.' },
      work_id: { type: 'string', required: true, description: 'The step.' },
      option: { type: 'string', description: 'For choose: the option id.' },
      options: { type: 'array', description: 'For choose with several: the option ids.' },
      approve: { type: 'boolean', description: 'For approve.' },
      text: { type: 'string', description: 'For answer, do and provide.' },
      reason: { type: 'string', description: 'For approve false: why.' },
      kind: { type: 'string', enum: ['file', 'memory', 'text'], description: 'For provide.' },
      ref: { type: 'string', description: 'For provide: the storage key or record key.' },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
