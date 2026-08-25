/**
 * @file src/services/prompt-defaults/surface-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt an operator copies into their own AI chat to arrange one of this node's
 *   pages, for the operators whose AI cannot reach this node over MCP.
 *
 *   IT RANKS UNDER THE TOOLS, NOT BESIDE THEM. An operator whose AI is connected asks it directly
 *   and aimeat_surface_layout_set does the work. This is the road for everyone that cannot: a
 *   consumer Gemini app, Copilot without Copilot Studio, ChatGPT without a paid developer mode. It
 *   is free, AI-agnostic, and the operator reads the JSON before anything is sent.
 *
 *   THE MOVING HALF IS GENERATED, NOT WRITTEN. `{{block_catalog}}` and `{{current_layout}}` are
 *   filled from the registry and the stored layout when the prompt is served, so the vocabulary an
 *   AI is handed is the vocabulary the validator will accept. A hand-written block list would drift
 *   the first time a block was added, and the operator would read the resulting refusal as "the AI
 *   is broken".
 *
 *   FORCE-SYNCED, and prompt-seeder.ts names it in `syncIds` for that reason. This describes a
 *   machine contract rather than the operator's own words: a node still serving last month's
 *   description hands an AI names this node no longer has. `operator-welcome` beside it is
 *   seed-once for the opposite and equally correct reason.
 * @structure SURFACE_LAYOUT_SEEDS
 * @usage import { SURFACE_LAYOUT_SEEDS } from './surface-layout.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { PromptSeedEntry } from '../prompt-defaults.js';

export const SURFACE_LAYOUT_SEEDS: PromptSeedEntry[] = [
    {
        id: 'surface-layout',
        group: 'portal',
        name: 'Page Layout Editor',
        description: 'The prompt an operator pastes into their own AI to arrange a page on this node.',
        content: `# Arranging a page on {{node_name}}

You are helping the person who runs this installation decide what one of its pages shows.
They will paste your answer back into the admin screen, so what you produce has to be
exactly right and nothing else.

## Which page

You are working on: **{{surface}}**

- \`portal\` — the public front page. Anyone can see it, signed in or not.
- \`home\` — the page a member lands on once their account is set up.
- \`home-onboarding\` — what someone sees while they are still setting up.

## The blocks this installation can put there

Use these and only these. A name that is not on this list is refused, and so is a setting
a block does not declare.

{{block_catalog}}

## How it is arranged now

{{current_layout}}

## What to give back

One JSON object, nothing around it, no explanation before or after. This REPLACES the page
rather than merging into it, so include every block that should stay.

\`\`\`json
{
  "layout": {
    "{{surface}}": {
      "v": 1,
      "blocks": [
        { "id": "a.block.id", "key": "a.block.id" },
        { "id": "another.block", "key": "another.block", "props": { "setting": "value" } }
      ],
      "meta": { "note": "One line on what this change was for." }
    }
  }
}
\`\`\`

Each block is \`{ "id", "key" }\`. The key is that block's own name within the page; use the
id unless the same block appears twice, and then give each one a key of its own. \`props\`
holds only the settings that block declares. \`titles\` gives it your own heading, per
language: \`{ "en": "Who to ask", "fi": "Keneltä kysyt" }\`. \`hidden: true\` parks a block
without losing its settings.

## Writing your own words on the page

Use the block id \`common.freeform\` and put the text on it as \`body\`:

\`\`\`json
{ "id": "common.freeform", "key": "freeform.helpdesk",
  "titles": { "en": "Who to ask" },
  "body": "Payroll goes to **Anna Virtanen**.\\n\\n- Holiday requests: in the HR space" }
\`\`\`

It is **Markdown**. Headings, bold, lists and links work. Script tags, iframes, inline
event handlers and \`javascript:\` links are refused, and so is anything over 64 KB. If they
want a page with its own HTML and its own styling, that is the portal template, not this.

## Grouping

\`common.band\` holds other blocks under one heading, one level deep:

\`\`\`json
{ "id": "common.band", "key": "band.help", "titles": { "en": "Getting help" },
  "children": [ { "id": "common.freeform", "key": "freeform.who", "body": "..." } ] }
\`\`\`

## Before you answer

Ask them what the page is FOR and who lands on it, if they have not said. A department's
home usually wants less than the built-in one, not more: their own words near the top, the
things their people actually use, and nothing that advertises what they are not going to
do. Then say in one sentence what you changed and why, and give them the JSON.
`,
        variables: ['node_id', 'node_name', 'node_url', 'surface', 'block_catalog', 'current_layout'],
        usedIn: ['/v1/site/layout-prompt'],
    },
];
