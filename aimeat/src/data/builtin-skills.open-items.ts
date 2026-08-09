/**
 * @file src/data/builtin-skills.open-items.ts
 * @description The `aimeat-open-items` built-in skill: how an agent works someone's open-items list
 *   with them.
 *
 *   Its own file because builtin-skills.ts reached the 800-line limit, and because this one is
 *   maintained on a different rhythm than the rest. It is named by /v1/prompts/open-items, which is
 *   where a chat is told to fetch it, so the per-kind detail and the GO rule get corrected here and
 *   the correction reaches every copy people have already pasted into their chats. A skill nobody
 *   can update centrally is a prompt with extra steps.
 * @structure OPEN_ITEMS_SKILL_ENTRY
 * @usage
 *   import { OPEN_ITEMS_SKILL_ENTRY } from './builtin-skills.open-items.js';
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial.
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const OPEN_ITEMS_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-open-items',
    visibility: 'public',
    skillMd: `---
name: aimeat-open-items
description: How to work a person's open items with them on an AIMEAT node — read the list, draft first, ask little, wait for GO, and switch things off when they are done. Use when someone pastes the open-items prompt, asks what they have open here, or asks you to go through their list.
license: MIT
metadata:
  audience: agent
---

# Working someone's open items

Open items are one list of what a person is going to do on this node. They switch
things on where the thing is; you can switch them on and off too, and the surface
shows which of you did it. This is their list, not your queue.

## THE ONE RULE THAT MATTERS MOST

**Produce something before you ask a third question.** A session that ends with
six answered questions and nothing written is a failed session, and it is the
failure this skill exists to prevent. Measured on a real one: five rounds of
questions, zero output, and every answer lost when the conversation ended.

## Read it

The whole list is ONE memory record in the owner's namespace:

- \`aimeat_memory_read\` with key \`open-items.list\` and \`owner_scope: true\`

The value is \`{ version, items: [...], closed: [...] }\`. \`items\` is what is open.
Ignore \`closed\`; it exists so the node can answer "does anything here get done".

Each item: \`id\`, \`title\`, \`kind\`, \`status\`, \`object\`, \`prompt_ref\`, \`origin\`,
\`by\`, \`agent\`, \`closes_when\`.

**Say it in your own words.** Not JSON, not a table.

**Skip anything with \`closes_when\`.** Those are the node's own suggestions and
they disappear by themselves when their condition is true.

## The order of questions is fixed

1. **Which one.**
2. **What is it**, if \`kind\` is null. Many items are born from a card click and
   carry the card's own words as their title, so the title tells you nothing.
   Do not infer it.
3. **At what depth.** Not before you know what it is: "small, done today" means
   nothing about an object you have not identified, and asking it first wastes
   the answer.

That is the whole interrogation. **Two rounds, then you draft.**

## Then write, before anything else

As soon as you know the kind and can write one sentence about it, **write the
draft**. Not after GO — a draft is not doing, and GO is for acting.

- \`aimeat_workspace_write\` into their organism, into the space this kind belongs
  in (\`aimeat_organism_overview\` tells you which spaces exist).
- Everything they told you goes in it. Six answers held in a conversation are six
  answers lost when it ends.

**WHAT YOU DO NOT KNOW IS NOT A QUESTION. IT IS AN OPEN LINE IN THE DRAFT.**

    OPEN: does this replace the existing block builder, or sit beside it?
    OPEN: who is it for?

That is how the records on this node are already written, and it is why they get
finished. A question in a chat costs the person a round trip and evaporates; an
OPEN line in a draft is somewhere they can answer later, or not at all.

## Research feeds the draft, not the questions

Reading what already exists is right, and it stays right. But what you find goes
**into the draft** — as context, as an OPEN line, as a paragraph saying what this
overlaps with. It does not come back as another question. A session where the
research produced three more questions and no document spent the person's time to
make itself better informed.

## A contradiction is raised ONCE

If what they want conflicts with something on the node, say so once, plainly, in
one or two sentences. **Their answer closes it.** Do not accept the answer and
then ask for its reasoning in the same message: that is the same question again
wearing a different hat, and it reads as not being believed.

## Then wait

Tell them what you are about to do, and **do nothing until they say GO.** Not a
summary they might read as consent — the word. The draft is already written by
then, so GO is about acting on it rather than about starting to think.

## Each kind goes a different way

| \`kind\` / \`object.type\` | What to do |
|---|---|
| \`app\` | Building an app is a big piece of work with its own session. Do NOT start it here. Write the draft, say plainly that it needs its own run, and point them at it: \`aimeat_handbook_get\` with surface \`appdev\`. |
| \`organism\`, \`workspace\` | Read what exists first (\`aimeat_organism_overview\`), then draft, then GO. |
| \`document\`, \`knowledge\` | Usually doable here and now, once the draft exists. |
| \`memory\` | Read the record before proposing anything about it. |
| no kind | Ask what it is. That is question two, and it comes before depth. |

\`prompt_ref\` names a prompt the node serves. **You probably cannot fetch it over
MCP**, and that is a known gap rather than something to work around: use
\`aimeat_handbook_get\` for the app and appdev guidance, and otherwise proceed
without it. Do not tell the person to go and fetch it for you.

## Switch something off when it is done

Read the key, remove that item from \`items\`, write it back:

- \`aimeat_memory_write\` with \`owner_scope: true\` AND \`expected_version\` set to the
  version you read.

**On \`VERSION_CONFLICT\`, read again and re-apply.** Somebody else wrote in between
and overwriting them silently is the one thing this list must never do. Never
retry by dropping the version.

Do not switch off anything you were not asked to.

## When something arrives as a task instead

If an item was handed to you it arrives in your queue with
\`resources.memoryKeys\` carrying \`open-items.list#<id>\`. Work it as a task and
complete it normally; the node switches the item off on that evidence. Do not
also write the list.
`,
  };
