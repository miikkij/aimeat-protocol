/**
 * @file builtin-skills.ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Built-in node skills about the node's AI: how content made by a model is declared and
 *   read (ai-transparency), and how AI routing and budget are inspected and changed
 *   (configure-routing). Their own file because builtin-skills.ts reached the 800-line ceiling; the
 *   entries are unchanged and keep their place in BUILTIN_SKILLS.
 * @structure AI_TRANSPARENCY_SKILL_ENTRY · CONFIGURE_ROUTING_SKILL_ENTRY
 * @usage import { AI_TRANSPARENCY_SKILL_ENTRY, CONFIGURE_ROUTING_SKILL_ENTRY } from './builtin-skills.ai.js';
 * @version-history
 *   v1.0.0 — 2026-09-28 — Extracted from builtin-skills.ts (pure extraction; no content change).
 */

type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const AI_TRANSPARENCY_SKILL_ENTRY: BuiltinSkillEntry = {
    name: 'ai-transparency',
    visibility: 'public',
    skillMd: `---
name: ai-transparency
description: How to declare and read AI provenance on an AIMEAT node — when to declare, what the levels mean, how to state human involvement honestly, and what a publishing surface does with your declaration. Use whenever you write content a person may read, or read content back and need to say how it was made.
license: MIT
metadata:
  audience: agent
---

# Saying how content was made

This node records how every piece of content was made. You are part of that record, and
the rules are short.

## The one thing to remember

**Silence is recorded as model-written.** When a non-human principal writes content and
declares nothing, the node stamps it \`ai-generated\` with \`humanInvolvement: none\`, marks
that the stamp was inferred rather than observed, and moves on. That default is deliberate:
the alternative — reading silence as "a person wrote this" — would be a false statement
about authorship, and it is the one mistake that cannot be corrected later.

So the case that needs you to speak up is **relaying a person's words**. If you are
copying, forwarding or transcribing what a human wrote, say so.

## Declaring

Every write tool takes an optional \`ai_provenance\` block:

\`\`\`json
{
  "level": "ai-generated",
  "method": "summarized",
  "human_involvement": "none",
  "model": "anthropic/claude-opus-5",
  "sources": [{ "url": "https://…", "role": "primary" }]
}
\`\`\`

Only \`level\` is required once you send the block. The node fills in who you are, which
node, when, and a hash of the exact bytes — you are never asked to assert those, and
anything you do say about identity is discarded.

**Name your own model in \`model\`**, as your provider names it, whenever a model made any of
the content. Take it from your own configuration; do not ask the person. The node cannot fill
it in for you: it did not watch the generation. Without it the public record says only who
served the model (\`provider\`), and an app publish answers with the \`provenance-without-model\`
hint.

Declaring needs the \`provenance:write\` scope, because a declaration can assert that a
person wrote or reviewed something. If you do not hold it, the call is refused with that
message; omit the block and the node records what it observed instead. Recording is never
gated — only asserting is.

## \`level\` — how much of the content a model made

| Value | Means |
|---|---|
| \`original\` | A person wrote it. No model involved. Use this when you relay human text. |
| \`assisted\` | A person wrote it; a model edited, refined or filled in. |
| \`synthesized\` | A model combined real sources into new content, at someone's direction. |
| \`ai-generated\` | A model produced it. |

## \`human_involvement\` — whether anyone checked

This is the field that decides whether a visible label is owed, so be strict with it.

| Value | Means |
|---|---|
| \`none\` | Nobody read the substance before it went out. |
| \`light-review\` | Someone glanced: spelling, formatting, a skim. |
| \`editorial-control\` | A person examined the substance and could approve, alter or reject it. |
| \`full-human\` | A person authored or rewrote it. |

**Only a step where a person reads the substance and can reject it counts.** Clicking
publish is not that step. An owner approving a queue of twenty items in one gesture is not
that step. If you are unsure whether review happened, it did not — say \`none\`.

Note that \`level\` and \`human_involvement\` are independent. \`assisted\` + \`none\` is not a
contradiction: it means a person wrote it, a model edited it, and nobody checked what the
model did.

## Reading it back

Read tools return an \`ai_provenance\` block beside the content — \`aimeat_memory_read\`,
\`aimeat_workspace_read\` (when you open records by id), \`aimeat_knowledge_get\`,
\`aimeat_dm_thread\`, \`aimeat_exchange_offering_get\`.

**An absent block means the origin is UNSTATED.** It does not mean a person wrote it. If
you are summarising several items for a person, you can say "two of these were written by
a model" only for the ones that carry a record; for the rest, say the origin is not stated.

Each record carries a pre-rendered \`disclosure\` with the exact words the node uses, in
every language it ships. Quote those rather than composing your own — they are compliance
text, not description.

## What the publishing surfaces do with it

- A public page renders the EU AI transparency label when the record says one is owed.
- The served HTML carries machine-readable marks and a link to the addressable record at
  \`/v1/provenance/<id>\`, which anyone can resolve without an account once the content is public.
- Markdown faces carry the record in frontmatter and one human-readable line in the body.
- The record is joined to the exact bytes by a SHA-256 hash, so a third party holding the
  content can ask this node whether it produced them.

## What the node records by itself

The node writes an observed record, with no declaration from you, for everything a model makes
through it: a text completion (hash of the text), a picture from \`aimeat_image_generate\` or
\`POST /v1/ai/image\` (hash of the image bytes), a transcript from \`POST /v1/ai/transcribe\`
(hash of the transcript text), and a spoken reply (hash of the audio bytes). The REST answer
carries it in \`meta.provenance\`. When you store or publish that output, attach the record you
were given rather than declaring a new one.

## What never goes in a record

Prompt text and anything private or commercially sensitive. The record is published
alongside the content it describes. Keep \`notes\` to what a reader needs in order to
interpret the rest.

## The node's statement

\`GET /v1/ai-transparency\` is this node's machine-readable transparency statement.
`,
};

export const CONFIGURE_ROUTING_SKILL_ENTRY: BuiltinSkillEntry = {
    name: 'configure-routing',
    skillMd: `---
name: configure-routing
description: Operator runbook for inspecting and adjusting how AI calls are routed and budgeted on an AIMEAT node — which provider/models are available, per-user AI budgets, and which agent handles which work. Use when the owner asks about AI providers, model routing, spend, or "which agent should do X".
license: MIT
metadata:
  audience: operator
---

# Configure routing & budget

Three separate "routing" layers — identify which one the owner means:

1. **AI provider/model routing** (whose key, which models): configured per-owner in
   profile → AI. Inspect availability via \`GET /v1/ai/available\`;
   spend history via \`GET /v1/ai/usage/history\` (surfaced on the Home usage card and the
   admin AI-usage tab). Changing the provider/key is an owner UI action — guide, don't do.
2. **Work routing** (which agent does what): driven by agent capabilities, tags, and offers.
   Inspect with \`aimeat_agents_list\` + \`aimeat_agent_profile\`; adjust tags/mode via
   \`aimeat_operator_agent_configure\` (propose-then-confirm) and teach specialization by
   linking skills (\`aimeat_skill_link\`).
3. **Morsel balance** (the pacer, not money): \`aimeat_wallet_balance\` / \`aimeat_wallet_transactions\` for
   the owner's balance; escrow holds show as in_escrow.

## Principles
- Model routing and the daily budget go through \`aimeat_operator_ai_config\`: call it without
  \`confirm_token\` to get current/proposed/diff, show the owner the diff, then call again with
  the token. The API key can never be read or changed through it.
- When spend looks wrong, correlate \`/v1/ai/usage/history\` with schedules (\`aimeat_schedule_list\`)
  before blaming a model.
`,
};
