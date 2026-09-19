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
description: What to do when someone asks for something to happen regularly ("every morning", "each week", "keep an eye on"). Find out whether they already have an agent that could do it and give the work to that agent, rather than building a fourth parallel implementation they will never find again. Covers how to look, how to hand work over, and the two token-free options when there is nobody to hand it to, and how to propose a new agent when the work needs one. Use before creating any schedule or installing any extension that runs on a clock.
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
- **\`kind: "ai"\`** — a server-side completion over memory keys, on **their own OpenRouter key if
  they have set one**, otherwise on the node's key while their allowance has something left, and on
  a free model once it is spent. Right when the work genuinely needs a model: summarising,
  translating, drafting.

Prefer the extension whenever the work does not need reasoning. A model called on a clock to do
something a script could do is a bill that arrives every week for no reason.

## 4. When the work needs an agent of its own

Some recurring work is more than one completion: several steps, tools, judgement about what was
found, something that answers when spoken to. Then propose a new agent.

\`aimeat_agent_propose\` takes a name, a \`purpose\` the person can decide from, the scopes the
agent needs (never more than you hold yourself) and a \`crew_def\`, the JSON document that says
what the agent is: its roles, its tasks and its tools. The call creates nothing. It puts one line
on the person's open items, and their press on it creates the agent, gives it the definition and
hands it to their connector to run. Send the \`crew_def\` with the proposal: an agent approved
without one exists and cannot start.

Once it runs, section 2 applies: a schedule of \`kind: "agent_task"\` gives it the work on a
clock. How to write the definition and how to check it is in the skill \`node:add-a-crew-agent\`.

Say what this needs before you propose it: a connector of theirs running on a machine of theirs,
and a model that machine can reach. Without the connector the agent is created and nothing runs
it, and the answer to the approval says so.

## The rule underneath all of this

**One capability, one place.** Before you build, ask what already exists for this person, and
add to it if anything does. A new mechanism needs a reason that survives the question "why is
this not part of the thing they already have".

And whatever you build: it belongs where the person will look for it. A schedule they cannot
find in their own agent surfaces is a thing that happens TO them rather than something they own.
`,
};

export const RECURRING_WORK_SKILL_ENTRIES: BuiltinSkill[] = [RECURRING_WORK_ENTRY];
