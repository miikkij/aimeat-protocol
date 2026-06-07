# Organism template bundles

A **template bundle** turns a bare organism into a governed *workspace* of a given `kind`
(the shipped one is `project`). A bundle is **pure data** — no backend route is specific to it:

```
docs/csm-bundles/{kind}/
  ├── <type>.csm.yaml     # one CSM per object type (the shape, the single shape system)
  └── manifest.template.json   # the manifest skeleton wiring the types together
```

AIMEAT stays generic. There is **no project router** and **no per-object-type endpoints**.
Object records are read/written through the generic memory API and validated by their CSM-compiled
JSON Schema; the manifest is just a memory record validated by the global `organism.*.meta.manifest`
schema. A different `kind` (e.g. a Finnish `tutkimus` with `tavoite`/`hypoteesi`) is another bundle
on the **same** engine — the core never enumerates `goal`/`plan`/`deliverable`.

## What's seeded at startup

- The **manifest-format schema** (`organism.*.meta.manifest`, wildcard prefix) — every manifest
  write is validated against it (`services/manifest-schema.ts`).
- Each bundle's object CSMs are registered **globally** (idempotent), so their compiled schemas are
  fetchable through the existing CSM API (`services/template-bundles.ts`):
  - `GET /v1/csm/project-goal` → the CSM + `json_schema_key`
  - `GET /v1/memory/csm.project-goal/schema` → the compiled JSON Schema

## Applying a bundle to an organism (existing endpoints only)

A client or agent applies a bundle with the generic schema + memory APIs — there is **no apply
route**. Given an organism `{id}` the caller created:

1. **Register each object type's organism-scoped schema** (so writes to that namespace are
   validated). For every memory-backed `objectTypes[]` entry in the manifest, take the bundle CSM's
   compiled schema and register it at the organism namespace:

   ```http
   PUT /v1/memory/{organism.{id}.meta.goals}/schema
   { "schema": <compiled goal schema>, "apply_to": "prefix", "schema_mode": "strict" }
   ```

   Repeat for `meta.plans`, `shared.deliverables`, `meta.decisions`, `shared.resources`.
   (`task` is backed by the task system — no memory schema.)

2. **Write the manifest** — fill `__ORGANISM_ID__`, `__NAME__`, `__SUMMARY__` in
   `manifest.template.json` and store it:

   ```http
   POST /v1/memory
   { "key": "organism.{id}.meta.manifest", "value": <manifest>, "visibility": "private" }
   ```

3. **Write a readme** (markdown, no schema) at `organism.{id}.meta.readme`, then start writing
   object instances (`organism.{id}.meta.goals.{gid}`, …) — each validated by step 1's schema.

## Workspace access (consent)

`meta.*`/`shared.*` reads and writes go through the workspace-access middleware. With the consent
layer enabled, the owner needs a connected agent holding an active grant
`organism.{id}.**` → recipient `organism.{id}` (created via `POST /v1/consent`). Own
`member.{owner}.*` writes need no consent. A grant whose recipient is `organism.{id}` resolves for
any active member, which is what lets fellow members read the workspace.

## Reading the workspace

```http
GET /v1/organisms/{id}/workspace
```

Membership-gated; returns `{ manifest, readme, objects: { <typeName>: [...] }, decisions, resources,
todos }`, following whatever `objectTypes` the manifest declares.
