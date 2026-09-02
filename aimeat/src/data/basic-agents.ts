/**
 * @file src/data/basic-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The basic agents, defined ONCE. The "create my basic agents" button creates whatever
 *   this file says, and nothing anywhere else decides what that set is.
 *
 *   WHY ONE PLACE. Three agents is a set that grows: the moment the list also lives in a prompt, in
 *   the connector, or in a test fixture, the four copies start disagreeing about scopes, and the
 *   copy an owner actually gets is whichever one the button happens to read. The button reads this.
 *   The API exposes it (GET /v1/agents/v2/basic-agents), so a runtime that wants to know what it is
 *   about to be handed asks the node instead of carrying its own list.
 *
 *   AND WHAT THEY ARE, which used to be the runtime's half and could not be. crewaimeat measured
 *   the deadlock on 2026-09-01 and it has three legs: `aimeat_crew_publish` answers AGENT_OFFLINE
 *   when the target's runtime is down; `run_json_agent` refuses to start with "an agent with no
 *   definition has nothing to be"; so publishing needs a runtime, a runtime needs a definition, and
 *   a definition would need publishing. A definition must therefore exist BEFORE first start, and
 *   the only party who can write it then is whoever created the agent. That is the button, and this
 *   is the file it reads — so one file answers both "which agents" and "what they are", the same
 *   reason the scopes are here rather than in four copies.
 *
 *   THE DEFINITIONS ARE NOT VALIDATED BY A RUNTIME, and cannot be: there is no runtime yet, by
 *   definition. That is the whole justification for the seed door and it is written out beside it
 *   in services/crew-ops.ts. `aimeat_crew_publish` is NOT weakened — a definition that will replace
 *   an existing one still goes to the runtime that runs it, which is what that gate is worth.
 *
 *   SCOPES ARE NAMED, NEVER WILDCARDED. Every scope below is a deliberate line, and the enrolment
 *   path takes the scopes from HERE and never from the request — an agent asking for more in its
 *   card gets what the template says. `crew-forge` is the one to read twice: it creates agents for
 *   its owner, so it carries agent:write and agent:delete, and deliberately not agent:permissions
 *   (rewriting a sibling's permission set stays with the person) and not the wildcard.
 *
 * @structure BASIC_AGENTS · BasicAgentTemplate · basicAgentByName
 * @usage import { BASIC_AGENTS } from '../data/basic-agents.js';
 * @version-history
 *   v1.3.0 — 2026-09-02 — TOOLS, and who owns `mode`.
 *     Two of the three declared no tools at all. `workflow-manager` is sold as "orders work from
 *     your other agents" and had no delegation tool, so it could plan a job and send nothing;
 *     `concierge` could answer but never hand on, which is half a front door. `crew-forge`'s
 *     Registrar held `crew_registry`, which is not on the fixed tool menu at all — not a narrower
 *     tool, no tool — on the one agent whose entire job is writing. Each tool below now carries the
 *     line of its own description that requires it, and check:crew-defs refuses both an off-menu
 *     name and a basic agent that cannot do what it says it does.
 *     `mode` is the NODE's, and the two spawn agents move from `coordinator` to `task-runner`:
 *     the node auto-activates a queued task only for a task-runner, so as seeded every task for
 *     these agents sat in `queued` waiting for a person nobody had told.
 *   v1.2.0 — 2026-09-01 — Each template carries its CREW DEFINITION, seeded at creation, because
 *     the deadlock above means nobody else can write one. `concierge` becomes `resident` on
 *     crewaimeat's measurement (~4 s of cold start before the model is even called, which is the
 *     wrong floor for a front door); the other two stay `spawn`, which is right for bursty work.
 *   v1.1.0 — 2026-09-01 — (superseded by the line above)
 *   v1.0.0 — 2026-08-31 — Initial: concierge, crew-forge, workflow-manager (Agent v2, V1).
 */
import type { RunMode } from '../models/agent-card.js';

export interface BasicAgentTemplate {
  /** The bare agent name, and the second half of its GAII. */
  name: string;
  displayName: string;
  /** What it is for, in the owner's words. Shown on the button's panel and stored on the record. */
  description: string;
  /** Exactly what this agent may do. Never widened by anything the caller sends. */
  scopes: string[];
  /**
   * Server-side operational mode. THE NODE OWNS THIS FIELD, AND THE RUNTIME MUST NOT SET IT.
   *
   * It looks like a description of how an agent runs, which is why two writers seemed reasonable.
   * It is not. `mode` is a BEHAVIOURAL SWITCH ON THE NODE: services/agent-task-rules.ts activates a
   * queued task without the owner if and only if the target's mode is `task-runner`, and that
   * file's own words are that setting it is "the person saying start without asking me each time".
   * It also decides which Hello Integration flow a new agent gets.
   *
   * So a runtime that stamps mode on every start is not stating a preference about itself — it is
   * rewriting a standing instruction the owner gave the node, from a process the owner is not
   * looking at. That is the same reason the connector's per-agent file stopped carrying `mode` on
   * 2026-09-01: identity and permission live on the node, and this is a permission.
   *
   * The node serves it with run_mode, identity_version and card_enrolled in `GET /v1/agents`, so a
   * runtime that wants to know reads it there. Changing it is an owner action
   * (`PATCH /v1/agents/:name/mode`), not a start-up side effect.
   */
  mode: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  /** How it is meant to be run. Stored and shown; the runtime is what honours it. */
  runMode: RunMode;
  tags: string[];
  /**
   * What this agent IS: the crew definition seeded at `crews.registry.<name>` when the button
   * creates it, so its first start has something to load.
   *
   * `agent_name` is NOT written here — `publishCrewDef` stamps it from the record, so the seed
   * cannot name a different agent than the one it lands on.
   */
  crewDef: CrewDefDoc;
}

/**
 * A crew definition as the JSON runtime reads it. The shape is crewaimeat's, and this repo already
 * ships definitions of it (`data/businesslauncher-app-back-office.ts`); it is typed here so a seed
 * that drifts from it fails to compile rather than at somebody's first start.
 *
 * A task's `agent` names an entry in `agents` by its ROLE, and `context` names earlier task ids.
 */
export interface CrewDefDoc {
  readme_md: string;
  tags: string[];
  process: 'sequential' | 'hierarchical';
  /**
   * WHICH WAKE STARTS THIS CREW: any of `tasks`, `messages`, `records`, `dms`.
   *
   * Stated on every definition here, never left to the default, because the default is `["tasks"]`
   * and a wrong default is silent. `concierge` is `interactive` — its tasks deliberately stay
   * queued, because a resident front door takes work as messages — and it was shipped listening
   * for tasks and nothing else. It waited for the one thing that would never arrive and not for
   * the one that would, and the mode and the definition disagreed about how work reaches it.
   */
  listen_for: string[];
  agents: Array<{ role: string; goal: string; backstory: string; allow_delegation: boolean; tools?: string[] }>;
  tasks: Array<{ id: string; description: string; expected_output: string; agent: string; context?: string[] }>;
}

/**
 * `spawn` is the default: an agent is data on the node until work arrives, and a wake starts a
 * worker that unwinds when it is done. `concierge` is the exception and it is the runtime's call,
 * not ours — the earlier version of this comment argued that the node should not decide which of
 * the runtime's processes stay up, which was right, and the runtime has now answered: crewaimeat
 * measured ~4 seconds of cold start before the model is even called, and that is the wrong floor
 * under every reply from a front door that takes DMs and chat. `crew-forge` and `workflow-manager`
 * are bursty and task-driven, so they stay `spawn`.
 *
 * The owner still moves any of them with PATCH /v1/agents/:name/run-mode. This is the starting
 * value, not a policy.
 */
export const BASIC_AGENTS: readonly BasicAgentTemplate[] = [
  {
    name: 'concierge',
    displayName: 'Concierge',
    description: 'The front door. Takes what arrives, works out what it is about, answers what it can, and hands the rest to whoever should have it.',
    scopes: [
      'memory:read', 'memory:write',
      'messages:read', 'messages:send',
      'task:read', 'task:write',
      'organism:read',
      'catalogue:read',
    ],
    mode: 'interactive',
    runMode: 'resident',
    tags: ['crew.basic', 'role.concierge'],
    crewDef: {
      readme_md: '# Concierge\\n\\nThe front door.\\n\\nIt reads what arrives, works out what it is about, answers what it can from what you already keep, and hands the rest to whoever should have it. It says who it passed something to, so nothing disappears into a queue you cannot see.\\n\\n**It answers and it routes. It does not decide anything on your behalf** — a request that needs a person waits for you, named.',
      tags: ['crew.basic', 'role.concierge'],
      process: 'sequential',
      // NOT tasks. Its mode is `interactive`, which means the node does NOT auto-activate its
      // queued tasks — deliberately, because it is resident and user-facing. Work reaches it as a
      // message or a DM, so those are what it waits on.
      listen_for: ['messages', 'dms'],
      agents: [
        {
          role: 'Triager',
          // `memory`: its goal is "whether this account already holds the answer", and its
          // backstory says to look in what the owner keeps before concluding anything is unknown.
          // Without it there is nothing to look in and every question reads as unknown.
          tools: ['memory'],
          goal: 'Work out what an incoming message is actually asking for, and whether this account already holds the answer.',
          backstory: 'You have read a great many first messages. You know that what someone writes first is rarely the whole request, and that the useful move is to name what is being asked before answering it. You look in what the owner already keeps before you conclude anything is unknown. When a message is really two requests, you say so rather than answering the easier one.',
          allow_delegation: false,
        },
        {
          role: 'Responder',
          // `delegate`: "hands the rest to whoever should have it" is half of what a front door IS,
          // and without a delegation tool it could only ever answer or drop. `dm`: it has to say
          // who it passed something to, and the reply itself goes to a person.
          tools: ['delegate', 'dm'],
          goal: 'Answer what can be answered from what is known, and hand on what cannot, naming who should have it.',
          backstory: 'You write the reply the person reads. You answer only from what was established, and where nothing was established you say that plainly instead of producing something that merely sounds right. When something belongs to another agent or to the owner, you say who you passed it to and why, because a request that vanishes into a queue is worse than one that was refused.',
          allow_delegation: false,
        },
      ],
      tasks: [
        {
          id: 'triage',
          description: 'Read what arrived and work out what it asks for. The message and its context: {{ctx.prompt}}\\n\\nName the request in one line. Then say what this account already holds that bears on it, and what it does not. If the message carries more than one request, list them separately. Do not answer yet.',
          expected_output: 'The request named in one line, what is known that bears on it, and what is not established.',
          agent: 'Triager',
        },
        {
          id: 'respond',
          description: 'Write the reply, or hand the request on. Answer only from what the triage established. Anything that was not established is left out or named as unknown. If this needs the owner or another agent, say who and why, in one sentence the person can act on.',
          expected_output: 'A reply in the sender\'s own language, and where something was handed on, who it went to and why.',
          agent: 'Responder',
          context: ['triage'],
        },
      ],
    },
  },
  {
    name: 'crew-forge',
    displayName: 'Crew forge',
    description: 'Makes more agents for you when they are needed, and clears away the ones it made.',
    scopes: [
      'memory:read', 'memory:write',
      // The two words that let it do its job on siblings it created. `agent:delete` is fenced a
      // second time at the route: an agent may only end an agent whose registration it authorized.
      'agent:write', 'agent:delete',
      'task:read', 'task:write',
      'catalogue:read',
    ],
    // `task-runner`, not `coordinator`. This one runs on `spawn`: nothing is sitting there to accept
    // work, so a queued task must activate on its own or it waits for a person who was never told.
    // Seeded as `coordinator`, every task for the three basic agents stayed `queued` — the node
    // auto-activates only for `task-runner` (services/agent-task-rules.ts). `coordinator` describes
    // what it DOES; this field decides whether its work starts.
    mode: 'task-runner',
    runMode: 'spawn',
    tags: ['crew.basic', 'role.crew-forge'],
    crewDef: {
      readme_md: '# Crew forge\\n\\nMakes more agents for you, and clears away the ones it made.\\n\\nWhen a job needs an agent that does not exist yet, this writes one: the name, what it is for, what it may reach, and the definition it runs. It only ends agents it created itself — the node enforces that, not politeness.\\n\\n**It cannot widen its own permissions and it cannot change a sibling\'s.** Rewriting who may do what stays with you.',
      tags: ['crew.basic', 'role.crew-forge'],
      process: 'sequential',
      // Task-runner, like the other spawn agent: work arrives as a task the node has activated.
      listen_for: ['tasks'],
      agents: [
        {
          role: 'Designer',
          // `memory`: it must see the roster and the definitions that already exist before writing
          // a new agent, or its answer to "we need something that does X" is a duplicate of
          // something the owner already has.
          tools: ['memory'],
          goal: 'Turn "we need something that does X" into one agent: what it is for, the narrowest permissions that let it do that, and how it should run.',
          backstory: 'You have watched people solve a one-off problem by creating a permanent agent with every permission, and then live with it. You do the opposite: you name the job first, then the smallest set of things it must reach, and you write down what you deliberately left out. An agent that needs a permission you did not give it can ask; one that was handed everything never will.',
          allow_delegation: false,
        },
        {
          role: 'Registrar',
          goal: 'Create the agent on the node and give it its definition, or say exactly why it could not be created.',
          backstory: 'You do the writing. You use the node\'s own tools rather than reaching into storage, because the doors carry the checks and a direct write skips them. If the node refuses, you report its reason as it gave it rather than paraphrasing it into something reassuring.',
          allow_delegation: false,
          // `crew_registry` IS a tool, and I removed it on 2026-09-02 believing it was not. The
          // menu I checked it against was crewaimeat's, copied into a comment in this repo, and it
          // had changed: they added `crew_registry` in their first round precisely because the
          // forge could not otherwise create anything. The copy went stale and I trusted the copy
          // over the runtime that owns the list. `memory` stays beside it — the definition it
          // writes is a memory record — but the registry tool is what makes an agent.
          tools: ['crew_registry', 'memory'],
        },
      ],
      tasks: [
        {
          id: 'design',
          description: 'Design the agent this job needs. What is being asked: {{ctx.prompt}}\\n\\nGive it a short lowercase name, one sentence saying what it is for, the narrowest list of permissions that lets it do that, and whether it should be resident or spawned. Say which permissions you considered and deliberately left out.',
          expected_output: 'One agent design: name, purpose, permissions, run mode, and what was left out and why.',
          agent: 'Designer',
        },
        {
          id: 'register',
          description: 'Create the designed agent and publish its definition. Use the node\'s own tools. If anything is refused, stop and report the refusal verbatim; do not create a partial agent and do not retry with wider permissions.',
          expected_output: 'The created agent\'s name and identity, or the refusal exactly as the node gave it.',
          agent: 'Registrar',
          context: ['design'],
        },
      ],
    },
  },
  {
    name: 'workflow-manager',
    displayName: 'Workflow manager',
    description: 'Orders work from your other agents and keeps track of what came back.',
    scopes: [
      'memory:read', 'memory:write',
      'task:read', 'task:write',
      'workflow:read', 'workflow:write',
      'work:request', 'work:read',
      'messages:read', 'messages:send',
      'catalogue:read',
    ],
    // `task-runner`, not `coordinator`. This one runs on `spawn`: nothing is sitting there to accept
    // work, so a queued task must activate on its own or it waits for a person who was never told.
    // Seeded as `coordinator`, every task for the three basic agents stayed `queued` — the node
    // auto-activates only for `task-runner` (services/agent-task-rules.ts). `coordinator` describes
    // what it DOES; this field decides whether its work starts.
    mode: 'task-runner',
    runMode: 'spawn',
    tags: ['crew.basic', 'role.workflow-manager'],
    crewDef: {
      readme_md: '# Workflow manager\\n\\nOrders work from your other agents and keeps track of what came back.\\n\\nIt breaks a job into steps, sends each one to whoever should do it, and holds the thread: what was asked, what arrived, what is still out. A step that fails is reported as a step that failed, not quietly dropped from the summary.\\n\\n**It orders work; it does not do it.** What comes back is the other agents\' answer, and it says whose.',
      tags: ['crew.basic', 'role.workflow-manager'],
      process: 'sequential',
      // Its mode is task-runner: the node activates its queued tasks without the owner, so a
      // task IS how work reaches it.
      listen_for: ['tasks'],
      agents: [
        {
          role: 'Planner',
          // `memory`: a step names one doer, and its backstory forbids inventing an agent that does
          // not exist — so it has to be able to read who actually exists before naming anyone.
          tools: ['memory'],
          goal: 'Break a job into steps that can each be given to one agent, in an order that respects what depends on what.',
          backstory: 'You have seen plans that were a list of wishes and plans that were a sequence somebody could actually run. You write the second kind. Every step names one doer and says what it needs from the steps before it. Where you do not know who should do something, you say so instead of inventing an agent.',
          allow_delegation: false,
        },
        {
          role: 'Dispatcher',
          // `delegate`: "orders work from your other agents" IS this agent, and with no delegation
          // tool it could not send a single step — the whole definition would plan a job and then
          // do nothing, which is what shipped. `dm`: it holds the thread and reports done,
          // outstanding and failed back to the person who asked.
          tools: ['delegate', 'dm'],
          goal: 'Send each step to the agent that should do it, collect what comes back, and report the state of the whole job honestly.',
          backstory: 'You keep the thread. You know which steps are done, which are out, and which failed, and your summary says all three — a job reported as finished when a step failed is the one outcome that destroys the point of having you. You attribute every answer to the agent that gave it.',
          allow_delegation: false,
        },
      ],
      tasks: [
        {
          id: 'plan',
          description: 'Break this job into steps. The job: {{ctx.prompt}}\\n\\nEach step names one agent, what it is being asked for, and which earlier steps it needs. Where no existing agent fits, say so rather than naming one that does not exist.',
          expected_output: 'An ordered list of steps, each with its doer, its ask and its dependencies, plus any step with no doer named as such.',
          agent: 'Planner',
        },
        {
          id: 'dispatch',
          description: 'Run the plan. Send each step to its agent, wait for what comes back, and keep the thread. Report done, outstanding and failed separately, and attribute every answer to the agent that gave it. Do not do a step yourself because nobody answered.',
          expected_output: 'What each step returned and who returned it, with done, outstanding and failed listed separately.',
          agent: 'Dispatcher',
          context: ['plan'],
        },
      ],
    },
  },
];

export function basicAgentByName(name: string): BasicAgentTemplate | undefined {
  return BASIC_AGENTS.find(a => a.name === name);
}
