/**
 * @file src/data/builtin-skills.context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-context` built-in skill: how an AI opens, uses and shapes a person's
 *   contexts. A context is one memory record under `context.<slug>` whose form grows with use: a
 *   small core read first, optional concepts, references to other places with a line on when each
 *   is worth opening, contexts it includes or excludes, its own material, kept views and a
 *   lifecycle stamp.
 *
 *   WHY a skill and no new tool: the developer's ruling of 2026-11-08 starts with the smallest
 *   thing that can work, one record and the guidance to use it, and adds MCP tools only when the
 *   context eval suite (scripts/cold-agent/context-cases.ts) shows an AI cannot manage without
 *   them. Every rule below is something that suite measures. Two tools came later, because no
 *   memory read could do their work: aimeat_memory_history (earlier versions) and aimeat_context_check
 *   (a machine check across hundreds of records).
 * @structure CONTEXT_SKILL_ENTRY
 * @usage
 *   import { CONTEXT_SKILL_ENTRY } from './builtin-skills.context.js';
 * @version-history
 *   v1.3.0 — 2026-11-09 — When a context goes wrong: earlier versions and how to restore one
 *     (aimeat_memory_history), the machine check (aimeat_context_check); splitting a part off a large
 *     context into one the original includes; `module` names the ontology module.
 *   v1.2.0 — 2026-11-09 — `compose`: or, and, xor and not over other contexts, computed on
 *     ontology ids; references between ontology modules; an app's context wider than its spec.
 *   v1.1.0 — 2026-11-08 — Opt-in: a context starts only when the person asks for one; the AI no
 *     longer offers one when a topic repeats. A context that exists is still kept up to date.
 *   v1.0.0 — 2026-11-08 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const CONTEXT_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-context',
    visibility: 'public',
    skillMd: `---
name: aimeat-context
description: How to use and shape a person's contexts on an AIMEAT node. A context holds together something larger the person works on (a project, a long conversation with someone, a trip, a story world) in a form that grew with use. Use when the person asks about something they have been working on, says "make this a context" or "keep a context", "remember where we are with X", "what is open in X", or combines two things they work on.
license: MIT
metadata:
  audience: agent
---

# A person's contexts

A context is something larger the person keeps working on with their AI: a project, an
ongoing conversation with a colleague, a trip, a renovation, a story world. Its form is not
fixed in advance. It grows from what the conversations needed, and it is kept in the form
an AI understands best. The person sees it through you: when they ask, or through a view
you keep for them.

Each context is one memory record under the key \`context.<slug>\`, kept under the PERSON, not
under you, so that every AI they use reads and shapes the same one. Read it with
\`aimeat_memory_read\` and \`owner_scope: true\`; write it with \`aimeat_memory_write\`,
\`owner_scope: true\` and visibility \`owner\`. Writing under the person needs the
memory:write-as-owner permission: when the node asks for it, give the person the address it
answers with, and write again once they have allowed it. Never keep a second copy under
yourself: two copies drift apart, and the next AI reads the wrong one.

## What a context holds

\`\`\`json
{
  "type": "aimeat.context/v1",
  "name": "Lisbon trip",
  "summary": "One line: what this is, and when to open it.",
  "kind": "factual | creative | mixed",
  "ontology": "on | off | auto",
  "module": "vocab.ctx.lisbon-trip",
  "core": "Your compact picture: what this is about, where it stands, what is open. Read first.",
  "concepts": [{ "term": "release", "means": "the album coming out", "broader": "album", "replacedBy": null }],
  "references": [{ "ref": "memory:trip.flights", "what": "flight times", "openWhen": "flights or arrival come up" }],
  "includes": ["context:catering"],
  "excludes": ["context:health"],
  "material": "Notes, decisions and excerpts that do not belong in the core.",
  "views": [{ "ask": "a one-page status for Dan every Monday", "keep": "weekly", "last": { "at": "…", "text": "…" } }],
  "lifecycle": { "createdAt": "…", "shapedAt": "…", "readAt": "…" }
}
\`\`\`

Only \`type\`, \`name\`, \`summary\` and \`core\` are needed. The rest appears when the work
calls for it. A \`ref\` is \`memory:<key>\`, \`memory:<owner>/<key>\`, \`workspace:<org>/<ws>/<id>\`,
\`file:<key>\`, \`context:<slug>\`, \`organism:<id>\`, \`app:<id>\` or an https address.

## Opening a context

1. **Find it.** List the person's contexts with \`aimeat_memory_list\`, prefix \`context.\` and
   \`owner_scope: true\`, then read the ones whose name fits.
   Each summary says when that context is worth opening. Open the one the question is about.
2. **Read the core first,** and the concepts when there are any. Answer from them when you can.
3. **Open a reference only when its \`openWhen\` matches the question.** A context can point to
   dozens of places; open the one you need, not all of them.
4. **A reference does not give access.** You open its target with your own permissions. When
   the node refuses, tell the person you cannot open it and who holds it. Never fill the gap
   with a likely value.
5. **Included contexts** are part of this one: open them as you would a part of the core.
   **Excluded contexts** stay closed for this context's work: do not open them and do not mix
   what you know of them into the answer.
6. **Open each context once per answer.** When contexts include each other, stop at the one
   you already opened. Go at most three levels deep.

## Kinds: when inventing is the job

- **factual**: every claim you make comes from the context or a reference. When you reason
  beyond it, say so ("my reading", "a guess"). Where a concept or a line says it was
  \`replacedBy\` something newer, use the newer one.
- **creative** (a story, a game world): inventing is the work. Keep what the context already
  settled: its rules, its people, what has happened. A new scene may add anything that does
  not break those.
- **mixed**: treat each part by what it is.

## Shaping a context as you work

- **A context starts only when the person asks for one** ("make this a context", "keep a context
  of this"). Then create it at once, \`kind\` set by what it is, visibility \`owner\`. Do not offer
  one and do not start one on your own, however often a topic comes back.
- **A context that exists you keep up to date yourself** while you work in it, without asking
  each time.
- **When something new is settled**, write it into the context before the conversation ends.
  Read the whole record first and write it back whole, with \`expected_version\`, so nothing
  that was there is lost and nothing appears twice. Move what was open to what was decided.
  Mark a replaced fact with \`replacedBy\` instead of deleting it.
- **Keep the core small:** what someone needs in their first minute. When it grows past about
  a page, move detail into \`material\` or a reference.
- Stamp \`lifecycle.shapedAt\` when you change it.

## Concepts (the ontology)

\`ontology\` says what the person chose:

- **on**: keep \`concepts\` current: every term with a meaning of its own in this context,
  abbreviations, terms that mean something else elsewhere, and replaced terms.
- **off**: keep meanings in the core and material as plain sentences.
- **auto**: you decide. Add concepts when the context gets large, when it uses shorthand, when
  a term means something else in another of the person's contexts, or when another AI will
  read it. Otherwise leave them out.

A large context may keep its ontology as a module of its own: \`module\` names its key
\`vocab.ctx.<name>\`, whose index \`vocab.ctx.<name>.index\` lists the parts (each under 30 kB) and
when to read each. Read the index first and then only the part the question needs. Each
statement names its source: the record key, the date and a quote of 20 words or fewer.

## Combining, splitting, merging

- **Combining for an answer:** read both contexts and answer. Write the result only into the
  context the person names. What one context's readers may not see stays out of it.
- **Including and excluding** is the person's choice: add \`context:<slug>\` to \`includes\` or
  \`excludes\` when they say so ("the wedding plan includes the catering", "keep my health out
  of work").
- **Composing** goes further, when the person asks for it: \`compose\` is an expression over
  other contexts.
  \`\`\`
  expr := "context:<slug>" | { "or": [expr, ...] } | { "and": [expr, ...] }
        | { "xor": [expr, expr] } | { "not": expr }
  \`\`\`
  The context's own content always belongs to the result; \`includes\` is shorthand for \`or\`
  and \`excludes\` for \`not\`; in one object the operators apply in the order and, xor, or, not.
  On contexts with an ontology the operators work on ids, never on wording: **or** is
  everything any part holds; **and** keeps only what every part holds (the same registry
  person, group or app, or a concept one part references by id in the other); **xor** gives
  two lists, what only one side holds and what only the other holds; **not** keeps a context
  closed and out of the answer. Two items are the same when they share an \`@id\`, one names
  the other with \`skos:exactMatch\`, or both are ABOUT the same registry entity. Who decided
  or said them does not count: the person decides most things in every context. Without an
  ontology there are no ids: say that the comparison was made by reading.
  Typical uses: an app's umbrella context is its spec OR its research OR its marketing; "what
  do we promise that is not built" is marketing XOR spec; "what do these two matters share" is
  an AND.
- **References between ontology modules:** a concept may point at a concept in another
  context's module by its id. Follow it only into a context you may read and that the current
  one does not exclude; otherwise say there is a reference you cannot open, and never fill it
  in.
- **An app's context is wider than its spec.** Reference the app's own spec records (design
  spec, data map, roadmap, development notes) instead of copying them, so they stay current;
  keep work about the app that is not in the spec (marketing, research, sales) in contexts of
  their own that name the same app, and compose them.
- **Splitting or merging** two contexts happens on its own only when both have the same
  readers. When their readers differ, ask the person first: a merge can show one person's
  material to someone who was not given it.

## Views for people

The context is kept for an AI. A person gets a view: ask who it is for and write it in their
words, at their level, from the context. A view keeps the facts and changes only how they are
told. **It adds nothing the context does not say**: no weekday the context does not name, no
purpose of a meeting, no "still" or "as usual", no detail that would make the note read better.
If the reader needs something the context lacks, leave it out and tell the person what is
missing. When the person wants a view kept up to date, add it to \`views\` with \`keep\` and write
its newest text into \`last\`. For a view on a clock ("every Monday"), create a schedule of kind
\`ai\` over the context's key with \`aimeat_schedule_create\`, its prompt the view request, so the
node writes the view even when no AI is connected.

**The fingerprint** shows at a glance what a context is made of: which parts are fact, analysis,
opinion, instruction, decision or narrative, and what each rests on (+ a source, ~ a named person,
? nothing, x replaced). Make one when the person asks how solid a context is, or before you lean
on a factual context for something that matters: \`aimeat_content_inspect\` with
\`stages: ["profile"]\` on the context's key, after the person says yes, then
\`aimeat_content_facts\` to read it. In a factual context a large share of ? is worth saying first;
in a creative one, narrative is what you expect.

## Ageing

The list of contexts you receive when you connect marks a context nobody has shaped for a long
time, and one whose core has grown large. When such a context comes up, ask the person once:

- **keep** it: stamp \`lifecycle.shapedAt\`, and the mark goes away;
- **condense** it: rewrite the core to what still matters and move the rest into \`material\`;
- **split a part off**: when one part of it has grown into a matter of its own (a sub-project, one
  party, one period), move that part into a new context \`context.<slug>-<part>\` with its own name,
  summary and core, and its references and concepts. The original stays where it is, smaller, and
  names the new one in \`includes\`, so opening the original still reaches everything. Both keep
  the same visibility; tell the person the new name in one sentence;
- **archive** it: set \`lifecycle.archivedAt\` to now. An archived context leaves the list you
  receive on connecting and stays readable by its key; clearing \`archivedAt\` brings it back;
- **delete** it, only when they say so: \`aimeat_memory_delete\`, which they can still undo for a
  while.

For a large core, offer to move detail into \`material\` or to split a part off. Never archive,
condense, split or delete without their yes.

## When a context goes wrong

- **A wrong fact:** when the person says something is wrong, write the right one and mark the
  wrong one \`replacedBy\` (in an ontology, \`aimeat:status\` superseded and \`dcterms:isReplacedBy\`),
  with the source of the correction. Never delete the old statement.
- **A bad write:** every write to a context or its ontology keeps the version it replaced (the
  newest 50). \`aimeat_memory_history\` with the key and \`owner_scope: true\` lists them, each with
  what that write changed; with \`version\` it gives that version whole. To put one back ("restore
  yesterday's version"), say which version and what it changes back, and after the person's yes
  write its value with \`aimeat_memory_write\`, \`owner_scope: true\` and \`expected_version\` set to
  the current version. The version you replace is kept too, so the restore can be undone.
- **Is it still sound?** \`aimeat_context_check\` checks it by machine: references that no longer
  open, included or composed contexts that are gone, and with an ontology module, source quotes
  no longer found in their records, ids that name nothing, replacement chains that loop. Run it
  when the person asks how solid a context is, before you lean on it for something that matters,
  and after a large rewrite. Tell the person what it found in plain words, and fix what you can
  only with their yes. A context whose statements all name their sources can be rebuilt from
  those sources when too much has gone wrong.
- **What is it made of?** For a quick picture of the parts (fact, opinion, decision, narrative)
  make the fingerprint (below).

## Sharing

A context is shared like any record: with a person or an organism by consent, or into a
workspace. Including another context never shares that one too.

**Someone whose AI is not on AIMEAT** (a repair shop with its own ChatGPT, say) gets a link and a
ready prompt. Never open the context itself to the internet; give them a view made for them:

1. Ask what they may see, and for how long (two weeks if the person does not say).
2. Write that view as a Markdown page in one of the person's workspaces
   (\`aimeat_workspace_write\`, then \`aimeat_workspace_publish\`). Leave out excluded contexts,
   other people's material and anything the person did not agree to.
3. Share that one page: \`aimeat_workspace_share\` with \`space\`, \`id\`, \`access: "open"\` and
   \`until\`.
4. Hand the person two things to send: the page's plain-text address,
   \`<node>/v1/organisms/<org>/workspace/public/document?ws=<ws>&type=<space>&id=<id>&format=md\`,
   which any AI can read, and a short prompt: who this is from, what the reader's AI should do
   with it, and to answer by replying to the person's email.
5. When the reply arrives in the person's connected mailbox, read it (\`aimeat_mail_search\`,
   \`aimeat_mail_read\`), tell the person what it says, and write it into the context. Ask before
   you write a price, a date or a commitment.
6. When the context changes in a way the reader needs, update the page. When the work is done,
   stop the share (\`shared: false\`).

## Speaking about it

Say "your Lisbon trip", "what we have on the renovation", not "the context record" or its
key. Tell the person what changed in one sentence after you shape a context.
`,
};
