/**
 * @file src/services/exposure/exposure-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of the exposure report: what of one person someone outside can read, at
 *   which level, and how to close it (plan doc-mvcn6c7e4e5q, V6.1).
 *
 *   FOUR LEVELS, and what is NOT one of them. A thing is exposed when somebody who is neither the
 *   person nor acting for them can read it:
 *
 *     public      anyone, signed in or not.
 *     link        anyone who holds an address: an app with no access code that is not listed, an
 *                 open workspace share. A presigned download address is NOT counted: it ends by
 *                 itself and the person handed it to somebody on purpose.
 *     signed-in   any account of this node (stored as 'members' on memory, files and skills,
 *                 'community' or 'signed-in' on apps, 'account' on a workspace share).
 *     organism    the members of one organism (stored as 'organism:<id>').
 *
 *   'private', 'owner', 'group' and 'workspace' are not exposure: they name the person, their agents,
 *   or an audience the person chose by name. A sharing group or a workspace roster is a decision about
 *   named people, and this report answers the question about strangers.
 *
 *   The context carries a memo, so the sources of one report read a shared list once (every
 *   person's memory meta, the node's boards, the node's offerings), and the node-wide variant reads
 *   each of them once for every account instead of once per account.
 * @structure ExposureLevel · ExposureKind · KINDS · ExposureItem · ExposureSource · ExposureContext ·
 *   createExposureContext · levelOfVisibility · ownerIdentities · ownerMemoryMeta · EXPOSURE_ITEM_CAP
 * @usage
 *   const ctx = createExposureContext(storage, config);
 *   const items = await source.list(ctx, 'alice', 'alice@node');
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import type { MemoryMetaRow } from '../../storage/repositories/memory.repository.js';
import type { ContentLabelTarget } from '../../storage/types/content-labels.js';
import { parseAudience } from '../audience.js';

/** Who can read a thing, from the widest to the narrowest. */
export type ExposureLevel = 'public' | 'link' | 'signed-in' | 'organism';

/** Every level, in the order the report counts them. */
export const LEVELS: readonly ExposureLevel[] = ['public', 'link', 'signed-in', 'organism'];

/**
 * Every kind of content the report looks at. A fixed list: test/unit/exposure-sources.test.ts holds
 * EXPOSURE_SOURCES to it, so a kind added here without a source fails before it ships.
 */
export const KINDS = [
  'memory', 'file', 'app', 'workspace_share', 'organism', 'board', 'knowledge', 'package',
  'datapackage', 'skill', 'portfolio', 'company', 'exchange', 'agent',
] as const;

export type ExposureKind = typeof KINDS[number];

/** One thing someone outside can read. */
export interface ExposureItem {
  kind: ExposureKind;
  /** Unique within its kind: a memory key, an app filename, `<org>/<ws>/<space>/<id>` for a shared page. */
  id: string;
  /** What a person recognises it by. */
  title: string;
  level: ExposureLevel;
  /** Present exactly when `level` is 'organism': the organism whose members read it. */
  organism_id?: string;
  /** The address it is read at, when it has one a stranger can open. */
  url?: string;
  /** One plain sentence, naming the MCP tool and the REST route that close it. */
  how_to_close: string;
}

/**
 * What a source hands the report: an item, and for a record or a file the content it names, which
 * the report passes through the caller's classification reader before it lists the item. The
 * `content` field never leaves the report.
 */
export type ExposureFound = ExposureItem & { content?: ContentLabelTarget };

/** What a source is handed: the store, the node, and a memo shared by every source of one run. */
export interface ExposureContext {
  storage: Storage;
  config: AimeatConfig;
  /** The node's address without a trailing slash, for the `url` of an item. */
  base: string;
  /** The moment the report is about. */
  nowMs: number;
  /** Run `fn` once per `key` for the life of this context, and hand every caller the same answer. */
  memo<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** One content kind: how to find what of one person is exposed. */
export interface ExposureSource {
  kind: ExposureKind;
  /**
   * Every exposed item of this kind that belongs to the person. `ownerName` is the bare account name,
   * `ownerGhii` the same account as a GHII. A source returns all it finds; the report caps the list
   * it hands out and counts the whole of it.
   */
  list(ctx: ExposureContext, ownerName: string, ownerGhii: string): Promise<ExposureFound[]>;
}

/** The most items one kind lists in a report. The counts are always of everything found. */
export const EXPOSURE_ITEM_CAP = 500;

export function createExposureContext(storage: Storage, config: AimeatConfig, nowMs: number = Date.now()): ExposureContext {
  const memos = new Map<string, Promise<unknown>>();
  return {
    storage, config, nowMs,
    base: config.baseUrl.replace(/\/+$/, ''),
    memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
      if (!memos.has(key)) memos.set(key, fn());
      return memos.get(key) as Promise<T>;
    },
  };
}

/**
 * The level a stored visibility string gives, or null when it is not exposure. Reads every form a
 * kind stores (services/audience.ts parseAudience): 'public', 'members', 'organism:<id>'; 'private',
 * 'owner', 'group', 'workspace' and anything unknown are not exposure.
 */
export function levelOfVisibility(visibility: unknown): { level: ExposureLevel; organism_id?: string } | null {
  const a = parseAudience(visibility);
  if (!a) return null;
  if (a.level === 'public') return { level: 'public' };
  if (a.level === 'members') return { level: 'signed-in' };
  if (a.level === 'organism' && a.organismId) return { level: 'organism', organism_id: a.organismId };
  return null;
}

/** The identities a person's content is stored under: their GHII, their agents, their ecosystem apps. */
export interface OwnerIdentities {
  ghii: string;
  agents: AgentRecord[];
  /** The GHII first, then every agent's GAII, then every ecosystem app's GEAI. */
  all: string[];
}

export function ownerIdentities(ctx: ExposureContext, ownerName: string, ownerGhii: string): Promise<OwnerIdentities> {
  return ctx.memo(`ids:${ownerName}`, async () => {
    const agents = await ctx.storage.getAgentsByOwner(ownerName);
    const eco = await ctx.storage.getEcosystemAppsByOwner(ownerName);
    return { ghii: ownerGhii, agents, all: [ownerGhii, ...agents.map(a => a.gaii), ...eco.map(e => e.geai)] };
  });
}

/**
 * Every memory row the person and their agents and apps hold, without values: what the memory, the
 * knowledge and the skill sources all read, so it is read once. The visibility filter of the store
 * is an exact match and cannot find 'organism:<id>', so the whole meta list is read and filtered here.
 */
export function ownerMemoryMeta(ctx: ExposureContext, ownerName: string, ownerGhii: string): Promise<MemoryMetaRow[]> {
  return ctx.memo(`meta:${ownerName}`, async () => {
    const ids = await ownerIdentities(ctx, ownerName, ownerGhii);
    return ctx.storage.listMemoryMetaForOwners(ids.all);
  });
}
