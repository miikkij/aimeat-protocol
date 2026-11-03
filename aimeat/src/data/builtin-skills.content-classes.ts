/**
 * @file src/data/builtin-skills.content-classes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-content-classes` built-in skill: how a person's own AI uses the content
 *   class pipeline from chat. The node reads what every arriving file and long text says about
 *   itself, and, when the owner turns them on, describes it, sorts it into content classes and
 *   extracts each class's fields as JSON-LD typed by the class's OWL class.
 *
 *   WHY A NODE SKILL. The pipeline is a platform capability (services/content/) with REST and MCP
 *   tools; a person's AI should find how to use it with `aimeat_skill_list` on any node, and learn
 *   the two things that matter most: read the facts before reading a file again, and never turn on
 *   a step that spends the owner's AI key without asking.
 *
 *   WHAT IT MUST AGREE WITH. The pipeline, the stages and the service (services/content/pipeline.ts,
 *   ai-stages.ts, service.ts), the settings (settings.ts) and the built-in classes
 *   (data/content-classes.ts). security/skill-reviews.json watches those files.
 * @structure CONTENT_CLASSES_SKILL_ENTRY
 * @usage import { CONTENT_CLASSES_SKILL_ENTRY } from './builtin-skills.content-classes.js';
 * @version-history
 *   v1.3.1 — 2026-11-03 — "Model steps: ask first": a refused permission carries the address where
 *     the person allows it; hand them that.
 *   v1.3.0 — 2026-11-03 — "A workspace document has one fingerprint, shared": who sees and makes it,
 *     stale, the listing by prefix, the setting on publication, and a person's correction
 *     (wish-sormenj-lki-jaetuksi-yksi-per-ty-tilan-asiakirja-ja-ty-tilan).
 *   v1.2.0 — 2026-11-02 — "The fingerprint": the profile step, the tag aimeat_content_facts answers
 *     and how to say it to the person (wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse).
 *   v1.1.1 — 2026-10-29 — A PDF's facts may carry textNotRead (the node's PDF read limit;
 *     secaudit2026oct26 round 8c). Added, nothing else changed.
 *   v1.1.0 — 2026-10-21 — "When something is wrong: correct it": aimeat_content_correct, and who
 *     decided a class (by, confidence, decisionId).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const CONTENT_CLASSES_SKILL_ENTRY: BuiltinSkillEntry =
{
    name: 'aimeat-content-classes',
    visibility: 'public',
    skillMd: `---
name: aimeat-content-classes
description: What an AIMEAT node knows about the person's files and long texts — facts read without AI (a PDF's author, pages and signatures; a picture's camera, time, size and AI mark; a video's length and codecs) and, when the person turns them on, a description, the content classes (invoice, contract, photo, ...) and each class's fields as JSON-LD. and a fingerprint (each section's kind of text and what it rests on). Read the facts before the file; scan; decide proposals; correct a wrong class or field. Use when a person asks what a file is, who signed it, whether a picture is AI-made, what kind of material a document is or whether it can be trusted, to find invoices or contracts, or to tabulate documents by their fields. Triggers on content class, sisältöluokka, what is this file, who signed this, is this picture AI, alt text, find my invoices, ontology, fingerprint, sormenjälki, millaista tämä aineisto on, voiko tähän luottaa.
license: MIT
metadata:
  audience: agent
---

# Content classes

When content arrives on the node (a stored file, a long memory record, a published workspace
document) the node reads it and keeps its **facts**. One item, one set of facts:

1. **Technical facts, always, no AI.** A PDF: title, author, creator, dates, pages, whether it has a
   text layer, and its signatures (valid, invalid or indeterminate, with the signer). A PDF whose size
   the node cannot check before reading it (an encrypted one, for example) is read under a time and a
   memory limit; past one, \`pdf.textNotRead\` names the limit, the file stays stored as it was, and
   its text was not read: say so rather than calling the file empty. A picture: size,
   bit depth, colour space, camera, when it was taken, location (when it carries one), creator and
   copyright, and any alt text it already carries. A video: length, size, frame rate, codecs, when it
   was recorded. Every item: whether it **declares** being AI-made, and how (the node's own
   provenance record, an IPTC DigitalSourceType in its XMP, a C2PA manifest), plus the EU AI Act
   line \`euAiAct\`: \`marked\` (it carries a machine-readable AI mark) and \`markMissing\` (it says it is
   AI-made but carries no such mark). This reads declarations only: \`unknown\` means the item says
   nothing, never "a person made it".
2. **Model steps, only when the owner turned them on.** \`describe\` (alt text and a description; the
   words in a picture or a scanned page; a video's transcript), \`classify\` (the content classes it
   belongs to, from one decision with a yes-or-no question per class, so an item can be in several),
   \`extract\` (each class's properties as a JSON-LD entity typed \`cc:<class>\` and the class's
   schema.org type), \`propose\` (a new class when none fits, or new properties a class lacks),
   \`profile\` (the fingerprint, below). Every one is **off by default** and spends the owner's AI
   allowance.

"Content class" is the kind of thing an item is. It is not the node's sensitivity classification
(who may read what), and not the MIME type.

## Read before you read again

Before you open, download or summarise a file for the person, call
\`aimeat_content_facts { kind: "file", key }\` (or \`kind: "memory"\` for a memory record or a workspace
document's key). The facts often answer the question outright (who signed it, when the photo was
taken, what the invoice's due date is), and \`with_text: true\` gives the text the node already took out
of it. Read the file itself only when the facts do not answer.

No facts yet (404 "Nothing has been read")? \`aimeat_content_inspect { kind, key }\` reads it now with
the owner's settings. The facts change when the file changes: an inspect of a changed file reads it
afresh.

## Model steps: ask first

The owner's settings decide what runs (\`aimeat_content_settings\` with no patch reads them). **Never
turn a model step on, and never pass \`stages\` naming one, without the person saying yes in this
conversation**: it spends their AI allowance on every item that arrives. When they say yes for one
file, pass \`stages\` on that inspect only; when they want it for everything from now on, change the
setting (\`aimeat_content_settings { patch: { stages: { describe: true } } }\`, which needs
memory:write-reserved). Without a permission a call needs, the refusal (SCOPE_DENIED) carries the
address where the person allows it, in \`details.allow_url\` on REST and in the text over MCP: give
them that address in their own words, without naming the permission, and call again once they have
allowed it. They can also switch the step themselves in their Data Wallet,
\`/profile?tab=dataWallet\`, section "What is known about your content".

An item whose sensitivity label keeps it from AI models gets its technical facts only; the inspect
answers the model steps in \`skipped\` with the reason. Tell the person that, in their words.

## Many items

\`aimeat_content_scan {}\` reads every file of the person (and their agents') that has no facts yet;
\`kinds\`, \`keys\` and \`memory_prefix\` narrow it, \`stages\` adds model steps (ask first), \`prune: true\`
also removes the facts of items that are gone. It answers at once; follow it with
\`aimeat_content_scan { scan_id }\`. One scan per account at a time.

## Content classes and the ontology

\`aimeat_content_classes { action: "list" }\` lists the classes: the built-in ones (receipt, invoice,
order, booking, job, system, support, newsletter, personal, contract, report, meeting-notes,
certificate, photo, screenshot, diagram, presentation) and the person's own. Each has the properties
an extraction fills, which are its OWL datatype properties. \`action: "ontology"\` gives the whole set as
an OWL ontology in JSON-LD, for anyone who wants it in an RDF tool.

A model proposes a class or properties when the propose step is on. \`action: "proposals"\` lists the
waiting ones; \`approve\` and \`reject\` with \`id\` decide one (memory:write-reserved). Depending on the
owner's \`approval\` setting a proposal waits for them (\`ask\`), is approved at once (\`auto\`), or is
decided by their decision rule (\`rule\`). Put a waiting proposal to the person as a question in their
words ("I found recipes. Shall I start a Recipe class with dish and servings?"), never as an id.

To find items of a class: \`aimeat_content_facts { class: "invoice" }\` pages through them, newest
first; each item's \`entities.invoice.entity\` holds the extracted fields. Each membership in
\`classes\` says who decided it (\`by\`: model, owner, rule), how sure (\`confidence\`) and, for the
model, its \`decisionId\` (the decision record, which the person sees on their AI page).

## The fingerprint: what kind of material it is

When the person asks what kind of material an item is, whether it can be trusted, or what it rests
on, read its fingerprint. The \`profile\` step cuts a text with words into sections and labels each:

- its kind of text, as a colour: F fact 🟦, A analysis 🟩, M opinion 🟧, O instruction 🟨, P decision
  or plan 🟥, K narrative 🟪;
- what it rests on, as a mark: **+** a source the reader can check (a link, a named study or
  document, data shown), **~** an identified person or meeting stands behind it, **?** nothing stands
  behind it, **x** the text says it is contradicted or replaced;
- how firmly it is stated, its topic, and where it leans (fact or opinion, concrete or abstract, past
  or future, describes or directs action, overview or detail, certain or a guess).

\`aimeat_content_facts { kind, key }\` then answers \`fingerprint\`: \`squares\` (one square per section,
as wide as its share of the words) and five \`lines\` (kind and genres, topics with their marks, trust
shares, where it leans, which model made it and when). Show the squares as they are and say the
lines in the person's own language, keeping the marks + ~ ? x as they are; for example "🟦🟦🟩🟦🟩🟧
A research report: mostly fact and analysis. Hintakehitys + and Kilpailutilanne + rest on named
sources; the recommendations ~ rest on the researchers' word." Lead with what matters to the
question: a high share of ? is worth saying first ("most of it states things with nothing behind
them"). \`with_profile: true\` adds each section's heading and one-sentence claim, for "which part is
the weak one?".

No profile yet: the profile step is off (ask before running it, as for every model step:
\`aimeat_content_inspect { kind, key, stages: ["profile"] }\`, or the setting for everything that
arrives, \`aimeat_content_settings { patch: { stages: { profile: true } } }\`; the Data Wallet page
does not show this switch yet, so it is changed from chat). When the node's decision model is on, it
marks the sections and the fingerprint model writes only the headings, claims and topics
(\`profile.labels: "decide"\`, and the tag's last line names both); otherwise the fingerprint model
does all of it. The fingerprint model is DeepSeek V4 Pro unless the operator chose another;
\`models.profile\` in the settings picks the person's own. A profile is the model's reading and can be wrong; it says which model made it. The marks
judge what the text shows, not whether its claims are true.

### A workspace document has one fingerprint, shared

A published workspace document's key (\`organism.<org>.w.<ws>.<namespace>.<id>.latest\`) has ONE
fingerprint, the same for everyone who may read the document; nobody else sees it. The facts answer
then carries \`shared\`: \`made_by\` (who asked for it and paid), \`corrected_by\`, and \`stale\` (a
newer version was published since, so it describes older words; say so). Making it
(\`aimeat_content_inspect { kind: "memory", key, stages: ["profile"] }\`) spends the asker's own AI
key: anyone who may read the document makes a missing or stale one; a current one is answered as it
is, and making it again with \`force\` needs the right to edit the document. To see a whole
workspace at once, \`aimeat_content_facts { prefix: "organism.<org>.w.<ws>.", has_profile: true }\`
lists its documents with their fingerprints (without sections), up to 1000 a call; \`has_profile:
false\` lists the ones that have none yet. Whether documents get theirs when they are published is
the workspace's setting, off by default: \`aimeat_content_settings { organism_id, ws }\` reads it,
and its creator or an organism admin changes it with \`patch: { autoProfile: true }\`; even then it
is made only on a publisher whose own settings run the profile step, on their key.

A person may correct a section: \`aimeat_content_correct { kind, key, profile: { sections: [{ n: 3,
mark: "+" }] } }\` (\`genre\` for its kind of text). The fingerprint then names who corrected it, and
a later run on the same words keeps the correction. On a workspace document that changes what every
reader sees, so it takes the right to edit the document.

## When something is wrong: correct it

The person is the authority on their own content. When they say an item is in the wrong class, or an
extracted value is wrong, call \`aimeat_content_correct\`:

- \`classes\`: the item's WHOLE list as it should be (\`["contract"]\`, or \`[]\` for none). A class the
  model gave and the list keeps stays as it was; one added is the person's; one left out goes, with
  its fields. The model's decision is marked confirmed or overridden on its record, so the person
  sees it was corrected.
- \`fields\`: per class, the values to set, \`{ "invoice": { "due_date": "2026-11-30" } }\`; \`null\`
  removes one. Use the property names \`aimeat_content_classes { action: "list" }\` gives.
- \`extract: true\` extracts the classes again (an AI step, ask first). A value the person corrected
  stays as they set it.

Correct only what the person confirmed, and say what you changed in their words: "I moved it from
invoice to receipt and set the date to 30 November."

## Saying it to the person

Say what the item is and what it says, not the record: "The PDF is an invoice from Acme Oy, due on
31 October, and it is not signed." Say an AI mark as "the picture says it was made with AI" and
\`markMissing\` as "it says it was made with AI but carries no label saying so". Never present a
\`human\` or \`unknown\` verdict as proof that a person made something.
`,
};
