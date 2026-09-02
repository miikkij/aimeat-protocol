/**
 * @file scripts/check-crew-defs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pre-commit gate: the crew definitions this repo SHIPS are checked against the
 *   runtime's rules before they leave, because their only reader is a runtime we do not run here.
 *
 *   WHAT THIS COST. The three basic-agent definitions seeded by the button carried tags in the
 *   form `crew:basic` and `role:concierge`. The node accepted them and answered ok — the node
 *   validates tags nowhere, so that was silence, not approval. crewaimeat's validator refused all
 *   six seeded definitions, 6/6, one cause, shape and not content: a tag must match
 *   [a-z0-9._-], and `:` is reserved in their `capabilities` field for versioned ids, so a tag
 *   carrying a colon stops being distinguishable from a capability id by eye. The feedback
 *   arrived days later, on another team's machine, from a worker that would not start.
 *
 *   Skipping the runtime validator AT CREATION is right: there is no runtime to ask, and the
 *   definition being published is what the agent would load. It does not follow that nothing can
 *   be checked. What we ship can be checked before we ship it, and that is all this does.
 *
 *   THIS IS A NEAR-COPY, AND IT WILL DRIFT. crewaimeat's validator is the authority on what a
 *   crew definition must be. The rules below are the subset we know, written out again here
 *   because importing theirs across repos is not on offer. They will fall behind. A definition
 *   that passes HERE and fails THERE is a signal to update this file — not a disagreement to
 *   argue, and not a reason to relax their validator. When the two differ, they are right.
 *
 *   The point is to catch the class of error that cost the round: a shape nobody looked at. It
 *   is not to become a second authority on crew definitions.
 *
 *   TWO QUESTIONS, and only one of them is theirs. Their validator decides whether a definition
 *   RUNS. This file also asks whether it can DO anything once it runs, which no validator can
 *   answer: a crew that declares no tools is perfectly valid and perfectly inert. That half is
 *   ours, because the descriptions those agents are sold under are ours.
 *
 *   AND IT DOES NOT HOLD THEIR VOCABULARY. It briefly did: a copy of crewaimeat's tool menu lived
 *   here, went stale, and rejected `crew_registry` — a tool they had ADDED for the very agent this
 *   file then stripped it from. A hard-coded allowlist for someone else's list can only be behind,
 *   and it fails closed against the newest names while looking authoritative. A tool this file
 *   rejects may simply be NEWER than this file, so it checks the shape of a name and not its
 *   membership. When the two disagree about whether a tool exists, they are right.
 *
 * @structure TAG_CHARSET · TOOL_NAME_SHAPE · MUST_BE_ABLE_TO · checkTags · checkDefinition · report
 * @usage pnpm check:crew-defs   (runs in .githooks/pre-commit and CI)
 * @version-history
 *   v1.2.0 — 2026-09-02 — Stops enforcing a tool MENU, and checks the wake.
 *     The menu was crewaimeat's, copied, and the copy went stale: it rejected `crew_registry`, a
 *     tool they added in their first round for crew-forge specifically, and on that authority I
 *     removed it from the one agent whose job is creating agents. Membership is theirs; this now
 *     checks only that a tool name has a tool name's shape.
 *     New rule, specific on purpose: an `interactive` agent must listen for something other than
 *     tasks. The node auto-activates a queued task only for a `task-runner`, so `concierge` — whose
 *     `listen_for` was unset and therefore `["tasks"]` — waited for the one thing that would never
 *     arrive. `listen_for` must also be stated rather than defaulted, because a wrong default is
 *     silent.
 *   v1.1.0 — 2026-09-02 — Two rules about TOOLS. (1) A tool must be on the fixed menu: a name
 *     outside it is not a narrower tool, it is no tool, and `crew_registry` had shipped on the one
 *     agent whose whole job is writing. (2) MUST_BE_ABLE_TO, a by-name table saying what each basic
 *     agent has to be capable of — SPECIFIC ON PURPOSE, because "this description promises
 *     delegation" is a judgement and a checker that guessed would be wrong both ways.
 *     `workflow-manager` declared zero tools while being described as ordering work from other
 *     agents, and `concierge` could answer but never hand on. Every shape rule passed them.
 *   v1.0.0 — 2026-09-02 — Added after crewaimeat refused all six seeded definitions on a tag
 *     charset this repo had never checked.
 */
import { fileURLToPath } from 'node:url';
import { BASIC_AGENTS, type CrewDefDoc } from '../src/data/basic-agents.js';

/**
 * crewaimeat's tag charset. Lowercase letters, digits, dot, underscore, hyphen — and nothing
 * else, which is what rules out both `:` (reserved for versioned capability ids) and `@`.
 */
const TAG_CHARSET = /^[a-z0-9._-]+$/;

/**
 * THE TOOL MENU IS NOT OURS, SO THIS FILE NO LONGER ENFORCES ONE.
 *
 * It used to. A copy of crewaimeat's list lived here and in a comment in
 * src/mcp/catalog/definitions/crew.ts, and on 2026-09-02 that copy rejected `crew_registry` as
 * "not a tool" — so I removed it from crew-forge's Registrar, the one agent whose entire job is
 * creating agents, on the authority of a stale transcription. crewaimeat had ADDED that tool in
 * their first round, for exactly that agent. The copy was older than the list.
 *
 * A hard-coded allowlist for someone else's vocabulary can only ever be behind. It fails closed
 * against the newest and most useful names, and the failure looks authoritative. So what is
 * checked now is the SHAPE of a tool name — non-empty, no whitespace, the grammar every tool on
 * their menu follows — and nothing about membership. A typo is still caught. A tool this file has
 * never heard of goes through, because it is more likely to be newer than wrong.
 *
 * If a definition passes here and crewaimeat's validator rejects a tool, THEY ARE RIGHT: the tool
 * does not exist or is spelled wrong. Fix the definition, not this file.
 */
const TOOL_NAME_SHAPE = /^[a-z][a-z0-9_]*$/;

/** The tool that lets one agent give work to another. Nothing else on the menu does. */
const DELEGATION_TOOL = 'delegate';

/**
 * WHAT EACH BASIC AGENT MUST BE ABLE TO DO, by name. SPECIFIC ON PURPOSE.
 *
 * The general rules above say whether a definition is well FORMED. This says whether it can do the
 * thing its own description promises, which no general rule can decide: reading a goal and
 * concluding "this one delegates" is a judgement, and a checker that guessed would be wrong in both
 * directions — silent where it matters and noisy where it does not.
 *
 * So it is a table, and adding to it is a decision someone makes deliberately. It covers the three
 * agents this repo SHIPS, which is the whole population this file has any business judging. A
 * fourth basic agent gets an entry here as part of adding it.
 *
 * The failure it exists for: `workflow-manager` is described as "orders work from your other
 * agents" and declared zero tools, so it could plan a job and then send nothing. `concierge` is a
 * front door that "hands the rest to whoever should have it" and could only answer or drop. Both
 * passed every shape rule, because the shape was fine.
 */
const MUST_BE_ABLE_TO: Record<string, { tool: string; because: string }[]> = {
  'concierge': [
    { tool: DELEGATION_TOOL, because: 'it is a front door that hands on what it cannot answer' },
    { tool: 'memory', because: 'it answers from what the account already holds' },
  ],
  // `crew-forge` left BASIC_AGENTS on 2026-09-02 (see the tombstone in src/data/basic-agents.ts),
  // so its entry is gone with it. This table judges what this repo SHIPS; an entry for something
  // it does not ship would never run and would slowly become a description of the past.
  'workflow-manager': [
    { tool: DELEGATION_TOOL, because: 'ordering work from other agents is its entire description' },
    { tool: 'memory', because: 'it names doers, and must read who exists rather than invent one' },
  ],
};

/** The placeholder a run's own input arrives as. At least one task must take it. */
const PROMPT_PLACEHOLDER = '{{ctx.prompt}}';

export interface Problem {
  where: string;
  value: string;
  rule: string;
}

/** What a template must carry for this check to read it — the shippable subset of BasicAgent. */
export interface Shippable {
  name: string;
  tags: string[];
  mode: string;
  crewDef: CrewDefDoc;
}

let problems: Problem[] = [];
function fail(where: string, value: unknown, rule: string): void {
  problems.push({ where, value: typeof value === 'string' ? value : JSON.stringify(value), rule });
}

function checkTags(where: string, tags: unknown): void {
  if (!Array.isArray(tags)) {
    fail(where, tags, 'tags must be an array of strings');
    return;
  }
  for (const tag of tags) {
    if (typeof tag !== 'string' || !TAG_CHARSET.test(tag)) {
      fail(where, tag, 'a tag must match [a-z0-9._-] — no ":" (reserved for capability ids), no "@", no spaces, no capitals');
    }
  }
}

function checkDefinition(name: string, def: CrewDefDoc, mode: string): void {
  const at = (part: string) => `${name} → crewDef.${part}`;

  // THE MODE AND THE DEFINITION MUST AGREE ABOUT HOW WORK ARRIVES. SPECIFIC ON PURPOSE: this is a
  // rule about one field's interaction with one node behaviour, not a general property of crew
  // definitions, and it is here because the two disagreed in the shipped set.
  //
  // `interactive` means the node does NOT auto-activate a queued task (services/agent-task-rules.ts
  // does that only for `task-runner`). So an interactive agent's tasks sit there by design — and
  // `concierge` was shipped with `listen_for` unset, which defaults to `["tasks"]`. It waited for
  // the one thing that would never arrive, and not for the one that would.
  if (!Array.isArray(def.listen_for) || def.listen_for.length === 0) {
    fail(at('listen_for'), def.listen_for,
      'state it rather than taking the default: the default is ["tasks"], and a wrong default is silent');
  } else if (mode === 'interactive' && def.listen_for.every(s => s === 'tasks')) {
    fail(at('listen_for'), JSON.stringify(def.listen_for),
      `mode is "interactive", so the node will not auto-activate this agent's tasks — it must listen for something other than tasks (messages, dms, records) or nothing will ever wake it`);
  }

  checkTags(at('tags'), def.tags);

  if (typeof def.readme_md !== 'string' || def.readme_md.trim() === '') {
    fail(at('readme_md'), def.readme_md, 'readme_md must be a non-empty string');
  }
  if (def.process !== 'sequential' && def.process !== 'hierarchical') {
    fail(at('process'), def.process, 'process must be "sequential" or "hierarchical"');
  }

  // ── agents[] ──
  if (!Array.isArray(def.agents) || def.agents.length === 0) {
    fail(at('agents'), def.agents, 'a definition needs at least one agent');
    return;
  }
  const roles = new Set<string>();
  for (const [i, agent] of def.agents.entries()) {
    for (const field of ['role', 'goal', 'backstory'] as const) {
      if (typeof agent?.[field] !== 'string' || agent[field].trim() === '') {
        fail(at(`agents[${i}].${field}`), agent?.[field], `every agent needs a non-empty ${field}`);
      }
    }
    if (typeof agent?.allow_delegation !== 'boolean') {
      fail(at(`agents[${i}].allow_delegation`), agent?.allow_delegation, 'allow_delegation must be stated, true or false');
    }
    for (const tool of agent?.tools ?? []) {
      // Shape only. Membership belongs to crewaimeat — see TOOL_NAME_SHAPE above for why this
      // stopped asserting a list it cannot keep current.
      if (typeof tool !== 'string' || !TOOL_NAME_SHAPE.test(tool)) {
        fail(at(`agents[${i}].tools`), tool,
          'a tool name is lowercase letters, digits and underscores, starting with a letter — this is a shape check, not a menu; crewaimeat decides which tools exist');
      }
    }
    if (typeof agent?.role === 'string') {
      if (roles.has(agent.role)) fail(at(`agents[${i}].role`), agent.role, 'two agents share a role, so a task naming it is ambiguous');
      roles.add(agent.role);
    }
  }

  // ── tasks[] ──
  if (!Array.isArray(def.tasks) || def.tasks.length === 0) {
    fail(at('tasks'), def.tasks, 'a definition needs at least one task');
    return;
  }
  const seen = new Set<string>();
  for (const [i, task] of def.tasks.entries()) {
    for (const field of ['id', 'description', 'expected_output', 'agent'] as const) {
      if (typeof task?.[field] !== 'string' || task[field].trim() === '') {
        fail(at(`tasks[${i}].${field}`), task?.[field], `every task needs a non-empty ${field}`);
      }
    }
    if (typeof task?.agent === 'string' && !roles.has(task.agent)) {
      fail(at(`tasks[${i}].agent`), task.agent, `a task's agent must name a role defined in agents[] — this one names nobody`);
    }
    // `context` may only name EARLIER tasks: the run is a chain, and a forward reference has
    // nothing to read when it executes.
    if (task?.context !== undefined) {
      if (!Array.isArray(task.context)) {
        fail(at(`tasks[${i}].context`), task.context, 'context must be an array of earlier task ids');
      } else {
        for (const ref of task.context) {
          if (!seen.has(ref)) fail(at(`tasks[${i}].context`), ref, 'context may only name an EARLIER task id');
        }
      }
    }
    if (typeof task?.id === 'string') {
      if (seen.has(task.id)) fail(at(`tasks[${i}].id`), task.id, 'two tasks share an id');
      seen.add(task.id);
    }
  }

  // The run's own input has to land somewhere, or the crew answers the same thing every time.
  if (!def.tasks.some(t => typeof t?.description === 'string' && t.description.includes(PROMPT_PLACEHOLDER))) {
    fail(at('tasks'), '(none)', `at least one task description must contain ${PROMPT_PLACEHOLDER}`);
  }

  // CAN IT DO THE THING IT SAYS IT DOES. Everything above asks whether the definition is well
  // formed; this asks whether it has the means to act, which is a different question and the one
  // that shipped wrong. crewaimeat's validator is the authority on whether a definition RUNS — it
  // was right about all six and said nothing about this, because a crew with no tools runs fine
  // and does nothing.
  const required = MUST_BE_ABLE_TO[name];
  if (required) {
    const held = new Set(def.agents.flatMap(a => a?.tools ?? []));
    for (const { tool, because } of required) {
      if (!held.has(tool)) {
        fail(`${name} → agents[].tools`, `(no agent declares "${tool}")`,
          `${name} must declare "${tool}" on one of its agents, because ${because}`);
      }
    }
  }
}

/**
 * Every problem in these templates. Exported so the unit test can hand it a deliberately broken
 * definition — the negative control has to keep failing, or the gate proves nothing.
 */
export function collectProblems(templates: readonly Shippable[]): Problem[] {
  problems = [];
  for (const template of templates) {
    // The agent RECORD's tags travel to the node and to every listing that shows them, and they
    // are written from the same template — so both places are checked, not just the definition's.
    checkTags(`${template.name} → tags`, template.tags);
    checkDefinition(template.name, template.crewDef, template.mode);
  }
  return problems;
}

function main(): void {
  const found = collectProblems(BASIC_AGENTS);

  if (found.length === 0) {
    const tasks = BASIC_AGENTS.reduce((n, t) => n + t.crewDef.tasks.length, 0);
    console.log(`✓ crew definitions shippable — ${BASIC_AGENTS.length} definitions, ${tasks} tasks, checked against the rules we know.`);
    console.log('  crewaimeat\'s validator is the authority; this is a near-copy that drifts.');
    process.exit(0);
  }

  console.error(`\n  ${found.length} problem(s) in the crew definitions this repo ships:\n`);
  for (const p of found) {
    console.error(`    ${p.where}`);
    console.error(`      value: ${p.value}`);
    console.error(`      rule:  ${p.rule}\n`);
  }
  console.error('  These definitions are read by crewaimeat, not by this node, so nothing here');
  console.error('  fails at runtime — the worker simply refuses to start on someone else\'s machine.');
  console.error('  Fix the template in src/data/basic-agents.ts.\n');
  process.exit(1);
}

// Only when run as the gate. Importing this file (the unit test does) must check nothing and
// exit nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
