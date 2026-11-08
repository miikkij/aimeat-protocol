---
paths:
  - "**/aimeat/public/views/profile/**"
  - "**/aimeat/public/views/admin/**"
  - "**/aimeat/public/components/PageStart.js"
  - "**/aimeat/public/components/PageHead.js"
  - "**/aimeat/public/components/SettingsPage.js"
  - "**/aimeat/public/components/HelpTip.js"
  - "**/aimeat/public/components/Tooltip.js"
  - "**/aimeat/public/components/ExplainDialog.js"
  - "**/aimeat/locales/**"
---

<!-- Written 2026-11-08 at Jouni's request: the guidance system of 2026-10-03 was written only in component headers, so a session that built a page never found it. It loads when Claude reads a Settings & Controls or admin page, a guidance component or a locale file. -->

# How a page explains itself

Most people who open a Settings & Controls page have never met the thing it controls. A page that
only shows its controls leaves them guessing what the thing is, what they get from it and where to
start. Every page answers those three questions, and it answers them with the same parts in the same
places, so a person learns the pattern once and finds the explanation on every page. On 2026-11-08 a
count of the 48 Settings pages found 14 different ways of explaining in 38 different combinations,
and only nine pages used the parts below; a new or changed page uses them and nothing of its own.

This applies when you build a Settings & Controls or admin page, when you change one, and when you
add or rewrite any explanation on one. A page you touch that lacks a part below gets it in the same
change, or the change says why not.

## The parts, and what each one is for

| Question the person has | Part | How |
|---|---|---|
| What is this page, in one breath? | The head's paragraph | `desc` on `SettingsPage`: one or two sentences, what the person gets here. Not the full explanation. |
| I am new here: what is it for, what do I do first, what happens then? | **PageStart** | `start=${html\`<${PageStart} id="<page>" … />\`}` on `SettingsPage`. Words under `pageStart.<id>.*`: `purpose` (one sentence, what the person gets), `prompt` (what they paste into their own AI to do the first thing), `next` (one sentence, what follows), optional `action` (this page's own button for the same first thing) and `link`. The person folds it once done; `done` folds it when the page knows. |
| What is this thing, why would I want it, when does it fit? | **The page's question mark** | `help="concept.<thing>"` on `SettingsPage` (or `PageHead`), and `explain.concept.<thing>.*`: `title`, `short` (the tooltip: one or two sentences), `what` (what it is and what the person gets from it), `ex1` … `ex6` (use cases: a real situation and the question the person then asks their AI), `tip` (when to use something else) with its own heading `tipLabel` (without one the dialog heads it "When to change the value", a setting's heading), `terms` (glossary words the dialog lists). The dialog ends with "Ask your AI more" on its own. |
| What does this setting do, which value do I pick? | **The setting's question mark** | `help="<area>.<setting>"` on a field-family control, `Check` or `SettingLine`; `HelpLabel` for a Facts row's name, a heading or a column head. Words under `explain.<term>.*`: `short`, `what`, `range`, `low`, `high`, `ex1` …, `tip`. Facts come from the code that enforces the setting. → `frontend.md` |
| What is this word? | A word that opens help | `HelpLabel` on the word (a dotted line; it shows `short` after the pointer rests and opens the dialog on a press). A word from the system's vocabulary carries its meaning in the same sentence, or it gets this. |
| Why is this list empty, how do I fill it? | The empty state | `empty=` on `List`: what fills the list and the one way to fill it. |
| A line about this section's controls | `Hint` | One line under a section, about what is in that section. Never the concept. |
| One thing said out loud | The dashed aside | `Note kind="aside"`: the sentence to say to one's own AI, or a note that needs attention. One per page. Never a general explanation. |
| What may it do, what may it not, how does it go stale? | A Facts section | Only for limits and safety facts a person must see without pressing anything (what a key may reach, when it stops). The concept itself goes in the page's question mark. |

**The tooltip is never the only place a fact lives.** `Tooltip` shows `short` while the pointer or
focus rests on a question mark or a help word; a touch screen opens the dialog instead. Anything a
person needs is in the dialog or on the page, and the tooltip only previews it.

**The same words reach an AI.** Every `explain.*` term, the concepts first, is served by
`aimeat_handbook_get { tier: "settings" }` and `"settings/<term>"` (`src/services/settings-explain.ts`),
in English, Finnish and Spanish. Write the explanation once, in the locale, and never a second copy in
a page, a skill or a handbook.

## Not on a new or changed page

These exist on older pages and are migration debt, not examples:

- a section of its own that explains the concept ("What it is good for", "How it works", "About"):
  that is the page's question mark;
- a section of numbered steps for getting started: the first step is PageStart's prompt, and steps a
  person takes by hand in another system stand next to the action that needs them (the key dialog,
  not the page);
- `SetupGuide`, `InstructionBlock` or `HowTo` to explain a concept;
- a fold ("read more") that hides an explanation;
- a link out to a help or documentation page instead of explaining here;
- a `Tooltip` with words that are nowhere else.

## Writing the words

Lead with what the person gets, then how. A use case names a real situation and the question the
person then asks their own AI. Facts come from the code, never from the page's old text. Terms come
from the language context (skill `aimeat-writing`, `references/language-context.md`); a new term gets
its row in the same change. English, Finnish and Spanish in the same change, Finnish composed in
Finnish. A new concept needs no code: a `explain.concept.<thing>` entry and `help="concept.<thing>"`.
