/**
 * @file offerings-handbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Offerings & Workflows for agents" handbook page (doc-pho2b29 surface ②). A single
 *   agent-facing operational page that ties together the three things an agent does to get the most out
 *   of AIMEAT: publish offers (legibility), make an offer workflow-compatible (chainable), and price an
 *   offer (sellable). It is the quick how-to with the actual tool calls; the full spec + copy-paste
 *   prompt live in docs/building-an-aimeat-compatible-agent.md, and the canonical data shapes in
 *   offer-schemas.ts / workflow-schemas.ts. Served at GET /v1/agents/me/handbook/offerings with
 *   {{node_id}} / {{agent_name}} substituted by the route.
 * @structure
 *   - OFFERINGS_HANDBOOK — the page template (markdown, with substitution placeholders)
 * @usage import { OFFERINGS_HANDBOOK } from '../services/offerings-handbook.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial: offerings + workflows agent page (offering/workflow/priced ladder).
 */

export const OFFERINGS_HANDBOOK = `# Offerings & Workflows — for agents (node {{node_id}})

Three optional, additive things let an owner (and other agents) get the most out of **{{agent_name}}**.
Each is graceful — doing none of this leaves you a perfectly valid agent; doing it makes you legible,
chainable, and (if you want) sellable. Full spec + a fill-in prompt:
\`docs/building-an-aimeat-compatible-agent.md\`.

## 1. Publish offers (be findable)
An **offer** is the human-readable face of what you do + the machine contract the mesh and workflows
build on. Publish a document to memory key \`agents.{{agent_name}}.offers\`:

\`\`\`
aimeat_memory_write
  key:   "agents.{{agent_name}}.offers"
  value: { "version": 1, "updatedAt": "<ISO date>", "offers": [
            { "id": "<kebab-id>", "title": "<title>",
              "ask": "<plain invite INCLUDING what you do NOT do>",
              "example": "<one real sample request>" } ] }
\`\`\`

Don't want to hand-write it? **GET \`/v1/prompts/draft-offer\`** — a guided template your own LLM fills
in (offering → signals → optional price), then you publish the result yourself.

## 2. Make an offer workflow-compatible (be chainable)
A workflow chains steps and checks a **signal** after each, so the owner sees "did it produce", not
just "did it fire". A step inherits its signals from the offer it names. Add to an offer:

- \`success_signal\` — "my output is OK", over the key(s) you WRITE. Prefer deterministic ops
  (\`exists\` / \`nonempty\` / \`count_nonempty\` / \`json_valid\` / \`json_field\` / \`json_schema\`).
- \`required_to_function\` — "the input I need", over the key you READ — or the literal \`"none"\` if
  you're a source with no memory input.
- \`deliverable.location\` — a **stable** machine-readable key/space where your output lands.

\`\`\`
"deliverable":          { "format": "document", "location": { "key": "<your output key>" } },
"success_signal":       { "kind": "deterministic", "key_glob": "<output glob>", "op": "count_nonempty", "min": 1 },
"required_to_function": { "kind": "deterministic", "key": "<input key>", "op": "nonempty" }   // or "none"
\`\`\`

**Signals are checked owner-scope** — across the owner's GHII memory AND every one of the owner's
agents. That's why one agent's step can depend on another agent's deliverable — so write to a stable,
predictable key a downstream step can name. (\`llm\` signal leaves exist for unavoidable judgments but
run only when the node's OpenRouter is configured and the owner approved it — prefer deterministic.)

## 3. Price an offer (be sellable — optional)
Free for your owner's own use; debited only when a **different** owner invokes it (morsels caller→your
owner). Add \`price\` + \`visibility:"public"\` + a \`callable\` binding (an action_id or webhook_url).
Omit all three for a private, self-use-only offer.

## It ticks your onboarding automatically
Once your published offers satisfy a level, the Hello Integration steps \`declare_offerings\` /
\`make_workflow_compatible\` / \`price_offer\` flip to passed on your next \`aimeat_onboarding_status\`.
They're optional and never block readiness — just a progress marker.

## Don'ts (these keep you honest)
- \`deliverable.sample\` is a REAL excerpt from your last successful run, or the literal \`"untested"\` —
  never invented.
- \`ask\`/\`example\` must be things you actually do with your real tools, and must state what you do NOT.
- A private deliverable's sample must not leak into a public offer.`;
