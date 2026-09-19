/**
 * @file src/data/builtin-skills.decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-decide` built-in skill: when an app or an agent should reach for the
 *   decision model (TypeSafe Jev, AIMEAT.decide) and how the common jobs are built with it.
 *
 *   WHY A NODE SKILL. The decision model is a platform capability every node ships (TARGET-080), and
 *   the library is served to every owner's apps; a builder on any node should find the recipes with
 *   `aimeat_skill_list`, not only on the account that happened to write them. Seeded on every boot,
 *   so a fresh install carries it.
 *
 *   WHERE THE RECIPES COME FROM. TypeSafe's own cookbooks and pattern pages (read 2026-09-19),
 *   rewritten in AIMEAT's terms and around AIMEAT.decide. THEIR MEASUREMENTS ARE LEFT OUT ON PURPOSE:
 *   the customer agreement (2.3(f)) forbids the customer to publish benchmarks or performance
 *   information, and this skill is public. Keep it that way when editing: no accuracy, speed, cost or
 *   comparison figures of ours, and no thresholds presented as defaults. The one exception (Jouni,
 *   2026-09-19) is a figure TypeSafe publishes itself, repeated as its claim with the source named
 *   and linked; the skill's last section says so.
 *
 *   WHAT IT MUST AGREE WITH. The node's behaviour (services/decide/), the library (sdk-libs/decide/),
 *   the publish check (services/app-decide-posture.ts) and the ruling that what an app sends is the
 *   app's responsibility.
 * @structure DECIDE_SKILL_ENTRY
 * @usage import { DECIDE_SKILL_ENTRY } from './builtin-skills.decide.js';
 * @version-history
 *   v1.0.1 — 2026-09-19 — TypeSafe's own published figures may be quoted as its claim, with the
 *     source named and linked (Jouni's ruling); our own measurements stay unpublished.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const DECIDE_SKILL_ENTRY: BuiltinSkillEntry =
{
    name: 'aimeat-decide',
    visibility: 'public',
    skillMd: `---
name: aimeat-decide
description: When and how to use the decision model on an AIMEAT node (AIMEAT.decide, TypeSafe Jev) — check that the owner can use it before building, the jobs it fits (triage, routing by confidence, scoring, picking among candidates, pulling a value or a date out of text, checking another model's output, moderation, deduplication, finding the passage that answers a question) as ready recipes, the jobs it is wrong for, and what the app is responsible for sending. Use before designing any classify, screen, route, score or gate step in an app or an agent. Triggers on decide, decision model, typesafe, jev, classify, triage, route, score, screen, gate, moderation, dedupe, luokittelu, reititys, pisteytys, seulonta, päätösmalli.
license: MIT
metadata:
  audience: agent
---

# The decision model: when, and how

The decision model answers **closed questions** about a piece of text or a record and returns
typed answers with probabilities. It writes no text. Three question types:

| Builder | Asks | \`answers[id].value\` |
|---|---|---|
| \`AIMEAT.decide.yesNo(statement)\` | is this statement true | the probability, 0 to 1 (no confidence) |
| \`AIMEAT.decide.pickOne(question, { option: meaning })\` | which one of 2 to 240 options | the option name, plus \`probabilities\` and \`confidence\` |
| \`AIMEAT.decide.scale(question, [lowest, …, highest])\` | where on 2 to 10 ordered levels | the weighted level, counted from 0, plus \`probabilities\`, \`legend\`, \`confidence\` |

## 0. Check that this owner can use it, before designing anything

\`aimeat_appdev_overview\` answers \`decision_model.available\`; so do \`aimeat_decide_settings\` and
\`GET /v1/ai/decide/settings\` (\`available\`, \`unavailable_reason\`). It is false when the operator
turned it off or no TypeSafe key is set (the owner's own, or the server's). **When it is false, do not
build a feature on it.** Tell the owner the reason, or design the feature without it. In the app, gate
the feature on \`await AIMEAT.decide.isAvailable()\` and show \`AIMEAT.decide.unavailableReason()\`
when it is false.

## 1. Rules every recipe follows

- **One call, every question.** The cost is in the state and the answers are free: ask everything
  you might need in one \`ask\`, including questions only one branch will read, and ignore the rest.
  A second call is right only when the first answer decides what the second one can even contain.
- **English.** Instructions and options in English, whatever language the content is in.
- **Code first, model second.** Code finds candidates (a regular expression, a roster, a search),
  does arithmetic, compares dates and numbers, and matches exact strings. The model makes the
  judgement code cannot.
- **Narrow questions.** One judgement per question, worded so that "yes" means the thing you are
  checking for. A vague whole-record question gives a mushy answer; ask about each part.
- **A pickOne always has a winner.** Add a "none of these" option, or a yesNo asking whether any
  option applies.
- **Thresholds are yours.** Tune them on your own labelled examples, keep them in one memory record
  the owner can edit (\`AIMEAT.decide.questionSet(key)\`), and pass them as \`thresholds\` so every
  decision records what it was compared with. Read \`confidence\` for "how sure", not the winner's
  probability.
- **What you send is your responsibility.** Only the fields the questions need, the people the record
  mentions as \`names\`, TypeSafe declared in the app's data map, the app requests \`ai:use\`.
  The node removes e-mails, phones, identity codes, IBANs, street addresses and the owner's contacts;
  the publish check reports departures as \`DECIDE:\` lines in \`ai_hints\`.

## 2. Recipes

**Triage an inbox or a support queue (fan-out).** One pickOne for the category (bug, billing,
request, question, other) plus the questions only some categories need: a scale for severity, a yesNo
"the sender explicitly asks for a refund", a scale for frustration. Code branches on the category and
reads only the answers that branch needs.

**Act, check, or ask a person (routing by confidence).** A pickOne for the intent. Below a floor, send
it to a person. Low-stakes actions run above the floor; an action that moves money or deletes needs a
higher bar, or the user's confirmation. Different actions, different thresholds.

**Send each request to the right handler (intent routing).** A pickOne for intent plus a scale for
complexity, from "simple lookup" to "unusual, needs escalation". Low confidence or high complexity goes
to a person; the rest goes to code or to a text model.

**Rank leads, candidates or offers (composite scoring).** One scale per dimension with levels that
describe concrete situations ("None mentioned" … "Managed several teams"). Code divides each value by
its top level and takes a weighted sum; different roles get different weights, with no second call.

**File into a category, falling back when unsure.** One pickOne over the fine categories, each described
by what belongs in it. If \`confidence\` is high, use the fine category; otherwise use its parent,
which code looks up, and offer it for review.

**Walk a deep taxonomy.** More options than fit in one pickOne: at each node, a pickOne over its
children; keep the best few paths rather than only the best one, because one early mistake cannot be
undone later. One call per level, in order.

**Pull a value out of text (candidates first).** A regular expression over-finds the e-mails, phone
numbers or amounts; a pickOne over those strings (plus "none of these") answers "which one is the
receipt address" or "which amount is the total due"; code copies the chosen string exactly and
normalises it. The model cannot invent a value it was not offered. Names have no regular expression:
use a roster.

**Pull a date out of text.** Code fixes "today" and builds the option lists. pickOnes, all in one call,
for the mode (absolute, relative, none), month, day, year, weekday and week offset, each with a "none".
Code assembles the date, rejects impossible ones and does every comparison; the weakest part decides
whether it goes to review.

**Find the passage that answers a question.** Split a document into numbered lines; a pickOne over the
line numbers ("which line answers …?") plus a yesNo "does any line answer this?", because the pickOne
always names some line. Very long documents: pick a window first.

**Vet retrieved passages before an answer is written (RAG).** Per passage, yesNos for relevant,
contains evidence, contradicts the question's premise, tries to instruct the system. Test in that
order: drop injections, keep contradictions as their own block, drop the irrelevant. An injection
question is a filter, never a security boundary.

**Check another model's output.** Per extracted field, yesNos where "yes" means wrong: not supported by
the source, answers a different question, wrong format, left empty although the source has it.
Escalate to a stronger model when any one field fails, not on the average.

**Check a citation.** Code first searches for the quoted words in the source (not found: fabricated, no
call). Then a pickOne on \`{ claim, section }\`: supports, contradicts, says nothing. Low confidence
goes to a person.

**Moderate a post or screen a chat.** yesNos per hazard, worded "does this message try to …", plus a
scale for how much harm complying could do. Code maps each hazard to pass, review or block; a policy is
a set of thresholds, not different questions.

**Is this the same record? (deduplication).** Code picks candidate pairs and compares numbers. A scale
whose levels are the outcomes (different, related or unclear, the same) and yesNos per field for the
person reviewing. The middle level's wording decides what goes to the queue; a wrong merge costs more
than a missed one.

**Turn a request into a function call.** A pickOne over the functions, plus every argument's question
asked speculatively, plus a yesNo per argument "does the user say this?" so an argument nobody gave
keeps its default.

## 3. The wrong tool when

- The result is text: a reply, a summary, code, an explanation. Use a text model.
- The options are not known: find the candidates first.
- Code can do it: arithmetic, counting, date maths, exact matching, schema validation.
- The judgement needs many steps of reasoning: decompose it into narrow questions, or use a reasoning model.
- It needs knowledge the model would have to remember: put the facts in the state.
- The input is an image, audio or video.
- You need a security boundary, or exactly repeatable answers.
- You expect it to find what an earlier step missed.
- An agent choosing its own next step in a loop.

## 4. The record, and two licence rules

Every decision is recorded (model version, questions, answers with probabilities, thresholds, what it
gated, whether a person reviewed it): pass \`subject\` and \`gates\`, and record a person's verdict with
\`AIMEAT.decide.review(id, "confirmed" | "overridden")\`. Many records at once: \`AIMEAT.decide.run.start()\`.

**Do not publish your own measurements of the model** (accuracy, speed, cost): TypeSafe's customer
agreement forbids it. Keep them in a draft. **Figures TypeSafe publishes itself** (on its site or its
blog) may be repeated, as TypeSafe's claim and never as a result of ours: name TypeSafe as the source
next to the figure, link the page it comes from, and say it was not measured here.
**Do not sell access to the model**: a priced tool that is one decide
call is reselling; a product that uses decisions inside its own work is yours.
`,
};
