/**
 * @file src/data/builtin-skills.organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-organisms` built-in skill: what an organism and a workspace are for, when
 *   a person needs one, the starting shapes, and how a place keeps itself current (guided journey P5,
 *   brief doc-mupor242l3cq). Until 2026-10-01 the handbook named organisms as one of the three
 *   grounds and no skill explained them; the organism-setup prompt was reachable over REST only.
 *
 *   It must agree with data/organism-shapes.ts (the shapes and what they make),
 *   services/organism-lifecycle.ts (the `shape` parameter and its defaults) and the organism record's
 *   agentAccess setting.
 * @structure ORGANISMS_SKILL_ENTRY
 * @usage import { ORGANISMS_SKILL_ENTRY } from './builtin-skills.organisms.js';
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const ORGANISMS_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-organisms',
  visibility: 'public',
  skillMd: `---
name: aimeat-organisms
description: What an organism and a workspace are for on an AIMEAT node, when a person needs one and when they do not, the six starting shapes (own work, team, company, family, club, project), how to set one up with the person in a few questions, who can see and change what, what their agents may do there, and how a place stays current. Use when someone wants to share work or knowledge with other people or with several AIs, asks what an organism or a workspace is, or wants a place for a team, a company, a family, a club or a project.
license: MIT
metadata:
  audience: agent
---

# Organisms: where work lives between conversations

## Say it this way

An organism is **one place where the person, the people they invite and all their AIs read and write
the same material**, and nothing goes out without a person. Their chat app remembers things for one
AI; an organism is shared by every AI they connect, whichever company makes it, and by other people.

Inside it are **workspaces**, one per purpose: a handbook, the customers, the decisions. A workspace
holds two kinds of things: **documents** (pages of text, guides, notes) and **records** (items with
the same fields, such as decisions, tasks or customers, checked against a schema).

Use the person's words. The first time you say "organism", say what it is in the same sentence; on
the home page it is called "a shared place".

## When they need one, and when they do not

- More than one person, or more than one AI, works on the same material: they need one.
- They want something to stay put between conversations and be found by any AI: they need one.
- Only their own notes, read by one AI: they do not. Memory is enough (\`aimeat_memory_write\`).
- Sharing a few memory records with a known set of people, with no workspace: a sharing group is
  enough (\`aimeat_group_*\`). Use an organism when there is a shared purpose and a structure.

## Setting one up: four questions, then do it

1. What is the place for? (One sentence, theirs.)
2. Who else will use it: nobody yet, a team, a company, a family, a club?
3. Propose a name and a starting shape, and say in one line what the shape makes.
4. Wait for their yes. Then create it in one call:

\`aimeat_organism_create { name, description, shape, lang }\`, with \`lang\` the person's language
(en, fi or es). The answer names the organism and the workspaces made.

| shape | for | makes |
|---|---|---|
| \`own-work\` | their own work, invite later | Notes (pages) |
| \`team\` | a team | Team handbook (pages, decisions) |
| \`company\` | a company | Company knowledge (pages, decisions) and Customers (customer records) |
| \`family\` | a family | Family (pages, tasks) |
| \`club\` | a club, members join with approval | Club (pages, events) |
| \`project\` | a project with goals and gates | Project (goals, plans, deliverables, decisions, resources) |

A shape sets the join policy and visibility too: everything is private and by invitation, except a
club, which is listed and takes join requests. The person can change either afterwards. Nothing fits:
create without a shape and add a workspace with \`aimeat_workspace_create\`.

Every shaped workspace starts with a readme that says what it is for and has a section for what is
current. Fill that section with them, from what they told you. Do not invent content for them.

Then hand over the address and say in one sentence how another of their AIs reads the same place:
it connects to this node and finds it with \`aimeat_discover { scope: "shared" }\`.

## Who can see and change what

- **Members** are people. Each person's agents act with that person's rights, so a member's AIs reach
  what the member reaches. The organism's owner can narrow this to listed agents only
  (\`aimeat_organism_update { agent_access: "listed" }\`); widening it back needs the owner signed in.
- **Access is per workspace**: one organism can hold an open handbook and a closed roadmap. Give a
  person viewer or contributor access to a workspace (\`aimeat_workspace_member_grant\`).
- **Drafts and publishing**: a write is a draft until it is published; a workspace can require a person
  to publish. Approvals and anything that spends money wait for a person.
- **Inviting** another person happens with \`aimeat_organism_invite\` or by email
  (\`aimeat_organism_invite_email\`); the invited person accepts on their own page.

## Apps and agents in a workspace

A workspace can carry apps bound to it, which read and write the same records. An installed package
can say which workspace it uses. An agent that works on its own reads and writes a workspace with its
owner's rights; give it only the workspaces it needs.

## How a place stays current

Knowledge here has a lifecycle. Keep the readme's "what is current" section true: when something
stops mattering, say so there and archive the material (\`aimeat_organism_archive\` for a whole
workspace or organism). A place nobody prunes becomes a pile no AI can use. Offer this once when a
workspace has grown and nothing in it has changed for a long time.
`,
};
