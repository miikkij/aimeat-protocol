/**
 * @file src/data/builtin-skills.find-my-app.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-find-my-app` built-in skill: how an AI finds one app among the hundreds a
 *   person has published, from what the person remembers of it ("the one that counted…, from the
 *   autumn"), and hands back the address to open it.
 *
 *   The tools were all there: aimeat_app_list searches the name, the description and the file name and returns the
 *   tags, the day of the latest version and the address; aimeat_usage_report apps-used returns the day
 *   the person last used each app (last_bucket). What was missing was the order to use them in, so an
 *   AI does not read 233 apps into the chat to find one, and does not answer with a file name when
 *   the person needs a link.
 * @structure FIND_MY_APP_SKILL_ENTRY
 * @usage
 *   import { FIND_MY_APP_SKILL_ENTRY } from './builtin-skills.find-my-app.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-omien-sovellusten-l-yt-minen-kun-niit-on-satoja).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const FIND_MY_APP_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-find-my-app',
    visibility: 'public',
    skillMd: `---
name: aimeat-find-my-app
description: How to find one app a person made on an AIMEAT node from what they remember of it (what it did, roughly when, a word in its name) and give them the address to open it. Use when someone asks where an app of theirs went, which app did something, or what they used last week.
license: MIT
metadata:
  audience: agent
---

# Finding one app among many

A person with hundreds of apps remembers what an app did and roughly when, not its
file name. Your job is to turn that memory into one address they can press.

## The answer you give

The app's name, one line on what it does, and its \`url\`. When there are two or
three candidates, list them the same way and say what tells them apart. Never
answer with only a file name: the person needs the link.

## Search first, with their words

1. \`aimeat_app_list\` with \`own: true\` and \`search\` set to the strongest word the
   person gave ("laskuri", "map", "recipes"). The search looks in the name, the
   description and the file name. Try a second word or the other language before you give up on it:
   people name apps in one language and describe them in another.
2. When they named a topic rather than a word, add \`tag\`.
3. Read \`created_at\` on each hit: it is the day of the app's latest version, so
   "the one I made in the autumn" and "the one I fixed last week" both narrow on it.

## When they remember using it, not making it

\`aimeat_usage_report\` with \`report: "apps-used"\` and \`from\` set far enough back
(it defaults to the last 30 days). Each row's \`dims.appId\` is \`owner/filename\`
and \`last_bucket\` is the last day the person used it. "The one I had open on
Tuesday" is the row whose \`last_bucket\` is that Tuesday. Join it to
\`aimeat_app_list\` by owner and filename to get the name and the \`url\`.

## When nothing matches

Read the whole own list (\`own: true\`, \`limit: 200\`, again with
\`offset += limit\` while \`has_more\` is true) and match on the description and the
tags yourself. Say how many apps you looked through. Keep the list out of the
chat: the person wants the one app, not the catalogue.

## Other people's apps

Without \`own: true\` the same search covers every app this person may open on the
node. Use it when they say "the one someone showed me".

## Where it shows on a screen

My Apps (\`/v1/appcat\`) shows the same thing: the apps opened most recently at the
top, and the person's own apps not opened nor changed in six months in a folded
section under the list. A search there looks through all of them.
`,
  };
