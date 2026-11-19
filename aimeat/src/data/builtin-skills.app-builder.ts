/**
 * @file src/data/builtin-skills.app-builder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-app-builder` built-in skill, RETIRED since 2026-11-19: it was the Classic
 *   track's paved path, and now sends every build to node:aimeat-app-builder-atelier.
 *
 *   WHY IT MOVED OUT OF builtin-skills.ts, AND WHAT THAT FIXED. Seeding was create-if-missing then
 *   (it now updates a copy nobody edited, by fingerprint: services/skill/seeds.ts), so a
 *   built-in skill has two places it can be edited and no reconciliation between them: the repo,
 *   which never reaches a node that already has the skill, and the node itself, which never comes
 *   back here. Both happened. On 2026-08-16 the node's copy gained a whole section — "Say it in
 *   their words", the plain-language proposal rule with its two examples, and the three-rung
 *   escalation ending at support@operators — and the repo never learned about it. On 2026-08-25 the
 *   repo gained a pointer to node:aimeat-app-workstation and the node never learned about that. The
 *   node's copy was 11 513 bytes, the repo's 8 622, and a republish in either direction would have
 *   silently deleted the other side's work.
 *
 *   THIS FILE IS THE MERGE, and the reason it is a file: builtin-skills.ts sat at 789 of its 800
 *   lines, so the section could not come home while the skill lived inline. The text below is the
 *   node's copy, verbatim, plus the workstation pointer.
 *
 *   KEEP IT THE SUPERSET. If this skill is edited on a node again, bring the change here before
 *   republishing, or the next republish is the deletion this file exists to document.
 * @structure APP_BUILDER_SKILL_ENTRY
 * @usage import { APP_BUILDER_SKILL_ENTRY } from './builtin-skills.app-builder.js';
 * @version-history
 *   v2.0.0 — 2026-11-19 — RETIRED with the Classic track (decision-atelier-is-the-only-app-build-
 *     guide-classic-and-t1-t2-t3-are). The skill keeps its name, because prompts and models ask for
 *     it, and says only where to go: node:aimeat-app-builder-atelier, the platform sections, and
 *     section from-classic for an app built on Classic. Its sections that hold on any track (the
 *     model, saying it in their words, the publish checks, what a finished build leaves, the AI
 *     label and capabilities, dates and numbers, the workstation) moved, word for word, to
 *     builtin-skills.app-builder-common.ts, which the Atelier skill carries. The Classic
 *     specification, templates, workflow and extension sections went with the track.
 *   2026-11-08 — "Which model builds it" says the model rule by quality (MODEL_QUALITY_ADVICE), never
 *     by name (Jouni).
 *   2026-11-08 — The description's first sentence says a new app is built with
 *     aimeat-app-builder-atelier: the handbook's skill list shows the first sentence only, and the
 *     old one named the Classic track and nothing else (instruction audit 2026-11-08).
 *   2026-11-07 — The extension section says when server-side work outgrows an extension and points at
 *     aimeat_appdev_overview's `microservices` and aimeat-extension-builder section 11.
 *   (2026-11-04) A new app is sent to the Atelier track; Classic stays for an app already on it.
 *   v1.12.0 — 2026-10-30 — The structure page's first write carries two or three layouts drawn for the app (proposals).
 *   v1.11.0 — 2026-10-29 — A new app's first message carries its structure page (services/app-structure.ts):
 *     a cold Opus run that read this skill and not the Atelier one never opened it (1 of 3 runs).
 *   v1.10.1 — 2026-10-21 — A key is stored "for host X": the app tells the person the name and the
 *     host, and the extension declares both in `uses_secrets` (secaudit 2026-10, v58 and v59 follow-up).
 *   v1.10.0 — 2026-10-11 —Do / Don't: the node tells the screen when its data changed, and a timer
 *     is kept for data that has no event (build-events-first.ts says what happened without it).
 *   v1.9.0 — 2026-10-10 — The finish has a fifth step, the data map, and names when an app is
 *     finished: the four things next_steps shows present (face, bound skill, data map, design spec).
 *     An app reached version 4 with the first two and without the last two (Jouni, 2026-10-10).
 *   v1.8.0 — 2026-10-02 — The app's design spec: read it in the research step on an app that exists,
 *     write it back as the fourth step of the finish (services/app-design-spec.ts).
 *   v1.7.0 — 2026-10-01 — "Which model builds it": on any model but Claude Opus or Fable, the first
 *     message about the app says once that those build the better app. Cold-agent build-app on
 *     2026-10-01: Opus 5.5 3/3, Sonnet 5.5 (claude.ai's free plan) 1/3.
 *   v1.6.1 — 2026-10-01 — The framing line on an app's own users names the node roster and a gate from
 *     aimeat_iam_define instead of the aimeat-iam pack.
 *   v1.6.0 — 2026-09-28 — A section on the AI capabilities: capabilities() first, ask for the
 *     capability, models= and prefer.* in the meta, the price first (System 2 plan, V5).
 *   v1.5.0 — 2026-09-19 — The track comes first. This skill is where a "build me an app" request
 *     lands, and it did not contain the word Atelier: a builder who followed it never learned the
 *     track existed, and one who began on Atelier found a guide that needed HTTP and a Classic
 *     shell that did not. A model told the developer exactly that after handing him a Classic app.
 *     Added, above everything else: a new app is built on Atelier, what Classic is still for, that
 *     "quicker to start" is not a reason, and that a track is not changed mid-build.
 *   v1.4.0 — 2026-09-18 — Says how a chat connected over MCP reads the spec. The skill named three
 *     GET calls and nothing else, and an MCP-only chat can make none of them: six of six cold-agent
 *     build runs asked the handbook tool for `build-app`, were told "Prompt not found", and built
 *     without the spec this skill calls law.
 *   v1.3.0 — 2026-09-13 — A word is not a unit: fmt.relative and fmt.duration follow the LANGUAGE,
 *     and the {n}-key trap is named, because it is the repair every app author reaches for first.
 *   v1.2.0 — 2026-09-12 — "Dates, times and numbers: never from the language". The app-side half of
 *     the ruling that language, regional format and time zone are three settings; AIMEAT.fmt is
 *     what an app calls, and the moment-versus-calendar-date distinction is stated because getting
 *     it wrong produces a wrong DAY rather than a wrong format.
 *   v1.1.0 — 2026-09-06 — The extension section says a key is named as `{{secret:NAME}}` and
 *     filled from the person's vault, and what the app tells the person instead of drawing a field.
 *   v1.0.0 — 2026-08-25 — Extracted from builtin-skills.ts (max-file-lines) and merged with the
 *     node's diverged copy.
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const APP_BUILDER_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-app-builder',
    visibility: 'public',
    skillMd: `---
name: aimeat-app-builder
description: Retired, so load aimeat-app-builder-atelier instead, for every app, game or tool, new or changed. The Classic build track this skill described was retired on 2026-11-19, and this skill only says where to go and how an app built on Classic moves.
license: MIT
metadata:
  audience: agent
---

# The Classic track is retired: build with Atelier

The Classic build track (daisyUI pages, a hand-written sign-in, the T1/T2/T3 shells
\`shell-pure-client\`, \`shell-cortex\` and \`shell-extension\`) was retired on 2026-11-19. There is
one build guide on this node now.

**Load \`node:aimeat-app-builder-atelier\` (\`aimeat_skill_get\`) and follow it.** It is the guide for
a new app and for changing an existing one, whatever the app was built with. Its specification is
\`aimeat_handbook_get { tier: "build-app-atelier" }\` in parts (over HTTP
\`GET /v1/prompts/build-app-atelier\`), and its part \`platform\` lists what only some apps need: a
team sharing data, files, AI, anonymous intake, people without an account, server-side work.

**An app built on Classic** (it loads \`/lib/aimeat-daisyui-bridge.css\`, boots its sign-in with
\`AIMEAT.auth.onSession\`, or declares \`<meta name="aimeat-track" content="classic">\` or no track)
is changed with the Atelier guide and moved with the specification's section \`from-classic\`
(\`aimeat_handbook_get { tier: "build-app-atelier/from-classic" }\`). It gives the owner two ways:
move the app now, or put it inside the Atelier shell and keep the old markup in one section until
it moves. Either way the filename and every memory key stay, so the address and the data stay.

**The old addresses still answer.** \`GET /v1/prompts/build-app\` and \`aimeat_handbook_get { tier:
"build-app" }\` now serve the Atelier specification behind a notice that says so. A prompt that
names them still reaches the right guide.
`,
};
