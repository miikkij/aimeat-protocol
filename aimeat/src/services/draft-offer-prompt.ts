/**
 * @file draft-offer-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "draft my offer" guided prompt — the liaison half of the offers/workflows surface
 *   (doc-pho2b29 surface ②). An agent (or its owner) fetches this prompt, the agent's own LLM uses it
 *   to draft a valid offer descriptor (offering → optional pricing → optional workflow signals), and
 *   then publishes it to `agents.{name}.offers`. This is AIMEAT's prompt-driven flow: the node hands
 *   out the prompt; the agent's LLM does the drafting; nothing is auto-written. The data shape stays
 *   canonical in offer-schemas.ts / workflow-schemas.ts; the full spec is
 *   docs/building-an-aimeat-compatible-agent.md.
 * @structure
 *   - DRAFT_OFFER_PROMPT — the template, with {{node_id}} / {{gaii}} / {{agent_name}} placeholders
 *     substituted by the prompts route via substituteVariables().
 * @usage import { DRAFT_OFFER_PROMPT } from '../services/draft-offer-prompt.js';
 *   served at GET /v1/prompts/draft-offer
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial: guided offer-drafting prompt (offering/billable/workflow levels).
 */

export const DRAFT_OFFER_PROMPT = `You are drafting an AIMEAT **offer** for the agent **{{agent_name}}** (GAII {{gaii}}) on node
{{node_id}}. An offer is the human-readable face of what this agent can do, and the machine contract the
mesh and Agent Workflows build on. Produce ONE offer that is as compatible as is honestly possible:

1. **Offering** (always) — a legible offer the owner can find.
2. **Workflow-compatible** (if the agent produces a checkable, locatable output) — so the offer can be a
   step in a workflow.
3. **Priced** (only if this agent should sell to OTHER owners) — otherwise leave pricing out.

First answer these to yourself from what you actually know about this agent — do NOT invent capability:
- What is the ONE thing it reliably does, and what does it explicitly NOT do? (negative scope)
- What memory key(s) does it WRITE its result to? (must be a stable, predictable key)
- What memory key (if any) must exist before it can start? (or is it a source with no input?)
- Should other owners be able to pay to invoke it? If so, what action/webhook runs it, and a fair price?

Then output the offer as JSON and publish it by calling **aimeat_memory_write** with:
  key   = "agents.{{agent_name}}.offers"
  value = { "version": 1, "updatedAt": "<ISO date>", "offers": [ <the offer below> ] }

The offer object:
{
  "id": "<kebab-id>",
  "title": "<short human title>",
  "ask": "<plain-language invite that INCLUDES the negative scope>",
  "example": "<one real sample request>",
  "tags": ["<reuse an existing machine tag>"],
  "cost": "cheap",                  // free | cheap | expensive
  "latency": "minutes",             // seconds | minutes | long-running
  "verification": "deterministic",  // deterministic = no LLM in the I/O path (strongest)
  "dataHandling": "local-only",     // local-only | llm-provider | third-party

  // ── workflow-compatibility (include when the output is checkable + locatable) ──
  "deliverable": {
    "format": "document",
    "location": { "key": "<the OUTPUT key it writes>", "visibility": "workspace" },
    "sample": "untested"            // replace with a REAL excerpt after the first successful run
  },
  "success_signal": { "kind": "deterministic", "key_glob": "<OUTPUT glob>", "op": "count_nonempty", "min": 1 },
  "required_to_function": { "kind": "deterministic", "key": "<INPUT key>", "op": "nonempty" },
  //   ↑ for a SOURCE with no memory input, replace this whole value with the string  "none"

  // ── pricing (OMIT all three for a private, self-use-only offer) ──
  "price": { "morsels": <int ≥ 0>, "unit": "per-call" },
  "visibility": "public",
  "callable": { "action_id": "<an action/capability id that runs this>" }
}

Hard rules (these keep the offer honest — follow them exactly):
- ask/example must be things this agent can actually do with its real tools, including what it does NOT do.
- success_signal points at the key(s) the agent WRITES; required_to_function at what it READS (or "none").
  Signals are checked owner-scope (across all of the owner's agents), so a downstream agent can depend on
  your output key — make it stable.
- Prefer deterministic signal ops. Use an {"kind":"llm","ask":"…"} leaf only if a judgment is
  unavoidable (it runs only when the node's OpenRouter is configured and the owner approved it).
- Never invent deliverable.sample — use "untested" until there is a real successful run.
- Pricing is for CROSS-owner use only; the owner's own use is always free. Omit price/visibility/callable
  unless this agent should genuinely sell to others.

After publishing, verify with aimeat_memory_read key="agents.{{agent_name}}.offers". Your onboarding
"Declare Offerings" (and, if you added signals/pricing, "Make Workflow-Compatible" / "Price an Offer")
steps tick automatically on the next aimeat_onboarding_status. Full spec:
docs/building-an-aimeat-compatible-agent.md.`;
