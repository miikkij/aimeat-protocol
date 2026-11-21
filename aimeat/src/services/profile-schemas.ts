/**
 * @file src/services/profile-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Defines the standardized JSON Schemas for interest-profile fields (interests,
 *   location, bio, seeking, availability, languages) and seeds them into Schema Locking at startup.
 *   A schema this build changes reaches a node whose copy nobody edited; a schema a person locked,
 *   or one changed after the seed wrote it, is left alone (services/seed/stamped-seed.ts).
 *
 * @structure
 *   - interestsSchema/locationSchema/bioSchema/seekingSchema/availabilitySchema/languagesSchema: per-field JSON Schemas
 *   - PROFILE_SCHEMAS: the field→schema list keyed to `profile.*.<field>` patterns
 *   - seedProfileSchemas(storage, lockedBy): registers each schema via Schema Locking, through seedStamped
 *
 * @version-history
 *   v1.1.0 — 2026-11-21 — Seeded through seedStamped: an unedited schema follows this build; until now
 *     a schema was written only when missing, so no change to one ever reached a node that had it.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from '../storage/interface.js';
import { seedStamped } from './seed/stamped-seed.js';
import { isNodeSeedLock } from '../utils/node-seed-lock.js';

// ── Interest Profile Schema Definitions ──

const interestsSchema = {
  type: 'array',
  items: {
    type: 'string',
    minLength: 1,
    maxLength: 100,
  },
  minItems: 1,
  maxItems: 50,
};

const locationSchema = {
  type: 'object',
  required: ['city'],
  properties: {
    country: { type: 'string', minLength: 2, maxLength: 3 },
    city: { type: 'string', minLength: 1, maxLength: 100 },
    area: { type: 'string', maxLength: 100 },
    geo: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '[latitude, longitude]',
    },
  },
  additionalProperties: true,
};

const bioSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 500,
};

const seekingSchema = {
  type: 'array',
  items: {
    type: 'string',
    maxLength: 200,
  },
  maxItems: 20,
};

const availabilitySchema = {
  type: 'string',
  enum: ['anytime', 'evenings', 'weekends', 'evenings-weekends', 'by-appointment', 'not-available'],
  description: 'When the person is available for contact/activities',
};

const languagesSchema = {
  type: 'array',
  items: {
    type: 'string',
    minLength: 2,
    maxLength: 5,
    pattern: '^[a-z]{2,3}(-[A-Z]{2})?$',
    description: 'ISO 639-1 language code, optionally with region (e.g. fi, en, sv, en-US)',
  },
  minItems: 1,
  maxItems: 20,
};

// ── Schema definitions ──

const PROFILE_SCHEMAS = [
  { field: 'interests', schema: interestsSchema },
  { field: 'location', schema: locationSchema },
  { field: 'bio', schema: bioSchema },
  { field: 'seeking', schema: seekingSchema },
  { field: 'availability', schema: availabilitySchema },
  { field: 'languages', schema: languagesSchema },
] as const;

/**
 * Register standardized profile schemas in Schema Locking, at every startup.
 *
 * A missing schema is written. One the seeder wrote and nobody changed is brought up to this build;
 * one from before seed stamps counts as unchanged while its lock is still a seeder's (only a seeder
 * writes a `system@` lock, utils/node-seed-lock.ts). A person's lock, or a schema changed after the
 * seed wrote it, is left alone. An update re-stamps the lock with `lockedBy`.
 *
 * @returns the number of schemas written (created + updated).
 */
export async function seedProfileSchemas(storage: Storage, lockedBy: string): Promise<number> {
  let seeded = 0;
  for (const s of PROFILE_SCHEMAS) {
    const keyPattern = `profile.*.${s.field}`;
    const action = await seedStamped(storage, {
      store: 'profile-schema',
      name: keyPattern,
      shipped: { schemaJson: s.schema as Record<string, unknown>, schemaMode: 'open' as const },
      read: async () => {
        const existing = await storage.getSchema(keyPattern, 'prefix');
        if (!existing) return null;
        const seeders = isNodeSeedLock(existing.lockedBy);
        return { content: { schemaJson: existing.schemaJson, schemaMode: existing.schemaMode }, heldByOther: !seeders, untouchedWithoutStamp: seeders };
      },
      write: async (shipped) => {
        const now = new Date().toISOString();
        const existing = await storage.getSchema(keyPattern, 'prefix');
        await storage.setSchema({
          ...(existing ?? {}),
          keyPattern,
          applyTo: 'prefix',
          schemaJson: shipped.schemaJson,
          schemaMode: shipped.schemaMode,
          lockedBy,
          setAt: existing?.setAt ?? now,
          updatedAt: now,
        });
      },
    });
    if (action === 'create' || action === 'update') seeded++;
  }
  return seeded;
}

/**
 * Returns the list of profile field names registered by the standard.
 */
export function getProfileFieldNames(): string[] {
  return PROFILE_SCHEMAS.map(s => s.field);
}
