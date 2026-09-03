/**
 * @file src/services/handbooks/full.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operating handbook for the `full` surface: everything the node offers, and how
 *   to work when nothing has been narrowed for you. It is short on purpose — the five focused
 *   handbooks are the detailed ones, and this surface's honest advice is mostly to name them.
 * @structure FULL_HANDBOOK — markdown, served by GET /v1/agents/me/handbook?surface=full
 * @usage import { FULL_HANDBOOK } from './full.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial, with the `full` surface.
 */
export const FULL_HANDBOOK = `# Working here with everything

This surface carries every tool the node offers to a v2 client. Nothing has been narrowed for you,
which means nothing is missing and nothing is pointing you anywhere either.

## Start by knowing where you are

Three grounds carry most of the work:

- **Memory** is the person's own knowledge. \`aimeat_memory_list\` takes a key prefix,
  \`aimeat_memory_search\` finds by content. A feature here is usually a memory record under a key
  prefix plus something that reads it, so look before you build.
- **Apps** are single-file web apps published on this node. \`aimeat_app_list\` gives each one the
  \`url\` you hand the person.
- **Organisms and workspaces** are how the person shares knowledge with others. A **skill**
  (\`aimeat_skill_list\`, \`aimeat_skill_get\`) is the operating guide for one named capability, and
  reading the skill first is faster than deriving it.

## If your work has a shape, take the surface named after it

A focused surface is less to hold and gives fewer ways to reach for the wrong tool. Connect to
\`/v2/mcp/<name>\` instead of this one when the name fits:

| surface | for |
|---|---|
| \`appdev\` | building and publishing apps, extensions and cortex packs |
| \`agent\` | the owner's own agent: memory, tasks, messages, knowledge, discovery |
| \`service\` | offering a service: work, actions, wallet, capabilities, organisms |
| \`admin\` | governance: operator settings, flags, groups, consent, agent management |
| \`commerce\` | selling and getting paid: priced manifests, checkout, receipts |
| \`primitives\` | twelve tools, and everything else found with \`aimeat_discover\` and run with \`aimeat_invoke\` |

Each of those has its own handbook, and it is more use than this page.

## Two things that are true on every surface

**Your scopes decide what you actually hold.** This surface lists everything the node offers; the
tools you were given are the ones your permissions allow. When the owner changes them, the node
says so and a client that follows the spec re-reads the list on its own.

**Say what you did in the person's words.** Ids, keys, scopes and tool names belong in what you do,
not in what you tell them.
`;
