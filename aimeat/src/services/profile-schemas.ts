/**
 * @file src/services/profile-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Defines the standardized JSON Schemas for interest-profile fields (interests,
 *   location, bio, seeking, availability, languages) and seeds them into Schema Locking at startup.
 *   Idempotent and non-destructive — it will not overwrite operator-customized schemas.
 *
 * @structure
 *   - interestsSchema/locationSchema/bioSchema/seekingSchema/availabilitySchema/languagesSchema: per-field JSON Schemas
 *   - PROFILE_SCHEMAS: the field→schema list keyed to `profile.*.<field>` patterns
 *   - seedProfileSchemas(storage, lockedBy): registers each schema via Schema Locking, skipping existing ones
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from '../storage/interface.js';

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
 * Register standardized profile schemas in Schema Locking.
 * Called once during node startup. Idempotent — will not overwrite
 * existing schemas (operator may have customized them).
 */
export async function seedProfileSchemas(storage: Storage, lockedBy: string): Promise<number> {
  let seeded = 0;
  const now = new Date().toISOString();

  for (const s of PROFILE_SCHEMAS) {
    const keyPattern = `profile.*.${s.field}`;
    const existing = await storage.getSchema(keyPattern, 'prefix');
    if (!existing) {
      await storage.setSchema({
        keyPattern,
        applyTo: 'prefix',
        schemaJson: s.schema as Record<string, unknown>,
        schemaMode: 'open',
        lockedBy,
        setAt: now,
        updatedAt: now,
      });
      seeded++;
    }
  }

  return seeded;
}

/**
 * Returns the list of profile field names registered by the standard.
 */
export function getProfileFieldNames(): string[] {
  return PROFILE_SCHEMAS.map(s => s.field);
}
