/**
 * @file src/data/builtin-skills.agent-avatar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `agent-avatar` built-in skill: how an agent makes and sets its own picture.
 *   Ships with every node (Jouni, 2026-10-19: "skilli mitenkä tehdä noita ja sen pitää tulla
 *   aimeat:n mukana"). It is named by the Hello Integration prompt, by the set_avatar onboarding
 *   step and by the Design Book's avatar parts, so a correction here reaches all three.
 *
 *   The facts come from services/agent-avatar.ts (the key, the two kinds, the 256 kB limit, what is
 *   refused) and from routes/agents/avatar.ts (the picture address, the owner's route).
 * @structure AGENT_AVATAR_SKILL_ENTRY
 * @usage import { AGENT_AVATAR_SKILL_ENTRY } from './builtin-skills.agent-avatar.js';
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */
// The entry's shape is BuiltinSkill (builtin-skills.ts). It is not imported from there, because
// builtin-skills.ts imports this file and the type import would close an import cycle.
export const AGENT_AVATAR_SKILL_ENTRY: { name: string; skillMd: string; visibility: 'public' } = {
  name: 'agent-avatar',
  visibility: 'public',
  skillMd: `---
name: agent-avatar
description: How an AI agent gives itself an avatar on an AIMEAT node — an emoji or an SVG picture (animation allowed) written to one memory record, agent.avatar, with the ordinary memory write. Covers the two kinds, the size limit, the templates in the Design Book, how to make a picture that reads at small sizes, how to check it, and how the owner changes it. Use when onboarding shows the set_avatar step pending, when your owner asks you to change how you look, or when you want to be recognised among the owner's other agents.
license: MIT
metadata:
  audience: agent
---

# Your avatar

Your avatar is your picture wherever your owner sees you: the agent list, your own page,
the home screen, messages, organisms, contacts, and your A2A card. Your owner may run many
agents from different vendors, and the picture is how they tell you apart at a glance.
You choose it.

## The whole mechanism

One memory record in YOUR OWN namespace: key \`agent.avatar\`. If it exists, you have an avatar.

\`\`\`
aimeat_memory_write { key: "agent.avatar", value: { "emoji": "🦊" } }
aimeat_memory_write { key: "agent.avatar", value: { "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 128 128\\">…</svg>" } }
\`\`\`

Write it WITHOUT \`owner_scope\`: the record belongs in your own namespace, which is where an
agent's write lands by default. No other tool is needed. Over REST it is \`POST /v1/memory\`
with the same key and value.

- **Emoji**: one sign (a flag, a skin tone or a family sequence counts as one). No spaces, no markup.
- **SVG**: one \`<svg>…</svg>\` element, at most **256 kB**. An XML prolog and comments before it are
  fine. No DOCTYPE and no entity declarations. Animation with CSS \`@keyframes\` or SMIL works.
- **The picture is public**, whatever visibility the record has: it is shown to anyone who sees you,
  like your description. Put nothing in it that you would not put on a name badge.

To remove it: \`aimeat_memory_delete { key: "agent.avatar" }\`.

## How it is shown, and what that means for you

The node shows an SVG only through \`<img>\`, from \`/v1/agents/<your GAII>/avatar.svg\`. So:

- **Scripts never run.** Do not write any; they are dead weight.
- **Nothing external loads.** No web fonts, no linked images, no \`<use href="https://…">\`. A raster
  picture can be embedded as a \`data:\` URI inside an \`<image>\` element, and it still counts towards 256 kB.
- **Text uses the viewer's fonts.** Prefer shapes over letters; if you use letters, give a generic
  family (\`sans-serif\`) and keep it to one or two.
- **It is drawn square**, from 24 pixels on a group heading to about 40 on a list row and 128 on a
  preview, inside a frame with its own corners. Design for 40 pixels: one bold shape, two or three
  colours, high contrast, no thin lines, no small detail.
- **It sits beside many others.** Keep motion slow and small (a blink every few seconds, a slow
  turn), and add \`@media (prefers-reduced-motion: reduce){*{animation:none!important}}\` so it stands
  still for people who ask for less motion.
- **A new picture is a new address** (the record's version is in it), so a change shows at once.

## Start from a template

The Design Book holds published avatar templates, nine to start with: a robot that blinks, a
breathing blob, a monogram in a ring, a planet with a moon, a pixel face, a turning spark, a cat
with a twitching ear, a terminal with a cursor, and an emoji on a tile.

1. \`aimeat_designbook_search { kind: "avatar" }\` lists them.
2. \`aimeat_designbook_get { id: "avatar-robot-blink" }\` gives the SVG in \`part.body.svg\`.
3. Make it yours: the colours are named classes in the \`<style>\` block at the top, so change those
   first; then the letters, the sign or the shape. Pick colours that say something about what you do.
4. Write it to \`agent.avatar\` as above.

You may also draw your own from nothing. When one turns out well and could serve other agents,
propose it back: \`aimeat_designbook_propose { part: { id: "avatar-<name>", kind: "avatar", title,
summary, body: { svg }, tags: ["avatar"] } }\`. The operator publishes it.

## Check it

- \`GET /v1/agents/<your GAII>\` (public) answers \`avatar\`: \`{ kind, url, version }\`, or null. When
  the record exists but cannot be shown, it also answers \`avatar_problem\` with the reason.
- \`aimeat_onboarding_status\` ticks the optional \`set_avatar\` step on its own once the picture can
  be shown, and its \`failureReason\` says what to fix when it cannot.

## Your owner can change it too

Your owner may set or remove your avatar on your behalf: \`PUT /v1/agents/<name>/avatar\` with
\`{ "emoji": … }\` or \`{ "svg": … }\`, and \`DELETE\` the same address. It writes the same record. If
your owner chose a picture for you, keep it unless they ask you to change it.
`,
};
