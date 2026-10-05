/**
 * @file src/services/packages/compose/package-component-collisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a package component would take over that already belongs to somebody, asked
 *   before anything is written.
 *
 *   Two components write into places that are not the install's own:
 *
 *   - A MEMORY component names its keys, and they land in the installer's namespace. A key the owner
 *     already has is the owner's record, and installing somebody else's package is not the owner
 *     writing it. So a key that exists is refused unless this same component wrote it before (its
 *     `_pkg:<registered name>` manifest lists it: the update path re-registers under the same name)
 *     or an install of the same package group did (the record carries `package:<groupId>`).
 *   - A CORTEX component's `schema` parts set strict schema locks, and a lock is found by its key
 *     pattern alone (storage.findApplicableSchema), so it governs every owner on the node. The schema
 *     route refuses to replace another principal's lock (SCHEMA_LOCKED_BY_OTHER, routes/schemas.ts);
 *     the package path wrote it anyway, and the uninstall then deleted it. The owner's own lock, or
 *     one an agent of theirs set, may be replaced as before. Another person's lock that already is
 *     the same strict structure is shared: the registration leaves it and does not record it.
 *
 *   docs/specs/package-sale-design.md, T3 and T4.
 * @structure PACKAGE_TAG_PREFIX · packageTag() · cortexComponentsOf() · componentCollision()
 * @usage
 *   const refusal = await componentCollision(storage, { type, content, registeredAs, owner, ownerGaii, groupId });
 *   if (refusal) return refusal;   // before the first write
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 1).
 */
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import type { Storage, PackageComponentType } from '../../../storage/interface.js';
import { memoryComponentEntries } from '../install/package-memory-component.js';
import { logger } from '../../../utils/logger.js';

/**
 * The tag a memory component's records carry, so another install of the same package may rewrite them.
 * The memory route takes tags of at most 64 characters, so a group id that would not fit is named by
 * the first 16 hex digits of its sha256 instead.
 */
export const PACKAGE_TAG_PREFIX = 'package:';
export function packageTag(groupId: string): string {
  const plain = `${PACKAGE_TAG_PREFIX}${groupId}`;
  return plain.length <= 64 ? plain : `${PACKAGE_TAG_PREFIX}#${createHash('sha256').update(groupId).digest('hex').slice(0, 16)}`;
}

/**
 * The components a cortex package part declares: under `spec.components` (the standard manifest) or
 * at the top level. Content is JSON `{ manifest: "YAML", libs }` or the manifest text itself.
 */
export function cortexComponentsOf(content: string): { manifestStr: string; meta: Record<string, unknown>; libs: Record<string, string>; components: Array<Record<string, unknown>> } {
  let parsed: { manifest?: string; libs?: Record<string, string> };
  try { parsed = JSON.parse(content); }
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  catch { parsed = { manifest: content }; }
  const manifestStr = parsed.manifest ?? content;
  let meta: Record<string, unknown> = {};
  try { meta = (YAML.parse(manifestStr) as Record<string, unknown>) ?? {}; }
  catch (err) { logger.warn('config: use defaults', { error: String(err) }); }
  const spec = (meta.spec ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(spec.components) ? spec.components : meta.components ?? []) as Array<Record<string, unknown>>;
  return { manifestStr, meta, libs: parsed.libs ?? {}, components: Array.isArray(raw) ? raw : [] };
}

/** Whether `lockedBy` is this owner: their GHII, their bare account name, or one of their agents. */
export function isOwnersLock(lockedBy: string, owner: string, ownerGaii: string): boolean {
  return lockedBy === ownerGaii || lockedBy === owner || lockedBy.endsWith(`#${ownerGaii}`);
}

/** JSON with its object keys sorted, so a schema read back from Postgres jsonb compares equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Whether an existing lock already is the structure a schema part would set: strict, with the same
 * JSON Schema. Two owners on one node who install the same package want the same lock, and the second
 * leaves it as it is, unrecorded, so neither uninstall removes it from under the other.
 */
export function isSameLock(existing: { schemaJson: Record<string, unknown>; schemaMode: string }, schema: unknown): boolean {
  return existing.schemaMode === 'strict' && canonical(existing.schemaJson) === canonical(schema ?? {});
}

/** The JSON Schema a cortex `schema` part sets, read the way the registrar reads it. */
export const schemaOfPart = (c: Record<string, unknown>): unknown => c.schema ?? c.content ?? {};

export interface CollisionInput {
  type: PackageComponentType;
  content: string;
  registeredAs: string;
  componentId: string;
  owner: string;
  ownerGaii: string;
  /** The package group being installed, when the caller knows it. */
  groupId?: string;
}

/**
 * The refusal for a component that would overwrite what is not the install's, or null. Reads only.
 * `code` is KEY_EXISTS or SCHEMA_LOCKED_BY_OTHER; `error` is the registrar's `CODE: message` form.
 */
export async function componentCollision(
  storage: Storage, input: CollisionInput,
): Promise<{ code: 'KEY_EXISTS' | 'SCHEMA_LOCKED_BY_OTHER'; message: string; error: string } | null> {
  if (input.type === 'memory') {
    let entries: Array<{ key?: unknown }>;
    // eslint-disable-next-line aimeat/no-silent-catch -- a body the registrar cannot read is refused there, with its own reason
    try { entries = memoryComponentEntries(input.content, input.registeredAs) as Array<{ key?: unknown }>; } catch { return null; }
    if (!Array.isArray(entries)) return null;
    const manifest = await storage.getMemory(input.ownerGaii, `_pkg:${input.registeredAs}`);
    const own = new Set(Array.isArray(manifest?.value) ? manifest!.value as string[] : []);
    const taken: string[] = [];
    for (const e of entries) {
      const key = e && typeof e === 'object' ? e.key : undefined;
      if (typeof key !== 'string' || own.has(key)) continue;
      const rec = await storage.getMemory(input.ownerGaii, key);
      if (!rec) continue;
      if (input.groupId && rec.tags?.includes(packageTag(input.groupId))) continue;
      taken.push(key);
    }
    if (taken.length === 0) return null;
    const named = taken.map(k => `"${k}"`).join(', ');
    const message = `Component "${input.componentId}" would overwrite ${named}, which ${taken.length === 1 ? 'is a record' : 'are records'} `
      + 'you already have. A package does not replace your own records; rename or remove them first, or ask the package\'s author to use other keys.';
    return { code: 'KEY_EXISTS', message, error: `KEY_EXISTS: ${message}` };
  }
  if (input.type === 'cortex') {
    const { components } = cortexComponentsOf(input.content);
    const held: string[] = [];
    for (const c of components) {
      if (c.type !== 'schema' || typeof c.key_pattern !== 'string' || !c.key_pattern) continue;
      const applyTo = c.apply_to === 'exact' ? 'exact' : 'prefix';
      const existing = await storage.getSchema(c.key_pattern, applyTo);
      if (existing && !isOwnersLock(existing.lockedBy, input.owner, input.ownerGaii) && !isSameLock(existing, schemaOfPart(c))) {
        held.push(c.key_pattern);
      }
    }
    if (held.length === 0) return null;
    const named = held.map(k => `"${k}"`).join(', ');
    const message = `Component "${input.componentId}" would replace the structure lock on ${named}, which somebody else set. `
      + 'A lock applies to everyone on this node, so a package cannot replace another person\'s.';
    return { code: 'SCHEMA_LOCKED_BY_OTHER', message, error: `SCHEMA_LOCKED_BY_OTHER: ${message}` };
  }
  return null;
}
