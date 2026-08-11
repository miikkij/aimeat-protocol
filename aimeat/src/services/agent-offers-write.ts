/**
 * @file src/services/agent-offers-write.ts
 * @description Publishing one agent's offers document (`agents.{name}.offers`) — the record the
 *   profile Offers surface, the owner's "Do" feed, the mesh delegate picker and the EXCHANGE
 *   projection all read.
 *
 *   WHY THIS FILE EXISTS. Two surfaces published that record and each carried its own copy of the
 *   same six steps: resolve the named agent under the caller's own owner, refuse a foreign one,
 *   validate the WHOLE document, bump the document version, store the record, and tell the node.
 *   PUT /v1/agents/:name/offers (routes/agents/offers.ts) and `aimeat_offer_price_set`
 *   (mcp/commerce.ts) agreed on the shape and had drifted on the part that costs most: both wrote
 *   with storage.setMemory, so neither answered to the rules the same record answers to when a
 *   person edits it through /v1/memory. No schema lock, no 1024 kB value ceiling, no key ceiling,
 *   no byte quota, no archive guard, and none of the fan-out a write sets off — a Tracked Response
 *   watching the key never evaluated, an event-triggered workflow never started, a federated peer
 *   waited for the next scheduled sync. An offers document is a memory record, and going through
 *   services/memory-write.ts is what makes it behave like one on whichever door it arrived at.
 *
 *   WHAT IS SHARED AND WHAT IS NOT. Shared here: target resolution, the same-owner refusal, the
 *   OffersDocSchema validation of the whole document, the version bump, the write and the change
 *   event. Not shared, because it belongs to one door: how each parses its input, what it does to
 *   the offers before publishing (the MCP tool patches one offer's price, the REST route replaces
 *   the list), and how a refusal is rendered.
 * @structure
 *   - OffersWriteDeps / OffersWriteCaller / OffersWriteResult — the contract
 *   - offersKeyFor() — the memory key, in one place
 *   - loadAgentOffers() — resolve and read, for a door that patches rather than replaces
 *   - publishAgentOffers() — validate the whole document and store it
 * @usage
 *   const out = await publishAgentOffers({ storage, config }, caller, 'trader', offers);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own answer
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/commerce.ts (August 2026 MCP audit, step 8). The REST
 *     route routes/agents/offers.ts still holds the second copy of the same sequence; pointing it
 *     here is a one-line change that belongs to whoever owns that file.
 */
import type { AimeatConfig } from '../config.js';
import type { MemoryRecord, Storage } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { writeMemoryRecord, type MemoryWriteResult } from './memory-write.js';
import { emitChange } from './event-bus.js';

export interface OffersWriteDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** Who is publishing, in the terms every surface can supply. */
export interface OffersWriteCaller {
    /** The principal that wrote this. Provenance names it, never the namespace it lands in. */
    principal: string;
    /** The bare owner name behind the session. A named agent has to belong to it. */
    owner: string;
    scopes: string[];
    roles: string[];
    /** Which road this came down, for the provenance record: 'mcp.offer_price_set', 'rest.offers'… */
    pipeline: string;
    /**
     * The permission that authorises this publish when it is not `memory:write`. An offers document
     * is a memory record underneath, but the door in front of it has its own word: the MCP pricing
     * tool is granted `commerce:sell` and was never asked to hold a memory permission.
     */
    authorisingScope?: string;
}

/** The refusals services/memory-write.ts can return, so callers can switch on one set of codes. */
type MemoryWriteRefusal = Extract<MemoryWriteResult, { ok: false }>;

export interface OffersWriteRefusal {
    ok: false;
    status: number;
    code: 'AGENT_NOT_FOUND' | 'ACCESS_DENIED' | 'INVALID_OFFERS' | MemoryWriteRefusal['code'];
    message: string;
    details?: unknown;
}

export type OffersWriteResult =
    | {
        ok: true;
        agentName: string;
        agentGaii: string;
        /** The DOCUMENT's own version counter, which is not the memory record's. */
        docVersion: number;
        offers: Offer[];
        record: MemoryRecord;
    }
    | OffersWriteRefusal;

export type OffersReadResult =
    | { ok: true; agentName: string; agentGaii: string; docVersion: number; offers: Offer[] }
    | OffersWriteRefusal;

/** The memory key an agent's offers live under. */
export function offersKeyFor(agentName: string): string {
    return `agents.${agentName}.offers`;
}

/**
 * Resolve what a caller named into one of their OWN agents. A bare name is built into a GAII under
 * the caller's owner; a full GAII is taken as given and then has to survive the same-owner check,
 * which is what stops a caller publishing into somebody else's agent.
 */
async function resolveOwnAgent(
    deps: OffersWriteDeps,
    callerOwner: string,
    identifier: string,
): Promise<{ ok: true; gaii: string; name: string } | OffersWriteRefusal> {
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, callerOwner, deps.config.nodeId);
    const agent = await deps.storage.getAgent(gaii);
    if (!agent) {
        return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    }
    if (agent.owner !== callerOwner) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You can only publish offers for your own agents' };
    }
    return { ok: true, gaii, name: agent.name };
}

/**
 * Read one of the caller's own agents' offers, with the same target resolution the publish uses.
 *
 * A door that changes one offer needs the current list before it can write the whole document back,
 * and resolving the agent twice by hand is how the two copies came to disagree about what a bare
 * name means.
 */
export async function loadAgentOffers(
    deps: OffersWriteDeps,
    callerOwner: string,
    identifier: string,
): Promise<OffersReadResult> {
    const target = await resolveOwnAgent(deps, callerOwner, identifier);
    if (!target.ok) return target;
    const rec = await deps.storage.getMemory(target.gaii, offersKeyFor(target.name));
    const doc = (rec?.value as { version?: number; offers?: Offer[] } | undefined) ?? {};
    return {
        ok: true,
        agentName: target.name,
        agentGaii: target.gaii,
        docVersion: doc.version ?? 0,
        offers: doc.offers ?? [],
    };
}

/**
 * Publish the offers document for one of the caller's own agents.
 *
 * The WHOLE document validates, not the entry that changed: a door that patches a single offer would
 * otherwise store a list it never checked. The document version counts publishes and carries on from
 * whatever is stored, so a reader can tell one edition from the next.
 */
export async function publishAgentOffers(
    deps: OffersWriteDeps,
    caller: OffersWriteCaller,
    identifier: string,
    offers: unknown,
): Promise<OffersWriteResult> {
    const target = await resolveOwnAgent(deps, caller.owner, identifier);
    if (!target.ok) return target;

    const parsed = OffersDocSchema.safeParse({ offers });
    if (!parsed.success) {
        return { ok: false, status: 400, code: 'INVALID_OFFERS', message: parsed.error.message };
    }

    const key = offersKeyFor(target.name);
    const existing = await deps.storage.getMemory(target.gaii, key);
    const docVersion = ((existing?.value as { version?: number } | undefined)?.version ?? 0) + 1;

    const written = await writeMemoryRecord(deps, {
        principal: caller.principal,
        targetGaii: target.gaii,
        scopes: caller.scopes,
        roles: caller.roles,
    }, {
        key,
        value: { version: docVersion, updatedAt: new Date().toISOString(), offers: parsed.data.offers },
        // 'owner' means every one of this owner's principals reads it, which is what the profile
        // surfaces and the delegate picker rely on. Per-offer `visibility` is a different axis: it
        // decides which offers a stranger sees, and it lives inside the document.
        visibility: 'owner',
        tags: ['offers'],
        pipeline: caller.pipeline,
        // The record lands in the agent's own namespace, where every reader looks for it, so there
        // is no owner copy for the shadowing check to find.
        ownerScoped: true,
        ...(caller.authorisingScope ? { authorisingScope: caller.authorisingScope } : {}),
    });
    if (!written.ok) return written;

    // The profile Offers tab and the "Do" feed listen on 'agents' rather than on the memory
    // firehose. The EXCHANGE projection is deliberately not repeated here: writeMemoryRecord already
    // reconciles the listing this record is the source of truth for.
    emitChange('agents');

    return {
        ok: true,
        agentName: target.name,
        agentGaii: target.gaii,
        docVersion,
        offers: parsed.data.offers,
        record: written.record,
    };
}
