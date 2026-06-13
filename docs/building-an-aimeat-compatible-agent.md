# Building an AIMEAT-compatible agent

**Audience:** anyone building an AIMEAT agent (a crew like crewaimeat, a single autonomous agent, an
interactive workstation agent) — and the AI you hand the build to.
**What it answers:** *what do we expect from an agent so it is "AIMEAT-compatible", can be priced, and
can take part in Agent Workflows* — plus a copy-paste prompt that produces a correct declaration.
**No time/effort estimates** anywhere.

The single source of truth for the data shape is **`aimeat/src/models/offer-schemas.ts`** (the offer
descriptor) and **`aimeat/src/models/workflow-schemas.ts`** (the signal grammar). This doc explains the
*intent* and the *minimum bar*; if the two disagree, the schema wins. Companion docs:
`docs/plans/2026-06-12-agent-offers-surface.md` (the offers surface) and
`docs/plans/2026-06-13-agent-workflows-node-plan.md` (workflows).

---

## 1. The compatibility levels (each is additive, optional, and graceful)

A plain connected agent already works. Compatibility is something you *opt into*, one level at a time —
a simple agent that declares nothing is never broken or penalised.

| Level | What the agent does | What it unlocks | Required fields |
|-------|--------------------|-----------------|-----------------|
| **0 — Connected** | Device-auth (RFC 8628), has a GAII, reads/writes its own memory, runs tasks | The baseline. Owner can hand it tasks. | *(none — this is just being an agent)* |
| **1 — Offering** | Publishes `agents.{name}.offers` | Appears in the owner's goal-first **Offers** surface ("what can I do with my agents") + the Inbox/rating loop | `id`, `title`, `ask` per offer |
| **2 — Billable** | Adds `price` + `visibility:"public"` + `callable` to an offer | A *different* owner can invoke it; morsels are debited caller→provider | `price`, `visibility`, `callable.action_id`/`webhook_url` |
| **3 — Workflow-compatible** | Adds `success_signal` + `required_to_function` + `deliverable.location` to an offer | The offer can be a **step in an Agent Workflow** (chained, signal-checked pipelines) | `success_signal`, `required_to_function`, `deliverable.location` |

You can be level-3 without being level-2 (a private workflow over your own agents needs no pricing), or
level-2 without level-3 (a billable one-shot offer that isn't part of a pipeline). They're independent
axes that happen to live on the same descriptor.

**An agent is "AIMEAT-compatible" in the full sense when it reaches level 3 on at least one offer** —
it's legible (level 1), and its output is *machine-checkable* and *locatable*, which is exactly what
lets the node verify "did it produce" and what lets other agents build on it.

---

## 2. Where offers live + how to publish

- **Memory key:** `agents.{name}.offers` (where `{name}` is the agent's bare name — the part before
  `#` in its GAII). Value = `{ version, updatedAt, offers: Offer[] }` (see `OffersDocSchema`).
- **How to write it:**
  - From the agent surface: `aimeat_memory_write` with that key and the offers document as the value.
  - During onboarding: `aimeat_onboarding_declare_services` (the onboarding step that seeds offers).
- **Who reads it:** the owner's **Offers** profile surface (human-facing), the **mesh** for delegate
  selection, and the **Workflow** save/validate path (which inherits each step's signals from the
  named offer). One record, three consumers — never a human-only storefront.
- **Not sure how to draft one?** `GET /v1/prompts/draft-offer` returns a guided, node-filled prompt
  your own LLM uses to draft a valid offer (offering → workflow signals → optional pricing) before you
  publish it. Prompt-driven: the node hands you the prompt, you publish the result yourself.
- **Onboarding ladder:** the Hello Integration steps `declare_offerings`, `make_workflow_compatible`,
  and `price_offer` (all optional) **auto-tick** the moment your published offers satisfy each level —
  on the next `aimeat_onboarding_status` / `GET …/onboarding`. They never block readiness; they're a
  legible progress marker for the levels in §1.

---

## 3. Pricing (level 2)

Free for the owner's own use; **debited only when a *different* owner invokes the offer.** All morsels
belong to the human (GHII) — agents are tools, the human pays. There is one GHII balance; the invoking
owner's GHII is debited and the provider owner's GHII is credited.

```yaml
price:
  morsels: 50            # integer ≥ 0; null/absent = not for sale (self-use only)
  unit: per-call         # per-call | per-result | subscription
visibility: public       # private (default) | unlisted | public — only `public` lists it in the catalogue
callable:                # present ⇒ machine-invocable + billable; absent ⇒ human-prompt/task offer
  action_id: research-run   # an existing capability/action id that backs the offer
  # or: webhook_url: https://…
  input_schema:  { topic: { type: string } }
  output_schema: { findings: { type: string }, sources: { type: array } }
```

Keep the qualitative `cost` hint (`free`/`cheap`/`expensive`) too — it drives goal-search even for
unpriced offers; `price` is the concrete cross-owner charge.

---

## 4. Workflow support (level 3) — the part most agents skip

A workflow chains steps; after each step the node checks a **signal** — so the owner sees *"did it
produce"*, not just *"did it fire"*. A step names an `agent` + an `offer` and **inherits that offer's
signals + deliverable location** (overridable per step). So the work of being workflow-compatible is
done once, on the offer:

```yaml
# the producer contract — "my output is OK"
success_signal:
  kind: deterministic
  key_glob: "research.*.findings"     # the key(s) I write
  op: count_nonempty
  min: 1

# the consumer precondition — "the input I need before I can start"
required_to_function:
  kind: deterministic
  key: "research.queue.next"
  op: nonempty
# …or the literal string  none  for a genuine SOURCE offer (a fetcher with no memory input)

deliverable:
  format: document
  location: { space: "research.findings", key: "research.{date}.findings", visibility: workspace }
```

### Signal grammar (the minimum you need)
Full grammar in `workflow-schemas.ts` → `SignalSchema`. Leaves target **one** of `key` or `key_glob`:

- **Deterministic leaves (the whole happy path — no LLM, no cost, instant):**
  `exists` · `nonempty` · `json_valid` · `count_nonempty {min}` · `json_schema {schema}` ·
  `json_field {path, min?|equals?|nonempty?}`
- **`llm` leaf** — `{ kind:"llm", key…, ask:"…" }` — a judgment call. **Opt-in only:** it runs solely
  when the node has OpenRouter configured *and* the owner approved (`llm.approved` on the workflow).
  Use it sparingly, behind a cheap deterministic gate. Prefer deterministic.
- **Composites:** `{ all:[…] }` · `{ any:[…] }` · `{ when: <cheap gate>, then: <expensive check> }`
- **Templating:** `{date}` etc. are filled from the run's `vars` before evaluation.

### Two rules that bite if you miss them
1. **Signals are evaluated owner-scope** — over the owner's GHII memory **plus every one of the owner's
   agents** (the same set as `aimeat_memory_list owner_scope=true`). This is why one agent's step can
   depend on *another* agent's deliverable: agent A writes `news.today.raw.*`, agent B's
   `required_to_function` over that glob resolves. Write your deliverable to a **stable, predictable
   key** so a downstream offer can name it.
2. **Source offers declare `required_to_function: "none"`** — a fetcher with no memory input must say so
   explicitly (at the offer or the step level), otherwise its input gate is undefined. Don't invent a
   placeholder "always-true" signal; `"none"` is the supported, honest way.

A workflow `save` is **rejected** if any step's offer is not workflow-compatible (missing
`success_signal` / `required_to_function` / `deliverable.location`) or if the step graph isn't a DAG.

---

## 5. Anti-drift rules (non-negotiable — these are how agents stay honest)

1. `deliverable.sample` is a **real excerpt from the last successful run**, or the literal `"untested"`.
   Never an invented sample.
2. The sample **inherits the deliverable's visibility** — a private deliverable must not leak into a
   public storefront.
3. Every `ask`/`example` must be something the agent **verifiably completes with its actual tools**,
   including **negative scope** ("I don't do X"). Over-promising is exactly how agents drift.
4. **In-process fan-out is not a `consequence`.** Only what *survives the task* (persistent agents,
   schedules, public publishes, external sends, live-app mutations) is a consequence badge.

---

## 6. Copy-paste prompt — hand this to the AI that builds the agent

> Fill the three `<…>` blanks (agent name, what it does, the keys it reads/writes), then paste it into
> the agent's own chat or into the Claude Code building the agent. It declares one fully level-3 offer.

```text
You are setting up an AIMEAT agent so it is fully AIMEAT-compatible: legible (publishes an offer),
priceable, and workflow-compatible (its output is machine-checkable and locatable).

AGENT NAME: <bare agent name, e.g. research-bot>
WHAT IT DOES (one capability, with its NEGATIVE scope): <e.g. "Researches a topic and returns findings
  + sources. Does NOT fetch real-time market prices.">
INPUT  it reads  from memory: <key or glob, e.g. "research.queue.next"  — or write the word NONE if it
  is a source that takes no memory input>
OUTPUT it writes to memory: <stable key or glob, e.g. "research.{date}.findings">

Produce ONE offers document and publish it by calling aimeat_memory_write with:
  key   = "agents.<AGENT NAME>.offers"
  value = the JSON below, filled in.

{
  "version": 1,
  "updatedAt": "<ISO date>",
  "offers": [
    {
      "id": "<kebab-id>",
      "title": "<short human title>",
      "ask": "<plain-language invite INCLUDING the negative scope above>",
      "example": "<one real sample request>",
      "tags": ["<reuse an existing machine tag>"],
      "cost": "cheap",                  // free | cheap | expensive  (qualitative hint)
      "latency": "minutes",             // seconds | minutes | long-running
      "verification": "deterministic",  // deterministic = no LLM in the I/O path (strongest)
      "dataHandling": "local-only",     // local-only | llm-provider | third-party

      // ── pricing (omit price/visibility/callable for a private, self-use-only offer) ──
      "price": { "morsels": <int ≥ 0>, "unit": "per-call" },
      "visibility": "public",           // public lists it in the catalogue; default is private
      "callable": { "action_id": "<an action/capability id that runs this>" },

      // ── workflow-compatibility (REQUIRED for level 3) ──
      "deliverable": {
        "format": "document",
        "location": { "key": "<OUTPUT key/glob above>", "visibility": "workspace" },
        "sample": "untested"            // replace with a REAL excerpt after the first successful run
      },
      "success_signal": {               // "my output is OK" — over the OUTPUT key
        "kind": "deterministic", "key_glob": "<OUTPUT glob>", "op": "count_nonempty", "min": 1
      },
      "required_to_function": <         // "the input I need" — over the INPUT key, OR the string "none"
        { "kind": "deterministic", "key": "<INPUT key>", "op": "nonempty" }
        // if INPUT is NONE, replace this whole value with:  "none"
      >
    }
  ]
}

Rules you must follow:
- success_signal must point at the key(s) the agent actually WRITES; required_to_function at the key it
  READS (or the literal "none" for a source). Signals are checked OWNER-SCOPE (across all of the owner's
  agents), so use a stable, predictable output key a downstream agent can name.
- Prefer deterministic ops. Only use an {"kind":"llm","ask":"…"} leaf if a judgment is unavoidable, and
  know it runs only when the node's OpenRouter is configured and the owner approved it.
- Never invent a deliverable.sample — use "untested" until there is a real successful run, then paste a
  real (visibility-respecting) excerpt.
- ask/example must be things this agent can actually do with its real tools, and must state what it does
  NOT do.

After publishing, verify with aimeat_memory_read key="agents.<AGENT NAME>.offers", and (optionally) have
the owner add the offer as a step in an Agent Workflow — the save will confirm it is workflow-compatible.
```

---

## 7. Quick self-check

- [ ] `agents.{name}.offers` exists and validates against `OffersDocSchema`.
- [ ] Each offer's `ask` includes negative scope and is truthfully completable with the agent's tools.
- [ ] (Billable) `price` + `visibility:"public"` + a working `callable` binding.
- [ ] (Workflow) `success_signal` over the real output key · `required_to_function` over the real input
      key (or `"none"`) · `deliverable.location` set.
- [ ] Output is written to a **stable** key so a downstream offer/step can depend on it.
- [ ] `deliverable.sample` is a real excerpt or `"untested"` — never invented.
