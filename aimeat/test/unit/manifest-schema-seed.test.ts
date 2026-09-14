/**
 * @file manifest-schema-seed.test.ts
 * @description The manifest-format schema lives in each node's own database, and the boot seeder
 *   upgrades it in place when a build ships a newer seed version. That upgrade used to fire only
 *   when the stored record's `lockedBy` equalled the node's CURRENT system identity, which reads a
 *   renamed node's own earlier self as a stranger: innokas.aimeat.io was first booted as
 *   `aimeat-local-001-dev`, renamed on 2026-08-24, and three weeks later still refused every
 *   `backing: 'rows'` manifest from a stored enum of memory|tasks while running code that supports
 *   row spaces. Measured 2026-09-14 by reading its public `GET /v1/memory/…/schema`.
 *
 *   The distinction the seeder actually needs is "did a seeder write this", and only a seeder
 *   writes a `system@` lock: `PUT /v1/memory/:key/schema` stamps the caller's GHII.
 * @structure
 *   - a record seeded under an older node id is upgraded, and re-stamped with the current identity
 *   - the upgraded enum is the one this build ships, so `rows` is accepted afterwards
 *   - an operator's own (GHII-locked) schema is left alone, whatever version it carries
 *   - a record already at the current seed version is not rewritten
 * @usage cd aimeat && pnpm exec vitest run test/unit/manifest-schema-seed.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { SchemaRecord } from '../../src/storage/types/apps.js';
import {
  seedManifestSchema,
  seededVersionOf,
  MANIFEST_SCHEMA_KEY,
  MANIFEST_WS_SCHEMA_KEY,
  MANIFEST_SEED_VERSION,
} from '../../src/services/manifest-schema.js';

/** What innokas.aimeat.io was called when it first booted, and what it is called now. */
const OLD_NODE = 'system@aimeat-local-001-dev';
const THIS_NODE = 'system@innokas-finland-001-genesis';
const AN_OPERATOR = 'jounimiikki@innokas-finland-001-genesis';

/** The stored shape of a node seeded before row spaces existed: the enum has no 'rows'. */
const SEED_V4: Record<string, unknown> = {
  $comment: 'aimeat-seed-v4',
  type: 'object',
  required: ['manifestVersion', 'id', 'name', 'kind', 'status', 'objectTypes'],
  properties: {
    objectTypes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { backing: { enum: ['memory', 'tasks'] } },
      },
    },
  },
};

function stale(keyPattern: string, lockedBy: string): SchemaRecord {
  return {
    keyPattern,
    applyTo: 'prefix',
    schemaJson: structuredClone(SEED_V4),
    schemaMode: 'open',
    lockedBy,
    setAt: '2026-08-21T10:33:08.000Z',
    updatedAt: '2026-08-21T10:33:08.000Z',
  };
}

/** The one value the whole trap is about: which backings a manifest may declare. */
function backings(record: SchemaRecord | null): unknown {
  const props = record?.schemaJson?.properties as Record<string, Record<string, Record<string, Record<string, Record<string, { enum?: unknown }>>>>> | undefined;
  return props?.objectTypes?.items?.properties?.backing?.enum;
}

describe('seedManifestSchema', () => {
  let storage: SqliteStorage;

  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
  });

  it('upgrades a record this node seeded under an older node id, and re-stamps it', async () => {
    await storage.setSchema(stale(MANIFEST_SCHEMA_KEY, OLD_NODE));

    // The stale record is upgraded; the workspace-scoped pattern is absent here and seeded fresh.
    expect(await seedManifestSchema(storage as never, THIS_NODE)).toBe(2);

    const upgraded = await storage.getSchema(MANIFEST_SCHEMA_KEY, 'prefix');
    expect(seededVersionOf(upgraded!.schemaJson)).toBe(MANIFEST_SEED_VERSION);
    expect(backings(upgraded)).toContain('rows');
    expect(upgraded!.lockedBy).toBe(THIS_NODE);
  });

  it('upgrades the workspace-scoped pattern the same way', async () => {
    await storage.setSchema(stale(MANIFEST_WS_SCHEMA_KEY, OLD_NODE));
    await seedManifestSchema(storage as never, THIS_NODE);

    const upgraded = await storage.getSchema(MANIFEST_WS_SCHEMA_KEY, 'prefix');
    expect(backings(upgraded)).toContain('rows');
    expect(upgraded!.lockedBy).toBe(THIS_NODE);
  });

  it('leaves an operator-customized schema alone, stale or not', async () => {
    await storage.setSchema(stale(MANIFEST_SCHEMA_KEY, AN_OPERATOR));

    // Only the workspace-scoped pattern is written; the operator's record is not counted.
    expect(await seedManifestSchema(storage as never, THIS_NODE)).toBe(1);

    const kept = await storage.getSchema(MANIFEST_SCHEMA_KEY, 'prefix');
    expect(seededVersionOf(kept!.schemaJson)).toBe(4);
    expect(backings(kept)).toEqual(['memory', 'tasks']);
    expect(kept!.lockedBy).toBe(AN_OPERATOR);
  });

  it('writes nothing when both records are already at this build version', async () => {
    expect(await seedManifestSchema(storage as never, THIS_NODE)).toBe(2);
    expect(await seedManifestSchema(storage as never, THIS_NODE)).toBe(0);
  });

  it('adopts a record seeded under a third node id too, not just the two names in this test', async () => {
    await storage.setSchema(stale(MANIFEST_SCHEMA_KEY, 'system@aimeat-finland-001-genesis'));
    await seedManifestSchema(storage as never, THIS_NODE);

    const upgraded = await storage.getSchema(MANIFEST_SCHEMA_KEY, 'prefix');
    expect(backings(upgraded)).toContain('rows');
  });
});
