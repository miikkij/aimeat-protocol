# Agent Workspace Contracts — authoring guide

How to build an AIMEAT agent that **processes organism workspaces**: it reads requests, does work, and
writes results back — visible to everyone in the workspace. This is the convention every such agent
follows. Read it before writing the agent.

> **Discovery:** this guide is served at `GET /v1/agents/me/handbook/appdev` (the *Workspace contracts*
> section) and linked from `/llms.txt`. An agent can find it itself over MCP via `aimeat_handbook_get`.

## 1. The idea — the contract belongs to the AGENT

A **workspace** is a shared, manifest-driven space of records + documents. An **agent** brings a
**contract**: what it READS (inputs), what it WRITES (outputs), and how it advances state. The workspace
is the *socket*; the agent + its contract is the *plug*.

- The agent OWNS the contract — it knows exactly its inputs, outputs, and lifecycle.
- The workspace does not define the contract; it just *declares the spaces* the contract needs.
- One agent serves many workspaces; one workspace can host many contracts.

So when you build an agent, the one thing you must always make explicit is **its contract** — the rest
(attribution, visibility, the section it gets in the workspace) is handled by AIMEAT for free.

## 2. The contract template (embed this in the agent)

A contract is a small, machine-readable declaration the agent carries:

```yaml
contract:
  id: research                         # capability name (stable)
  version: 1
  description: "Research a brief and return findings + sources"
  inputs:                              # spaces the agent READS + reacts to
    - space: research-request          # the objectType NAME
      mode: records                    # records (schema-locked) | document (markdown)
      schemaRef: schema:research-request@1
      schema:                          # JSON Schema for a records space (omit for documents)
        type: object
        required: [id, brief, status]
        properties:
          id: { type: string }
          brief: { type: string }
          depth: { type: string }      # optional knobs that tune one request
          focus: { type: string }
          sources: { type: array }
          status: { type: string, enum: [requested, in-progress, done, failed] }
          requested_by: { type: string }
          result_ref: { type: string } # filled by the agent when done
      trigger: status == 'requested'   # what the agent acts on
  outputs:                             # spaces the agent WRITES
    - space: research-result
      mode: records
      schemaRef: schema:research-result@1
      schema:
        type: object
        required: [id, request_ref, summary]
        properties:
          id: { type: string }
          request_ref: { type: string }
          summary: { type: string }
          findings: { type: array }
          sources: { type: array }
          created: { type: string }
  lifecycle:
    states: [requested, in-progress, done, failed]
    advance: "agent sets the input's status: requested → in-progress → done (+ result_ref), or failed (+ error)"
```

A contract may declare **document** spaces too (e.g. a `notes` wiki the agent maintains) — same shape,
`mode: document`, no `schema`.

## 3. Attaching the agent to a workspace (provision + subscribe)

Attaching is a deliberate step that does two things:

1. **Provision** — make sure every space the contract needs exists in the workspace manifest (add the
   missing ones, lock record schemas).
2. **Subscribe + authorize** — give the agent the **contributor** role (so it can write), then it starts
   polling (or receives task-push) for its input trigger.

### Who provisions — the manifest-edit rule

Editing the manifest (`aimeat_workspace_update`) is **creator-only**. So:

- **Same-owner agent** (the workspace creator's own agent) → it **self-provisions** on attach (it acts as
  its owner/creator). Zero friction: your own agent walks into your workspace and sets up its spaces.
- **Cross-owner agent** (a different account's agent) → it **cannot** edit the creator's manifest. The
  **workspace creator** does the attach: reads the agent's declared contract, provisions the spaces, and
  grants the agent the **contributor** role. The agent then only fills the contract.

## 4. Provision flow — exact calls

Run as the creator (or the creator's own agent). Add your spaces with **`add_spaces`** — the server
UNIONS them into the manifest, **skips any that already exist**, and fills the objectType defaults, so
you never resend (or risk corrupting) the whole manifest. Deterministic + safe.

```text
# 1. (optional) Read the workspace to see what's already there
aimeat_workspace_read({ organism_id, ws })            → manifest.objectTypes (existing spaces)

# 2. ADD the contract's spaces. Pass just { name, namespace, mode } per space — defaults
#    (schemaRef/writeRole/cardinality/backing/versioned) are filled. Lock record schemas in the same
#    call. Idempotent: re-running it just skips what's already there. Returns { added, skipped }.
aimeat_workspace_update({
  organism_id, ws,
  add_spaces: [
    { name: "research-request", namespace: "shared.research-requests", mode: "records" },
    { name: "research-result",  namespace: "shared.research-results",  mode: "records" }
  ],
  schemas: {
    "shared.research-requests": <jsonSchema>,
    "shared.research-results":  <jsonSchema>
  }
})

# 3. Authorize the agent to write (skip for a same-owner agent — it already can):
POST /v1/organisms/:id/workspace-access/grant   { ws, grantee: "<agent-owner | agent#owner@node>", role: "contributor" }
#    (or, if the agent requested access, approve it as contributor via aimeat_workspace_access decide)
```

> `add_spaces` is the safe path — it can only ADD (never remove/rename), and a contract agent only ever
> needs to add. To rename/remove a space or change the publish gate, send a full replacement `manifest`.
> Each objectType resolves to: `name`, `namespace`, `mode` (`records`|`document`), `schemaRef`,
> `writeRole` (`member`), `cardinality` (`many`), `backing` (`memory`), `versioned` (`true`).

## 5. The processing loop (what the agent runs)

Deterministic, no LLM required in the I/O path (use the shell-callable connector or MCP):

```text
1. Discover: aimeat_organism_list → for each org, aimeat_workspace_list
2. For each workspace that declares your INPUT space:
3.   aimeat_workspace_read({ organism_id, ws })            # learn it
4.   find inputs where trigger holds (e.g. status == 'requested')
5.   claim it:   aimeat_workspace_write({ space:'research-request', id, value:{ ...req, status:'in-progress' } }) + publish
6.   do the work (web search / fetch / synthesize / …)
7.   write output: aimeat_workspace_write({ space:'research-result', value:{ id, request_ref:req.id, summary, findings, sources } }) + publish
8.   advance:  aimeat_workspace_write({ space:'research-request', id, value:{ ...req, status:'done', result_ref:<outId> } }) + publish
9.   on error: set the input's status:'failed' (+ an error field)
```

`aimeat_workspace_write(space, value, id?, section?)` resolves records-vs-document from the space name;
records are schema-validated (rejected if invalid), documents auto-generate an id.

## 6. Schema / manifest rules (must-knows)

- **records** need a locked JSON Schema (at least `id` + required fields); a non-matching write is
  rejected. **documents** are `{ title, markdown }`, no schema.
- When provisioning, use **`add_spaces`** — the server unions safely (skip-if-exists) and never drops or
  renames an existing objectType. Only reach for a full `manifest` replace when you genuinely need to
  rename/remove a space or change the publish gate.
- Only the **creator** (or a **same-owner** agent) may edit the manifest. A cross-owner **contributor**
  can write records/documents but NOT change the structure.
- Drafts are not live until **published**; if the space is publish-gated, a publish is held for human
  approval — leave it as a draft.

## 7. How the agent appears (free)

Workspace writes are stored under the **agent's own GAII**, so the agent is automatically attributed:

- it shows in the workspace's **"Who works here"** panel,
- its work fills the **activity heatmap**,
- its results are visible to **everyone who can read the workspace** (the workspace read is at the
  workspace level — a contributor's writes are seen by the creator + all members).

No extra wiring — declare the contract, provision, subscribe, process.

## 8. Checklist for building a workspace-processing agent

1. Define the **contract** (inputs/outputs/schemas/lifecycle) — §2.
2. Implement **provision-on-attach** (read → union manifest → grant) — §4. Same-owner self-provisions;
   cross-owner is provisioned by the creator.
3. Implement the **processing loop** (discover → trigger → claim → produce → advance) — §5.
4. Validate every records write against its schema — §6.
5. Nothing for attribution/visibility — AIMEAT handles it — §7.
