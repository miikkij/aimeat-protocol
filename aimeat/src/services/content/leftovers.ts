/**
 * @file src/services/content/leftovers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removes what the content class pipeline's fingerprint loop left behind. Until 669d8e254
 *   (2026-11-06) the arrival hook read the pipeline's own files: each fingerprint stored its sections as
 *   `contentclass-profile/<hash>.json`, that file arrived, got facts, a kept text copy
 *   (`contentclass-text/<hash>.txt`) and a fingerprint of its own, which stored the next sections file,
 *   without end. One account held 4619 such facts and about 9200 such files.
 *
 *   ON POSITIVE EVIDENCE ONLY (CLAUDE.md, Backend: a migration that can destroy data):
 *   - Facts whose source is a `contentclass-` file. The pipeline never reads its own files since
 *     669d8e254, so every such entry is the loop's.
 *   - A `contentclass-` file that no remaining facts entry names (`textKey`, `profile.detailKey`), at
 *     least MIN_AGE_MS old. Nothing reads such a file except through the facts entry that names it, so
 *     one no entry names is unreachable. The age leaves alone a file the pipeline wrote a moment ago and
 *     is about to name.
 *   The facts and files of the person's real items, and the files those name, stay.
 *
 *   BY ITSELF. It runs once when the node starts and with the daily file store sweep (core-jobs.ts);
 *   on a node with nothing left it reads the facts records' keys and stops.
 * @structure MIN_AGE_MS · LeftoverResult · removeFingerprintLoopLeftovers
 * @usage const r = await removeFingerprintLoopLeftovers({ storage, config });
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 */
import { logger } from '../../utils/logger.js';
import { emitChange, emitRecordChange } from '../event-bus.js';
import { allFacts, deleteFactsWhere, SHARD_PREFIX } from './facts-store.js';
import type { ContentDeps } from './classes.js';

/** A `contentclass-` file younger than this is never removed: its facts entry may be about to name it. */
export const MIN_AGE_MS = 60 * 60 * 1000;
const OWN_FILE_PREFIX = 'contentclass-';

export interface LeftoverResult { owner: string; facts: number; files: number; failed: number }

/** Remove the loop's facts and the pipeline files nothing names, for every owner that has facts. */
export async function removeFingerprintLoopLeftovers(deps: ContentDeps, opts: { now?: number; minAgeMs?: number } = {}): Promise<LeftoverResult[]> {
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? MIN_AGE_MS;
  const owners = [...new Set((await deps.storage.listMemoryKeysByPrefix(SHARD_PREFIX)).map(r => r.ownerGaii))];
  const results: LeftoverResult[] = [];
  for (const owner of owners) {
    const r: LeftoverResult = { owner, facts: 0, files: 0, failed: 0 };
    try {
      const writer = { principal: owner, ownerGhii: owner, scopes: [] as string[], roles: ['owner'] };
      r.facts = await deleteFactsWhere(deps, writer, f => f.source?.kind === 'file' && String(f.source.key ?? '').startsWith(OWN_FILE_PREFIX));

      const named = new Set<string>();
      for (const f of await allFacts(deps.storage, owner)) {
        if (f.textKey) named.add(f.textKey);
        if (f.profile?.detailKey) named.add(f.profile.detailKey);
      }
      const unnamed = (await deps.storage.listStorageFiles(owner)).filter(file => file.key.startsWith(OWN_FILE_PREFIX)
        && !named.has(file.key) && now - Date.parse(String(file.createdAt ?? '')) >= minAge);
      // The storage method, not removeStorageFile: these are the pipeline's own private files, written
      // by no caller, and the service would send one change event per file (thousands for one account).
      // The wrapped method removes the object in a file store as well; one event follows for the owner.
      for (const file of unnamed) {
        try {
          if (await deps.storage.deleteStorageFile(owner, file.key)) r.files++;
        } catch (err) {
          r.failed++;
          logger.warn('contentclass: a leftover pipeline file could not be removed; the next run tries again', {
            owner, key: file.key, error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (r.files) emitRecordChange('files', owner, 'private');
    } catch (err) {
      r.failed++;
      logger.warn('contentclass: removing the fingerprint loop\'s leftovers failed for one owner; the next run tries again', {
        owner, error: err instanceof Error ? err.message : String(err),
      });
    }
    if (r.facts || r.files || r.failed) results.push(r);
  }
  if (results.some(r => r.facts || r.files)) {
    for (const r of results) if (r.facts || r.files) emitChange('contentclass', r.owner);
    logger.info('contentclass: the fingerprint loop\'s leftovers were removed', { results });
  }
  return results;
}
