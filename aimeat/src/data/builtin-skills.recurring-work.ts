/**
 * @file src/data/builtin-skills.recurring-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-recurring-work` built-in skill: what to do when somebody asks for
 *   something to happen regularly, before you build the mechanism yourself. Until 2026-09-19 it
 *   was called `hatchery-agent-requests`.
 *
 *   WHY THE NAME CHANGED. In July two tool descriptions pointed at an agent hatchery as the place
 *   where a person's agents were made and run. There is no agent hatchery: an agent is made with
 *   aimeat_agent_propose and a crew definition, which step 3 of the skill now says. The skill's
 *   subject is its first heading, "Somebody wants something to happen regularly", and every tool it
 *   names is live, so the content stayed and the name went.
 *
 *   HOW THE OLD NAME LEAVES A RUNNING NODE. It is on the list in builtin-skills.retired.ts, and the
 *   seeder removes a retired skill from a node that never edited it. For a few hours on 2026-09-19
 *   the old name was kept as a three-line text pointing here; the developer ruled that a skill
 *   named after something that does not exist is removed, not redirected.
 *
 *   WHY IT EXISTS. Two tool descriptions had been naming it since July: aimeat_schedule_create
 *   and aimeat_extension_install both told the reader to load the skill BEFORE
 *   they build, and the skill did not exist. Every agent that obeyed got NOT_FOUND and then built
 *   the thing the instruction was written to prevent, which is the most expensive kind of missing
 *   file: one that two other files promise.
 *
 *   Its own module because builtin-skills.ts was at the 800-line limit, the same reason
 *   builtin-skills.open-items.ts is separate. It also earns the separation: the two descriptions
 *   that point here are edited on their own rhythm, and when one of them changes what it promises,
 *   this is the file that has to agree with it.
 * @structure RECURRING_WORK_SKILL_ENTRIES (one skill; a list because builtin-skills.ts spreads it)
 * @usage
 *   import { RECURRING_WORK_SKILL_ENTRIES } from './builtin-skills.recurring-work.js';
 * @version-history
 *   v1.8.1 — 2026-10-13 — Section 4: the approval page asks which model the agent thinks with, and
 *     with no pick the computer's own setting applies, which can be a small model.
 *   v1.8.0 — 2026-10-11 — Section 5, putting the work on a clock: the schedule kinds and fields, the
 *     REST routes for an agent with no model, steps joined by memory keys, who starts a task a fire
 *     gives (the agent's task-start answer, not its mode alone) and the edge cases. Folded in from
 *     the Finnish scheduler guide of the package docs, a file the node never served, now deleted
 *     (docs audit 2026-10-11, D7).
 *   v1.7.2 — 2026-10-11 — Section 4: one `offers` entry in the definition puts the agent on the
 *     person's offers page; the node adds one when there is none.
 *   v1.7.3 — 2026-10-11 — Section 4: the first run's task text is the offer's example.
 *   v1.7.1 — 2026-10-11 — Section 4: the approval gives the new agent its work once, as a task with
 *     its name and its purpose (services/agent-first-run.ts).
 *   2026-10-11 — The word a person reads for a connector is "computer" (laptop, server, cloud, AIMEAT instance), never "machine" (Jouni, 2026-10-11).
 *   v1.7.0 — 2026-10-10 — Section 4: a person with more than one connector names the machine, with
 *     aimeat_connector_list and the proposal's `connector`.
 *   v1.6.2 — 2026-10-08 — Section 4: an agent approved without a connector waits and gets its key
 *     when the connector next connects.
 *   v1.6.1 — 2026-10-02 — Section 4: the node adds ai:use when the person's crews think through it,
 *     and a resident ask is stored as spawn where the connector cannot keep an agent up.
 *   v1.5.0 — 2026-10-02 — Section 4: the agent is proposed here and never sent elsewhere, built on
 *     the organisms and workspaces the person keeps, and the person is given the approval address.
 *   v1.4.0 — 2026-09-29 — `kind: "refinery"`, one mail refinery batch each fire.
 *   v1.3.0 — 2026-09-28 — `kind: "ai"` runs on the owner's AI providers; an ai step or job can make a
 *     picture or transcribe (op), and the capability is checked at setup (System 2 plan, V5).
 *   v1.2.0 — 2026-09-19 — The old name is gone for good (builtin-skills.retired.ts), and step 3
 *     names the way an agent is made today: aimeat_agent_propose with a crew definition.
 *   v1.1.0 — 2026-09-19 — Renamed to aimeat-recurring-work; the old name stays as a superseded stub.
 *   v1.0.1 — 2026-09-19 — `kind: "ai"` no longer claims the person's own OpenRouter key pays for
 *     it. The content audit of 2026-09-19 compared every claim in this skill with the code; the
 *     rest of it holds.
 *   v1.0.0 — 2026-08-23 — Initial.
 */
/**
 * The shape of a built-in skill entry, stated here and not imported: builtin-skills.ts imports this
 * file, so importing its type back is an import cycle (check:deps). builtin-skills.ts spreads these
 * entries into a BuiltinSkill[], so a field this lacks or spells differently fails the type check.
 */
interface BuiltinSkill { name: string; skillMd: string; visibility?: 'members' | 'public' }

const RECURRING_WORK_ENTRY: BuiltinSkill =
{
    name: 'aimeat-recurring-work',
    visibility: 'public',
    skillMd: `---
name: aimeat-recurring-work
description: What to do when someone asks for something to happen regularly ("every morning", "each week", "keep an eye on"). Find out whether they already have an agent that could do it and give the work to that agent, rather than building a fourth parallel implementation they will never find again. Covers how to look, how to hand work over, and the two token-free options when there is nobody to hand it to, and how to propose a new agent when the work needs one. Then how to put the work on a clock, with the schedule kinds and their fields, the REST routes for an agent with no model in the loop, steps joined by memory keys, who starts a task the clock gives, and what a fire does when an agent is offline or the last run is still going. Use before creating any schedule or installing any extension that runs on a clock.
license: MIT
metadata:
  audience: agent
---

# Somebody wants something to happen regularly

Before you build anything: **find out whether they already have an agent that could do this.**

The failure this prevents is specific and common. A person asks for "a summary every Monday",
and the nearest tool is a schedule, so a schedule gets built over a memory key that nothing
writes. It runs. It stores nothing. It looks finished on every screen the person opens, and it
is the fourth place their weekly summary now half-exists. Nobody goes looking for the other
three.

## 1. Look first

\`aimeat_agents_list\` returns the owner's agents: name, mode, capabilities, tags and when each
was last seen. That list is the answer to "is there already something running for this person".

Read it for two things:

- **Is one of them already doing this?** Capabilities and tags usually say. If yes, the work is
  an addition to that agent, not a new mechanism.
- **Is one of them ALIVE?** \`last_seen\` is the test. An agent that has not been seen for weeks
  is a record, not a runtime, and handing it work means the work never happens.

An agent whose profile carries a console address is hosted somewhere that actually runs it: a
fleet runtime, a cockpit, the person's own daemon. That is the strongest signal you can get from
here, because it means something outside this node is keeping it alive.

## 2. Hand the work over

\`aimeat_task_create\` assigns a task to another agent of the SAME owner. That is the whole
mechanism, and it is enough:

- Say what the outcome is, not how to get it. The agent receiving this has its own tools and
  its own model, and they are probably not yours.
- Say where the result should land — the memory key, the workspace space, the record shape.
- Say what "done" looks like, so the agent can close it rather than leaving it open forever.

To make it recur, a schedule of \`kind: "agent_task"\` queues that task on a clock. Note what
that costs: the receiving agent spends its own tokens on its own account, and this node
measures none of it. Say so before you set it up, rather than after the first bill.

## 3. When there is nobody to hand it to

Say that plainly first — "you have no agent running that could do this" is information, not a
failure, and the person may want to connect one before anything else. Connecting an AI they
already pay for is in the profile under Agents.

Then offer what the node itself can do, cheapest first:

- **\`kind: "extension"\`** — a sandboxed action on the node's own clock. **Zero tokens**, no key
  of theirs, no account anywhere else. This is the right answer for fetch-and-store, for
  checking whether something changed, and for any tidying that needs no judgement.
- **\`kind: "ai"\`** — a server-side completion over memory keys, on **their own AI providers** (their
  routing picks which one), otherwise on the node's key while their allowance has something left, and
  on a free model once it is spent. Right when the work genuinely needs a model: summarising,
  translating, drafting. A workflow \`ai\` step or a background job can also make a picture
  (\`op: "image"\`) or transcribe a stored recording (\`op: "transcribe"\`, \`audio_key\`). Check the
  capability with \`aimeat_ai_capabilities\` when you set it up: a capability that is off when the run
  comes stops that step with a refusal that names what to set.
- **\`kind: "refinery"\`** — one batch of a mail refinery (\`input: { prefix }\`) each fire: the
  mailbox read, sorted and filed as workspace rows. Right when the recurring work is "go through my
  mail". It runs as you, so its mailbox must be one you connected. Skill: aimeat-refinery.

Prefer the extension whenever the work does not need reasoning. A model called on a clock to do
something a script could do is a bill that arrives every week for no reason.

## 4. When the work needs an agent of its own

Some recurring work is more than one completion: several steps, tools, judgement about what was
found, something that answers when spoken to. Then propose a new agent, here. This node makes it,
so never point the person to an outside agent builder, tool or product for it.

First read what it will work on: \`aimeat_organism_list\` and \`aimeat_workspace_list\` (or
\`aimeat_discover\` with scope "shared") show the organisms and workspaces they keep. "Every
morning, gather my open deals" is about the deals in their own sales workspace, so read that
workspace's record shape and design the agent for it.

\`aimeat_agent_propose\` takes a name, a \`purpose\` the person can decide from (name their data in
it), the scopes the agent needs (never more than you hold yourself; the node adds \`memory:read\`
and \`memory:write\`, which a crew runtime needs for itself, and \`ai:use\` when the person's crews
think through this node) and a \`crew_def\`, the JSON document that says what the agent is: its
roles, its tasks and its tools. Leave \`run_mode\` out: a worker per piece of work is what the
person's connector runs, and a \`resident\` ask is stored as \`spawn\` with \`run_mode_corrected\`
saying so wherever the connector cannot keep an agent up. The call creates nothing.
It puts one line on the person's open items, and their press on it creates the agent, gives it the
definition and hands it to their connector to run. The answer carries \`approval_url\` and
\`next_step\`: give the person both, so they know where to press. Send the \`crew_def\` with the
proposal: an agent approved without one exists and cannot start. One \`offers\` entry in the
definition (\`id\`, \`title\`, \`ask\`) is what puts the agent on the person's "Ask your agents" page once
it has started; the node adds one from the name and the purpose when the definition has none.

The approval gives the new agent its work once, as a task with its name and the offer's \`example\`
(its purpose when the offer has none), so the person sees a first result without waiting for the clock. Once it runs, section 2 applies: a
schedule of \`kind: "agent_task"\` gives it the work on a clock. How to write the definition and how
to check it is in the skill \`node:add-a-crew-agent\`.

Say what this needs before you propose it: a connector of theirs running on a computer of theirs,
and a model that computer can reach. Without the connector the agent is created and waits, and the
answer to the approval says so; when their connector next connects, the node gives the agent its
key and the connector starts it, with nothing for them to press. A person with more than one
connector says which computer: \`aimeat_connector_list\` names them, and the proposal's
\`connector\` carries the choice, so the agent waits for that computer and no other.

Say which model the work needs, too. The approval page asks "Which model it thinks with" and lists
the models the chosen computer reaches; the person's pick is stored before the first run. With no
pick the computer uses the model in its own settings, which can be a small one: tell a person
whose agent searches, reads sources or works in many steps to pick a strong model there.

## 5. Putting the work on a clock

The node holds the clock. A schedule fires while the agent that made it is offline, and the owner
sees every schedule and can pause or delete any of them.

\`aimeat_schedule_create\` takes \`kind\`, \`cron\` (five fields: \`"0 7 * * *"\` is 07:00 every day),
\`display_name\`, \`purpose\` (the owner reads it) and \`timezone\`. Give an IANA timezone
(\`"Europe/Helsinki"\`) to every daily schedule, or summer time moves it by an hour. Then, by kind:

| kind | Fields | The caller needs |
|---|---|---|
| \`ai\` | \`prompt\`, \`input_keys\` (the owner's memory keys given to the model), \`output_key\` (where the result is written, private) | \`ai:use\` |
| \`agent_task\` | \`target_agent\` (an agent of the same owner; yourself when left out), \`task_title\`, \`task_description\` | \`task:write\` |
| \`extension\` | \`extension_name\`, \`action_id\`, \`input\` (the action's parameters on every fire), \`instance_id\` | |
| \`refinery\` | \`input: { prefix }\` | \`connections:read-through\`, \`ai:use\`, \`organism:rows\`, \`memory:write\` |

It answers \`schedule_id\`. \`aimeat_schedule_list\` lists the schedules you made (\`detail: true\` adds
each one's prompt), \`aimeat_schedule_update\` pauses (\`enabled: false\`), resumes, or changes the
cron, the timezone, the name or the prompt, \`aimeat_schedule_trigger\` runs one now, and
\`aimeat_schedule_delete\` removes it. A clock you run yourself, outside the node, can still be shown
to the owner: \`aimeat_schedule_report_internal\` lists it beside theirs, and the node does not run it.

**Over REST, for an agent with no model in the loop.** \`POST /v1/agents/{name}/schedules\` puts a
schedule on the named agent, and any token of the same owner may call it: the target is the path, not
the token. \`POST /v1/schedules\` takes the target in the body as \`agent_name\` (or \`target_agent\`,
or \`agent\`). An \`agent_task\` schedule needs the task, either \`task_template: { title,
description }\` or \`task_title\` and \`task_description\`. An agent of another owner answers 404
AGENT_NOT_FOUND. The rest is \`GET /v1/schedules\`, \`GET\`, \`PATCH\` and \`DELETE
/v1/schedules/{id}\`, and \`POST /v1/schedules/{id}/trigger\`.

**Steps are joined by memory keys, not by order.** No schedule waits for another to finish. Put the
steps at different times (fetch at 06:00, write at 07:00), and name the exact memory key each step
reads and writes, in \`task_description\` and in \`input_keys\`, so each step finds what the one before
it left.

**Who starts a task the clock gives.** An \`agent_task\` fire queues a task. It starts on its own only
when the agent's owner lets that agent start tasks by itself (\`aimeat_agent_task_start_set\`, or an
agent in \`task-runner\` mode when the owner has said nothing); otherwise it waits for the owner's OK
on each one. An agent that can spend money, send mail or delete as the owner always waits. The
\`ai\`, \`extension\` and \`refinery\` kinds need no agent at all, which makes them the choice for work
nobody should have to approve every morning.

**What a fire does when things are not ready.**

- The target agent is offline: the task waits in its queue and is picked up when it connects.
- The previous run is still going, or its task is still open: this fire is skipped.
- A fire missed while the node was down is not made up later. A "every morning" job skips that
  morning; it does not run at noon.
- The owner can cap a schedule: \`max_runs\` turns it off after that many runs, and \`daily_limit\`
  caps the day's AI spend in US dollars.

## The rule underneath all of this

**One capability, one place.** Before you build, ask what already exists for this person, and
add to it if anything does. A new mechanism needs a reason that survives the question "why is
this not part of the thing they already have".

And whatever you build: it belongs where the person will look for it. A schedule they cannot
find in their own agent surfaces is a thing that happens TO them rather than something they own.
`,
};

export const RECURRING_WORK_SKILL_ENTRIES: BuiltinSkill[] = [RECURRING_WORK_ENTRY];
