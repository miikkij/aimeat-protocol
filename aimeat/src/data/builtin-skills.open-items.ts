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
description: How to work a person's open items with them on an AIMEAT node — read the list, talk it through, ask about scope, wait for GO, and switch things off when they are done. Use when someone pastes the open-items prompt, asks what they have open here, or asks you to go through their list.
license: MIT
metadata:
  audience: agent
---

# Working someone's open items

Open items are one list of what a person is going to do on this node. They switch
things on where the thing is; you can switch them on and off too, and the surface
shows which of you did it. This is their list, not your queue.

## Read it

The whole list is ONE memory record in the owner's namespace:

- \`aimeat_memory_read\` with key \`open-items.list\` and \`owner_scope: true\`

The value is \`{ version, items: [...], closed: [...] }\`. \`items\` is what is open.
Ignore \`closed\`; it exists so the node can answer "does anything here get done".

Each item: \`id\`, \`title\`, \`kind\`, \`status\` (\`open\` or \`working\`), \`object\`,
\`prompt_ref\`, \`origin\`, \`by\` (\`person\` or \`ai\`), \`agent\`, \`closes_when\`.

**Say it in your own words.** Not JSON, not a table. If something has been open a
long time, ask whether it still matters — that is the only ageing this list has.

**Skip anything with \`closes_when\`.** Those are the node's own suggestions and
they disappear by themselves when their condition is true. Do not tick them off
and do not offer to.

## Talk it through, then wait

1. Ask which one to start with.
2. **Then ask at what depth.** This is always the first follow-up: the same title
   can mean twenty minutes or two days, and guessing wastes whichever one they
   did not want.
3. Ask what you actually need to know. Write the answers into their organism
   (\`aimeat_workspace_write\`) so nobody has to ask again next time.
4. Say what you are about to do.
5. **Do nothing until they say GO.** Not a summary they might read as consent —
   the word. This is the rule the whole surface exists for.

## Each kind goes a different way

There is no generic handling. What follows an item depends on what it is:

| \`kind\` / \`object.type\` | What to do |
|---|---|
| \`app\` | Building an app is a big piece of work with its own session. Do NOT start it in the middle of going through a list. Say so, and steer them to start it properly: \`aimeat_handbook_get\` for the app guide, then the app-building flow. |
| \`organism\`, \`workspace\` | Structure work. Read what exists first (\`aimeat_organism_overview\`), then propose, then GO. |
| \`document\`, \`knowledge\` | Usually doable here and now, once you know the depth. |
| \`memory\` | Read the record before proposing anything about it. |
| no kind | Ask what it is before anything else. Do not infer it from the title. |

If \`prompt_ref\` is set, fetch that prompt from \`/v1/prompts/<name>\` and follow it
rather than inventing your own approach: it is the node's current instruction and
it is corrected centrally.

## Switch something off when it is done

Read the key, remove that item from \`items\`, write it back:

- \`aimeat_memory_write\` with \`owner_scope: true\` AND \`expected_version\` set to the
  version you read.

**On \`VERSION_CONFLICT\`, read again and re-apply.** Somebody else wrote in between
— the person in their browser, or another agent — and overwriting them silently is
the one thing this list must never do. Never retry by dropping the version.

Do not switch off anything you were not asked to. Being wrong here deletes
something the person meant to keep.

## When something arrives as a task instead

If an item was handed to you, it arrives in your normal queue with
\`resources.memoryKeys\` carrying \`open-items.list#<id>\`. Work it as a task and
complete it normally; the node switches the item off on the evidence of the
completed task. Do not also write the list yourself.
`,
  };
