/**
 * @file src/services/credential-search-reindex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every credential record stored before the search text left out
 *   its value is written again, so both backends rebuild its search text without it.
 *
 *   WHY. Search matches a word at its start, and the search text of a credential record (the AI
 *   provider and decision keys, the per-agent keys and the payment provider record) held its whole
 *   value: the stored ciphertext, and on a node without an encryption key the payment secrets. A caller
 *   that searched the owner's records learned the value a character at a time from a hit or a miss on
 *   the record's key, which every read door shows only as configured (secaudit2026oct26,
 *   search-text.ts:searchableValue:secret-record-values-indexed). storage/search-text.ts leaves the
 *   value out from now on; this step rebuilds the text of the records already stored.
 *
 *   HOW. Each credential key prefix is listed across every namespace and each record found is stored
 *   again with storage.setMemory, which recomputes the search text. The value is unchanged. Nothing
 *   else is written.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (CREDENTIAL_SEARCH_REINDEX_KEY), before the node
 *   serves (server-bootstrap/once-only-keep-steps.ts).
 * @structure CREDENTIAL_SEARCH_REINDEX_KEY · reindexCredentialSearchTextOnce(storage, config)
 * @usage await reindexCredentialSearchTextOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isIndexedCredentialKey } from '../storage/search-text.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const CREDENTIAL_SEARCH_REINDEX_KEY = 'migrations.secaudit2026oct26.credential-search-reindex';

/** The prefixes every credential key starts with (storage/search-text.ts isIndexedCredentialKey). */
const PREFIXES = ['openrouter.apikey', 'decide.apikey', 'commerce.psp', 'ai.apikey.'];

/** How many records one read takes. */
const PAGE = 500;

/**
 * Store every credential record again, so its search text is rebuilt without its value, and record
 * the run. Throws when a write fails, and then leaves no record, so the next start tries again.
 * @returns how many records were written again, or null on a node that ran the step before
 */
export async function reindexCredentialSearchTextOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<number | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, CREDENTIAL_SEARCH_REINDEX_KEY);
  if (!claim) return null;
  try {
    let written = 0;
    for (const prefix of PREFIXES) {
      for (let offset = 0; ; offset += PAGE) {
        const { items } = await storage.listAllMemory({ prefix, limit: PAGE, offset, archived: 'include', excludeVersionRows: true });
        for (const rec of items) {
          if (!isIndexedCredentialKey(rec.key)) continue;
          await storage.setMemory(rec);
          written++;
        }
        if (items.length < PAGE) break;
      }
    }
    await claim.finish({ at: new Date().toISOString(), written });
    if (written) logger.info(`Rebuilt the search text of ${written} credential record(s) without their value`);
    return written;
  } catch (err) {
    await claim.release();
    throw err;
  }
}
