/**
 * @file builtin-skills.ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Built-in node skills about the node's AI: how content made by a model is declared and
 *   read (ai-transparency), and how AI routing and budget are inspected and changed
 *   (configure-routing). Their own file because builtin-skills.ts reached the 800-line ceiling; the
 *   entries are unchanged and keep their place in BUILTIN_SKILLS.
 * @structure AI_TRANSPARENCY_SKILL_ENTRY · CONFIGURE_ROUTING_SKILL_ENTRY · AI_MODEL_POLICY_SKILL_ENTRY
 * @usage import { AI_TRANSPARENCY_SKILL_ENTRY, CONFIGURE_ROUTING_SKILL_ENTRY } from './builtin-skills.ai.js';
 * @version-history
 *   v1.4.0 — 2026-09-28 — configure-routing names the AI roles, aimeat_ai_roles and aimeat_ai_role_set.
 *   v1.3.0 — 2026-09-28 — configure-routing names the extension provider type (System 2 plan, V6).
 *   v1.2.0 — 2026-09-28 — configure-routing and aimeat-ai-model-policy point to the model catalogue
 *     (GET /v1/ai/models) and say what it decides (System 2 plan, V4).
 *   v1.1.0 — 2026-09-28 — aimeat-ai-model-policy: the owner's model policy for an AI (System 2 plan,
 *     V2); configure-routing points to it.
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

1. **AI providers and routing** (whose key, which provider answers which capability):
   \`aimeat_ai_providers\` (or \`GET /v1/ai/providers\`) lists the owner's providers and the node's,
   what each serves with which model, whether each capability is tested and working, and the
   routing. A provider is added and its key set by the owner on the web page, never through a tool:
   guide, don't do. What you do: test a provider (\`aimeat_ai_provider_test\`; an image test costs
   one picture, so ask first) and propose the routing (\`aimeat_ai_routing_set\`, propose-then-
   confirm): the ordered providers per capability, and the rules (fallback on or off, at most how
   many attempts, only tested providers, never away from this machine when the first was local).
   Every answer carries \`route\`: who chose, who answered, each attempt. Spend history is
   \`GET /v1/ai/usage/history\`, where each failed attempt before a fallback is a line of its own.
   The operator's side: \`AIMEAT_AI_PROVIDERS\`, \`AIMEAT_AI_BUILTIN_PROVIDERS\`,
   \`AIMEAT_AI_PROVIDER_EGRESS\` and \`AIMEAT_AI_PROVIDER_TYPES\` on the Config tab; the node's own
   key is the provider \`node-openrouter\` and answers only an owner whose list is empty. A service the
   node has no type for is a provider of type \`extension\`: an extension of the owner's own whose
   manifest declares \`provides.ai_provider\` and \`ai.<op>\` actions; the node adds the key to its
   requests, only for the hosts the manifest lists.
   **Which models exist**, what each serves and what it costs: \`GET /v1/ai/models\` (the model
   catalogue; \`?capability=image&allowed=true\` gives what this caller can use). A retiring or
   retired model shows on its provider in \`aimeat_ai_providers\`: propose another. The operator
   refreshes the catalogue with \`POST /v1/admin/ai/catalog/refresh\`; \`AIMEAT_AI_CATALOG_REFRESH\`
   sets the cadence and \`GET /v1/ai/catalog/meta\` says when it last ran.
   **AI roles** say what a model is used for: \`aimeat_ai_roles\` lists the owner's roles (for each
   capability, the providers and models in order) and the roles apps declare, each connected to one
   of the owner's or waiting (\`requestedAt\`: the app already asked). \`aimeat_ai_role_set\` proposes a
   role or a connection, propose-then-confirm; an app's role runs only once the owner connects it, so
   show the owner what the app needs before you propose it. A call running as a role says
   \`chosenBy: role\` in its \`route\`.
2. **Work routing** (which agent does what): driven by agent capabilities, tags, and offers.
   Inspect with \`aimeat_agents_list\` + \`aimeat_agent_profile\`; adjust tags/mode via
   \`aimeat_operator_agent_configure\` (propose-then-confirm) and teach specialization by
   linking skills (\`aimeat_skill_link\`).
3. **Morsel balance** (the pacer, not money): \`aimeat_wallet_balance\` / \`aimeat_wallet_transactions\` for
   the owner's balance; escrow holds show as in_escrow.

**Which models are allowed at all** is a fourth thing, the owner's model policy: \`GET /v1/ai/policy\`
or \`aimeat_ai_policy_set\` with no policy. The skill \`aimeat-ai-model-policy\` covers it. The
node's recommended models are the operator's setting \`AIMEAT_AI_RECOMMENDED_MODELS\` (Config tab,
AI group); \`GET /v1/ai/recommended\` shows them.

## Principles
- Model routing and the daily budget go through \`aimeat_operator_ai_config\`: call it without
  \`confirm_token\` to get current/proposed/diff, show the owner the diff, then call again with
  the token. The API key can never be read or changed through it. The model policy works the same
  way through \`aimeat_ai_policy_set\`.
- When spend looks wrong, correlate \`/v1/ai/usage/history\` with schedules (\`aimeat_schedule_list\`)
  before blaming a model.
`,
};

export const AI_MODEL_POLICY_SKILL_ENTRY: BuiltinSkillEntry = {
    name: 'aimeat-ai-model-policy',
    visibility: 'public',
    skillMd: `---
name: aimeat-ai-model-policy
description: Which AI models the owner's calls may use on an AIMEAT node, and what to do when a call is refused because of it. Covers the owner's model policy (open, recommended, custom), the node's recommended models, an app's own models= list, the refusals AI_MODEL_NOT_ALLOWED and AI_MODEL_POLICY_EMPTY, policy_chose_model, and proposing a change with aimeat_ai_policy_set. Use when an AI call is refused over its model, when the owner wants quality without trying models, or when building an app that needs a particular model.
license: MIT
metadata:
  audience: agent
---

# The owner's model policy

A weak model gives poor answers and wastes the person's time. The model policy lets the owner say
which models their AI calls may use, and it can only tighten, never loosen, what another rule says.

## What decides

Three lists, and a call may use only a model that every list with something in it allows:

1. **The owner's policy** (\`GET /v1/ai/policy\`): \`open\` (no list), \`recommended\` (the node's
   recommended models per capability, which follow the operator's updates), or \`custom\` (the
   owner's own list). Four switches say whose calls it covers: the owner's own, the node's chat,
   the owner's agents, apps. The owner can also tighten it for one app or one agent.
2. **The node's recommended models** (\`GET /v1/ai/recommended\`), set by the operator. They
   restrict nobody until the owner chooses \`recommended\`.
3. **The app's own list**: \`models=\` in its \`<meta name="aimeat-ai">\`. It binds that app only.

A model is written \`<type>:<model id>\`, for example \`openrouter:anthropic/claude-opus-5.5\`. The
type picks the owner's providers of that type (\`aimeat_ai_providers\` lists them); a bare id goes to
the provider that answers the call. Naming a type the owner has no provider for is 400
\`AI_PROVIDER_NOT_CONFIGURED\`. To find a model for a list, read the model catalogue:
\`GET /v1/ai/models?capability=<capability>&allowed=true\` lists the models this caller can use,
each with its \`ref\`. When the node picks from a custom list, it uses the catalogue to know which
model serves the capability; a model the catalogue does not know counts as a text model.

## When a call is refused

- **403 \`AI_MODEL_NOT_ALLOWED\`**: the call named a model the rules leave out. \`error.details\`
  names the layer that refused and lists \`allowed\`. Call again with an allowed model, or with no
  model at all and let the node choose. Do not look for a way around the rule.
- **403 \`AI_MODEL_POLICY_EMPTY\`**: two lists have no model in common (an app's own list and the
  owner's policy, most often). A person has to widen one. Tell the owner which two lists, in one line.
- **402 \`QUOTA_EXHAUSTED\` saying the policy does not allow the free model**: the node's allowance
  is spent and the owner ruled the free model out. The answer is the owner's own key or more
  allowance, never a weaker model.
- **\`policy_chose_model: true\`** on an answer: the model the owner or the app would have used is
  not allowed, so the node took the first allowed one. Say so when it matters to the person.

## Proposing a change

\`aimeat_ai_policy_set\` without a policy reads the current one and the recommended list. With a
policy it changes nothing: it returns the proposal and a token. Show the owner what changes, in
their words ("only the recommended models, for your apps and agents too"), then call again with
the same policy and \`confirm_token\` (valid ten minutes, one use). The owner in person changes it
at once (\`PUT /v1/ai/policy\` in their own session).

When the owner has an AI provider and no policy, and the node recommends models, suggest
\`{ mode: "recommended" }\` once: it gives quality at once, without trying models.

## Building an app

Ask for a capability, not a model. Name a model only when the app truly needs that one, and then
declare it in the meta (\`models=openrouter:anthropic/claude-opus-5.5\`) so the app states its own
rule. Handle \`AI_MODEL_NOT_ALLOWED\` visibly: show the person the message, never an empty result.
`,
};
