/**
 * @file src/services/memory-write-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contract of services/memory-write.ts: what a caller supplies for a memory write
 *   (MemoryWriteFanout, MemoryWriteCaller, MemoryWriteInput) and what it gets back (MemoryWriteResult,
 *   MemoryWriteWarning, AfterMemoryWriteReport). Moved out of memory-write.ts unchanged, which
 *   re-exports every name, so the service file stays under the line limit.
 * @structure MemoryWriteFanout · MemoryWriteCaller · MemoryWriteInput · ExchangeReconcileReport ·
 *   MemoryWriteWarning · AfterMemoryWriteReport · MemoryWriteResult
 * @usage import type { MemoryWriteCaller, MemoryWriteResult } from './memory-write.js';
 * @version-history
 *   2026-11-04 — Moved verbatim from services/memory-write.ts (codebase analysis 2026-11-03, item C3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { provenanceForWrite } from './ai/provenance.js';
import type { reconcileAfterSourceWrite } from './exchange-projection.js';
import type { publishRequestedBody } from './publish-requests/ask.js';

/** What a caller must supply for the fan-out that a memory write sets off. */
export interface MemoryWriteFanout {
    storage: Storage;
    config: AimeatConfig;
    /** Known peers, for the replication queue. Absent on a node with no federation. */
    peers?: Map<string, unknown>;
    /** MCP resource notifications, when the door has them. */
    emitResourceUpdated?: (gaii: string, uri: string) => void;
    emitResourceListChanged?: (gaii: string) => void;
    /** The directory refresh, for the two profile keys it watches. */
    onDirectoryChange?: () => void;
    /** The node's counters. */
    stats?: { increment: (metric: string) => void };
    /** True when the write came from an agent session, for the activation marker. */
    fromAgent?: boolean;
    /** The owner behind the session, needed only when fromAgent. */
    ownerName?: string;
}

/** Who is writing, in the terms every surface can supply. */
export interface MemoryWriteCaller {
    /** The principal that WROTE this. Provenance names this, never the namespace it lands in. */
    principal: string;
    /** Namespace the record lands in, already resolved through services/write-target.ts. */
    targetGaii: string;
    /** Scopes on the session. An owner or operator role passes without one, as requireScope does. */
    scopes: string[];
    roles: string[];
    /** A federated session: minted with the owner role and a scope list the receiving node chose. */
    federated?: boolean;
    /** `owner/filename` of an app grant, so a publish request names the app that asked. */
    app?: string;
}

export interface MemoryWriteInput {
    key: string;
    value: unknown;
    visibility: MemoryRecord['visibility'];
    tags?: string[];
    ttlHours?: number | null;
    groupId?: string;
    /** Already normalized by the caller through utils/workspace-ref.js — a single string. */
    workspaceRef?: string;
    /** Optimistic lock. When set and it does not match the stored version, the write is refused. */
    expectedVersion?: number;
    declaredProvenanceId?: string;
    declaredProvenance?: Parameters<typeof provenanceForWrite>[1]['declared'];
    /**
     * The value is the stored one and only metadata changes (a visibility or tag edit through
     * PUT /v1/memory/:key). No new provenance statement is made about bytes that already have one:
     * the record keeps `keptProvenanceId`, the id it carried.
     */
    valueUnchanged?: boolean;
    keptProvenanceId?: string;
    /** Which road this came down, for the provenance record: 'mcp.memory_write', 'rest.memory' … */
    pipeline: string;
    /**
     * Skip the shadowing check when the caller already knows the write lands in the owner's own
     * namespace. Only a shortcut: the check reads the TARGET namespace and never runs for an owner
     * GHII anyway, so a door that is not sure leaves this unset rather than guessing true.
     */
    ownerScoped?: boolean;
    /**
     * The permission that authorises THIS write, when it is not `memory:write`.
     *
     * Some capabilities are a memory record underneath but have their own permission word at their
     * own door: a seller's PSP configuration and an app's tool manifest are gated on `commerce:sell`
     * and nothing else. Those tools used to call storage.setMemory directly, which is how they came
     * to skip the archive guard, the value-size ceiling, the key ceiling, the byte quota and the
     * overage charge — the whole reason this service exists. Naming the governing scope here lets
     * them come in through the front door without being told to hold a permission their owner never
     * granted them, and without a second implementation to keep in step.
     */
    authorisingScope?: string;
    /**
     * Ask the node's publish gate when this write makes the record public (services/publish-gate.ts,
     * plan doc-mvcn6c7e4e5q V4.4). The generic memory doors set it: POST, PUT and PATCH /v1/memory and
     * aimeat_memory_write. A door whose record is public BY DESIGN leaves it unset: an agent's offers
     * document on the exchange market (decision 11.6), the node's own pitfall knowledge base.
     */
    gatePublic?: boolean;
    /** Start nothing else: no Tracked Response, connector push, workflow trigger, ecosystem push or recipe (an AI job's answer). */
    noTriggers?: boolean;
}

/**
 * What the EXCHANGE projection reports about a write to one of its listing sources (an app-tool
 * manifest, an agent's offers document): what listed and what was skipped, and why. Its shape
 * belongs to services/exchange-projection.ts; this file only carries it out of the write, so the
 * type follows whatever that function returns and is `never` while it returns nothing.
 */
export type ExchangeReconcileReport =
    Exclude<Awaited<ReturnType<typeof reconcileAfterSourceWrite>>, void | undefined | null>;

/** A warning a successful write carries: the record was stored, and something about it needs a person. */
export interface MemoryWriteWarning {
    // PUBLISH_NOT_ASKED: stored at the level it had, and the request to make it public could not be
    // filed (too many already wait for the owner). PUBLIC_IS_SIGNED_IN_HERE: asked public on a node
    // that shows its content to signed-in accounts only, stored at 'members' (closed-node-level.ts).
    code: 'SHADOWED_BY_OWNER_COPY' | 'PUBLISH_NOT_ASKED' | 'PUBLIC_IS_SIGNED_IN_HERE';
    message: string;
    [detail: string]: unknown;
}

/** What everything a write sets off has to say back to the door that made the write. */
export interface AfterMemoryWriteReport {
    exchange?: ExchangeReconcileReport;
}

export type MemoryWriteResult =
    | {
        ok: true;
        record: MemoryRecord;
        /** Set when the OWNER already holds this key and this copy lands in an agent namespace, so
         *  owner-scope reads will resolve to theirs and this one is invisible. A warning, not a
         *  refusal: writing your own copy is legitimate, it just does not update somebody else's. */
        shadowedBy: string | null;
        /** Every warning above in one list, worded once, for a door to hand back as it is. */
        warnings: MemoryWriteWarning[];
        /** The EXCHANGE projection's report, when this key is a listing source and it made one. */
        exchange?: ExchangeReconcileReport;
        /**
         * The write asked to make the record public and the caller may not do that alone: the record
         * is stored at the level it had, and this is the request the owner answers. A door answers 202.
         */
        publishRequest?: ReturnType<typeof publishRequestedBody>;
    }
    | {
        ok: false;
        status: number;
        code: 'SCOPE_DENIED' | 'SCHEMA_VALIDATION_FAILED' | 'VERSION_CONFLICT'
            | 'ACCESS_DENIED' | 'ARCHIVED' | 'QUOTA_EXCEEDED'
            // From the organism namespace rule, which answers with the same codes the HTTP door
            // has always sent for these three cases.
            | 'AUTH_REQUIRED' | 'NOT_FOUND' | 'CONSENT_REQUIRED'
            // A workspace record whose space the workspace manifest does not declare.
            | 'UNDECLARED_SPACE'
            // A record that holds a credential, written through a door that does not own it.
            | 'SECRET_RECORD'
            // A key only the node itself writes (utils/reserved-keys.ts SERVER_WRITTEN_KEYS).
            | 'RESERVED_KEY'
            // An `agents.` key that carries an identity where the agent's name belongs.
            | 'AGENT_KEY_NOT_A_NAME'
            // An EXCHANGE listing source whose changed text would break an ODPS length cap.
            | 'ODPS_FIELD_TOO_LONG'
            // The same source carrying the old morsel price on a node at 4.0.0 or later.
            | 'MORSEL_PRICE_REMOVED'
            // A knowledge package manifest whose sharing.toll_morsels and deprecated
            // sharing.morsel_price disagree, or whose amount is not a number of at least 0.
            | 'TOLL_MORSELS_MISMATCH' | 'INVALID_INPUT'
            // A write of an agent's live crew definition that changes its browser site list, not by
            // the owner in person (QA audit F07b-02).
            | 'OWNER_APPROVES_SITES'
            // visibility 'organism:<id>' naming an organism the writer's account is not an active
            // member of (services/organism-visibility.ts).
            | 'NOT_ORGANISM_MEMBER'
            // Making it public, by a caller with nobody on this node to ask (services/publish-gate.ts).
            | 'PUBLISH_NOT_ALLOWED'
            // A level wider than the record's label allows (services/classification/audience-cap.ts).
            | 'LABEL_CAPS_AUDIENCE';
        message: string;
        details?: unknown;
    };
