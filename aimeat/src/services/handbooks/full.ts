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
 *   v1.2.0 — 2026-09-19 — The Apps line sends a builder to the app-builder skill, which says the
 *     track first, and no longer straight to the Classic specification.
 *   v1.1.0 — 2026-09-19 — A paragraph on aimeat_discover and its three reaches. The agent handbook
 *     has said "master directory, start here" all along, and this page, which is the one a plain
 *     connection reads, named discovery only as a row in the table of surfaces.
 *   v1.0.1 — 2026-09-18 — This is what aimeat_handbook_get returns on /v1/mcp when called with no
 *     arguments, so it is the first thing most connected agents read. The primitives row no
 *     longer states a tool count: it said twelve, and the surface carries thirteen.
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
  \`url\` you hand the person. Before you build one, load the skill
  \`node:aimeat-app-builder\`: a new app is built on the Atelier track, from a genre, and its
  specification is \`aimeat_handbook_get { tier: "build-app-atelier" }\` in four parts. \`{ tier:
  "build-app" }\` is the Classic track's, for an app that is already Classic.
- **Organisms and workspaces** are how the person shares knowledge with others. A **skill**
  (\`aimeat_skill_list\`, \`aimeat_skill_get\`) is the operating guide for one named capability, and
  reading the skill first is faster than deriving it.

**When you do not know where something is, or what the person can reach, start with
\`aimeat_discover\`.** It is the master directory: one query across every kind of content
(capabilities, workflows, knowledge, documents, apps, skills, memory and more). \`mode: "map"\`
is a cheap count of WHAT exists by type and tag; \`mode: "find"\` with \`q\`, \`type\` or \`tags\`
returns the entries. It looks in one reach at a time: \`scope: "own"\` (the default) is the
person's own content, \`"shared"\` is what the organisms they belong to share with them, and
\`"public"\` is what anyone can read. Something a colleague or a club wrote down is under
\`"shared"\`, and no memory search will find it. Use the narrower tools once you know the domain.

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
| \`primitives\` | a handful of tools, and everything else found with \`aimeat_discover\` and run with \`aimeat_invoke\` |

Each of those has its own handbook, and it is more use than this page.

## Two things that are true on every surface

**Your scopes decide what you actually hold.** This surface lists everything the node offers; the
tools you were given are the ones your permissions allow. When the owner changes them, the node
says so and a client that follows the spec re-reads the list on its own.

**Say what you did in the person's words.** Ids, keys, scopes and tool names belong in what you do,
not in what you tell them.
`;
