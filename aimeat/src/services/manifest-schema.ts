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
 */
import type { Storage } from '../storage/interface.js';

/** Wildcard keyPattern (prefix mode) — matches `organism.{anyId}.meta.manifest` for every organism. */
export const MANIFEST_SCHEMA_KEY = 'organism.*.meta.manifest';

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
export const MANIFEST_FORMAT_SCHEMA: Record<string, unknown> = {
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
          backing: { enum: ['memory', 'tasks', 'storage', 'knowledge'] },
          writeRole: { enum: ['owner', 'admin', 'member'] },
          append: { type: 'boolean' },
        },
      },
    },
    flow: { type: 'object' },
    sharing: { type: 'object' },
    policy: { type: 'object' },
  },
};

/**
 * Register the manifest-format schema once. Idempotent — leaves an operator-customized schema
 * in place. Mirrors `seedProfileSchemas` (a global `*`-wildcard prefix schema resolved by
 * `findApplicableSchema`'s wildcard pass).
 *
 * @returns 1 if newly seeded, 0 if it already existed.
 */
export async function seedManifestSchema(storage: Storage, lockedBy: string): Promise<number> {
  const existing = await storage.getSchema(MANIFEST_SCHEMA_KEY, 'prefix');
  if (existing) return 0;

  const now = new Date().toISOString();
  await storage.setSchema({
    keyPattern: MANIFEST_SCHEMA_KEY,
    applyTo: 'prefix',
    schemaJson: MANIFEST_FORMAT_SCHEMA,
    schemaMode: 'open',
    lockedBy,
    setAt: now,
    updatedAt: now,
  });
  return 1;
}
