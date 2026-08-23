/**
 * @file src/data/builtin-skills.hatchery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `hatchery-agent-requests` built-in skill: what to do when somebody asks for
 *   something to happen regularly, before you build the mechanism yourself.
 *
 *   WHY IT EXISTS. Two tool descriptions have been naming it since July — aimeat_schedule_create
 *   and aimeat_extension_install both tell the reader to load `node:hatchery-agent-requests` BEFORE
 *   they build — and the skill did not exist. Every agent that obeyed got NOT_FOUND and then built
 *   the thing the instruction was written to prevent, which is the most expensive kind of missing
 *   file: one that two other files promise.
 *
 *   Its own module because builtin-skills.ts was at the 800-line limit, the same reason
 *   builtin-skills.open-items.ts is separate. It also earns the separation: the two descriptions
 *   that point here are edited on their own rhythm, and when one of them changes what it promises,
 *   this is the file that has to agree with it.
 * @structure HATCHERY_SKILL_ENTRY
 * @usage
 *   import { HATCHERY_SKILL_ENTRY } from './builtin-skills.hatchery.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial.
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const HATCHERY_SKILL_ENTRY: BuiltinSkill =
{
    name: 'hatchery-agent-requests',
    visibility: 'public',
    skillMd: `---
name: hatchery-agent-requests
description: What to do when someone asks for something to happen regularly ("every morning", "each week", "keep an eye on"). Find out whether they already have an agent that could do it and give the work to that agent, rather than building a fourth parallel implementation they will never find again. Covers how to look, how to hand work over, and the two token-free options when there is nobody to hand it to. Use before creating any schedule or installing any extension that runs on a clock.
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

An agent whose profile carries a console address is hosted somewhere that actually runs it — a
hatchery, a cockpit, the person's own daemon. That is the strongest signal you can get from
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
- **\`kind: "ai"\`** — a server-side completion over memory keys, on **their own OpenRouter key**
  and against their own daily cap. Right when the work genuinely needs a model: summarising,
  translating, drafting.

Prefer the extension whenever the work does not need reasoning. A model called on a clock to do
something a script could do is a bill that arrives every week for no reason.

## The rule underneath all of this

**One capability, one place.** Before you build, ask what already exists for this person, and
add to it if anything does. A new mechanism needs a reason that survives the question "why is
this not part of the thing they already have".

And whatever you build: it belongs where the person will look for it. A schedule they cannot
find in their own agent surfaces is a thing that happens TO them rather than something they own.
`,
};
