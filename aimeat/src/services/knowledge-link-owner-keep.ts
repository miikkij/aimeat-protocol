/**
 * @file src/services/knowledge-link-owner-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every knowledge link row written before link rows carried their
 *   owner gets the namespace that holds its source package, so the links that show today keep showing.
 *
 *   WHY. A link row named its source by the manifest key alone, and a manifest key is unique within one
 *   namespace only, so another account that wrote a record at packages/<id>/manifest read, replaced and
 *   deleted the owner's link rows through it (secaudit 2026-10, v78). Rows now carry `ownerGaii`, and
 *   the outgoing links of a package are only the rows of the namespace that holds its manifest. A row
 *   written before has ownerGaii '' (Postgres 0114, providers/sqlite/schema-knowledge-links.ts), which
 *   lists as an incoming link only until this step places it.
 *
 *   THE EVIDENCE. Every writer stored a row in the namespace where the caller's own account held the
 *   manifest (POST /link, the import, the clone), with linked_by = that account's bare name. So a row's
 *   owner is the one record at its source key held in its contributor's account (the GHII or one of the
 *   account's agents). With exactly one such holder, the row goes to it, and linked_by becomes the
 *   account's GHII, the form every writer stores from 2026-10-22 and owner erasure deletes by (v79).
 *
 *   WHAT IT DOES NOT DECIDE. A row whose source no namespace holds (its package was deleted) stays
 *   unplaced, as an incoming link only, as it showed before; only its linked_by gets the GHII when the
 *   account exists. A row whose contributor's account no longer exists and whose source no namespace
 *   holds is the leftover of an erased account (the erasure looked for the GHII form and missed it, v79),
 *   and is deleted. Everything else stays exactly as it is and is recorded as ONE incident on the
 *   Security page: two holders in the contributor's account, or a source held only by another account
 *   (a record at the same key, which never owned the row). Those rows list as incoming links only.
 *
 *   WHERE. The step's record is `migrations.knowledge-link-owner` under `system@<nodeId>`:
 *   { at, placed, kept, deleted, recorded }. It runs before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts).
 * @structure KNOWLEDGE_LINK_OWNER_STEP_KEY · placeKnowledgeLinkOwnersOnce(storage, config)
 * @usage await placeKnowledgeLinkOwnersOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v78 and v79).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryLinkRecord } from '../storage/interface.js';
import { isSameOwner, localAccountOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident, securityOwner } from './security-incident.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const KNOWLEDGE_LINK_OWNER_STEP_KEY = 'migrations.knowledge-link-owner';

/** How many unplaced rows the incident names one by one. */
const INCIDENT_ROWS = 50;

interface Outcome { placed: number; kept: number; deleted: number; recorded: number }

/**
 * The contributor's GHII on this node and its account name, or null when linked_by names another node
 * or no owner. Every writer stored the bare account name before 2026-10-22.
 */
function contributorOf(linkedBy: string, nodeId: string): { ghii: string; account: string } | null {
  if (!linkedBy) return null;
  const ghii = linkedBy.includes('@') ? linkedBy : `${linkedBy}@${nodeId}`;
  if (!ghii.endsWith(`@${nodeId}`) || ghii.includes('#')) return null;
  const account = localAccountOf(ghii);
  return account ? { ghii, account } : null;
}

/**
 * Place, once per node, every link row written before link rows carried their owner. Throws when a
 * read or a write fails, and then leaves no record, so the next start tries again; a row placed by a
 * failed run stays placed, which is what the next run would do anyway.
 */
export async function placeKnowledgeLinkOwnersOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean } & Partial<Outcome>> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, KNOWLEDGE_LINK_OWNER_STEP_KEY);
  if (!claim) return { ran: false };
  try {
    const at = new Date().toISOString();
    const out: Outcome = { placed: 0, kept: 0, deleted: 0, recorded: 0 };
    const rows = await storage.listUnplacedLinks();
    const undecided: Array<MemoryLinkRecord & { holders: string[] }> = [];
    if (rows.length) {
      const owners = await storage.listOwners();
      const accounts = new Set(owners.map(o => o.name));
      const namespaces = [
        ...owners.map(o => `${o.name}@${config.nodeId}`),
        ...(await storage.listAgents()).map(a => a.gaii),
      ];
      for (const row of rows) {
        const contributor = contributorOf(row.linked_by, config.nodeId);
        const ghii = contributor?.ghii ?? null;
        const accountExists = !!contributor && accounts.has(contributor.account);
        const holders = (await storage.listMemoryForOwners(namespaces, { prefix: row.source }))
          .filter(r => r.key === row.source).map(r => r.ownerGaii);
        const inAccount = ghii ? holders.filter(h => isSameOwner(h, ghii)) : [];
        const linkedBy = accountExists && ghii && ghii !== row.linked_by ? { linkedBy: ghii } : {};

        if (inAccount.length === 1 && accountExists) {
          if (await storage.updateUnplacedLink(row.source, row.target, { sourceOwner: inAccount[0], ...linkedBy })) out.placed++;
        } else if (holders.length === 0 && contributor && !accountExists) {
          // An erased account's row whose package no namespace holds: what its erasure should have taken.
          if (await storage.deleteUnplacedLink(row.source, row.target)) out.deleted++;
        } else if (holders.length === 0) {
          // The package is gone: the row lists as an incoming link only, as it did.
          if (linkedBy.linkedBy) await storage.updateUnplacedLink(row.source, row.target, linkedBy);
          out.kept++;
        } else {
          if (linkedBy.linkedBy) await storage.updateUnplacedLink(row.source, row.target, linkedBy);
          undecided.push({ ...row, ...(linkedBy.linkedBy ? { linked_by: linkedBy.linkedBy } : {}), holders });
        }
      }
    }
    if (undecided.length) {
      const shown = undecided.slice(0, INCIDENT_ROWS)
        .map(r => `${r.source} -> ${r.target} (linked by ${r.linked_by}; held by ${r.holders.length ? r.holders.join(', ') : 'no namespace'})`);
      const more = undecided.length > INCIDENT_ROWS ? ` and ${undecided.length - INCIDENT_ROWS} more` : '';
      const incident = await recordSecurityIncident(storage, config, {
        type: 'knowledge_link_owner',
        code: 'KNOWLEDGE_LINK_OWNER_UNPLACED',
        actorGhii: securityOwner(config.nodeId),
        actorName: 'node start',
        source: 'knowledge_links',
        detail: `${undecided.length} knowledge link row(s) written before link rows carried their owner could not be given one: `
          + 'the source package is held by more than one record in the contributor\'s account, or only by another account. '
          + 'They stay as they are and show only as incoming links of their target until the owner adds them again '
          + `with POST /v1/knowledge/:id/link. ${shown.join('; ')}${more}.`,
      });
      out.recorded = incident.recorded ? undecided.length : 0;
    }
    await claim.finish({ at, ...out });
    if (rows.length) logger.info('Knowledge links: rows written before the owner column placed', { ...out, undecided: undecided.length });
    return { ran: true, ...out };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
