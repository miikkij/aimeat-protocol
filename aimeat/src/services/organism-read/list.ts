/**
 * @file src/services/organism-read/list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which organisms a caller is listed: the query GET /v1/organisms builds and the rules
 *   around it (structure programme 2026-11, unit 2b). Browsing without a member filter shows what the
 *   directory shows ('public' and 'listed'; only an operator browses past that) and leaves archived
 *   organisms out. A member filter lists the member's organisms: the member themself or an operator
 *   sees every visibility (and, in person, the archived ones), anyone else the public ones; and for an agent an
 *   organism that does not admit it is left out (organismsAdmitting, its name is its own).
 *
 *   GET /v1/organisms (buildOrganismList, routes/organisms/crud.ts) calls it and then adds the counts
 *   and the roster redaction. aimeat_organism_list's public half and the aimeat://organisms resource
 *   list call it with no filter, which is the browse the route serves with no query.
 * @structure listedOrganisms(deps, auth, params) → OrganismRecord[]
 * @usage const organisms = await listedOrganisms({ storage, config }, req.auth, { visibility, member });
 * @version-history
 *   v1.1.0 — 2026-11-14 — A member list carries the archived organisms only for the owner or the
 *     operator in person; an agent gets the list aimeat_organism_list gives it (parity section
 *     ARCHIVED-LIST; finding u2b-archived-organisms-listed-to-agent-rest).
 *   v1.0.0 — 2026-11-13 — Moved from routes/organisms/crud.ts buildOrganismList, unchanged; the MCP
 *     list read the same browse query on its own (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { VerifiedToken } from '../../auth/jwt.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { isOwnerInPerson, localAccountName, resolveIdentity } from '../../utils/gaii.js';
import { organismsAdmitting } from '../organism-agent-access.js';
import { isOperatorCaller } from '../operator-override.js';

/** What a caller who is neither the member asked about nor an operator browses: the same two
 *  visibilities the directory indexes (services/directory.ts). */
const BROWSABLE_VISIBILITIES = new Set(['public', 'listed']);

export interface OrganismListParams {
    type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number;
}

/** The organisms this caller is listed for these filters, in the store's order. */
export async function listedOrganisms(
    deps: { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> },
    /** req.auth, or an MCP session's caller().auth: the facts the operator test, the anonymous test and
     *  resolveIdentity read. */
    auth: (Pick<VerifiedToken, 'sub' | 'owner' | 'roles' | 'scopes'> & Partial<Pick<VerifiedToken, 'federated' | 'homeNode' | 'anonymous'>>) | undefined,
    params: OrganismListParams,
): Promise<OrganismRecord[]> {
    const { storage, config } = deps;
    const memberBare = params.member ? localAccountName(params.member) : undefined;
    // The operator half asks isOperatorCaller, as the MCP tools do: the operator's agent holding
    // operator:admin passes too. A list read writes no operator trail.
    const operator = !!auth && await isOperatorCaller(storage, auth);
    const selfOrOperator = operator || (!!auth && !isAnonymousPrincipal(auth) && auth.owner === memberBare);
    // Browsing without a member filter shows what the directory shows: 'public' and 'listed'. The
    // caller's ?visibility= went to storage unchecked before, so ?visibility=private answered every
    // private organism of the node to an anonymous caller. Only an operator browses past that.
    const asked = params.visibility || 'public';
    if (!params.member && !operator && !BROWSABLE_VISIBILITIES.has(asked)) return [];
    const organisms = await storage.listOrganisms({
        type: params.type,
        city: params.city,
        interest: params.interest,
        member: memberBare,
        visibility: params.member ? (selfOrOperator ? params.visibility : 'public') : asked,
        // Pass pagination through untouched: a member-scoped list (the owner's own organisms) must return ALL
        // of them — the storage layer only page-caps browse/discovery (no member filter). Forcing perPage here
        // silently dropped the owner's oldest organisms out of "My Organisms" once they belonged to 20+.
        page: params.page,
        perPage: params.perPage,
        // The owner's OWN list includes archived (the client splits them into an "Archived" section);
        // browsing/discovery excludes archived — retired organisms are read-only and not discoverable.
        // Only for the owner or the operator in person: an archived organism drops out of every
        // AI-facing material assembly (services/archive.ts), as aimeat_organism_list leaves it out.
        archived: (params.member && selfOrOperator && isOwnerInPerson(auth)) ? 'include' : 'exclude',
    });

    // A member list leaves out, for an agent, an organism that does not admit it, as
    // aimeat_organism_list does: its name is its own (services/organism-agent-access.ts). Not an agent:
    // the list is as before. Browsing (no member filter) is the directory and is not narrowed here.
    return params.member && auth && !isAnonymousPrincipal(auth)
        ? organismsAdmitting(organisms, resolveIdentity(auth, config.nodeId))
        : organisms;
}
