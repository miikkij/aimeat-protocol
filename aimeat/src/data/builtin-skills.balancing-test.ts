/**
 * @file src/data/builtin-skills.balancing-test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in skill `balancing-test`: how an AI helps the owner of an app write the
 *   balancing test (the legitimate interests assessment of GDPR art. 6(1)(f); in Finnish
 *   tasapainotesti) when the app needs one, and what the AI leaves to the person. The rules it
 *   describes are enforced in services/compliance/lia-need.ts, lia-write.ts and lia-ops.ts; when one
 *   of them changes, this text changes in the same commit.
 * @structure BALANCING_TEST_SKILL_ENTRY
 * @usage import { BALANCING_TEST_SKILL_ENTRY } from './builtin-skills.balancing-test.js';
 * @version-history
 *   v1.0.0 -- 2026-11-13 -- Initial.
 */

export const BALANCING_TEST_SKILL_ENTRY = {
    name: 'balancing-test',
    skillMd: `---
name: balancing-test
description: Write the balancing test of an app with its owner (the legitimate interests assessment of GDPR art. 6(1)(f); Finnish tasapainotesti, Spanish prueba de ponderación). Use when an app processes personal data, is going into use with other people, and its register names legitimate interests as the legal basis; when a publish, a data map write or a register write answers with balancing_test; or when the compliance gaps list lia-missing, lia-incomplete or lia-reopened.
license: MIT
metadata:
  audience: owner
---

# The balancing test of an app

Legitimate interests is one of the six legal bases for processing personal data. It needs a written
test: is the interest real, is the processing needed, and do the interests of the people the data is
about weigh more. The server drafts the test from what the app already states. The person answers
the questions of judgement and makes the conclusion. You prepare; you do not conclude.

## When a test is needed

Read it, do not guess: \`aimeat_compliance_register_read { part: "lia_draft", app: "<file>.html", lang: "en" | "fi" | "es" }\`.
\`needed: true\` means at least one register of the app needs a test. The server asks for one when all
of these hold:

- the app's register (its record of processing) holds personal data,
- the register's \`legalBasis\` includes \`legitimate-interests\`,
- other people can see the data (the data map's readers are named people, an organism's members or
  anyone), or the app keeps regulated data such as employment data.

Nothing is asked in these cases, and \`not_needed\` names the reason:

| Reason | What it means | What you do |
|---|---|---|
| \`only-its-user\` | a demo, a prototype or a personal tool: only its user sees the data | nothing |
| \`trial\` | the owner marked the app a trial; it is shared with a small group and keeps no regulated data | nothing until the trial ends |
| \`trial-expired\` | the trial ended and the owner has not decided | ask the owner: into use, or close |
| \`reach-unknown\` | the data map does not say who sees the data in words the server reads | fix the data map (\`aimeat_datamap_set\`) |

A register on contract, legal obligation or consent has no test. A register with no legal basis yet is
a different gap: ask the person for the purpose and the basis first, and write them into the register
(\`part: "registers"\`).

## When legitimate interests cannot be used

\`not_allowed\` lists a register that holds special category data: health, biometric or genetic data,
or another special category (ethnic origin, religion, political opinion, trade union membership,
sexual orientation). Legitimate interests alone do not carry that data. The server drafts no test and
refuses a write with LIA_SPECIAL_CATEGORY. Tell the person plainly, and help them choose: a ground
under GDPR art. 9(2) in the register (\`specialBasis\`) with the legal basis that goes with it, and an
impact assessment (\`part: "dpias"\`).

Employment data is allowed on legitimate interests, and always needs the test. The draft then carries
a reminder in \`facts.reminders\`: employment privacy law can ask more (in Finland, only data directly
necessary for the employment relationship). Read the reminder to the person.

## Fill the draft with the person

Each item of \`items\` is one test. It carries:

- \`facts\`: what the server read from the app. The purpose and legal basis (section 1), the data and a
  proposal of data the app may not need (section 3), the regulated data, the people, AI use and who
  sees the data (section 4), and the server's own safeguards (section 5). You cannot write facts; a
  wrong fact is fixed in the data map or the register, where it came from.
- \`answers\`: yes or no per question id. The server answers a question only when it can see the
  answer in the app, and marks it \`evidence\`. Every other answer is open.
- \`unfinished\`: the questions still open, and whether the outcome and its summary are missing.
- \`questions\`: the question set in the language you asked for, five sections.

Work one section at a time:

1. Show the person the facts of the section and ask whether they are right.
2. Ask the open questions of the section in the person's language. Write \`"yes"\` or \`"no"\` only when
   the person answered. A question the person has not answered is left out, never guessed.
3. Write the person's reasoning into \`notes\`, keyed by the section id (\`basis\`, \`interest\`,
   \`necessity\`, \`balancing\`, \`safeguards\`) or by a question id. \`notes.safeguards\` is what this app
   does on top of the server's safeguards. You may draft the wording; the person confirms it.
4. Ask for the outcome last: \`{ "result": "suitable" | "not-suitable", "summary": "..." }\`. The
   result is the person's decision. Offer a summary of what they said; do not offer a result.

Save as often as you like:

\`\`\`
aimeat_compliance_register_write {
  part: "lias", app: "<file>.html",
  value: { items: [{ id, registerId, language, answers, notes, outcome }] }
}
\`\`\`

A save stores a draft whatever you send. The server writes the facts again from the app and marks
every answer and note you wrote as \`ai\`; what the person writes on the app's page is marked \`human\`.
The record keeps both, so a reader of the test sees what a model drafted. A write replaces the whole
document: send every test of the app you want to keep.

## Approval is the person's

When \`unfinished\` is empty, ask for approval:

\`\`\`
aimeat_compliance_register_write { part: "lias", app: "<file>.html", item_id: "<test id>", set: { "status": "approved" } }
\`\`\`

From an agent this approves nothing. It files a question to the owner and answers with
\`approval_request\`: tell the owner in one sentence that the test waits for them, and give them the
address in the answer. The owner reads the test on the app's page and allows it signed in themselves;
another agent cannot. You hear the answer as a message. A test edited after you asked is not approved
by the old question: ask again.

An approved test carries who approved it, who asked, and a review date twelve months on
(\`review_months\` in \`set\` changes it).

## After approval

- **Files.** The read \`part: "lias"\` gives each test's \`documents.pdf\` and \`documents.xlsx\`
  addresses (GET with the owner's session). The owner also downloads both on the app's page.
- **Privacy notice.** The people the data is about are told which interest the processing rests on.
  Offer to add the outcome's summary to the app's privacy notice
  (\`aimeat_app_manage { action: "legal", filename, kind: "privacy", format: "markdown", content }\`),
  and show the owner the text first.
- **Open again.** \`standing.state\` is \`reopened\` when more people can see the data than at approval,
  or the app keeps new regulated data. The approval is kept; the owner reads the test against the
  change and approves again.
- **Not suitable.** A test approved with \`not-suitable\` leaves a gap until the register names another
  basis or the processing stops.
- **Privacy contact.** An organism can name a member who hears when a test of an app shared with it is
  approved: \`aimeat_compliance_register_write { part: "contact", scope: "organism", organism_id, value: { "privacyContact": "<account name>", "notifyApprovedLia": true } }\`,
  written by the organism's creator or an admin.

## A trial

An app that a small group tries, to find the shape of a solution, is marked a trial:
\`aimeat_compliance_register_write { part: "trial", app, value: { "days": 60, "note": "..." } }\` (1 to 180
days, 60 when you send none). While it runs, a shared app with no regulated data is asked no test. A
trial does not cover an app anyone can open, or regulated data. When the trial ends the owner is
asked whether the app goes into use. It does not go into use by itself: \`value: { "end": true }\` says
it does, and the test is asked from then on. To close the app instead, the owner removes it.

## What you never do

- Answer a question of judgement for the person, or pick the outcome.
- Tell the person the processing is lawful. The test orders the thinking; it is not legal advice.
- Start a test for a demo because the app keeps personal data. Read \`needed\` first.
`,
};
