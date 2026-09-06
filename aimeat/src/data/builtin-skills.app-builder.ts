/**
 * @file src/data/builtin-skills.app-builder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-app-builder` built-in skill: the paved path for building and publishing
 *   an app on this node.
 *
 *   WHY IT MOVED OUT OF builtin-skills.ts, AND WHAT THAT FIXED. Seeding is create-if-missing, so a
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
description: Build and publish apps ON an AIMEAT node over MCP (the aimeat_* tools) or REST. The paved path for any "build/make/publish an app, game or tool on AIMEAT" request — fetch the canonical build spec first, research what already exists, build a single-file app from a template, verify, publish, and report the live URL. Use whenever an owner asks for an app on the node.
license: MIT
metadata:
  audience: agent
---

# Building AIMEAT apps

An **AIMEAT app** is a **single self-contained HTML file**. The node hosts it and serves it
on its own subdomain (e.g. \`https://<name>.apps.<node-domain>/\`). It logs the user in, reads
and writes their data, and uses node-hosted UI/AI libraries — all from \`<script>\` tags
pointing at the node. There is **no build step and no backend to write**: the node is the
backend. If you have the \`aimeat_*\` MCP tools, publish directly over MCP — you do not need
the web UI.

That holds for the node. Past roughly 300 kB it stops holding for YOU: one file is then expensive
to edit, and the fix is sources split behind a build step on your own machine that assembles the
same single file. Load \`node:aimeat-app-workstation\` when the app gets there, or when the publish
response's \`next_steps.size\` says so.

## The one rule that matters: fetch the canonical spec first

The node serves the **authoritative, always-current build-app specification** — the single
source of truth for available libraries, allowed script URLs, required \`<meta>\` tags,
auth/data APIs, and templates. **Before writing any app, fetch it and follow it exactly:**

\`\`\`
GET /v1/prompts/build-app        ← the spec (law; re-fetch every time, it changes)
GET /v1/app-templates            ← starter templates (start from one, do not invent structure)
GET /v1/appdev/pitfalls          ← curated "what bites app builders" registry
\`\`\`

Everything the app loads at runtime — CSS, auth, data, UI libraries — must be a URL
**listed in that spec**. Never invent script/style \`src\` URLs; they 404 and break the app.

**Carry the spec token.** The response includes \`spec_token\`, the digest of the spec you just
read. Pass it as \`spec_token\` on \`aimeat_app_publish\`; the publish answers \`spec_check\`
(\`ok\` | \`stale\` | \`missing\`), so a spec that moved under you says so instead of surfacing as a
broken app later. If the owner tells you to skip the spec, send \`spec_ack: "skipped-by-owner"\` —
that is recorded rather than silent.

## Research before building (research → frame → propose → build → finish)

Before writing code, look at what already exists on the node and reuse it. ONE call gives
the big picture: \`aimeat_appdev_overview\` (pass your OWN model id — you know which model you are; self-identify, never ask the user) — the owner's existing apps
and **template proposals** (often the fastest correct starting point: fork or copy their
patterns), library packs with per-model proofs, T1/T2/T3 templates, and the pitfalls
(curated + learned) for the areas you will touch. Drill down from there:
\`GET /v1/library-packs/{id}\` (per-pack AI doc), \`GET /v1/appdev/pitfalls\` (curated
registry), \`aimeat_appdev_pitfall_list\` (learned, model-filterable), \`aimeat_skill_list\`
\`binding=app:{owner}/{file}\` (how existing apps want to be driven).

Frame the build from the research (tier T1/T2/T3, packs, whether the app needs its own
users → the aimeat-iam pack for the gate + AIMEAT.iam for the panel, decided NOW; a role
belongs to the PERSON so a member's agents inherit it, and can() only paints while the extension
enforces), then **propose the frame in the person's own words, not the node's**. The section
below is what that means. If the user says to just build it the usual way, skip the research
and go.

## Say it in their words

Everything above is how the node thinks. None of it is how the person you are building for
thinks, and the proposal is the moment the two get confused. Three or four lines is the right
length. Length was never the problem.

**The test: could the person answer "yes, build that" without knowing a single AIMEAT word?**
If answering needs them to know what a tier is, what a pack is, or what a scope is, you have
described the machinery instead of the app.

Not this:

> T2 app, aimeat-iam pack for the gate, scopes \`memory:read memory:write\`, data under
> \`club.members.*\`, extension for the outbound call. Publishing to \`club.apps.aimeat.io\`.
> Confirm?

This:

> A page where your club members sign in and keep their own training log. Only they see their
> own entries; you see the whole list. It remembers everything on your own node, so nothing
> lives with anyone else. It will live at club.apps.aimeat.io. Shall I build it?

The second one names what they get, who can see what, where it lives, and what they are
agreeing to. The first names five things they cannot judge.

**A term from the node's vocabulary carries its meaning in the same sentence, or it does not
appear.** "Scopes memory:read and memory:write" says nothing; "it can read and write the notes
you keep here, and nothing else" says the same thing and can be argued with. Say the plain
sentence first; the identifier, if it earns its place at all, comes after it as evidence.

**When something stops, say what you are doing about it, not that it stopped.** A refused
publish is your problem to solve, and the response tells you how. Three rungs, in order:

1. **Fix it and carry on.** \`APP_ARTIFACT_BROKEN\` names the finding and the pitfall id. Fix,
   publish again, and tell the person only the outcome. They do not need the round trip.
2. **Ask one question, in plain words**, when only they can decide: what it should be called,
   who should see it, whether to pay for something. One question, not a list of options with
   their internal names.
3. **Report it to \`support@operators\` with \`aimeat_dm_send\`**, when something on the node is
   not working the way it should. Say what you were doing and what happened instead. The
   people who run the node answer in that thread, and what you report is how the node gets
   better. Then tell the person plainly: this is not something they did, it is being looked
   at, and here is what still works meanwhile.

Never leave a person holding an error code. If you cannot finish, the last thing you say is
what they can do now, not what failed.

## Finish — this is where the acceleration compounds

After a successful publish (the publish response's \`next_steps\` shows what is missing):
1. Publish the app's **agent face** + bind a **skill** (\`metadata.binding\`
   \`app:{owner}/{filename}\`) so the app is agent-facing by default. Write that skill for
   whoever will USE the app, in the same plain register as the proposal, because it is read by other
   people's agents, not by you.
2. If anything generalizes, record a template: \`aimeat_app_template_propose\`
   (your own model id required — self-identify) — the next build starts from it.
3. Report what bit you: \`aimeat_appdev_pitfall_report\` (model required; upserts by slug;
   \`share: true\` publishes it platform-wide) — the next builder skips your mistake.

## Workflow

1. **Fetch the spec** (above). Skim the templates; pick the closest one.
2. **Build one HTML file.** Single file, no bundler. Include the required meta tags the
   spec lists (at minimum \`aimeat-app\` + \`aimeat-scopes\`, plus \`aimeat-ai\` when the app
   generates content). Use
   \`AIMEAT.auth.mountLoginButton(...)\` + \`AIMEAT.auth.login()\` for sign-in,
   \`AIMEAT.data.get/set(key, value, { visibility })\` for storage, and the node UI helpers.
   Respect the light/dark theme via \`data-theme\` + CSS variables — never hardcode colors.
3. **Verify locally before publishing.** Syntax-check the inline JS, then verify the script
   tags resolve to real node URLs. Use a check that names the file explicitly:
   \`\`\`bash
   node -e 'const f=process.argv[1],s=require("fs").readFileSync(f,"utf8");new (require("vm").Script)(s,{filename:f});console.log("parsed:",f)' app-script.js
   \`\`\`
   Do **not** use bare \`node --check $VAR\`: with an empty or unset variable it reads empty
   stdin, parses that, and exits 0 printing nothing — which reads exactly like a pass for a
   file nobody looked at.
4. **Publish over MCP.** \`aimeat_app_publish\` (with \`spec_token\`) — for any file over ~1 KB
   use **presigned upload** (omit the content param → PUT the raw HTML to the returned
   \`upload_url\`). Re-publishing the same \`filename\` bumps the version — it does not duplicate.
   The node checks the bytes and **refuses** two things outright: an inline \`<script>\` that does
   not parse, and a script/stylesheet URL it answers 404 for. Both come back as
   \`APP_ARTIFACT_BROKEN\` with a pitfall id per finding — fix and publish again. Anything else it
   notices (theme tokens, the head declarations, unscoped reads of agent-written data) arrives as
   \`app_hints\` on a successful publish; read them, they are the same three defects that put a
   broken app live on 2026-08-11.
5. **Return the live URL** and confirm with \`aimeat_app_list\` if unsure. One line: what it is,
   and the address. The version number, the tier and the packs you used are yours, not theirs.

## When the app generates content, say so — it is two lines

An app that generates text, images, audio or video is, in EU AI Act terms, a system whose
PROVIDER is the app owner. You do not have to read the law; the SDK carries it:

\`\`\`javascript
const r = await AIMEAT.ai.complete({ app_id: 'my-app', prompt });
render(r.content);
AIMEAT.ai.disclose(r.provenance, { target: '#ai-label' });   // official EU label, your theme
await AIMEAT.data.set(key, AIMEAT.ai.declare(item, r.provenance));  // record follows the content
AIMEAT.ai.chatNotice({ target: '#chat-top' });               // a chat says so first thing
\`\`\`

Declare it in the head so the catalogue can show it:
\`<meta name="aimeat-ai" content="generates=text,image; discloses=yes; public-interest=no">\`.
\`disclose()\` draws nothing when no label is owed — the node decides, you pass the object.
Publishing warns (never blocks) when an app asks for \`ai:use\` and says nothing at all, and the
warning names the exact call to add.

**Emotion, mood, attention or any biometric inference about a person** is the app owner's OWN
duty to declare to the people exposed, in their own words, before the inference happens.
\`AIMEAT.ai.chatNotice({ title, body })\` renders your wording; it cannot write it for you.

## When the app needs external data (an extension)

A third-party API call belongs in an **AIMEAT extension** (sandboxed server-side function),
not in the browser: it owns its \`ext:<name>\` memory namespace, makes outbound HTTP via
\`ctx.fetch()\`, and exports actions as \`export default async function (ctx, input) {...}\`.
The app reads it **through** the node's cortex libs, never directly. Most apps need NO
extension — just auth + data + UI libs.

**A key for that API is named, never held.** The app never asks for, stores or sends one; the
extension writes it into the outbound header as \`{{secret:NAME}}\`, and the node fills it from
the signed-in person's own vault on the way out (a missing name fails as \`SECRET_UNKNOWN\`,
naming it, with nothing sent). What the app owes the person is the NAME and where it goes: their
Access page, section 04 Secrets, or their own AI (\`aimeat_secret_set { name, value }\`, behind
the \`secrets:manage\` scope the owner ticks per agent; \`aimeat_secret_list\` shows names and
who used them, never a value). Show a missing key by its name in the UI; never draw a field for it.

## Do / Don't

- **Do** fetch \`/v1/prompts/build-app\` every time — it is canonical and it changes.
- **Do** research existing apps/packs/pitfalls first; start from a template.
- **Do** verify locally, publish over MCP (presigned for >1 KB), hand back the live URL.
- **Do** call \`AIMEAT.ai.disclose()\` and declare \`aimeat-ai\` in any app that generates content.
- **Do** propose and report in words the person can judge without knowing how the node works.
- **Do** send it to \`support@operators\` when the node itself misbehaves, then tell the person
  what still works.
- **Do** load \`node:aimeat-app-workstation\` once an app is past roughly 300 kB — assets out of
  the source, sources split behind a build step, and an edit loop that stays affordable.
- **Don't** invent library/script URLs or reference files the spec doesn't list.
- **Don't** build a separate backend, a bundler, or a multi-file app.
- **Don't** hardcode brand colors or bypass the AIMEAT auth/data/UI libraries.
- **Don't** hand back a tier, a scope list, a pack name or an error code as if it were an answer.
`,
};
