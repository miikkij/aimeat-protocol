# PyPI offers + workflow-compat support — spec + copy-paste prompt for aimeat-crewai

**Created:** 2026-06-13
**Status:** Spec ready. This is doc-pho2b29 **surface ③** — the connector/PyPI half. It lives in the
**`aimeat-crewai`** repo (NOT in `aimeat-protocol`), so it cannot be implemented from the node repo;
this doc is the spec + the copy-paste prompt to hand to that repo's Claude Code.
**No time/effort estimates.**

## Goal

Generalise what crewaimeat already does (`offers.py` + `workflow_spec.py` = the executable reference)
into reusable connector/PyPI capabilities so **any** agent — not just "crewaimeat-crew" — can:

1. **`publish_offers`** — write a validated offers document to `agents.{name}.offers` (the node memory
   key the Offers surface + mesh + workflows all read).
2. **Signal builder** — helpers to construct the deterministic-first signal grammar
   (`success_signal` / `required_to_function`) without hand-writing JSON.
3. **Local workflow-compat validator** — a `shell` command **and** an MCP tool that, offline, tells an
   agent whether an offer is workflow-compatible (and why not), mirroring the node's save-time check.

The node side (this repo) is already done and deployed: the offer descriptor + signal grammar
(`aimeat/src/models/offer-schemas.ts`, `workflow-schemas.ts`), the owner-scope evaluator, the Hello
Integration ladder (`declare_offerings` / `make_workflow_compatible` / `price_offer`), the guided
prompt `GET /v1/prompts/draft-offer`, and the page `GET /v1/agents/me/handbook/offerings`. The
canonical contract + the human spec is `docs/building-an-aimeat-compatible-agent.md` in aimeat-protocol.

## The contract the package must build to (do not re-invent — mirror these)

An offer (subset relevant here):
- **Level 1 (offering):** `id`, `title`, `ask` (incl. negative scope).
- **Level 3 (workflow-compatible):** `success_signal` + `required_to_function` (a Signal **or** the
  literal string `"none"`) + `deliverable.location` (a stable key/space).
- **Level 2 (priced):** `price {morsels, unit}` + `visibility:"public"` + `callable {action_id |
  webhook_url}`.

Signal grammar (leaves target exactly one of `key` | `key_glob`):
- deterministic `op`: `exists` · `nonempty` · `json_valid` · `count_nonempty {min}` ·
  `json_schema {schema}` · `json_field {path, min?|equals?|nonempty?}`
- `llm` leaf `{kind:"llm", key…, ask}` (opt-in, node-OpenRouter + owner-approved only)
- composites: `{all:[…]}` · `{any:[…]}` · `{when, then}`
- `{var}` templating filled from run vars.

Two invariants the validator MUST enforce (these are exactly where agents drift):
1. `success_signal` targets keys the agent **writes**; `required_to_function` targets the key it
   **reads**, or is `"none"` for a source. Signals are evaluated **owner-scope** on the node, so the
   output key must be stable + predictable.
2. `deliverable.sample` is a real excerpt or the literal `"untested"` — never invented.

## Copy-paste prompt for the aimeat-crewai Claude Code

```text
In the aimeat-crewai repo, add reusable offers + workflow-compatibility support to the connector/PyPI
package, generalising offers.py + workflow_spec.py (our executable reference) so ANY agent can use them
— not just the crewaimeat crew. The AIMEAT node side is already deployed; build to its contract.

Canonical contract (read these in the aimeat-protocol repo, do not re-derive):
- docs/building-an-aimeat-compatible-agent.md  (the human spec + the 3 levels + the copy-paste prompt)
- aimeat/src/models/offer-schemas.ts            (the offer descriptor — the source of truth)
- aimeat/src/models/workflow-schemas.ts          (the signal grammar — the source of truth)
Live helpers on any node: GET /v1/prompts/draft-offer and GET /v1/agents/me/handbook/offerings.

Build THREE things:

1. publish_offers(offers, *, agent_name=None, validate=True)
   - Validates the offers document against the offer descriptor (port the Zod shape to pydantic/jsonschema;
     reuse workflow_spec.py where it already encodes signals).
   - Writes it to memory key  agents.{agent_name}.offers  via the connector's authenticated memory write
     (the same path the connector already uses for other memory). agent_name defaults to the connector's
     own bare GAII name.
   - Refuses to publish (with a clear error) if validate=True and the doc fails the local validator below.

2. A signal builder — small, composable helpers so callers don't hand-write JSON:
     sig.exists(key) / sig.nonempty(key) / sig.count_nonempty(key_glob, min=1) /
     sig.json_valid(key) / sig.json_field(key, path, min=…|equals=…|nonempty=True) /
     sig.json_schema(key, schema) / sig.llm(key, ask) /
     sig.all(*signals) / sig.any(*signals) / sig.when(cond, then) / sig.NONE  (== "none")
   Each leaf targets exactly one of key|key_glob (raise if both/neither). Mirror the names + semantics
   in workflow-schemas.ts EXACTLY — do not invent ops.

3. A local workflow-compat validator, exposed BOTH as a shell command AND an MCP tool:
     shell:  aimeat offers check [--file offers.json | --stdin]
     mcp:    a tool e.g. aimeat_offers_check  (input: the offers doc; output: per-offer verdict)
   For each offer it reports the highest level reached and, when an offer is NOT workflow-compatible,
   exactly what's missing — mirroring the node's save-time check:
     - level 1 (offering):   id + title + ask present
     - level 3 (workflow):   success_signal + required_to_function (Signal or "none") + deliverable.location
     - level 2 (priced):     price (non-null) + visibility=="public" + callable(action_id|webhook_url)
   Also surface the two drift checks: warn if deliverable.sample looks invented (not a real excerpt and
   not the literal "untested"), and warn if success_signal/required_to_function key targets look unstable
   (e.g. contain a timestamp/uuid that a downstream step couldn't predict). These are WARNINGS, not hard
   failures, except the level gates which are hard.

Constraints:
- This must be GENERIC: no crewaimeat-crew-specific assumptions. offers.py/workflow_spec.py are the
  reference to generalise FROM, not to depend ON.
- Mirror the node contract precisely; if you find a mismatch with offer-schemas.ts / workflow-schemas.ts,
  the node schema wins — flag it, don't fork the grammar.
- Add tests: a valid level-3 offer passes; a level-1-only offer is flagged "not workflow-compatible —
  missing success_signal/required_to_function/deliverable.location"; "none" is accepted as a valid
  required_to_function; a leaf with both key and key_glob is rejected.
- Follow the repo's existing release line (this is the Python aimeat-crewai line, tag-triggered PyPI —
  separate from the Node release line; bump pyproject accordingly).
```

## Done / not-done tracking (so the organism + repo stay honest)

- Node side: **done + deployed** (offer descriptor, signal grammar, owner-scope eval, Hello Integration
  ladder, draft-offer prompt, offerings handbook page).
- PyPI side: **pending in aimeat-crewai** — implemented with the prompt above, in that repo.
