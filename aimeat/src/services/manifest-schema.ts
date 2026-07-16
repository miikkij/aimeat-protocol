/**
 * @file manifest-schema.ts
 * @description The generic "manifest-format" JSON Schema and its idempotent startup seed.
 *   An organism becomes a governed workspace (project, research-study, campaign, anything)
 *   by storing a manifest at `organism.{id}.meta.manifest`. The manifest is a self-describing
 *   index + flow: it declares the OPEN, schema-defined object vocabulary (`objectTypes`), the
 *   entry hints, the flow DAG, sharing and policy. This module registers ONE wildcard schema
 *   (`organism.*.meta.manifest`) so every manifest write — for any `kind`, any language — is
 *   validated against the same format. The object *shapes* are separate per-organism schemas
 *   (authored as CSMs); this validates only the orchestration envelope.
 * @structure
 *   - MANIFEST_FORMAT_SCHEMA — the JSON Schema (schema_mode: open, so the format can evolve)
 *   - MANIFEST_SCHEMA_KEY — the wildcard keyPattern it is registered under
 *   - seedManifestSchema() — idempotent registration, called once at node startup
 * @usage
 *   import { seedManifestSchema } from '../services/manifest-schema.js';
 *   await seedManifestSchema(storage, `system@${config.nodeId}`);
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 3: validate the manifest envelope for every organism workspace.
 *   v1.1.0 -- 2026-06-08 -- Also seed the workspace-scoped pattern organism.*.w.*.meta.manifest
 *     (one organism holds many workspaces); the single-segment `*` matcher needs the explicit w.*.
 *   v1.2.0 -- 2026-06-10 -- backing enum narrowed to memory|tasks. 'storage'/'knowledge' were dead
 *     weight: no write/read/UI path existed for them, but the enum invited agents to pick them ("a
 *     document space sounds like knowledge") and the space silently vanished from every surface.
 *     Files/knowledge attach via workspace Sources or embedded document images instead.
 *   v1.3.0 -- 2026-06-10 -- Version-aware seed: the schema carries a `$comment: aimeat-seed-vN`
 *     marker, and seedManifestSchema() UPGRADES a stale system-seeded record in place at startup
 *     (so old connectors' raw manifest writes hit the new enum on existing nodes too, no manual
 *     migration). An operator-customized schema (lockedBy ≠ the system identity) is left alone —
 *     the same guarantee as before.
 *   v1.4.0 -- 2026-06-16 -- objectType gains an optional `contract` string (a provisioning agent
 *     stamps it; the workspace UI groups all spaces sharing a contract into one unit). Open schema,
 *     so it was always accepted — listed for clarity. Seed version bumped 2→3 so the stored system
 *     schema upgrades in place.
 *   v1.5.0 -- 2026-06-23 -- Measurability convention (domain-agnostic): optional top-level
 *     `objectives[]` (why + measurable KPIs: kind/unit/target/source, where source is a string recipe
 *     or a `{from:'records',...}` aggregation over the organism's own records) and an optional
 *     objectType `servesObjective` linking a space to the objective it feeds. Schema stays `open` so
 *     absent objectives stay valid, but the defined subschema enforces the kind/op enums when present.
 *     Seed version bumped 3→4 so the stored system schema upgrades in place. Design:
 *     docs/internal/2026-06-23-organism-measurability-design.md.
 */
import type { Storage } from '../storage/interface.js';

/** Wildcard keyPattern (prefix mode) — matches `organism.{anyId}.meta.manifest` for every organism. */
export const MANIFEST_SCHEMA_KEY = 'organism.*.meta.manifest';
/** Same envelope for workspace-scoped manifests `organism.{anyId}.w.{anyWs}.meta.manifest`
 *  (one organism holds many workspaces). The single-segment `*` matcher needs the explicit `w.*`. */
export const MANIFEST_WS_SCHEMA_KEY = 'organism.*.w.*.meta.manifest';

/**
 * The manifest envelope schema. Kept `open` (additionalProperties allowed) so the format can
 * evolve and a custom generator can add fields — but the required core + the bounded enums
 * (`status`, `objectTypes[].backing|writeRole|cardinality`) are always enforced, so a malformed
 * manifest write returns 422 through the existing `validateMemoryWrite` path.
 *
 * NOTE: stage `type`s and object `name`s are intentionally NOT enumerated here — the vocabulary
 * is open and declared per-manifest in `objectTypes`. A Finnish `kind:'tutkimus'` manifest using
 * `tavoite`/`hypoteesi` validates identically to an English `kind:'project'` one.
 */
/** Bump when the seeded schema changes in a way existing nodes must pick up (e.g. the backing
 *  enum). seedManifestSchema() upgrades any system-seeded record carrying an older version. */
export const MANIFEST_SEED_VERSION = 4;

export const MANIFEST_FORMAT_SCHEMA: Record<string, unknown> = {
  // Standard JSON Schema annotation (safe under ajv strict mode) doubling as the seed-version
  // marker — seededVersionOf() parses it to decide whether a stored record needs the upgrade.
  $comment: `aimeat-seed-v${MANIFEST_SEED_VERSION}`,
  type: 'object',
  required: ['manifestVersion', 'id', 'name', 'kind', 'status', 'objectTypes'],
  properties: {
    manifestVersion: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    kind: { type: 'string' },
    summary: { type: 'string' },
    language: { type: 'string' },
    status: { enum: ['active', 'paused', 'done', 'archived'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    entry: {
      type: 'object',
      properties: {
        readme: { type: 'string' },
        loadHint: { type: 'string' },
        primaryGoal: { type: 'string' },
      },
    },
    objectTypes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'schemaRef', 'namespace', 'backing', 'writeRole'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          schemaRef: { type: 'string' },
          namespace: { type: 'string' },
          cardinality: { enum: ['one', 'many'] },
          backing: { enum: ['memory', 'tasks'] },  // spaces are memory-backed; 'tasks' = pointer to the task system. Files/knowledge attach via Sources or document images — never as a backed space.
          writeRole: { enum: ['owner', 'admin', 'member'] },
          mode: { enum: ['records', 'document'] },  // 'records' (schema-locked form, default) | 'document' (free-form markdown pages)
          append: { type: 'boolean' },
          versioned: { type: 'boolean' },  // draft → publish → .version.N + .latest history (default true)
          maxVersions: { type: 'number' },  // per-space history retention window (overrides AIMEAT_WS_MAX_VERSIONS; 0 = keep all; create_only spaces never pruned)
          contract: { type: 'string' },  // optional contract id a provisioning agent stamps; the workspace UI groups all spaces sharing a contract into one unit
          servesObjective: { type: 'string' },  // optional: id of an objectives[] entry this space feeds (measurability convention)
        },
      },
    },
    // Measurability convention (all optional; domain-agnostic — units are the domain's: € of timber,
    // viable plots, confirmed hypotheses, closed deals). The subschema enforces the kind/op enums when
    // present, while the open envelope keeps a manifest with no objectives valid. See
    // docs/internal/2026-06-23-organism-measurability-design.md.
    objectives: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'statement'],
        properties: {
          id: { type: 'string' },                 // stable slug, referenced by objectType.servesObjective
          statement: { type: 'string' },          // what this is for
          why: { type: 'string' },                // why it matters now
          status: { enum: ['active', 'met', 'abandoned'] },
          kpis: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                kind: { enum: ['value', 'cost', 'roi', 'outcome', 'quality'] },
                unit: { type: 'string' },          // the domain's unit (EUR, count, minutes, %, …)
                target: {
                  type: 'object',
                  properties: {
                    op: { enum: ['<', '<=', '>', '>=', '==', 'between'] },
                    value: { type: 'number' },
                    values: { type: 'array', items: { type: 'number' } },  // for op: 'between'
                  },
                },
                // string recipe (human/agent-readable, NOT auto-evaluated in v1) OR an aggregation object
                // { from:'records', space, agg:'sum'|'count'|'avg'|'min'|'max', field, equals? } over the
                // organism's own published records. (Agent-ops sources telemetry/wallet/quota are a fenced
                // appendix — see the design doc §5 — and not enabled in this build.)
                source: { type: ['string', 'object'] },
                of: { type: 'object' },            // for kind:'roi' — { value:'<kpiName>', cost:'<kpiName>' }
                current: { type: 'number' },       // last-known value (cache, not history)
                measuredAt: { type: 'string' },
                measuredBy: { type: 'string' },
              },
            },
          },
        },
      },
    },
    flow: { type: 'object' },
    sharing: { type: 'object' },
    policy: { type: 'object' },
  },
};

/** Seed version of a stored schema record: parsed from the `$comment: aimeat-seed-vN` marker.
 *  Records seeded before versioning existed (no marker) count as v1. */
export function seededVersionOf(schemaJson: Record<string, unknown> | undefined | null): number {
  const c = schemaJson?.$comment;
  const m = typeof c === 'string' ? /^aimeat-seed-v(\d+)$/.exec(c) : null;
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Register the manifest-format schema at startup — and UPGRADE it in place when this build ships
 * a newer seed version (so e.g. the backing-enum narrowing reaches existing nodes' DBs without a
 * manual migration). An operator-customized record (lockedBy ≠ the system identity this is called
 * with) is left alone, the same guarantee the create-only seed gave. Mirrors `seedProfileSchemas`
 * (a global `*`-wildcard prefix schema resolved by `findApplicableSchema`'s wildcard pass).
 *
 * @returns the number of records written (newly seeded + upgraded).
 */
export async function seedManifestSchema(storage: Storage, lockedBy: string): Promise<number> {
  const now = new Date().toISOString();
  let seeded = 0;
  for (const keyPattern of [MANIFEST_SCHEMA_KEY, MANIFEST_WS_SCHEMA_KEY]) {
    const existing = await storage.getSchema(keyPattern, 'prefix');
    if (existing) {
      if (existing.lockedBy !== lockedBy) continue;                             // operator-customized — hands off
      if (seededVersionOf(existing.schemaJson) >= MANIFEST_SEED_VERSION) continue;  // already current
      await storage.setSchema({ ...existing, schemaJson: MANIFEST_FORMAT_SCHEMA, schemaMode: 'open', updatedAt: now });
      seeded++;
      continue;
    }
    await storage.setSchema({
      keyPattern,
      applyTo: 'prefix',
      schemaJson: MANIFEST_FORMAT_SCHEMA,
      schemaMode: 'open',
      lockedBy,
      setAt: now,
      updatedAt: now,
    });
    seeded++;
  }
  return seeded;
}
