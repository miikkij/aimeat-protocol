/**
 * @file src/data/builtin-skills.app-builder-common.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sections of the app-builder skill that hold whatever the page is made of, moved
 *   here from the Classic `aimeat-app-builder` skill when the Classic track was retired on
 *   2026-11-19 (decision-atelier-is-the-only-app-build-guide-classic-and-t1-t2-t3-are). The
 *   Atelier skill (builtin-skills.app-builder-atelier.ts) carries them from now on.
 *
 *   WHY A FILE OF ITS OWN. These sections lived only in the Classic skill: the model rule, saying
 *   the proposal in the person's words and the three rungs when something stops, the checks before
 *   a publish, what a finished build leaves behind (with the workstation for a big app), and dates
 *   and numbers through AIMEAT.fmt. An Atelier builder never read them. The text is the Classic
 *   skill's, word for word, except the example of machinery talk, which named a Classic tier and now
 *   names a genre.
 *
 *   WHERE EACH GOES. APP_BUILDER_COMMON (the model, their words) is in the Atelier skill, which every
 *   build reads. The other three are Atelier platform sections (atelier-platform.ts), read when the
 *   build reaches them: the Agent Skills standard keeps a SKILL.md under 500 lines, and the Atelier
 *   skill had no room for 140 more. The Classic skill's sections on the AI label and on asking for an
 *   AI capability are not here: the platform sections `ai-disclosure` and `ai` carry the same.
 * @structure APP_BUILDER_COMMON · PUBLISH_CHECKS_SECTION · AFTER_PUBLISH_SECTION · DATES_NUMBERS_SECTION
 * @usage import { APP_BUILDER_COMMON } from './builtin-skills.app-builder-common.js';  // inside a skillMd
 * @version-history
 *   v1.0.0 — 2026-11-19 — Moved from builtin-skills.app-builder.ts.
 */
import { MODEL_QUALITY_ADVICE } from '../services/model-recommendation.js';

export const APP_BUILDER_COMMON = `## Which model builds it

${MODEL_QUALITY_ADVICE} Measured on this node: the same app request succeeded 3 times in 3 on a
strong model and once in 3 on a lighter one, which read a third of the guidance.

## Say it in their words

Everything the specification says is how the node thinks. None of it is how the person you are
building for thinks, and the proposal is the moment the two get confused. Three or four lines is
the right length. Length was never the problem.

**The test: could the person answer "yes, build that" without knowing a single AIMEAT word?**
If answering needs them to know what a genre is, what a pack is, or what a scope is, you have
described the machinery instead of the app.

Not this:

> genre-pressctl fork, aimeat-iam pack for the gate, scopes \`memory:read memory:write\`, data under
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
`;

/** Atelier platform section `publish-checks` (services/builder/atelier-platform.ts). */
export const PUBLISH_CHECKS_SECTION = `## Before the publish: check the script, send the bytes the right way

Syntax-check the inline JS before publishing. Use a check that names the file explicitly:
\`\`\`bash
node -e 'const f=process.argv[1],s=require("fs").readFileSync(f,"utf8");new (require("vm").Script)(s,{filename:f});console.log("parsed:",f)' app-script.js
\`\`\`
Do **not** use bare \`node --check $VAR\`: with an empty or unset variable it reads empty
stdin, parses that, and exits 0 printing nothing — which reads exactly like a pass for a
file nobody looked at.

For any file over ~1 KB use **presigned upload** with \`aimeat_app_publish\` (omit the content
param → PUT the raw HTML to the returned \`upload_url\`). Re-publishing the same \`filename\` bumps
the version — it does not duplicate. The node checks the bytes and **refuses** two things outright:
an inline \`<script>\` that does not parse, and a script/stylesheet URL it answers 404 for. Both
come back as \`APP_ARTIFACT_BROKEN\` with a pitfall id per finding — fix and publish again. Anything
else it notices arrives as \`app_hints\` on a successful publish; read them.
`;

/** Atelier platform section `after-publish` (services/builder/atelier-platform.ts). */
export const AFTER_PUBLISH_SECTION = `## After the publish: leave the next build something

Beyond the four lines every app owes:
1. If anything generalizes, record a template: \`aimeat_app_template_propose\`
   (your own model id required — self-identify) — the next build starts from it.
2. Report what bit you: \`aimeat_appdev_pitfall_report\` (model required; upserts by slug;
   \`share: true\` publishes it platform-wide) — the next builder skips your mistake.
3. Write the bound skill for whoever will USE the app, in the same plain register as the
   proposal, because it is read by other people's agents, not by you.
4. **A big app: the workstation.** An app is one HTML file, and that holds for the node. Past
   roughly 300 kB it stops holding for YOU: one file is then expensive to edit, and the fix is
   sources split behind a build step on your own machine that assembles the same single file. Load
   \`node:aimeat-app-workstation\` when the app gets there, or when the publish response's
   \`next_steps.size\` says so.
`;

/** Atelier platform section `dates-numbers` (services/builder/atelier-platform.ts). */
export const DATES_NUMBERS_SECTION = `## Dates, times and numbers: never from the language

The pill that switches an app's language decides which WORDS a person reads. It does not decide
whether a date is 9/12/2026 or 12.9.2026, and it does not decide which clock they are looking at.
Those are two more settings of their own, and people mix all three: Finnish words with an American
date format is a real preference, and so is English words with a Helsinki clock.

Install \`aimeat-i18n\` and write everything through \`AIMEAT.fmt\`, which reads the signed-in
person's own settings from their profile:

\`\`\`javascript
await AIMEAT.fmt.useProfile();            // once, after sign-in; signed out, the browser answers
AIMEAT.fmt.num(1234)                      // their grouping
AIMEAT.fmt.date(iso)                      // their date format
AIMEAT.fmt.time(iso, { hour: '2-digit', minute: '2-digit' })   // their clock
AIMEAT.fmt.dateTime(iso)
AIMEAT.fmt.relative(iso)                  // "3 päivää sitten", "eilen" — a POINT in the past
AIMEAT.fmt.duration(ms)                   // "1pv 23t 26min" — a LENGTH of time
AIMEAT.fmt.money(12.5, 'EUR')
AIMEAT.fmt.morsels(625)                   // never a currency symbol
\`\`\`

**A word is not a unit.** \`relative\` and \`duration\` produce WORDS, so they follow the app's
LANGUAGE; everything else follows the regional format. A person who chose Finnish words with a
British date format gets \`3 päivää sitten\` beside \`13/09/2026\`, and that is what they asked for.

**Never write a \`{n} min ago\` translation key for this.** It survives Finnish only because \`min\`
does not inflect, it cannot produce \`eilen\`, and one \`{n}\` cannot carry a language whose noun
changes with the number — Polish writes \`1 dzień\` but \`2 dni\`, Russian \`1 день\`, \`2 дня\`,
\`5 дней\`. CLDR knows every one of those rules; a key does not.

Three things that are easy to get wrong:

- **A moment is not a calendar date.** A message arrived at an instant and belongs on the reader's
  clock. A heat-map square, a month rail or "the day this was counted into" is a day on a calendar:
  re-read it in someone's zone and it labels itself the day before for anyone west of the node, so
  a heading disagrees with the rows under it.
- **\`money()\` refuses morsels, on purpose.** A morsel is a pacer, not a currency: it paces what
  agents may push into a person's store, it accrues while they are idle, and it buys nothing. The
  two are numbers of the same size on the same screens. \`morsels()\` is the one that formats them.
- **Never write \`toLocaleString()\` with a tag you derived from the language.** That is the defect
  this exists to prevent, and on the platform itself it had thirty copies that disagreed with each
  other about what English meant.
`;
