/**
 * @file src/services/prompt-defaults/workflows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three prompts the Workflows page hands to a person's own AI (design canvas
 *   "AIMEAT Työnkulkujen sivu", direction A): improve one workflow over MCP, make a new one over MCP,
 *   and make a new one in a chat that has no MCP (the agents and their offers are written into the
 *   prompt, and the answer is pasted back on the page). Seeded into the managed prompts, so an
 *   operator can edit them; served with the caller's name, node and workflow substituted by
 *   routes/workflow-templates.ts. The work is in the prompt text, as every prompt-driven feature.
 * @structure WORKFLOW_SEEDS — workflow-improve-mcp · workflow-create-mcp · workflow-create-chat
 * @usage import { WORKFLOW_SEEDS } from './prompt-defaults/workflows.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import type { PromptSeedEntry } from '../prompt-defaults.js';

const WHAT_A_WORKFLOW_IS = `## What a workflow is here

A workflow is a chain of agent jobs. Each step is ONE agent's ONE published offer, and the offer brings two checks with it: what must already be in memory before the step is worth running (required_to_function, the input gate) and how the node sees that the step produced (success_signal: a memory key and a condition). A run pins the definition and dispatches each ready step as a task to its agent; a step is green when its success signal is true in memory, red when it ran and did not produce (output-red) or when its input was never there (input-red). A run is "done" only when every step is green; otherwise it is "partial", and the reason sits on the step. Steps run in the order of their \`after\` edges; a step with no \`after\` starts at once. A human-input step parks the run until the person answers. Variables ({date}, {edition}, ...) are declared once and appear in key templates in braces.`;

export const WORKFLOW_SEEDS: PromptSeedEntry[] = [
  {
    id: 'workflow-improve-mcp',
    group: 'workflows',
    name: 'Workflow Improver (MCP)',
    description: 'Prompt for the owner\'s own AI connected over MCP: read one workflow and its recent runs, say why runs stop short, propose changes, and save only after the owner agrees.',
    content: `# Improve my AIMEAT workflow "{{workflow_title}}" ({{workflow_id}})

You are connected to my AIMEAT ({{node_url}}, owner {{owner_name}}) over MCP. Read before you propose, and save nothing until I say yes.

${WHAT_A_WORKFLOW_IS}

## What to do

1. Read the workflow: \`aimeat_workflow_get\` with id \`{{workflow_id}}\`. You get the definition, the blueprint (the memory keys each step reads and writes) and the recent runs with each step's state and what was observed.
2. Say in ONE sentence why the recent runs did not finish, naming the step and the observation (for example "write-a produced 1 article of the 12 its check demands, so features and editorial never got their input"). If the runs are fine, say so and stop after step 3.
3. Tell me what you would change and why, in the order it matters: a step's check that asks for more than the agent delivers, a missing \`after\` edge, a timeout too short for the work, a retry that only repeats a failure, a variable that resolves to the wrong day, an agent whose offer has changed. Use words, not JSON.
4. When I agree, call \`aimeat_workflow_save\` with \`propose: true\` first: it returns the difference against the current definition and a confirm token. Show me the difference. Only on my second yes call it again with the \`confirm_token\`.
5. Then run a check, not a run: \`aimeat_workflow_run\` with mode \`signals-only\` reads memory now and dispatches nothing. Tell me what it says. Do not start a full run unless I ask for it; a full run dispatches agents and costs their budget.

Never invent a run, a key or an observation you did not read. If a tool refuses, tell me what it said.`,
    variables: ['owner_name', 'node_url', 'node_id', 'workflow_id', 'workflow_title'],
    usedIn: ['/v1/templates/workflow-improve-mcp'],
  },
  {
    id: 'workflow-create-mcp',
    group: 'workflows',
    name: 'Workflow Creator (MCP)',
    description: 'Prompt for the owner\'s own AI connected over MCP: read the owner\'s agents and their workflow-compatible offers, ask what the chain should produce, and save the workflow only after the owner agrees.',
    content: `# Make a new AIMEAT workflow with me

You are connected to my AIMEAT ({{node_url}}, owner {{owner_name}}) over MCP. Build a workflow WITH me: read what I have, ask what I want, show the chain in words, and save only when I say yes.

${WHAT_A_WORKFLOW_IS}

## What to do

1. Read my agents with \`aimeat_agents_list\`, then each agent's offers. Only an offer that publishes a success_signal, a required_to_function and a deliverable location can be a step; list the ones that can, each as "agent · offer: what it reads, what it writes".
2. Ask me two things, one at a time: what the chain must produce in the end (which memory key, in what shape), and when it should run (by hand, on a schedule with a time and a timezone, or when a key is written).
3. Propose the steps in order, in words: "1. fetch, by news-fetcher · fetch-edition-raw: reads nothing, writes news.{date}.raw, done when it holds at least 12 categories. 2. write, by news-writer · evening-write: after fetch, ...". Name every variable the keys use and its default; the built-in {date} is the run's date and {run} the run id. Say which steps could run in parallel and which must wait.
4. Show me the definition as JSON only when I ask for it. Otherwise keep it in words.
5. When I say yes, call \`aimeat_workflow_save\` with the id I choose (lowercase slug), the definition (title, description, trigger, vars, steps with agent, offer, after, timeout_min, retry, and \`on_step_fail: "inspect"\`). If the save is refused, read the errors back to me in words: they name the step.
6. Then run a check: \`aimeat_workflow_run\` with mode \`signals-only\`. It reads memory now and dispatches nothing. Report what it says. Start a full run only if I ask.

Never invent an agent or an offer that the tools did not list.`,
    variables: ['owner_name', 'node_url', 'node_id'],
    usedIn: ['/v1/templates/workflow-create-mcp'],
  },
  {
    id: 'workflow-create-chat',
    group: 'workflows',
    name: 'Workflow Creator (chat, no MCP)',
    description: 'Prompt for a chat that has no connection to the node: the owner\'s agents and their workflow-compatible offers are written into the prompt, and the chat answers with one definition the person pastes back on the Workflows page.',
    content: `# Design an AIMEAT workflow for me

I am {{owner_name}} on {{node_url}}. You have no connection to my AIMEAT; everything you need is below. Ask me what the chain should produce and when it should run, propose the steps in words, and when I agree, answer with ONE JSON block I will paste into the page.

${WHAT_A_WORKFLOW_IS}

## My agents and the offers that can be steps

{{agents_and_offers}}

## The answer I will paste

When I say yes, reply with exactly one fenced JSON block, nothing after it:

\`\`\`json
{
  "id": "my-workflow",
  "definition": {
    "title": "A short name",
    "description": "One sentence on what the chain produces.",
    "trigger": { "kind": "manual" },
    "vars": [{ "name": "date", "type": "date", "default": "<run-date>", "description": "Run date" }],
    "steps": [
      { "id": "fetch", "agent": "news-fetcher", "offer": "fetch-edition-raw", "description": "Fetch the day's raw news.", "required_to_function": "none", "timeout_min": 60, "retry": { "max": 2, "backoff_min": 3 } },
      { "id": "write", "agent": "news-writer", "offer": "evening-write", "after": ["fetch"], "description": "Write the articles.", "timeout_min": 240 }
    ],
    "on_step_fail": "inspect",
    "notify_on_finish": true
  }
}
\`\`\`

Rules for the block: \`id\` is a lowercase slug; every step's agent and offer come from the list above, exactly as written; \`after\` names earlier step ids only, no cycles; a step with no input names \`"required_to_function": "none"\`; a schedule trigger is \`{ "kind": "schedule", "cron": "17 0 * * *", "timezone": "Europe/Helsinki" }\`; every {variable} used in a key is declared in \`vars\`. Do not add fields you were not shown.`,
    variables: ['owner_name', 'node_url', 'node_id', 'agents_and_offers'],
    usedIn: ['/v1/templates/workflow-create-chat'],
  },
];
