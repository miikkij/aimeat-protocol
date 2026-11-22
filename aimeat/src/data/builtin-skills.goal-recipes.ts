/**
 * @file src/data/builtin-skills.goal-recipes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-goal-recipes` built-in skill: how an AI turns what a person wants, in their
 *   own words, into a working result on the node, telling them first which capabilities it will use.
 *
 *   WHY (Jouni, 2026-11-16 and 2026-11-20). The new entry (/v1/goal-start) asks a person what they
 *   would do if everything were possible, or what their team would stop doing by hand, and hands
 *   them a message for their own AI. The basics are learned while building something bigger. The
 *   AI, not a menu, chooses the capabilities: "ne kertoo unelmansa ja sitten AI kertoo ne
 *   kyvykkyydet mitä tarvittaisiin ennenkuin aletaan tekemään että voi vaikuttaa niihin", in plain
 *   words "ilman metaforaksi käännettyjä sanoja". It does not ask twice for what the person already
 *   asked for (decision-ai-ei-kysy-kahdesti-itsen-isyys-s-det-n-noden-ja-omistajan-t). The
 *   questions come from the person's profile when it exists, and a training is an organism with its
 *   own invitation link (decision-uusi-sis-ntulo-kysymykset-profiilista-ja-koulutus-omana-orga).
 *
 *   The recipes are this skill's knowledge, never a menu the person picks from: the capability list
 *   is the node's own (`aimeat_handbook_get { tier: "features" }`), held whole by check:feature-reach.
 * @structure GOAL_RECIPES_SKILL_ENTRY
 * @usage import { GOAL_RECIPES_SKILL_ENTRY } from './builtin-skills.goal-recipes.js';
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-uusi-sis-ntulo-perusteet-opitaan-isoa-tavoitetta-rakentaessa).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const GOAL_RECIPES_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-goal-recipes',
    visibility: 'public',
    skillMd: `---
name: aimeat-goal-recipes
description: How to build what a person wants on an AIMEAT node from their own words, telling them first, in plain words, which of the node's capabilities it needs, and then building it without asking twice. Use when a person pastes the message from the goal start page ("I want to build this on AIMEAT", "Haluan rakentaa AIMEATissa tämän"), describes something bigger they want their AIMEAT to do, or a team leader says what their team should stop doing by hand.
license: MIT
metadata:
  audience: agent
---

# From what a person wants to a working result

The person said, in their own words, what they want. Your job: say which capabilities it
needs, let them change that list, then build it, so they learn the basics while getting
something real. Never offer a ready-made example instead of their own thing, and never a
generic task any AI could do without AIMEAT.

## 1. Read before you answer

1. \`aimeat_handbook_get\` with no arguments, then \`aimeat_handbook_get { tier: "features" }\`
   for the areas, and the area pages the request touches. This is the node's whole capability
   list: choose from it, not from memory.
2. The person's profile: \`aimeat_memory_read\` key \`journey.state\` with \`owner_scope: true\`.
   Its \`work\`, \`needs\`, \`challenges\` and \`repetitive\` say what they do and what they repeat.
   Use them; do not ask again what the profile already says.
3. What they may let you do without asking: \`aimeat_ai_standing_get\`.
4. Every file they attached (Excel, CSV, PDF). You read them yourself; no converter is built
   for them. When your client cannot open an Excel file, ask for the same sheet as CSV.

## 2. Say the capabilities before doing anything

Answer with the capabilities this needs, one line each:

- **The capability's name in plain words**, in the person's language (the row name from the
  features list, said simply), then one sentence on what it does in their case, with their
  own nouns: "Excel to a table: your 212 songs and 38 members become tables you can export
  any time."
- Then, under its own line, the ones you would add although they did not mention them, each
  with the reason.
- For a team: each line also says which repeated or manual work it replaces. Never estimate
  hours or money saved.
- Then only the questions their files and profile do not answer, and: "What do we leave out
  or add?" When they have not said it yet, ask in the same message how long the work takes
  them now without AI, and how often. That is their own number, not your estimate.

Plain words only. No metaphors, no word from the system's vocabulary without its meaning in
the same sentence, no capability the request does not need. Do not start building yet.

## 3. When they agree, start; do not ask again

They said yes in the chat: that is the approval. Make the goal with \`aimeat_goal_set\`
\`action: "create"\` (its works are the capabilities, in the order below; their answer on the
time the work takes goes in \`baseline\`: \`{ minutes, per }\`). Use \`action:
"propose"\` only when they asked to review it on their home first.

A step that needs a permission you do not hold: the node answers with an address. Tell them
in one sentence what you were about to do and give the address; the same notice offers
"Allow always, for all my AIs" so the next time nobody asks. Never ask for a permission the
standing setting already gives.

## 4. Build in this order

1. **The place.** A group's shared information first (an organism and a workspace) when more
   than one person is involved; invite them by email. A team leader's organisation chart goes
   through \`aimeat_team_setup\`: show the tree of teams first, then make it.
2. **The data.** Map their columns to a schema you show them, then write rows with
   \`aimeat_workspace_rows_append\` (up to 500 per call), each with a \`row_id\` from a stable key
   in their data, so a retry writes nothing twice. A row the schema refuses: name the row and
   the missing field to the person and ask.
3. **The app.** Skill \`node:aimeat-app-builder\`. Before you design a feature, check whether the
   node already does it (the features list) and leave it to the node.
4. **Work that runs without them.** A schedule, a workflow or an agent; say who does the work
   when they are away (an agent on the node, a workflow with their model key, or their own AI
   on a schedule).
5. **Money.** Their payment provider's key goes on their Wallet page, never through the chat;
   a test key first.
6. **Signing, receivers, data packages** when the request needs them.

After each step, one line: what was done, and the one thing they now know how to do.

## 5. At the end

List the capabilities used. Then two or three they did not use that would matter for this
same thing, each with what it would do for them. Offer, do not push.

## Teams and trainings

- A team member's own AI, whichever vendor, reads the team's shared information from day
  one; decisions and open work are stored there, not in one person's chat.
- The leader sees adoption with \`aimeat_team_status\`: who connected an AI and who finished
  onboarding. Never rank people and never score the quality of anyone's AI work.
- A training is an organism the participants join with its invitation link. An app a
  participant opens to that organism shows in its app list:
  \`/v1/appcat?view=org&org=<organism id>\`, and over MCP \`aimeat_organism_apps\`.
`,
};
