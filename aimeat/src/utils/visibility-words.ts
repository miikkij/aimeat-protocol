/**
 * @file src/utils/visibility-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words a memory record's or a stored file's visibility is written in, as values
 *   and as zod schemas, for every surface that validates one: the REST bodies (models/schemas.ts),
 *   the tool catalog (which imports nothing above utils/) and the routes. `organism:<organism id>`
 *   is the active members of one organism (plan doc-mvcn6c7e4e5q, V3.2/V3.3); who passes it is
 *   services/audience.ts, and the id grammar here is the one parseAudience reads.
 * @structure ORGANISM_ID_RE · ORGANISM_VISIBILITY_RE · isOrganismVisibilityWord · MEMORY_WRITE_VISIBILITIES · STORED_VISIBILITY_WORDS · memoryWriteVisibilitySchema · storedVisibilitySchema
 * @usage
 *   visibility: memoryWriteVisibilitySchema.optional()
 *   if (!storedVisibilitySchema.safeParse(v).success) → 400
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.2 + V3.3).
 */
import { z } from 'zod';

const ORGANISM_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}';

/** An organism id as the node mints it (a UUID) or as tests and imports write it. */
export const ORGANISM_ID_RE = new RegExp(`^${ORGANISM_ID}$`);

/** `organism:<organism id>`. */
export const ORGANISM_VISIBILITY_RE = new RegExp(`^organism:${ORGANISM_ID}$`);

/** True for a well-formed `organism:<id>` (whether the organism exists is not decided here). */
export function isOrganismVisibilityWord(value: unknown): value is `organism:${string}` {
  return typeof value === 'string' && ORGANISM_VISIBILITY_RE.test(value);
}

/** The plain words POST /v1/memory, PATCH, the bulk write and aimeat_memory_write take. */
export const MEMORY_WRITE_VISIBILITIES = ['private', 'owner', 'group', 'members', 'public'] as const;

/** The plain words a stored file (and a memory record's column) holds; `workspace` needs a binding. */
export const STORED_VISIBILITY_WORDS = ['private', 'owner', 'group', 'workspace', 'members', 'public'] as const;

// Typed as the template literal it guarantees, so a parsed value is a StoredVisibility, not a string.
const organismWord = z.string().regex(ORGANISM_VISIBILITY_RE, 'organism:<organism id>') as unknown as z.ZodType<`organism:${string}`>;

/** A memory write's visibility: one of MEMORY_WRITE_VISIBILITIES or `organism:<id>`. */
export const memoryWriteVisibilitySchema = z.union([z.enum(MEMORY_WRITE_VISIBILITIES), organismWord]);

/** A stored file's visibility: one of STORED_VISIBILITY_WORDS or `organism:<id>`. */
export const storedVisibilitySchema = z.union([z.enum(STORED_VISIBILITY_WORDS), organismWord]);
