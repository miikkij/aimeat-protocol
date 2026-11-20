/**
 * @file src/utils/zod-patch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one way to derive the schema of a partial update (a PATCH body, a settings change)
 *   from an object schema. Under zod 4, `.partial()` makes every field optional and KEEPS each field's
 *   `.default()`, so a field the caller left out is filled with its default during the parse, and a
 *   merge onto the stored record resets it. It hit twice (data processing agreements, then the customer
 *   due diligence cards, settings and suspicion drafts) with every test green. patchOf() makes every
 *   top-level field optional and removes its default (and its prefault), so a parsed update carries
 *   only the fields the caller sent. A nested object the caller does send still gets its own inner
 *   defaults: it replaces the whole stored value, as it did before.
 *   scripts/check-partial-defaults.ts refuses `.partial()` anywhere else in src/.
 * @structure patchOf()
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial: replaces .partial() on every update schema in src/.
 */
import { z } from 'zod';

/** The field without the default it carries at its top, keeping .optional() and .nullable() around it. */
function withoutDefault(field: z.ZodType): z.ZodType {
  if (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) return withoutDefault(field.unwrap() as z.ZodType);
  if (field instanceof z.ZodOptional) return withoutDefault(field.unwrap() as z.ZodType).optional();
  if (field instanceof z.ZodNullable) return withoutDefault(field.unwrap() as z.ZodType).nullable();
  return field;
}

/**
 * The partial-update schema of an object schema: every field optional, no field filled by a default.
 * Same object mode (strict, passthrough) as the schema given, as `.partial()` keeps it.
 */
export function patchOf<S extends z.ZodObject>(schema: S): z.ZodObject<{ [K in keyof S['shape']]: z.ZodOptional<S['shape'][K]> }, S['_zod']['config']> {
  const partial = schema.partial();
  const undefaulted: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const bare = withoutDefault(field);
    if (bare !== field) undefaulted[key] = bare.optional();
  }
  return (Object.keys(undefaulted).length ? partial.extend(undefaulted) : partial) as never;
}
