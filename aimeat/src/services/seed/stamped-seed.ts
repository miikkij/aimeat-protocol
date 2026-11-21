/**
 * @file src/services/seed/stamped-seed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one way a boot seed writes a record it ships: it stores a fingerprint of what it
 *   wrote, so the next build can deliver a change to a record nobody edited and leave alone one that
 *   somebody did.
 *
 *   WHAT WENT WRONG WITH CREATE-IF-MISSING. A seed that writes a record only when it is missing
 *   protects something real: an operator's edit survives a restart. But it cannot tell an edit from an
 *   untouched copy, so it treats every existing record as edited, and every fix the project ships to
 *   that record reaches only nodes that never had it. A node runs the release and still serves the old
 *   record, and a restart changes nothing. It happened to the bundled packages (the 3.15.0 fixes
 *   reached no node that had seeded the package), to system prompts (two kept telling agents to use a
 *   storage feature deleted weeks before), to the Design Book parts and to the built-in skills, each
 *   found by a person who noticed the old text.
 *
 *   THE RULE. When this module writes a record it also writes a fingerprint (SHA-256 of the canonical
 *   JSON, so PostgreSQL's key order does not matter) of exactly what it wrote. At the next boot:
 *     record missing                                → create it
 *     the stored record matches the fingerprint      → nobody else changed it: write this build's
 *                                                     version over it when that differs ('update'),
 *                                                     else nothing ('current')
 *     the stored record does NOT match the fingerprint → somebody changed it on this node: leave it,
 *                                                     and say so in the log ('keep-edited')
 *     the record is held by another principal        → the same ('keep-edited'): a schema lock or a
 *                                                     registration that names a person is theirs
 *     no fingerprint (seeded before this existed)    → adopt it when it already equals this build's
 *                                                     version; update it when the store has its own
 *                                                     evidence that nobody touched it (a CSM still at
 *                                                     version 1, a schema lock still the seeder's);
 *                                                     otherwise leave it and say so ('keep-unknown')
 *
 *   The fingerprint is not a security boundary: it answers "has this changed since we wrote it". It
 *   lives under SEED_STAMP_OWNER, an owner no account can be (`system` is a reserved name) and which
 *   does not carry the node id: a node whose id changed keeps its stamps (docs: utils/node-seed-lock.ts).
 *
 *   WHICH SEEDS USE IT. The profile schemas, the CSM templates, the template bundles, the core
 *   scheduled jobs and the anonymous identity's scopes, which were create-if-missing until 2026-11-21.
 *   The built-in skills (services/skill/seeds.ts) take their decision from decideStampedSeed and keep
 *   their stamps where they always were. Three stores have their own answer and stay on it: a system
 *   package's fingerprint (a system package has no other writer, so a new fingerprint is always safe to
 *   publish as a new version), a system prompt's newest version entry, and a Design Book part's owner.
 *   The version-gated seeds (bundled cortexes, built-in extensions, the manifest-format schema) refresh
 *   when the shipped version is higher, so a forgotten version bump still means no node that has the
 *   record ever gets the change: a bundled cortex change is three edits (the code, the pack's VERSION
 *   constant, `spec.version` in its manifest), held by test/unit/cortex-bundle-versions.test.ts. That
 *   test reads the pack files rather than importing them, so a gate that picks unit tests by import
 *   graph does not run it: run it by hand after such a change.
 *
 *   THE TELL. `if (existing) continue` in a seeder, or a seeder that reads a record and returns when
 *   it is there. Ask what happens to a node that booted yesterday when this build changes that record.
 * @structure SEED_STAMP_OWNER · seedStampKey · seedFingerprint · decideStampedSeed · StampedSeedTarget ·
 *   seedStamped(storage, target)
 * @usage
 *   const action = await seedStamped(storage, { store: 'profile-schema', name: keyPattern, shipped,
 *     read: async () => ..., write: async (content, action, live) => ... });
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial: the skill seeder's fingerprint rule for every create-if-missing
 *     seed (docs/pitfalls.md §88, now deleted).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import { canonicalJson } from '../../utils/memory-content.js';
import { logger } from '../../utils/logger.js';

/** The owner of every seed stamp. No account can be called `system` (utils/gaii.ts RESERVED_NAMES), and no node id is in it. */
export const SEED_STAMP_OWNER = 'system@seed-stamps';

/** What happens to one seeded record at this boot. */
export type StampedSeedAction =
  /** Missing on this node: written. */
  | 'create'
  /** Unchanged since the seed wrote it, and this build ships a different version: written over. */
  | 'update'
  /** Seeded before stamps existed and equal to this build's version: the stamp is written, nothing else. */
  | 'adopt'
  /** Unchanged and already this build's version. */
  | 'current'
  /** Changed on this node since the seed wrote it, or held by another principal: left as it is. */
  | 'keep-edited'
  /** Seeded before stamps existed, different from this build, and no evidence who changed it: left as it is. */
  | 'keep-unknown';

/** Where the stamp of one seeded record lives: `seeds.<store>.<name>`, the name made safe for a memory key. */
export function seedStampKey(store: string, name: string): string {
  return `seeds.${store}.${name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** The fingerprint of seeded content: a string as its UTF-8 bytes, anything else as canonical JSON. */
export function seedFingerprint(content: unknown): string {
  return createHash('sha256').update(typeof content === 'string' ? content : canonicalJson(content), 'utf8').digest('hex');
}

/** What the store can say about the record beside its content. */
export interface StoredEvidence {
  /** The record names another principal as its holder (a person's schema lock or registration). */
  heldByOther?: boolean;
  /** Without a stamp: the store's own evidence that nobody changed the record since the seed wrote it. */
  untouchedWithoutStamp?: boolean;
}

/**
 * Decide what happens to one record, from fingerprints alone.
 *
 *   live    — the stored record's fingerprint, or null when there is none
 *   stamp   — the fingerprint the seed stored when it last wrote, or null when it never stored one
 *   shipped — the fingerprint of what this build ships
 */
export function decideStampedSeed(live: string | null, stamp: string | null, shipped: string, evidence: StoredEvidence = {}): StampedSeedAction {
  if (live === null) return 'create';
  if (evidence.heldByOther) return 'keep-edited';
  if (stamp === null) return live === shipped ? 'adopt' : evidence.untouchedWithoutStamp ? 'update' : 'keep-unknown';
  if (live !== stamp) return 'keep-edited';
  return live === shipped ? 'current' : 'update';
}

/** One record a seed ships, and how to read and write it in its own store. */
export interface StampedSeedTarget<T> {
  /** The kind of record, in the stamp key and the log: `profile-schema`, `core-job`, … */
  store: string;
  /** The record's own name in that store. */
  name: string;
  /** The part of the record the seed owns, as this build ships it. */
  shipped: T;
  /** The same part as stored now, with what the store can say about it; null when the record is missing. */
  read(): Promise<({ content: T } & StoredEvidence) | null>;
  /** Write the shipped part. `live` is what read() answered, for a write made on the value that was read. */
  write(shipped: T, action: 'create' | 'update', live: T | null): Promise<void>;
}

/** Read the stamp of one record; null when the seed never stored one. */
async function readStamp(storage: Storage, key: string): Promise<string | null> {
  const record = await storage.getMemory(SEED_STAMP_OWNER, key);
  const fingerprint = (record?.value as { fingerprint?: unknown } | undefined)?.fingerprint;
  return typeof fingerprint === 'string' && fingerprint ? fingerprint : null;
}

/** Store the stamp of what this seed wrote or adopted. */
async function writeStamp(storage: Storage, key: string, fingerprint: string, action: StampedSeedAction): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: SEED_STAMP_OWNER, value: { fingerprint, at: now, action },
    visibility: 'private', tags: ['seed-stamp'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
}

/**
 * Bring one seeded record into step with this build without overwriting a change made on this node.
 * Answers what it did; a record left alone is named in the log with the reason.
 */
export async function seedStamped<T>(storage: Storage, target: StampedSeedTarget<T>): Promise<StampedSeedAction> {
  const key = seedStampKey(target.store, target.name);
  const shipped = seedFingerprint(target.shipped);
  const [stored, stamp] = await Promise.all([target.read(), readStamp(storage, key)]);
  const action = decideStampedSeed(stored ? seedFingerprint(stored.content) : null, stamp, shipped, stored ?? {});

  if (action === 'keep-edited' || action === 'keep-unknown') {
    logger.info(action === 'keep-edited'
      ? `Seeded ${target.store} ${target.name} was changed on this node; kept as it is. Bring the change back to the repository if it should ship.`
      : `Seeded ${target.store} ${target.name} differs from this build and was seeded before this node kept a stamp; kept as it is.`);
    return action;
  }
  if (action === 'current') return action;
  if (action === 'create' || action === 'update') await target.write(target.shipped, action, stored?.content ?? null);
  await writeStamp(storage, key, shipped, action);
  return action;
}
