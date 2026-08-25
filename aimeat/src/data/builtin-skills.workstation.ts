/**
 * @file src/data/builtin-skills.workstation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-app-workstation` built-in skill: how a serious app is kept from a
 *   developer's own machine once it is too big to edit as one file in a chat.
 *
 *   WHY IT EXISTS, WITH THE MEASUREMENT. An app on this node is one HTML file, and `aimeat-app-builder`
 *   says so in its first paragraph — correctly, because that is what the node serves. What nobody
 *   said is what to do when that file reaches 3.18 MB: 43 213 lines, 1550 functions, 477 kB of
 *   base64 images inlined into the source, one line 294 490 characters long. Its author's small
 *   changes went from about five minutes to about forty over two days, and the cause was in his
 *   file rather than in the node — the median app here is 39 kB and the second largest is 0.64 MB.
 *   The publish response now measures this (services/app-size-health.ts) and its `note` names this
 *   skill, so this is where the measurement leads.
 *
 *   WHY A SKILL RATHER THAN MORE BUILD PROMPT. /v1/prompts/build-app is 89 kB and grew 21% in one
 *   week; every session pays for all of it. This applies to a minority of apps and to agents running
 *   on somebody's own machine, so it is loaded when it applies and costs nothing when it does not.
 *   The build prompt carries one line pointing here.
 *
 *   WHAT IT MUST NOT CONTRADICT. The published artefact is still ONE self-contained HTML file with
 *   no module system and no external CDN. The build step is on the author's machine and produces
 *   exactly that file. Any wording suggesting the node runs a build is wrong.
 *
 *   Its own module because builtin-skills.ts is at 777 of its 800 lines, the same reason
 *   builtin-skills.hatchery.ts and builtin-skills.open-items.ts are separate.
 * @structure WORKSTATION_SKILL_ENTRY
 * @usage
 *   import { WORKSTATION_SKILL_ENTRY } from './builtin-skills.workstation.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. Written from the drum-slicer measurement and from the build
 *     pipelines that already keep four apps in aimeat-apps small.
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const WORKSTATION_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-app-workstation',
    visibility: 'public',
    skillMd: `---
name: aimeat-app-workstation
description: Keep a large AIMEAT app fast to work on from your own machine — sources split into files, a build step that assembles the one HTML file the node serves, images in storage instead of inlined, and an edit loop that does not re-read the whole app to change one function. Use when an app is past about 300 kB or a few thousand lines, when edits have started taking much longer than they used to, or when a publish response's size note points here.
license: MIT
metadata:
  audience: agent
---

# Working a big app from your own machine

You are reading this because the app is large, or on its way. The published artefact does not
change: the node serves **one self-contained HTML file**, no module system, no external CDN. What
changes is where you keep the sources and how you edit them.

## Why it slows down, in numbers

An AI edit costs what has to be READ to make it. One file holds everything, so as it grows every
round trip grows with it, and nothing announces the moment it stopped being cheap.

The app that this skill was written from: **3.18 MB, 43 213 lines, 1550 functions**. Inside it,
**477 kB of base64 images** and **one line 294 490 characters long** — a grep that touches that
line puts about 70 000 tokens into the conversation in a single tool result. Small changes had gone
from roughly five minutes to roughly forty over two days. The node was answering in 173 ms
throughout, and another author built a whole app the same day at a 13-minute publish rhythm.

Three things caused it, and all three are fixable without redesigning the app.

## 1. Get the assets out of the source

**Never inline an image, font or sample as a data URI in the app.** Upload it once and reference
the URL. App origins allow \`img-src *\`, so a node URL loads fine.

\`\`\`
aimeat_storage_upload   key: "myapp/logo.png", visibility: "public"
→ reference it as  https://<node>/v1/pub/<your-ghii>/myapp/logo.png
\`\`\`

Assets are usually most of the weight, they never change while the code does, and every publish
re-uploads them for nothing. This is the single cheapest thing on this page.

## 2. Split the sources, build the one file

Keep the app as files you can point at, and let a script assemble the artefact:

\`\`\`
myapp/
  src/
    index.html        the shell, with markers where code goes
    engine/*.js       the parts, one concern per file
    ui/*.js
  build.mjs           assembles dist/myapp.html
  publish.mjs         uploads dist/myapp.html to the node
  dist/myapp.html     the built artefact — the ONLY thing published
\`\`\`

\`build.mjs\` concatenates the parts into the marker in the shell, then checks the result. Two guards
earn their place immediately, because both failures are invisible without them:

- **\`node --check\`** on the assembled script. A syntax error otherwise ships and shows up as a
  blank page.
- **a size line printed on every build**, next to the ceiling the node accepts. A number you see
  every build is a number that never surprises you.

A third is worth adding as soon as more than one file can define the same name: fail the build when
a top-level declaration appears twice. Concatenation makes the LAST one win, silently.

Add \`--check\` mode: build into memory and exit non-zero if \`dist/\` differs. That is what stops a
published artefact from drifting away from the sources it claims to come from.

The starter is on the node: \`GET /v1/app-templates/workstation-project\` — build, publish and
verify scripts with the guards already in them. Copy it rather than writing your own.

## 3. Edit like the file is big, because it is

- **One change per round.** A list of five changes makes the agent traverse five times as much of
  the app. Ask for one, verify it, then the next.
- **Point at the place.** Name the function or the source file. "In \`renderHitList\`" costs a
  fraction of "somewhere in the app".
- **Never re-read the whole file to make a small change.** Search for the function, read that
  region, edit that region.
- **Keep tool output small.** A verification script that returns 40 rows of JSON puts 40 rows into
  the conversation. Return the three that answer the question.
- **Watch for one enormous line.** \`awk '{ print length }' file | sort -rn | head\` finds it. If a
  single line is longer than a few thousand characters, it is an inlined asset (see 1).

## Publishing what you built

Anything over about 1 kB goes up presigned rather than inline, and a built app is always over it:

\`\`\`
POST /v1/apps   { filename, mode: "presigned", name, description, spec_token }
→ upload_url
PUT <upload_url>   Content-Type: text/html   --data-binary @dist/myapp.html
\`\`\`

Read \`next_steps.size\` in the answer. It carries the bytes, the share of this node's ceiling, how
fast the app is growing and the date that rate meets the ceiling. When it grows and you did not add
much, something was inlined.

## What does NOT change

- The app is still one HTML file: no imports at runtime, no bundler output with module syntax, no
  CDN. Everything it loads is a URL the build spec lists (\`GET /v1/prompts/build-app\`).
- The build step is **yours**, on your machine. The node does not build anything; it serves what
  you publish.
- Everything in \`aimeat-app-builder\` still applies — the spec first, research before building,
  the agent face and the bound skill after publishing.

## When you have finished a change

Drive a real browser at 390x844, 1280x900 and 1280x460 in both themes. A build that compiles is not
a screen that works, and at this size the thing you broke is usually somewhere you did not look.
`,
};
