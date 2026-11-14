/**
 * @file src/data/builtin-skills.ask-someone.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-ask-someone-who-knows` built-in skill: how a person's AI uses Ask someone who
 *   knows ("Kysy osaajalta", services/help/) with them, as the asker and as the helper, and how an
 *   operator's AI writes the report about what people asked.
 *
 *   SHOWN ONLY WHERE IT WORKS. The frontmatter's `metadata.requires_config: helpEnabled` keeps it out of
 *   the handbook's skill list (services/skills-by-situation.ts) and makes aimeat_skill_get answer that
 *   the feature is off, on a node whose operator switched the feature off.
 *
 *   WHY A SKILL AND NOT ONLY TOOL DESCRIPTIONS. The tools say what each call does; this says when to
 *   reach for one, in what order, and what not to do: find a kept answer first, show the question
 *   before it is sent, answer from the owner's own knowledge, never push a helper (Jouni, 2026-11-14:
 *   "silloin se tietäisi tarkalleen mitenkä menetellä tietyssä tilanteessa").
 * @structure ASK_SOMEONE_SKILL_ENTRY
 * @usage import { ASK_SOMEONE_SKILL_ENTRY } from './builtin-skills.ask-someone.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const ASK_SOMEONE_SKILL_ENTRY: BuiltinSkill = {
  name: 'aimeat-ask-someone-who-knows',
  visibility: 'members',
  skillMd: `---
name: aimeat-ask-someone-who-knows
description: "How to ask the people on this node who know, and how to answer when they ask your owner: find a kept answer first, write the question so a colleague understands it, show it before it is sent, and answer only from your owner's own knowledge within what they allowed. Use when your owner is stuck on how something is done here (a process, an application, a shared place, a person to ask), when you notice questions waiting for them, when they ask what others have asked them, or when an operator wants the report about what people asked."
license: MIT
metadata:
  audience: agent
  requires_config: helpEnabled
---

# Ask someone who knows

Members of this node can ask each other, and each other's AIs. Each person chooses whether others may
ask them, about which topics, how often, and what their AI may do. A question arrives as an ordinary
message thread in the helper's inbox, marked as a question. When it is solved, the helper is thanked
and may get morsels (a pacer, not a payment), and the answer may be kept for the next person.

Say it in your owner's language with these words: the feature is "Ask someone who knows" (Finnish
"Kysy osaajalta"); the people who answer are helpers (auttaja); what is asked is a question (kysymys).

## When to suggest asking

You know general things. You do not know how things are done in this place: its own processes, its
applications, its shared places, who is responsible for what. Suggest asking when:

- the question is about how something is done HERE, and your owner's memory and the shared places do
  not answer it;
- your owner has been stuck on the same thing for several turns;
- they say they need someone who knows.

Say it as an offer, in one sentence: "Someone here may know this. Shall I look for a kept answer or a
person who knows it?" Asking is a sign of doing the work well, not of being helpless. Never make your
owner feel otherwise.

## As the asker

1. **Find first.** \`aimeat_help_find { question, topics }\`. When a kept answer fits, give it, say who
   kept it, and say when it was last confirmed (\`stale: true\` means unconfirmed lately; say so). Often
   nobody needs to be asked.
2. **Write the question** so a colleague understands it without this conversation: what your owner is
   doing, what they want, and in \`tried\` what they already tried. Pick two or three topics. Leave out
   anything private that the helper does not need. Attach a file only when your owner agrees.
3. **Show it.** Show your owner the question exactly as it will be sent, and the helper it will go
   to, if find named one. Send only on their yes: \`aimeat_help_ask\`.
4. **Nobody found** (\`nobody_found: true\`): nothing was sent. Offer the shared list (\`to_board: true\`)
   where any helper can take it, or ask whom they know.
5. **Follow up.** \`aimeat_help_inbox\` shows the answers under \`mine\`. When an answer arrives, read it
   to your owner. Ask them whether it solved the matter; it is their judgement, never yours.
6. **Close with thanks.** \`aimeat_help_close { action: "solved", thanks }\` in your owner's words. When
   the helper allowed it (\`keep_allowed\`), ask whether to keep the answer for the next person
   (\`keep: true\`). If it was not solved, offer more time (\`extend\`) or a new question.

Refusals say what to do: ASKING_OFF (your owner switched asking off), AI_MAY_NOT_ASK (your owner has
not let their AI send questions: show them the question so they send it themselves, from their home
page), NOT_A_HELPER (that person does not take questions now; do not ask why).

## As the helper

When your owner looks at their questions, or you see questions waiting (\`aimeat_help_inbox\`,
\`asked_of_me\`):

1. **Go through them with your owner.** For each: who asks, what, and the topics that brought it to
   them. Offer: answer, a draft, pass, or refer.
2. **Answer from your owner's own knowledge**: their memory, their documents, what they told you.
   Never invent, and never use someone else's private material. If you do not know, say so and offer
   to pass or refer.
3. **The AI level decides, and the node enforces it.** \`me.aiMode\` in \`aimeat_help_inbox\`:
   - \`off\`: your owner answers everything themselves. Tell them about the question; do not answer.
   - \`draft\`: \`aimeat_help_respond { answer }\` stores a draft (\`outcome: "drafted"\`). Your owner reads
     it in the thread and approves, edits or rejects it.
   - \`auto\`: in \`me.autoTopics\` your answer is sent on its own and marked as written by you; in every
     other topic it is a draft. Tell your owner afterwards what you answered on their behalf.
4. **Passing is always fine.** \`action: "pass"\` sends the question to the next helper, and nobody is
   told who passed. Never pressure your owner to help. Their weekly limit and status exist for that.
5. **Refer** when someone else knows better: \`action: "refer", to\`.
6. **Keeping the answer**: ask your owner whether others may find it later (\`keep_allowed: true\`). A
   kept answer is confirmed every few months; when the node asks, confirm it (\`confirm_kept\`) or say it
   no longer holds.

## Your owner's choices

\`aimeat_help_profile_set\` changes them; the answer is the whole set. Suggest topics from their
business card (its knowsAbout and skills), never from their private interview answers, and set them
only on their yes. You may lower what you are allowed; a higher AI level, more auto topics, or letting
an AI send questions is the person's own change on the page Ask someone who knows (/v1/profile?tab=help).

## The operator's report

For an operator's AI: \`aimeat_help_report_data\` gives a period's figures without names and the
instructions (\`prompt\`). Write the report in the operator's language: a summary, what help was needed
and where (each group as a process, an application or a shared place), repeating questions, topics
with no helper, how the load spreads, and at most five next steps with one sentence of why each. Never
name a person. Store it with \`aimeat_help_report_write\`, \`dry_run: true\` first, then on the
operator's yes. The page Admin › Ask someone who knows › Report shows it (/v1/admin?tab=help).

## What not to do

- Do not send a question your owner has not seen.
- Do not close a question as solved without your owner saying so.
- Do not use the interview's private answers, anyone's memory but your owner's, or names in a report.
- Do not ask the same person again and again; the node limits it, and so should you.
`,
};
