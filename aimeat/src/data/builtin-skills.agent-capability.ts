/**
 * @file src/data/builtin-skills.agent-capability.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-agent-capability` built-in skill: how an agent gets a capability on
 *   this node. The capability is built as an app that publishes a tool, and the agent calls the
 *   tool. The agent's runtime gets a new tool only for work that needs the computer itself.
 *
 *   WHY A NODE SKILL. In October 2026 a list of 58 kinds of agent was sorted by what this node
 *   and the crew runtime can do. The first sorting proposed six new runtime tools (mail, a
 *   calendar, transcription, outside systems), because nothing an agent designer reads said that
 *   an app gives an agent its capability. Fourteen of the kinds moved to "possible now" once the
 *   rule was applied (Jouni, 2026-10-12: "applikaatio voi tehdä app-toolsin jonka kautta se voi
 *   hyödyntää aimeat:n kaikkia kyvykkyyksiä [...] ilman että paisutetaan crewaimeat:ia"). The
 *   same mistake repeats in every session until the rule is where a designer reads it.
 *
 *   WHAT IT MUST AGREE WITH. models/app-tool-schemas.ts (a tool's fields and its two ways of
 *   running), commerce/app-tool-catalog.ts and routes/webmcp.ts (which tools an owner's own agent
 *   calls free, and that a tool with no action answers TOOL_NOT_INVOKABLE to a direct call),
 *   commerce/sellable-resolvers.ts (a tool with no action becomes a task through a checkout only;
 *   the first text of this skill said "a call creates a task", which a reviewer checked against
 *   the route and found false on 2026-10-12), services/extension-ctx-contract.ts (what an extension's action is given),
 *   services/connect-tunnel-push.ts onMemoryWrite (a published record wakes a subscribed agent;
 *   services/workspace-rows/row-service.ts does not call it, so a row wakes no agent by itself),
 *   services/workflow/engine-triggers.ts fireWorkspaceRows with workflow-event.ts (a workflow starts
 *   on an append and its run carries the event as `event_*` variables; `coalesce`),
 *   services/refinery/pipeline.ts (mail arrives as rows), data/library-packs/ (the libraries
 *   named), routes/outbound.ts with services/connections/ (mail sent through a connected
 *   account), and crewaimeat's crew_def.py TOOL_REGISTRY (the tool ids `workspace`,
 *   `workspace_write`, `app_tools`, `exchange`, `delegate`) with workspace_tools.py, whose four
 *   tools list workspaces, read an index or records, write a record and append rows: none of
 *   them reads rows (read 2026-10-12, crewfive d0b0591).
 * @structure AGENT_CAPABILITY_SKILL_ENTRY
 * @usage import { AGENT_CAPABILITY_SKILL_ENTRY } from './builtin-skills.agent-capability.js';
 * @version-history
 *   v1.7.2 — 2026-10-25 — The newsletter row: ctx.email takes one recipient per call within the hourly allowance (secaudit2026oct22, lead 325).
 *   v1.7.1 — 2026-10-18 — The ctx.ai row says the extension reads the answer back, privately.
 *   v1.7.0 — 2026-10-14 — "What an app tool is": the permission organism:direct lets one agent
 *     write a closed space directly, the list of a closed space is changed only by the person in
 *     person or by such an agent, and an app names its extension on an existing workspace's space
 *     through POST …/workspace/spaces/{space}/extensions (services/fenced-space.ts v1.1.0,
 *     services/workspace-space-extensions.ts).
 *   v1.6.0 — 2026-10-13 — "What an app tool is": a record space that names extensions takes an
 *     agent's write only through one of them (services/organism-namespace-access.ts), and what the
 *     app's builder writes in the workspace's structure for it. Ruled by Jouni after an agent
 *     wrote past an app's tool on aimeat.io that day.
 *   v1.5.1 — 2026-10-13 — "When you propose the agent": an app tool reads and writes the app's
 *     workspace as the agent that called it, so the agent needs organism:read (and the writing
 *     reach for a tool that saves). Seen on aimeat.io that day: ext:invoke alone left a tool
 *     answering that the workspace is not the caller's to read.
 *   v1.5.0 — 2026-10-13 — `ctx.calendar` in the table of what an extension has.
 *   v1.4.0 — 2026-10-13 — A visitor who expects an answer on the page: an intake form with `thread`,
 *     and the signal record that wakes the agent (routes/organisms/intake-thread.ts).
 *   v1.3.1 — 2026-10-13 — The Email row: a refinery row holds the mail's text only when the
 *     definition says `keepText`.
 *   v1.3.0 — 2026-10-13 — "What an app cannot give": the runtime has a browser tool now, within the
 *     hostnames a definition names (crewaimeat 57b2cf0).
 *   v1.2.0 — 2026-10-13 — A calendar goes out as an ICS feed of a shared records space
 *     (services/calendar-feed.ts, routes/organisms/workspace-ops.ts): the table and the example.
 *   v1.1.0 — 2026-10-13 — A row still wakes no agent by itself, and a workflow now starts on it: the
 *     `workspace.rows` event, the `event_*` variables a run carries, and `coalesce`. The table, question
 *     4 and the email example said "a new row wakes nobody" and named the clock as the only way.
 *   v1.0.1 — 2026-10-12 — "When you propose the agent" names the scopes the tools use: ext:invoke
 *     for an app tool (services/capability-invoke.ts calls the extension action with the caller's
 *     token, and auth/rest-scope-gate.ts refuses that call without the word from node 4.0.0),
 *     organism:read and organism:write for a workspace.
 *   v1.0.0 — 2026-10-12 — Initial (wish-noden-skilli-agentin-kyvykkyys-suunnitellaan-sovelluksena-ja).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const AGENT_CAPABILITY_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-agent-capability',
  visibility: 'public',
  skillMd: `---
name: aimeat-agent-capability
description: How an agent gets a capability on AIMEAT. Build the capability as an app that publishes a tool, and let the agent call the tool, instead of asking for a new tool in the agent's runtime. Covers the three ways an agent gets a capability today (a workspace, an app tool, another agent's offer), what an app tool and the extension behind it can do, how information comes in and what wakes an agent, where a person approves what goes out, the ten questions to answer before building, and three worked examples (email, a calendar, meeting notes from a recording). Use before you design a new agent, before you propose a new tool for an agent, and when a person asks for an agent that needs mail, a calendar, an outside system, speech, or anything the agent's own tool list does not name.
license: MIT
metadata:
  audience: agent
---

# An app gives an agent its capability

## The rule

An agent does not need a tool of its own for every job. Build the capability on AIMEAT as an **app**,
and let the app give it to the agent as a **tool**. The same app serves a person on a screen and an
agent through the tool, and the tool can be offered to other owners on the Exchange.

The agent's runtime gets a new tool for one reason: the work needs the computer the agent runs on.
A browser, ffmpeg and a local file are such work. Mail, a calendar, transcription and an outside
system's API are not: an app reaches each of them.

## Look at what exists first

Before you design anything, read what the person already has:

1. \`aimeat_crew_menu\` on a connected agent of theirs: the tool ids its runtime resolves.
2. \`aimeat_app_list\`, then \`aimeat_app_tools_get\` for an app that looks right: the tools it
   publishes, each with its input fields. \`GET /v1/commerce/tools?include=own\` lists the owner's
   free callable tools in one read.
3. \`aimeat_organism_list\` and \`aimeat_workspace_list\`: the information they keep, by workspace.
4. \`aimeat_skill_list\` with \`binding: "app:{owner}/{filename}"\`: the app's own operating guide.

When one of their apps already publishes the tool, the agent uses it. When the information is
already in a workspace, the agent reads it there.

## Three ways an agent gets a capability today

| Where the capability is | The agent's tool id | What it gives |
|---|---|---|
| The information is in a workspace | \`workspace\`, \`workspace_write\` | The agent reads a workspace's index and its records, and with \`workspace_write\` writes records and appends rows. It does not read rows: an app tool does that for it. |
| An app publishes a tool | \`app_tools\` | The agent lists the tools apps publish and calls one by its sku, \`app-tool:<owner>/<app>:<tool>\`. Its own owner's tools cost it nothing, priced or not. |
| Another agent or another owner offers it | \`exchange\`, \`delegate\` | The agent uses another agent's work or another owner's app tool, under a contract and metered. |

A definition names a workspace by its id and a tool by its sku, so the runtime finds exactly that
one.

## What an app tool is

An app publishes a tool manifest (\`aimeat_app_tools_publish\`, stored as \`apps.<filename>.tools\`).
Each tool has a name, a description, the shape of its input and its result, and one of two ways of
running:

- **An extension's action** (\`action_id: "ext:<extension>:<action>"\`). The node runs it in a
  sandbox and answers with the result.
- **A task** (no \`action_id\`). The node has nothing to run for it. It is fulfilled as a task, for
  the agent the tool names or else for the app's owner, and only when it is bought through a
  checkout. A direct call answers \`TOOL_NOT_INVOKABLE\`, for the owner's own agent too. So an
  agent's definition names a tool that has an action.

A tool may carry a money price and a pacing amount, and it can be listed on the Exchange. A tool
with an action and no price is the owner's own: their agents call it directly.

**A tool's checks hold only if the agent cannot write past the tool.** The extension writes the
workspace as the agent that called it, so the same agent can write the same record directly with
the plain workspace tools, and then nothing the tool checks is checked. Close that in the
workspace's structure: name the extension on every record space an agent may write only through
your tool, \`objectTypes[].extensions: ["<installer>/<extension name>"]\` (the installer is the
account that installed the extension on this node). From then on the node refuses an agent's
draft, direct write, publish, revert, delete, archive, copy and import into that space
(\`ACCESS_DENIED\`) unless it arrives through one of the named extensions. A person in person and
the app's own page still write directly. A list with no valid entry closes the space to every
agent. Say in the space's \`description\` which tool writes it: the home's new-agent page shows
that sentence beside the space, writes it into the agent's tasks, and gives an agent that watches
such a workspace the tool that calls app tools.

The owner can let one agent through: the permission \`organism:direct\` (the agent editor's
organism row; full access \`*\` covers it, the read-only and read-and-write presets do not hold
it). An agent whose session holds it writes a closed space directly, and it may change the list.
Nobody else changes a list that is there: a change to the workspace's structure that alters or
removes the list of a closed space, or moves that space to another namespace or backing, is
refused (\`ACCESS_DENIED\`, details \`reason: "FENCE_CHANGE"\`) unless the person makes it in person
or the agent holds the permission. That holds for the structure record itself too, whichever
memory route or tool names it.

A workspace that existed before the app had its extension gets the list from the app's own page:
\`POST /v1/organisms/{id}/workspace/spaces/{space}/extensions?ws=<workspace>\` with
\`{ "add": ["<installer>/<extension name>"] }\`, or \`AIMEAT.organism.nameExtensions\`. It adds and
never removes, takes one to five entries, and takes only extensions the caller's own account
installed on this node. The person in person, the app the person signed in to, or an agent with
\`organism:direct\` may call it, as the workspace's creator or an admin of the organism.

## What the extension behind a tool can do

This is what an agent reaches through an app tool. The extension's manifest declares each one
(skill \`aimeat-extension-builder\` has the build path and every rule):

| The extension's \`ctx\` | What it does |
|---|---|
| \`ctx.fetch\` | Calls an outside service, at the hosts the manifest names. Its credential is a secret the node keeps encrypted, never text in the code. |
| \`ctx.workspace\` | Reads and writes workspace records, and reads and appends the rows of a row space that names the extension. |
| \`ctx.memory\` | Keeps the extension's own data and reads public records. |
| \`ctx.files\` | Reads and writes files in the node's storage. |
| \`ctx.ai\` | Starts a model call that runs in the background: text, a picture, or the transcription of a stored audio file. The extension's owner pays for it, and the extension reads the answer back while it stays private to the owner. |
| \`ctx.email\`, \`ctx.notify\` | Sends an email through the node's mail service, or a notice to the owner. |
| \`ctx.buy\` | Buys one call of another app's tool, under a contract the extension's owner holds. |
| \`ctx.calendar\` | Calendar arithmetic on the node, with the library the browser uses (\`aimeat-calendar\`): the occurrences of repeating events in a range, free time, a time zone's local time to an instant and back, ICS text to events and back. An extension has no time-zone data of its own, so a calendar tool ("what is booked this week", "when is free") is built on these calls and stores events in the library's event shape. |
| A schedule | Runs an action on a clock, for example to fetch from an outside system and write rows. |

The served libraries give an app the rest in the person's browser: \`aimeat-ai\` (text, pictures,
speech, **transcription**, embeddings on the person's own AI providers), \`aimeat-connect\` (the
person's own accounts at outside services, Gmail and Outlook among them), \`aimeat-refinery\` (mail
sorted into workspace rows), \`aimeat-intake\` (a form a visitor without an account sends into a
workspace), \`aimeat-webhook\`, \`aimeat-calendar\` (recurring events, time zones, ICS in and out,
free time) and \`aimeat-workflows\` (a run with a step that waits for a person).

## How information comes in, and what wakes the agent

| Source | How it reaches AIMEAT | What wakes the agent |
|---|---|---|
| Email | The mail refinery reads a connected mailbox on a clock and writes each message as a workspace row (skill \`aimeat-refinery\`). The row holds the read fields and a 280-character snippet; it holds the message's text and each PDF's text only when the definition says \`keepText\`, which a tool that checks the fields against the mail needs | A clock, set a few minutes after the refinery's, or a workflow that starts on the new rows (below) |
| A visitor on the web | An intake form writes a record into a workspace | The new record, for an agent that holds a workspace contract |
| A visitor who expects an answer on the page | An intake form defined with \`thread\` keeps a conversation: the node writes the visitor's messages into one record, and the visitor reads the answers back with the secret the start gave them (library \`aimeat-intake\`, \`AIMEAT.intake.thread\`) | The signal record the node writes for a message an agent is to answer, for an agent that holds a contract on the signal space. The agent reads the thread record of the same id and appends its answer to the reply record of that id. The node writes no signal once a person took the conversation over or the form's agent messages for the day are spent, so the agent needs no rule for either |
| An outside system | An extension fetches on a clock and writes rows | A clock, or a workflow that starts on the new rows (below) |
| A person in an app | The app writes into a workspace, or gives the agent a task | The task or the record |
| Sound | The app transcribes it (\`aimeat-ai\` in the browser, or the extension's \`ctx.ai\` for a stored file) and writes the text into a workspace | The task or the record |
| Another agent | An offer, a workflow step, or an app tool bought through a checkout and fulfilled as a task | The task |
| Time | A schedule of kind \`agent_task\` | The scheduled task |

An agent is woken by a task, a message, a schedule and a **published workspace record**. An agent
that reads named spaces of a workspace and is woken by their records is a contract agent, and that
way exists: skill \`aimeat-workspace-contracts\`. Use it, and build no second way for an agent to
follow a workspace.

**A row is not a record, and a new row wakes no agent by itself.** Two ways give an agent work from
rows. The simple one is a clock: the agent runs a few minutes after whatever writes the rows. The
other is a workflow that starts on the event, for when the delay matters or the rows come at no
fixed time. Its definition has this trigger and an agent step:

\`\`\`json
{ "trigger": { "kind": "event", "on": "workspace.rows",
               "match": { "organism": "<organism id>", "workspace": "<workspace id>", "space": "<row space>" },
               "coalesce": true },
  "steps": [ { "id": "handle", "agent": "<agent>", "offer": "<offer>", "description": "Handle the new rows" } ] }
\`\`\`

- The workflow starts **once for each append call**, whether the call wrote one row or five
  hundred. It starts for an owner only while that owner is a member who may read the space.
- The run carries what arrived as variables, and an agent step gets them with its task as
  \`var.event_organism\`, \`var.event_workspace\`, \`var.event_space\`, \`var.event_count\`,
  \`var.event_row_ids\` (at most 50 ids, and only ids made of letters, digits and \`. _ : @ + = -\`),
  \`var.event_at\` and \`var.event_folded\`. The event carries ids and a count, never a row's
  content: the agent reads the rows through an app tool.
- One run of a workflow is live at a time. Without \`coalesce\` an append that arrives during a run
  starts nothing. With \`"coalesce": true\` the appends that arrive during a run start **one** more
  run when it ends; \`event_folded\` says how many events it stands for, \`event_count\` is their
  rows together, and \`event_at\` is the time of the first, so "everything since \`event_at\`" misses
  nothing. Leave \`coalesce\` out of a workflow whose own step writes what its trigger matches: it
  would start itself again after every run.
- The same variables come with the other events: \`event_key\` for \`memory.write\`, \`event_offer\`
  for \`offer.ordered\`. Save the workflow with \`aimeat_workflow_save\`.
- An agent is a workflow step only when its offer declares its workflow signals (skill
  \`add-a-crew-agent\`, "What it offers", which has the three fields). An agent made from a crew
  definition reads the \`var.event_*\` values and writes its result where the workflow looks only
  when its runtime names \`task_scope\` in \`aimeat_crew_menu\` \`features\`; a crew written in Python
  reads the task's scope in its own code. Where no agent is needed, the step can be an extension
  action or the owner's model instead, and \`{event_row_ids}\` goes into its input or prompt.

"Where its work goes" is a different choice. It decides who reads the agent's finished result (its
owner only, or the members of one workspace). It gives the agent nothing to read and wakes it for
nothing.

## How information goes out, and where a person approves

The agent writes a draft into a workspace. The app shows it. The person presses. The app holds the
permission to send, so the agent needs none.

| Out | How |
|---|---|
| A reply from the person's own mailbox | The app sends through their connected Gmail or Outlook account when they approve (\`POST /v1/outbound/send\`; the send permission is a separate connection from the read permission) |
| A notice, a reminder, a newsletter | The extension's \`ctx.email\`, within what the owner consented to: one recipient per call, and by default at most 200 an hour for one account's extensions (the operator setting \`extensions.email_per_hour\`) |
| A post to social media | The connected accounts, through a publishing workflow with an approval step |
| An outside system | The extension's \`ctx.fetch\` to a declared host, or \`aimeat-webhook\` |
| A calendar | The app's own calendar in a workspace; an ICS file from the app; and the event space as an ICS feed the person subscribes to once in their own calendar program (below) |

Sending, paying and deleting are approved by a person on a screen. An instruction in the agent's
definition is not that approval.

## Ten questions, in this order, before anything is built

1. **What gets taken care of for the person?** One sentence, in their words.
2. **Where does the information come from?** Mail, a form, an outside system, a person, sound,
   another agent.
3. **Which workspace holds it, and in what shape?** Records or rows, and their fields.
4. **What wakes the agent?** A new record (a contract agent), a task, a message or a clock. A row
   does not by itself: a clock after the writer, or a workflow that starts on \`workspace.rows\`.
5. **What do plain rules settle before a model reads anything?** Rules drop the noise first; the
   model reads what is left.
6. **What does the agent decide, and what does it only prepare?**
7. **What does a person approve, and on which screen?**
8. **Which tools does the app publish**, so that this agent and others can do what a person does
   on the screen?
9. **Can it be offered to others?** An offer, workflow signals, the Exchange.
10. **Does the work need the computer itself?** Only a yes here is a reason to change the agent's
    runtime.

## Three examples

### Email

- **In:** the mail refinery runs on a clock. Each message is a workspace row with its class and the
  fields read from it.
- **The tools:** the mail app publishes "new messages" and "one message". The extension behind them
  reads the rows (\`ctx.workspace.readRows\`), because the agent's own \`workspace\` tool reads records
  and not rows.
- **The agent:** runs on a clock after the refinery, or as the step of a workflow that starts on
  the new rows. It calls those tools (\`app_tools\`), and writes a reply draft and its own
  classification back (\`workspace_write\`).
- **The person:** reads the drafts in the app and presses Send. The app sends through the connected
  account.
- **The runtime gets no mail tool.**

### A calendar

- **The information:** events are records in a workspace. An outside calendar comes in as an ICS
  file, or an extension fetches an ICS feed on a clock.
- **The tools:** the app publishes "events between two dates", "free time" and "propose a booking".
  An extension that uses the calendar library's code is behind them.
- **The agent:** calls those tools (\`app_tools\`) and proposes times.
- **The person:** approves the booking in the app.
- **Out to the person's own calendar:** the approved bookings are published records of one records
  space, each in the event shape of \`aimeat-calendar\`. The node serves that space as a calendar
  feed: \`GET /v1/organisms/<id>/workspace/public/records?ws=<ws>&space=<space>&format=ics\`. The
  workspace's creator or an organism admin opens the space in the workspace share, and for a
  calendar that is not public sets the share to ask a password and makes a feed key
  (\`PUT /v1/organisms/<id>/workspace/share?ws=<ws>\` with \`{ "ics_key": true }\`); the answer shows
  the address with the key once, and the person pastes it into Google, Apple or Outlook calendar.
  A new key ends the old address. Whoever holds the address reads every event of the space, so
  opening a space and making a key is the person's decision: propose it, and do it only when they
  said so.
- **The runtime gets no calendar tool.**

### Meeting notes from a recording

- **In:** a person puts the recording into the app. The app transcribes it (\`aimeat-ai\`) and writes
  the text into a workspace.
- **The agent:** gets a task, reads the text, and writes the decisions, the tasks and who owns each
  as records.
- **The runtime gets no transcription tool,** because the app does that part.

## What is outside an extension's reach

- \`ctx.email\` sends through the node's mail service. A reply inside the person's own mail thread
  goes from the app through their connected account.
- An extension reads no mailbox. Mail reaches a workspace through the refinery.
- \`ctx.ai\` is a background call. Live speech and a live conversation do not go through it.
- Other work on the agent's computer (ffmpeg, a local file). That is the case where the runtime
  grows. A browser is such work and the runtime has it: the tool \`browser\`, which opens only the
  hostnames the agent's definition names in \`browser_domains\` and never sends a form (skill
  \`add-a-crew-agent\`, "A browser on the agent's computer").

## When you propose the agent

Skill \`add-a-crew-agent\` has the steps. Give each member only the tool ids its role needs, name
the workspace by its id and each app tool by its sku in the task description, and say in the
purpose which of the person's workspaces and apps the agent works on, in the names they use.

Ask for the scopes those tools use. An agent that calls an app tool needs \`ext:invoke\`: the tool
runs an extension action, and the node calls it with the agent's own token. From node 4.0.0 that
call is refused without the word; before it, the call works and its answer carries a
\`Deprecation\` header. An agent that reads a workspace needs \`organism:read\`, and one that writes
into it \`organism:write\` as well. **An app tool that reads or writes the app's workspace does it
as the agent that called it**, so the agent needs those same words for the tool to work: with
\`ext:invoke\` alone the call arrives and the tool answers that the workspace is not one the caller
can read. The home's new-agent page asks \`organism:read\` for every agent that calls an app tool;
a tool that saves something needs the reach that writes.
`,
};
