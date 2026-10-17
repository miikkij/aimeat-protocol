/**
 * @file src/services/knowledge-publish-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for a knowledge package (plan doc-mvcn6c7e4e5q, V4). A package is
 *   public when its audience is 'public' (catalog_listed), and an entry when its visibility is
 *   'public'; three routes can make either so: PATCH /v1/knowledge/:id/sharing, PATCH
 *   /v1/knowledge/:id/entries/:entryKey/visibility and POST /v1/knowledge/import.
 *
 *   On an ask the route writes the rest of the change, keeps the package at its audience (a new one
 *   unlisted, 'owner') and each entry at its visibility (a new one 'private'), and then files ONE
 *   request here naming the package, the manifest's version and each entry kept back with its
 *   record's version. The applier (services/publish-requests/apply-knowledge.ts) makes the package
 *   public when `change.field` is 'audience', and the named entries public either way, only when
 *   nothing named changed since.
 * @structure KnowledgeAskTarget · knowledgePublishAsk · fileKnowledgeAsk · entryVersions
 * @usage
 *   const ask = knowledgePublishAsk(ctx, callerOf(req, nodeId, storage), req.auth?.app, raises);
 *   ...write without the public part...
 *   const asked = await fileKnowledgeAsk(ctx, owner, ask.requester, { ownerGaii, packageId, ... });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: knowledge packages).
 */
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { publishAskOf, fileAsk, publishRequestedBody, type PublishAsk } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { knowledgeEntryKey } from './knowledge-sharing.js';

/** What the request names: the package, and the entries kept back. */
export interface KnowledgeAskTarget {
  ownerGaii: string;
  packageId: string;
  /** The package's name, for the person who decides. */
  name: string;
  /** 'audience': the package is to be listed public (and the entries); 'entries': only the entries. */
  field: 'audience' | 'entries';
  /** The package's audience now, for 'audience'; the entries' visibility now, for 'entries'. */
  from: string;
  /** Full entry keys to make public. */
  entries: string[];
}

/** Ask before the write; `raises` is whether the change makes the package or an entry public. */
export function knowledgePublishAsk(ctx: PublishStoreCtx, caller: CallerContext, app: string | undefined, raises: boolean): PublishAsk {
  return raises ? publishAskOf(ctx, caller, app) : { kind: 'allowed' };
}

/** Each entry's record version, keyed by its full key: what the applier compares against. */
export async function entryVersions(storage: Storage, ownerGaii: string, packageId: string, keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const full = knowledgeEntryKey(packageId, key);
    out[full] = (await storage.getMemory(ownerGaii, full))?.version ?? 0;
  }
  return out;
}

/**
 * File the request after the write. Reads the manifest's version as written. A filing that fails
 * (too many waiting) is a warning on the success answer.
 */
export async function fileKnowledgeAsk(
  ctx: PublishStoreCtx, owner: string, requester: PublishRequester, t: KnowledgeAskTarget,
): Promise<{ publish_request?: ReturnType<typeof publishRequestedBody>; warnings?: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string }> }> {
  const manifest = await ctx.storage.getMemory(t.ownerGaii, `packages/${t.packageId}/manifest`);
  const entries = await entryVersions(ctx.storage, t.ownerGaii, t.packageId, t.entries);
  const filed = await fileAsk(ctx, owner, requester, {
    kind: 'knowledge',
    target: {
      namespace: t.ownerGaii, package_id: t.packageId, version: manifest?.version ?? 0,
      entries: JSON.stringify(entries),
    },
    title: t.field === 'audience' ? `the knowledge package ${t.name}` : `${t.entries.length === 1 ? 'an entry' : `${t.entries.length} entries`} of the knowledge package ${t.name}`,
    name: t.name,
    change: { field: t.field, from: t.from, to: 'public' },
  });
  if (filed.ok) return { publish_request: publishRequestedBody(ctx, filed) };
  return { warnings: [{ code: 'PUBLISH_NOT_ASKED', message: `Saved as ${t.from}, not public: ${filed.message}` }] };
}
