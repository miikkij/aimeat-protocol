# Language context: what you are naming, and what this product already calls it

Read this before composing any user-visible text in a language other than English. It is for the
writer, and for a reviewer checking that one concept keeps one word; never give it to a cold reader,
whose whole value is having no context.

It is three kinds of file, read in this order:

1. **`language-rules.md`**: why this exists, what a person is actually looking at, what the decided
   words bind you to, what is never translated, what is forbidden, the register of each language,
   and how a term is added or changed. Read it whole, once per task.
2. **The concept table, one file per area** (below). Each row is the thing, what it is in one
   sentence, and the word decided for it in English, Finnish and Spanish. Open the file for the
   area you are writing in; when a term could sit in two areas, search them all
   (`grep -i "<word>" references/terms-*.md`).
3. **`language-context-changes.md`**: the dated history of the table. A writer does not need it;
   a change to a row adds its line there.

| File | Area |
|---|---|
| `terms-people-and-agents.md` | The person and their own AIMEAT, other AIMEATs and the server underneath, federation, stored memory and knowledge, agents and the AI a person talks to, permissions, and signing in. |
| `terms-sharing-and-messages.md` | Organisms, teams and workspaces with their roles, spaces and sections, contacts, Messages and group chats, asking other members, boards, notifications and connected mailboxes. |
| `terms-apps-and-packages.md` | Published apps and the marks on them, extensions, skills and app tools, what agents and apps offer, an app's look and design spec, visitors and what the AI label says, packages, the store and paid packages, tool servers. |
| `terms-ai-and-pacing.md` | Morsels and the AI allowance, AI providers, models, roles and their settings, the decision model and its rules, image and speech terms, workflows, goals and the work agents take. |
| `terms-compliance-and-security.md` | Secrets and the vault, content classification and audience, GDPR registers, requests and agreements, laws asked as questions, electronic signatures, provenance and AI marks, what the node reads from an item, the Data Governance Act. |
| `terms-data-and-files.md` | File stores and buckets, data packages and data products, outside parties and shares, data spaces, the data library, incoming webhooks and data contracts, contexts and tags. |
| `terms-pages-settings-admin.md` | The home and the block that starts a page, settings and their question marks, the look of this AIMEAT's own pages (themes, styles, fonts, components), form checks, the operator's settings and data key, and one row per Settings or admin page. |

A new row goes to the file whose area it belongs to; when none fits, the one closest to the screen
that first uses it.

## What this file does and does not do, measured

Tested on 2026-09-12 against the Personal Nodes screen, 45 keys in three languages. Two writers
got the same task and the same SKILL.md; one also got this file. Two Finnish readers then read one
version each, cold, not knowing there was another.

Both versions drew **14 findings**. The headline count is a tie, and the shape underneath is the
useful part.

- **Three defects this file prevented.** The version without it wrote *tunnus* for a machine
  identifier (the reader reached for *tunniste* independently, citing Sanastokeskus), *läppäri*
  in a sentence that also says TLS, and *sykeviesti*, which no Finnish technical text uses. All
  three are terminology, which is what this file is for.
- **One it caused.** Having learned *oma AIMEAT*, that writer used it in the body under a heading
  that still said *Omat palvelimet*, and the reader asked which of the two they were registering.
  That is why the heading rule in `language-rules.md` now exists.
- **Seven of the fourteen were the same in both**, and none of them is a word choice: *operaattori*
  and *federaatiohakemisto* naming things the screen never explains, GAII never opened, a token the
  screen asks for but never provides, a half-English placeholder. A writing aid cannot supply
  information the source string does not contain.

So: it moves terminology and nothing else, which is worth its cost because terminology is the part
that compounds across screens. The seven shared findings are why the table now carries rows for the
service, the directory, the token, the identifier and the username: the test named the gaps.
