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
 *
 *   ONE READ. Every copy of the package's manifest key on this node is read once, by that key
 *   (getMemoryByKeysAnyOwner), so the cost is the number of copies of this one key and never the
 *   number of accounts or agents. The copy chosen leaves this file only through presentMemory with the
 *   caller's classification reader.
 * @structure PackageLinks · packageLinksFor(storage, config, reader, packageId, opts)
 * @usage const out = await packageLinksFor(storage, config, { caller, auth: req.auth }, id, { direction: 'both' });
 * @version-history
 *   v1.1.0 — 2026-11-14 — One keyed read of the manifest's copies replaces the whole-table owner and
 *     agent lists and the three listMemoryForOwners reads (repairs a153b56dc; check:unbounded-lists,
 *     check:classification-reach). The rule and its answers are unchanged.
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
import { isGEAI, localAccountName } from '../../utils/gaii.js';

type Link = Awaited<ReturnType<Storage['listLinks']>>[number];
/** `omitted`: the account holds the package, and the visibility rule left it out for this caller. */
export type PackageLinks = { found: false; omitted: boolean } | { found: true; manifest: MemoryRecord; links: Link[] };

/** Oldest first: the copy the package's import wrote, which any other copy at the key is younger than (secaudit2026oct26). */
function oldestFirst(rows: MemoryRecord[]): MemoryRecord[] {
    return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ownerGaii.localeCompare(b.ownerGaii));
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
    // Every live copy of this one key, oldest first, held by an account or an agent of this node (the
    // identities a package import writes under; an ecosystem app or a visitor's namespace is no account).
    const suffix = `@${config.nodeId}`;
    const copies = oldestFirst((await storage.getMemoryByKeysAnyOwner([key]))
        .filter(r => r.key === key && !isGEAI(r.ownerGaii) && r.ownerGaii.endsWith(suffix)));
    let record: MemoryRecord | undefined;
    let omitted = false;

    // The caller's own account: the principal's own copy, or the account's for the owner in person and
    // for an agent holding memory:read-as-owner.
    if (caller && !caller.visitor && caller.owner) {
        const identities = new Set([caller.ownerGhii, ...(await loadOwnerAgents(storage, caller.owner)).map(a => a.gaii)]);
        const own = copies.filter(r => identities.has(r.ownerGaii));
        record = own.find(r => r.ownerGaii === caller.principal)
            ?? (caller.inPerson || readsAsOwner(caller) ? own[0] : undefined);
        omitted = !record && own.length > 0;
    }
    // A public manifest of any account, the one its importer wrote.
    if (!record) {
        record = copies.find(r => r.visibility === 'public');
        // A package shared with this node's accounts or one organism, for a caller that audience admits.
        if (!record && isNodeAccount(reader.auth)) {
            for (const r of copies) {
                if (r.visibility === 'public') continue;
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
