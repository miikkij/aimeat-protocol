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
 *   - A private file in one of the pipeline's two folders (`contentclass-text/`, `contentclass-profile/`)
 *     that no remaining facts entry names (`textKey`, `profile.detailKey`), at least MIN_AGE_MS old, and
 *     that is the pipeline's own: a removed loop entry named it, or its key has exactly the shape the
 *     pipeline gives its files (`<folder>/<24 hex>.txt|.json`, facts-store.ts isPipelineFileKey). Nothing
 *     reads such a file except through the facts entry that names it, so one no entry names is
 *     unreachable. The age leaves alone a file the pipeline wrote a moment ago and is about to name.
 *   The facts and files of the person's real items, and the files those name, stay. So does a file
 *   the person, their agent or their app stored under a key that only starts with `contentclass-`
 *   (`contentclass-notes.md`, `contentclass-text/my-notes.txt`): the prefix is not reserved, so it
 *   alone is no evidence that the pipeline wrote the file.
 *
 *   BY ITSELF. It runs once when the node starts and with the daily file store sweep (core-jobs.ts);
 *   on a node with nothing left it reads the facts records' keys and stops.
 * @structure MIN_AGE_MS · LeftoverResult · removeFingerprintLoopLeftovers
 * @usage const r = await removeFingerprintLoopLeftovers({ storage, config });
 * @version-history
 *   v1.0.1 — 2026-11-08 — A file is removed only on evidence that the pipeline wrote it: one of its two
 *     folders, private, and named by a removed loop entry or carrying the pipeline's own key shape. A
 *     key that only starts with `contentclass-` was enough before, and a person's own file under it was
 *     removed after an hour (secaudit2026nov08b round 15, content/leftovers-delete-unreserved-prefix).
 *   v1.0.0 — 2026-11-08 — Initial (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 */
import { logger } from '../../utils/logger.js';
import { emitChange, emitRecordChange } from '../event-bus.js';
import { allFacts, deleteFactsWhere, isPipelineFileKey, SHARD_PREFIX } from './facts-store.js';
import type { ContentDeps } from './classes.js';

/** A `contentclass-` file younger than this is never removed: its facts entry may be about to name it. */
export const MIN_AGE_MS = 60 * 60 * 1000;
/** The prefix of every file the pipeline stores; a source under it is one of the pipeline's own files. */
const OWN_FILE_PREFIX = 'contentclass-';
/** The only folders the pipeline writes files to (facts-store.ts textKeyOf, profileKeyOf). */
const OWN_FOLDERS = ['contentclass-text/', 'contentclass-profile/'];
const inOwnFolder = (key: string): boolean => OWN_FOLDERS.some(p => key.startsWith(p));

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
      // The files a removed loop entry named are the pipeline's own: it wrote them for that entry.
      const loopNamed = new Set<string>();
      r.facts = await deleteFactsWhere(deps, writer, f => {
        if (!(f.source?.kind === 'file' && String(f.source.key ?? '').startsWith(OWN_FILE_PREFIX))) return false;
        if (f.textKey) loopNamed.add(f.textKey);
        if (f.profile?.detailKey) loopNamed.add(f.profile.detailKey);
        return true;
      });

      const named = new Set<string>();
      for (const f of await allFacts(deps.storage, owner)) {
        if (f.textKey) named.add(f.textKey);
        if (f.profile?.detailKey) named.add(f.profile.detailKey);
      }
      const unnamed = (await deps.storage.listStorageFiles(owner)).filter(file => inOwnFolder(file.key)
        && file.visibility === 'private'
        && (loopNamed.has(file.key) || isPipelineFileKey(file.key))
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
