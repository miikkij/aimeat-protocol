/**
 * @file src/services/knowledge/package-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The links of one knowledge package, read on the terms of the package itself.
 *   GET /v1/knowledge/:id/links found the package with routes/knowledge/helpers.ts findReadableManifest
 *   (the caller's own namespace, then a public manifest of any account, then a members or organism
 *   audience); aimeat_knowledge_links found it with its own readPackage (the owner's account, with
 *   memory:read-as-owner deciding an agent's reach, and never another account). Another owner's agent
 *   got a public package's links on REST and "not found" on MCP; the owner's agent holding
 *   memory:read-as-owner got a private package's links on MCP and 404 on REST (structure programme
 *   2026-11, unit 2b, B15; developer approval 2026-11-14).
 *
 *   THE RULE, one for both surfaces. A public package for any caller; a package of the caller's own
 *   account for the owner in person, for the agent whose own record it is, and for the owner's agents
 *   holding memory:read-as-owner; a package shared with this node's accounts or one organism for a
 *   caller that audience admits. Then what the classification reader shows. The outgoing rows are
 *   those of the namespace that holds the manifest found, never another account's at the same key
 *   (secaudit 2026-10, v78).
 * @structure PackageLinks · packageLinksFor(storage, config, reader, packageId, opts)
 * @usage const out = await packageLinksFor(storage, config, { caller, auth: req.auth }, id, { direction: 'both' });
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, B15).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { readsAsOwner } from '../owner-scope-read.js';
import { isNodeAccount, type AudienceAuth } from '../audience.js';
import { packageAudienceOf, knowledgeAudienceAllows } from '../knowledge-audience.js';
import { readerFor, type ReaderAuth } from '../classification/reader.js';
import { presentMemory } from '../classification/present-memory.js';
import { localAccountName } from '../../utils/gaii.js';

type Link = Awaited<ReturnType<Storage['listLinks']>>[number];
/** `omitted`: the account holds the package, and the visibility rule left it out for this caller. */
export type PackageLinks = { found: false; omitted: boolean } | { found: true; manifest: MemoryRecord; links: Link[] };

/** The copy of a manifest that names the package: of the records at `key`, the one written first (secaudit2026oct26). */
function firstCopy(rows: MemoryRecord[], key: string): MemoryRecord | undefined {
    return rows.filter(r => r.key === key)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ownerGaii.localeCompare(b.ownerGaii))[0];
}

/**
 * The package `packageId` when `reader` may read it, and its links. `reader.caller` is null for a
 * request with no account (no credential, or the anonymous one); `reader.auth` is the session the
 * classification reader and the audience test read.
 */
export async function packageLinksFor(
    storage: Storage, config: AimeatConfig,
    reader: { caller: CallerContext | null; auth: (ReaderAuth & AudienceAuth) | null | undefined },
    packageId: string, opts: { direction: 'outgoing' | 'incoming' | 'both'; relation?: string | undefined },
): Promise<PackageLinks> {
    const key = `packages/${packageId}/manifest`;
    const { caller } = reader;
    let record: MemoryRecord | undefined;
    let omitted = false;

    // The caller's own account: the principal's own copy, or the account's for the owner in person and
    // for an agent holding memory:read-as-owner.
    if (caller && !caller.visitor && caller.owner) {
        const agents = await loadOwnerAgents(storage, caller.owner);
        const own = (await storage.listMemoryForOwners([caller.ownerGhii, ...agents.map(a => a.gaii)], { prefix: key }))
            .filter(r => r.key === key);
        record = own.find(r => r.ownerGaii === caller.principal)
            ?? (caller.inPerson || readsAsOwner(caller) ? firstCopy(own, key) : undefined);
        omitted = !record && own.length > 0;
    }
    // A public manifest of any account, the one its importer wrote.
    if (!record) {
        const owners = (await storage.listOwners()).map(o => `${o.name}@${config.nodeId}`);
        const agents = (await storage.listAgents()).map(a => a.gaii);
        record = firstCopy(await storage.listMemoryForOwners([...owners, ...agents], { prefix: key, visibility: 'public' }), key);
        // A package shared with this node's accounts or one organism, for a caller that audience admits.
        if (!record && isNodeAccount(reader.auth)) {
            const rows = (await storage.listMemoryForOwners([...owners, ...agents], { prefix: key }))
                .filter(r => r.key === key && r.visibility !== 'public');
            for (const r of rows) {
                const audience = packageAudienceOf(r.value);
                if (audience !== 'members' && !audience.startsWith('organism:')) continue;
                if (await knowledgeAudienceAllows(storage, audience, reader.auth, localAccountName(r.ownerGaii))) { record = r; break; }
            }
        }
    }
    if (!record) return { found: false, omitted };
    const shown = await presentMemory(readerFor({ storage, config }, reader.auth), record);
    if (!shown) return { found: false, omitted: false };
    const links = await storage.listLinks(key, {
        direction: opts.direction,
        ...(opts.relation ? { relation: opts.relation } : {}),
        sourceOwner: shown.ownerGaii,
    });
    return { found: true, manifest: shown, links };
}
