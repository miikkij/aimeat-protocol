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
description: How to use what an AIMEAT node knows about the person's files and long texts — the facts it reads from every file without any AI (a PDF's author, pages and signatures; a picture's camera, time, size and whether it declares being AI-made; a video's length and codecs), and, when the person turns them on, a description and alt text, the content classes an item belongs to (invoice, contract, photo, ...) and each class's fields extracted as JSON-LD. Read the facts before reading a file again; scan old files; approve or reject the classes a model proposes; give the classes as an OWL ontology. Use when a person asks what a file is, who signed or wrote it, whether a picture is AI-made, to find their invoices or contracts, to describe their pictures, or to tabulate documents by their fields. Triggers on content class, sisältöluokka, what is this file, who signed this, is this picture AI, alt text, describe my pictures, find my invoices, extract fields, ontology, OWL, tiedoston tiedot, kuvan alt-teksti, onko kuva tekoälyn tekemä.
license: MIT
metadata:
  audience: agent
---

# Content classes

When content arrives on the node (a stored file, a long memory record, a published workspace
document) the node reads it and keeps its **facts**. One item, one set of facts:

1. **Technical facts, always, no AI.** A PDF: title, author, creator, dates, pages, whether it has a
   text layer, and its signatures (valid, invalid or indeterminate, with the signer). A picture: size,
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
   schema.org type), \`propose\` (a new class when none fits, or new properties a class lacks). Every one
   is **off by default** and spends the owner's AI allowance.

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
memory:write-reserved; without it, tell the person to switch it in their Data Wallet,
\`/profile?tab=dataWallet\`, section "What is known about your content").

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
first; each item's \`entities.invoice.entity\` holds the extracted fields.

## Saying it to the person

Say what the item is and what it says, not the record: "The PDF is an invoice from Acme Oy, due on
31 October, and it is not signed." Say an AI mark as "the picture says it was made with AI" and
\`markMissing\` as "it says it was made with AI but carries no label saying so". Never present a
\`human\` or \`unknown\` verdict as proof that a person made something.
`,
};
