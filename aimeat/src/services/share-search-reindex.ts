/**
 * @file src/services/share-search-reindex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every workspace share record written before the search text left
 *   out its password hash is written again, so both backends rebuild its search text without it.
 *
 *   WHY. Search matches a word at its start, and the search text of a share record
 *   (`organism.<id>.w.<ws>.meta.share`) held the scrypt hash of the share password and the SHA-256 of
 *   the calendar feed key as words. A caller that could search the record learned, by hit or miss on a
 *   chosen prefix, the hash a character at a time, which every read door masks (secaudit2026oct22,
 *   search-index-prefix-oracle-on-masked-fields). storage/search-text.ts leaves both fields out from
 *   now on; this step rebuilds the text of the records already stored.
 *
 *   HOW. Each organism's workspace registry names its workspaces; each copy of each share record is
 *   stored again with storage.setMemory, which recomputes the search text (the PostgreSQL searchBlob,
 *   the SQLite searchValues and its FTS row). The value is unchanged; the stored version goes up by one,
 *   as on any write. Nothing else is written.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (SHARE_SEARCH_REINDEX_KEY), before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts).
 * @structure SHARE_SEARCH_REINDEX_KEY · reindexShareSearchTextOnce(storage, config)
 * @usage await reindexShareSearchTextOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { workspaceRegistrations } from './workspace-meta-read.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const SHARE_SEARCH_REINDEX_KEY = 'migrations.secaudit2026oct22.share-search-reindex';

/** How many organisms one read takes. */
const PAGE = 200;

/**
 * Store every copy of every workspace share record again, so its search text is rebuilt without the
 * masked fields, and record the run. Throws when a write fails, and then leaves no record, so the
 * next start tries again.
 * @returns how many records were written again, or null on a node that ran the step before
 */
export async function reindexShareSearchTextOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<number | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, SHARE_SEARCH_REINDEX_KEY);
  if (!claim) return null;
  try {
    let written = 0;
    for (let page = 1; ; page++) {
      const orgs = await storage.listOrganisms({ page, perPage: PAGE, archived: 'include' });
      for (const org of orgs) {
        for (const wsId of (await workspaceRegistrations(storage, org.id)).keys()) {
          const key = `organism.${org.id}.w.${wsId}.meta.share`;
          const { items } = await storage.listAllMemory({ prefix: key, limit: 50, archived: 'include' });
          for (const rec of items) {
            if (rec.key !== key) continue;
            await storage.setMemory(rec);
            written++;
          }
        }
      }
      if (orgs.length < PAGE) break;
    }
    await claim.finish({ at: new Date().toISOString(), written });
    if (written) logger.info(`Rebuilt the search text of ${written} workspace share record(s) without the password hash`);
    return written;
  } catch (err) {
    await claim.release();
    throw err;
  }
}
