/**
 * @file organism-namespace-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read or write an `organism.{id}.*` key. Membership, the namespace role
 *   (meta = admin/creator write, a workspace's meta = its creator or an admin, shared = member,
 *   member.{owner} = self), the WORKSPACE role (viewer reads, contributor reads and writes, and it
 *   is the member's own permission, not an agent-only one) and the consent layer, in one function
 *   that takes a caller rather than an Express request.
 *
 *   WHY IT MOVED HERE. This rule lived entirely inside middleware/workspace-access.ts, which is
 *   RequestHandler-shaped, so only a road with a `req` could reach it. services/memory-write.ts —
 *   the shared write the MCP tools call — could therefore carry the FLOOR of the rule and nothing
 *   above it, and the August 2026 re-measurement found what that cost:
 *
 *     - a member holding only a VIEWER grant, or no grant at all, wrote another member's workspace
 *       content over MCP; revoking a contributor role stopped the web door and not the agent door
 *     - any active member rewrote organism.{id}.meta.workspaces — the registry every access decision
 *       reads — and so could add, rename or remove workspaces they do not administer
 *     - one member overwrote another member's private organism namespace
 *
 *   That is the shape the whole audit is about: a guard shaped like one door does not reach the
 *   other. The rule is the same rule for both now, and the middleware is a wrapper over it.
 * @structure
 *   - OrganismAccessCaller — the principal, its owner name and its roles
 *   - checkOrganismNamespaceAccess() — a refusal, or null when the access is allowed
 *   - organismReadableRecords() — the records of a listing the caller may read under the same rule
 * @usage
 *   const refusal = await checkOrganismNamespaceAccess({ storage, config }, caller, key, 'write');
 *   if (refusal) return { ok: false, ...refusal };
 *   const shown = await organismReadableRecords({ storage, config }, callerContext, records);
 * @version-history
 *   2026-10-21 — organismReadableRecords keeps the records of an organism that no longer exists in the
 *     listing, as the owner-scope reads returned them before 2026-10-20: there is no organism whose
 *     rule could refuse them. A barred agent of a live organism still loses that organism's records.
 *   2026-10-21 — organismReadableRecords reads storage through listingReads():the organism, the
 *     account, the membership, the owner's agents and each accessor's active consents once per
 *     listing instead of once per flat key. 1000 shared keys of one organism, an agent of a plain
 *     member with a consent: Postgres 11.2 → 0.04 ms a key (11 s → 41 ms a listing), SQLite 0.47 →
 *     0.02 ms; a creator's agent: Postgres 2.8 → 0.01 ms, SQLite 0.16 → 0.004 ms. The decisions are
 *     the same: checkOrganismNamespaceAccess still decides every key (capability-loss review).
 *   2026-10-20 — organismReadableRecords(): the read rule for a listing, which the owner-scope read
 *     and list paths of the memory route and the MCP memory tools ask. They returned organism records
 *     to an agent the organism does not admit (secaudit 2026-10, v57).
 *   2026-10-20 — A WORKSPACE ROLE IS A USER-LEVEL PERMISSION, so a member writing workspace CONTENT
 *     passes the same role test in person as through an agent: the caller is the workspace's
 *     registered creator, an organism manager, or holds an active `workspace-contributor` grant from
 *     the creator; a `viewer` grant reads only, and a member with no grant neither reads nor writes
 *     (Core 2026-11 COL-09, ruled by the developer on 2026-10-20). Until now isOwnerInPerson dropped
 *     the consent step for a human, so the role test ran for agents alone and any active member wrote
 *     any non-meta key of any workspace through POST /v1/memory, the draft and publish code paths and
 *     the row append and delete routes, while the READ gate already applied the role to them: the
 *     write was wider than the read (secaudit 2026-10, defect 1). The workspace's own meta namespace
 *     keeps its stricter creator-or-manager rule and its ACCESS_DENIED answer.
 *   2026-10-13 — The caller carries the session's `scopes`, and a write-mode check takes `write`,
 *     what a write to a workspace's manifest record stores. The fenced-space rule reads both: a
 *     session that covers `organism:direct` writes a fenced space directly, and a change to a fenced
 *     space's list is accepted only from the account holder in person or from such a session (ruled
 *     by the developer on 2026-10-13). An agent of the workspace's creator could store its own copy
 *     of the manifest through the memory write, and the newest copy of the creator's is the one that
 *     counts.
 *   2026-10-13 — A write into a record space that names extensions is refused to a caller that is
 *     not a person unless it arrives through one of them (services/fenced-space.ts, ruled by the
 *     developer on 2026-10-13). The caller carries `extension`, which only the workspace capability
 *     of an extension action sets; a refusal may carry `details`. An agent wrote records into an
 *     app's spaces with the plain write tools, past the checks of the app's own tool.
 *   2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   2026-09-28 — An organism that admits only listed agents refuses the others; a listed agent of an
 *     active member acts with the member's rights (services/organism-agent-access.ts).
 *   v1.0.0 -- 2026-08-11 -- Extracted from middleware/workspace-access.ts (security audit, MCP/REST
 *     drift): the consent layer, the meta.* admin rule and the member.* self-write rule reach every
 *     door instead of only the HTTP one.
 *   v1.1.0 -- 2026-09-24 -- A workspace's own meta namespace, `organism.{id}.w.{ws}.meta.*`, is
 *     written by the workspace's registered creator or an organism admin (secaudit 2026-09, A6-9).
 *     The admin rule matched the organism-level prefix only, and a human member skips the consent
 *     layer, so any active member stored a copy of a workspace's manifest under their own name; the
 *     manifest carries a row space's writeRole and app allowlist. The creator is read through
 *     findWorkspaceRegistration (services/workspace-meta.ts), which the consent step now shares.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ConsentRecord } from '../storage/interface.js';
import { matchesRecipient } from '../storage/consent-recipient.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';
import { findWorkspaceRegistration } from './workspace-meta.js';
import { agentBarred, agentBarredMessage, attachedAsParticipant } from './organism-agent-access.js';
import { isOwnerInPerson, parseGaiiLoose } from '../utils/gaii.js';
import { fencedSpaceRefusal, type ManifestWrite } from './fenced-space.js';
import type { CallerContext } from './caller-context.js';

/** The session asking, in the terms this rule decides on. */
export interface OrganismAccessCaller {
    /** The principal's own id: an agent GAII, a GHII, or an ecosystem id. */
    principal: string;
    /** The bare owner name behind that principal. Memberships are keyed by this, not by the GHII. */
    owner: string;
    /** The session's roles. isOwnerInPerson (utils/gaii.ts) reads the human principal from them. */
    roles: string[];
    /**
     * `installer/name` of the extension whose action makes this call, lower-cased. Set only by the
     * workspace capability of an extension action (services/extension-workspace.ts), never from a
     * request: it is what lets a caller that is not a person write a record space that names the
     * extension (services/fenced-space.ts).
     */
    extension?: string;
    /**
     * The SESSION's scope words, as the token carries them. The fenced-space rule reads them: a
     * session that covers `organism:direct` writes a record space that names extensions directly,
     * and changes which extensions such a space names. A code path that hands none over is read as
     * not holding the word, which refuses.
     */
    scopes?: readonly string[];
}

/** What to answer when the access is refused. `status` and `code` match what the HTTP door sent. */
export interface OrganismAccessRefusal {
    status: number;
    code: 'AUTH_REQUIRED' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'CONSENT_REQUIRED';
    message: string;
    /** Set by the fenced-space refusal: the space and the extensions that open it. */
    details?: Record<string, unknown>;
}

/**
 * May this caller touch this organism key?
 *
 * Returns null when the access is allowed, including for a key outside the `organism.` namespace,
 * which this rule has nothing to say about. `mode` separates reads from writes: the meta and member
 * namespaces are readable by every member and writable by fewer.
 *
 * `write` matters for one key, a workspace's manifest record: a code path that writes it says what
 * it stores, so the fenced-space rule can compare the manifest before and after. Without it a
 * write-mode check on that key is read as the removal of every fence (services/fenced-space.ts).
 */
export async function checkOrganismNamespaceAccess(
    deps: { storage: Storage; config: AimeatConfig },
    caller: OrganismAccessCaller,
    key: string,
    mode: 'read' | 'write',
    write?: ManifestWrite,
): Promise<OrganismAccessRefusal | null> {
    const { storage, config } = deps;

    const match = /^organism\.([^.]+)\./.exec(key);
    if (!match) return null;
    const organismId = match[1];

    if (!caller.owner) {
        return { status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required for workspace access' };
    }

    const organism = await storage.getOrganism(organismId);
    if (!organism) {
        return { status: 404, code: 'NOT_FOUND', message: `Organism not found: ${organismId}` };
    }

    // An organism that admits only listed agents treats every other agent as a non-member.
    if (agentBarred(organism, caller.principal)) {
        return { status: 403, code: 'ACCESS_DENIED', message: agentBarredMessage(organism, caller.principal) };
    }

    // An organism-level agent is attached to the organism rather than a member of it. It reads and
    // writes the shared namespace, reads meta, and gets nothing else — a workspace key included.
    // Where the organism admits only listed agents, the list is how a member's agent gets in at all,
    // so a listed agent acts with its owner's rights below instead (attachedAsParticipant).
    if (attachedAsParticipant(organism, caller.principal)) {
        if (key.startsWith(`organism.${organismId}.shared.`)) return null;
        if (key.startsWith(`organism.${organismId}.meta.`) && mode === 'read') return null;
        return { status: 403, code: 'ACCESS_DENIED', message: 'Agent not authorized for this workspace namespace' };
    }

    const userGhii = await storage.getGHIIByOwner(caller.owner);
    if (!userGhii) {
        return { status: 403, code: 'ACCESS_DENIED', message: 'Not a member of this organism' };
    }

    // Memberships are keyed by the BARE owner name — organisms.ts (join/leave/admin) and consent.ts
    // (organism resolution) both look membership up with the owner name, not the full GHII.
    const membership = await storage.getMembership(organismId, caller.owner);
    if (!membership || membership.status !== 'active') {
        return { status: 403, code: 'ACCESS_DENIED', message: 'Not an active member of this organism' };
    }

    // An org manager already administers this organism's access, invites, export and archive, so
    // they need no per-workspace contributor consent on top.
    const isOrgManager = membership.role === 'creator' || membership.role === 'admin';

    const ownMemberPrefix = `organism.${organismId}.member.${caller.owner}.`;
    const isOwnMemberNamespace = key.startsWith(ownMemberPrefix);

    // A human owner-role session acting as an active member is the principal of the FLAT organism
    // namespace — it does not consent to itself there. The consent layer governs AGENT access and
    // cross-node sharing, and, for workspace content, the member's own role (see isWsContentWrite).
    const isHumanOwnerSession = isOwnerInPerson(caller);

    const wsMatch = /^organism\.[^.]+\.w\.([^.]+)\./.exec(key);
    const wsId = wsMatch ? wsMatch[1] : null;
    // A write into the workspace's own meta namespace needs to know the creator whoever is asking,
    // except an org manager, who passes that rule whatever the registry says.
    const isWsMetaWrite = wsId !== null && mode === 'write' && key.startsWith(`organism.${organismId}.w.${wsId}.meta.`);
    // A WRITE OF WORKSPACE CONTENT. The workspace role is a permission of the MEMBER, not a
    // restriction on their agents: a grant gives the owner `viewer` (read) or `contributor` (read
    // and write) and covers that owner's agents (Core 2026-11 COL-09). So the role test below runs
    // for a member signed in as themselves exactly as it runs for an agent. Meta is left out: it has
    // the stricter creator-or-manager rule further down, which stays the refusal a caller hears for
    // a meta key.
    const isWsContentWrite = wsId !== null && mode === 'write' && !isWsMetaWrite && !isOwnMemberNamespace;
    let wsCreator: string | null = null;
    if (wsId && (!isHumanOwnerSession || isWsContentWrite || (isWsMetaWrite && !isOrgManager))) {
        wsCreator = (await findWorkspaceRegistration(storage, organismId, wsId))?.creator ?? null;
    }
    // The workspace's own creator holds every right in it, and an agent of theirs is that creator's
    // tool, so neither consents to itself. Every other member, in person or through an agent, holds
    // the granted contributor role or nothing.
    const isWorkspaceCreator = wsCreator !== null && wsCreator === caller.owner;

    const needsConsent = !isOwnMemberNamespace && !isWorkspaceCreator && !isOrgManager
        && !(isHumanOwnerSession && !isWsContentWrite);

    if (needsConsent) {
        let hasConsent = false;

        if (wsId) {
            // Workspace CONTENT: the creator's 'contributor' ROLE grant, and only that, so the
            // creator can revoke write by removing the grant. A 'viewer' grant is read-only and does
            // not match here. The role is granted to the OWNER, so all their agents inherit it.
            if (wsCreator) {
                const creatorGhii = `${wsCreator}@${config.nodeId}`;
                const recipient = `ghii:${caller.owner}@${config.nodeId}`;
                const pattern = `organism.${organismId}.w.${wsId}.**`;
                const grants = await storage.listConsents(creatorGhii, { status: 'active' });
                hasConsent = grants.some(c => c.purpose === 'workspace-contributor' && c.dataPattern === pattern && c.recipient === recipient);
            }
        } else {
            // Flat organism namespace: the writer's own contribution consent, owned by the member's
            // OWNER GHII or one of their agents, whichever made the grant.
            const ownerGhii = `${caller.owner}@${config.nodeId}`;
            const agents = await storage.getAgentsByOwner(caller.owner);
            const accessorPattern = `organism.${organismId}`;
            for (const accessor of [ownerGhii, ...agents.map(a => a.gaii)]) {
                if ((await storage.findMatchingConsents(accessor, key, accessorPattern)).length > 0) { hasConsent = true; break; }
            }
        }

        if (!hasConsent) {
            return {
                status: 403, code: 'CONSENT_REQUIRED',
                message: `Active consent required for organism workspace access (key: ${key})`,
            };
        }
    }

    // Meta namespace: every member reads it, only an admin or the creator writes it. It holds the
    // workspace registry that every access decision above reads, so a plain member writing here
    // would be deciding who may write everywhere else.
    if (key.startsWith(`organism.${organismId}.meta.`) && mode === 'write') {
        if (membership.role !== 'admin' && membership.role !== 'creator') {
            return { status: 403, code: 'ACCESS_DENIED', message: 'Admin access required for meta namespace' };
        }
    }

    // A workspace's own meta namespace, the same rule one level down: every member with access reads
    // it, and the workspace's registered creator or an org manager writes it. It holds the manifest,
    // which carries each row space's writeRole and app allowlist, and the share record, which decides
    // what the public reads. A memory key is unique per owner, so a member's write here never
    // overwrote the creator's record: it stored a second copy beside it for a reader to take. A
    // workspace nobody registered has no creator, and only a manager writes its meta.
    if (isWsMetaWrite && !isOrgManager && wsCreator !== caller.owner) {
        return {
            status: 403, code: 'ACCESS_DENIED',
            message: 'Only the workspace\'s creator or an organism admin may write its meta namespace',
        };
    }

    // Member namespace: every member reads it, only its owner writes it.
    const memberMatch = /^organism\.[^.]+\.member\.([^.]+)\./.exec(key);
    if (memberMatch && mode === 'write') {
        if (memberMatch[1] !== caller.owner) {
            return { status: 403, code: 'ACCESS_DENIED', message: 'Cannot write to another member\'s workspace' };
        }
    }

    // A record space that names extensions takes the write of a caller that is not a person only
    // through one of them (services/fenced-space.ts). Asked last, so every refusal above is still
    // the one a caller hears first, and with the real key: the space is matched by its namespace
    // prefix. The account holder in person returns from it before the manifest is read, and so does
    // a session whose scopes cover organism:direct. The same call protects the workspace's manifest
    // record: a write to it that changes the list of a fenced space is accepted from those two only.
    if (mode === 'write' && wsId) {
        const fenced = await fencedSpaceRefusal({ storage, config },
            { principal: caller.principal, roles: caller.roles, scopes: caller.scopes, extension: caller.extension },
            organismId, wsId, { key }, write);
        if (fenced) return fenced;
    }

    return null;
}

/** The caller of organismReadableRecords: the session's CallerContext (services/caller-context.ts). */
export type OrganismListCaller = Pick<CallerContext, 'kind' | 'inPerson' | 'principalView'>;

/**
 * The records of a listing this caller may read under the organism rule: every key outside the
 * `organism.` namespace, and each organism key checkOrganismNamespaceAccess admits in read mode.
 * Order is kept.
 *
 * WHY. The rule ran as Express middleware on the `:key` memory routes only, so an agent an organism
 * with agentAccess 'listed' did not admit was refused GET /v1/memory/:key and read the same record
 * through GET /v1/memory?owner_scope=true, aimeat_memory_read and aimeat_memory_list (secaudit
 * 2026-10, v57). The owner-scope read and list paths ask this.
 *
 * WHO IS EXEMPT. The owner in person and an app grant of the owner: both read the owner's records as
 * the owner does (services/owner-scope-read.ts readsAsOwner), and an organism the owner left, or one
 * that was deleted, must not hide the owner's own records from their own listing.
 *
 * AN ORGANISM THAT NO LONGER EXISTS has no rule to apply, so its records stay in the listing, as they
 * did before this function: the owner-scope reads returned them, and v57 is about an organism that
 * does not admit the caller, not about one that is gone.
 *
 * ONE CHECK PER DECISION. An organism a caller is barred from ('listed' without this agent) refuses
 * all its keys after one organism read. A workspace key's answer is the same for every
 * key of that workspace, so it is asked once per workspace. A key of the flat namespace (shared,
 * meta, member.{owner}) is asked on its own, because a consent there matches the key itself.
 *
 * ONE STORAGE READ PER FACT. Each flat key is still decided by checkOrganismNamespaceAccess, the one
 * rule, but over listingReads(): the organism, the account, the membership, the owner's agents and
 * each accessor's active consents are read once per listing, not once per key. Measured 2026-10-21
 * on 1000 shared keys of one organism, for an agent of a plain member: 11.2 ms a key on Postgres
 * (11 s for the listing) and 0.47 ms on SQLite before; see the version history for after.
 */
export async function organismReadableRecords<T extends { key: string }>(
    deps: { storage: Storage; config: AimeatConfig },
    caller: OrganismListCaller,
    records: readonly T[],
): Promise<T[]> {
    if (caller.inPerson || caller.kind === 'app') return [...records];
    if (!records.some(r => r.key.startsWith('organism.'))) return [...records];
    deps = { ...deps, storage: listingReads(deps.storage) };
    const organisms = new Map<string, 'gone' | 'barred' | 'open'>();
    const decided = new Map<string, boolean>();
    const out: T[] = [];
    for (const record of records) {
        const org = /^organism\.([^.]+)\./.exec(record.key);
        if (!org) { out.push(record); continue; }
        let state = organisms.get(org[1]);
        if (state === undefined) {
            const organism = await deps.storage.getOrganism(org[1]);
            state = !organism ? 'gone' : agentBarred(organism, caller.principalView.principal) ? 'barred' : 'open';
            organisms.set(org[1], state);
        }
        if (state === 'gone') { out.push(record); continue; }
        if (state === 'barred') continue;
        const group = /^organism\.[^.]+\.w\.[^.]+\./.exec(record.key)?.[0] ?? record.key;
        let admitted = decided.get(group);
        if (admitted === undefined) {
            admitted = !(await checkOrganismNamespaceAccess(deps, caller.principalView, record.key, 'read'));
            decided.set(group, admitted);
        }
        if (admitted) out.push(record);
    }
    return out;
}

/**
 * The storage the organism rule reads, for the length of ONE listing: the reads it repeats per key
 * are answered once and kept, everything else passes through untouched. It holds nothing between
 * calls, so a revoked consent or a removed member counts from the next listing on.
 *
 * findMatchingConsents is answered from the accessor's active consents, read once, with the same
 * matchers the providers use (matchesRecipient, consentMatchPattern) and the same expiry test. The
 * providers also mark an expired row while they read; here an expired row is only left out, and
 * the next provider read marks it.
 */
function listingReads(storage: Storage): Storage {
    const kept = new Map<string, Promise<unknown>>();
    const once = <R>(key: string, read: () => Promise<R>): Promise<R> => {
        if (!kept.has(key)) kept.set(key, read());
        return kept.get(key) as Promise<R>;
    };
    const activeConsents = (owner: string) => once(`consents\u0000${owner}`, () => storage.listConsents(owner, { status: 'active' }));
    const reads: Partial<Record<keyof Storage, unknown>> = {
        getOrganism: (id: string) => once(`organism\u0000${id}`, () => storage.getOrganism(id)),
        getGHIIByOwner: (owner: string) => once(`ghii\u0000${owner}`, () => storage.getGHIIByOwner(owner)),
        getMembership: (id: string, owner: string) => once(`membership\u0000${id}\u0000${owner}`, () => storage.getMembership(id, owner)),
        getAgentsByOwner: (owner: string) => once(`agents\u0000${owner}`, () => storage.getAgentsByOwner(owner)),
        listConsents: (owner: string, opts?: { status?: 'active' | 'revoked' | 'expired'; recipient?: string }) =>
            opts?.status === 'active' && opts.recipient === undefined ? activeConsents(owner) : storage.listConsents(owner, opts),
        findMatchingConsents: async (owner: string, key: string, accessorGaii: string): Promise<ConsentRecord[]> => {
            const now = new Date().toISOString();
            const accessor = parseGaiiLoose(accessorGaii);
            return (await activeConsents(owner)).filter(c => !(c.expires && c.expires < now)
                && matchesRecipient(c.recipient, accessorGaii, accessor.owner, accessor.node)
                && consentMatchPattern(c.dataPattern, key));
        },
    };
    return new Proxy(storage, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && prop in reads) return reads[prop as keyof Storage];
            const value = Reflect.get(target, prop, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
    });
}
