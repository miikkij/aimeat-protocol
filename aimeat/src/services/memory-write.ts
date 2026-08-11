/**
 * @file src/services/memory-write.ts
 * @description Writing one memory record, once, for every surface that can write one.
 *
 *   WHY THIS FILE EXISTS. `aimeat_memory_write` and `POST /v1/memory` do the same thing, and the same
 *   defect has been fixed inside the MCP one three separate times: schema locks (v1.8.0), the write
 *   target (owner-scope resolution), and the AI provenance stamp (v1.12.0 also had to add the SSE
 *   event). Each fix landed in one place while the other surface kept the old behaviour, and the
 *   August 2026 audit then found two more of the same kind. The rule in CLAUDE.md — one capability,
 *   one implementation, whatever the interface — is what this file is.
 *
 *   WHAT IS SHARED AND WHAT IS NOT. Shared here, because it is the same decision either way: the
 *   scope gate, the schema lock, the optimistic-version check, the shadowing warning, the provenance
 *   stamp, the record shape, and the change event. NOT shared, because it genuinely belongs to one
 *   door: how a request is parsed, how a refusal is rendered, where the write TARGET comes from (the
 *   two resolvers already live together in routes/memory/owner-target.ts), and the HTTP-only
 *   pre-checks a browser request carries — workspace access on `organism.*` keys and the ecosystem
 *   data-area allowlist, which are about who is knocking rather than about the write itself.
 *
 *   The caller passes what it knows; it does not pass a decision. `targetGaii` is the one thing that
 *   looks like a decision and is not: each door resolves it through the shared resolver first,
 *   because MCP has no `req` and REST has no session scopes in the same shape.
 * @structure
 *   - MemoryWriteCaller / MemoryWriteInput / MemoryWriteResult — the contract
 *   - writeMemoryRecord() — the whole sequence, in order, with the gate first
 * @usage
 *   const out = await writeMemoryRecord({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.2.0 — 2026-08-11 — afterMemoryWrite(): the nine things a write sets off, which all lived
 *     in the tail of POST /v1/memory. A write through a tool call reached storage and stopped
 *     there, so the record was right and the rest of the node did not know — no Tracked Response,
 *     no automation recipe, no workflow trigger, no ecosystem push, no EXCHANGE projection, no
 *     replication, and an organism document that did not appear on the screen it was written into.
 *     It runs inside writeMemoryRecord, so every door inherits it.
 *   v1.1.0 — 2026-08-11 — The organism namespace rule (services/organism-namespace-access.ts) and
 *     input.authorisingScope, so a capability with its own permission word can come in the front
 *     door instead of writing to storage itself.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B: shared service, gate inside).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { validateMemoryWrite } from './schema-validator.js';
import { memoryCeilings } from './memory-ceilings.js';
import { checkMemoryQuotaAlarm } from './quota-alarm.js';
import { isKeyArchived } from './archive.js';
import { provenanceForWrite } from './ai-provenance.js';
import { memoryContentBytes, isAnonymousGaii } from '../routes/memory/shared.js';
import { emitChange } from './event-bus.js';
import { enqueueMemoryReplication } from './memory-replication.js';
import { emitMemoryWritten } from './event-bus.js';
import { reconcileAfterSourceWrite } from './exchange-projection.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { emitEcosystemMemoryWrite } from './ecosystem-events.js';
import { runAutomationRecipesForWrite } from './ecosystem-automation.js';
import { logger } from '../utils/logger.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { parseGAII } from '../utils/gaii.js';

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
    /** Namespace the record lands in, already resolved through routes/memory/owner-target.ts. */
    targetGaii: string;
    /** Scopes on the session. An owner or operator role passes without one, as requireScope does. */
    scopes: string[];
    roles: string[];
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
    /** Which road this came down, for the provenance record: 'mcp.memory_write', 'rest.memory' … */
    pipeline: string;
    /** Skip the shadowing check when the caller already knows the write is owner-scoped. */
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
}

export type MemoryWriteResult =
    | {
        ok: true;
        record: MemoryRecord;
        /** Set when the OWNER already holds this key and this copy lands in an agent namespace, so
         *  owner-scope reads will resolve to theirs and this one is invisible. A warning, not a
         *  refusal: writing your own copy is legitimate, it just does not update somebody else's. */
        shadowedBy: string | null;
    }
    | {
        ok: false;
        status: number;
        code: 'SCOPE_DENIED' | 'SCHEMA_VALIDATION_FAILED' | 'VERSION_CONFLICT'
            | 'ACCESS_DENIED' | 'ARCHIVED' | 'QUOTA_EXCEEDED'
            // From the organism namespace rule, which answers with the same codes the HTTP door
            // has always sent for these three cases.
            | 'AUTH_REQUIRED' | 'NOT_FOUND' | 'CONSENT_REQUIRED';
        message: string;
        details?: unknown;
    };

/** Does this session carry the scope, allowing for the wildcard forms the middleware accepts? */
function hasScope(scopes: string[], needed: string): boolean {
    if (scopes.includes('*') || scopes.includes(needed)) return true;
    const domain = needed.split(':')[0];
    return scopes.includes(`${domain}:*`);
}

/**
 * Write one memory record. The order matters and is the same order the REST route has always used:
 * refuse before validating, validate before reading, read before deciding the version, and stamp
 * provenance last so it describes what is actually being stored.
 */
export async function writeMemoryRecord(
    deps: MemoryWriteFanout,
    caller: MemoryWriteCaller,
    input: MemoryWriteInput,
): Promise<MemoryWriteResult> {
    const { storage, config } = deps;

    // 1. The gate, inside. REST had this in middleware and MCP had it in a lookup table, which is
    //    two places to forget it and the reason the audit could find surfaces that had neither.
    //    Owner and operator pass on the role, exactly as requireScope lets them.
    const privileged = caller.roles.includes('owner') || caller.roles.includes('operator');
    const needed = input.authorisingScope ?? 'memory:write';
    if (!privileged && !hasScope(caller.scopes, needed)) {
        return {
            ok: false, status: 403, code: 'SCOPE_DENIED',
            message: `Writing this needs the "${needed}" permission, which this session does not carry.`,
        };
    }

    // 1b. An anonymous identity writes under anonymous.* and nowhere else. The HTTP route has said
    //     so since the anonymous mode existed; the MCP path had no such fence.
    if (isAnonymousGaii(caller.principal) && !input.key.startsWith('anonymous.')) {
        return {
            ok: false, status: 403, code: 'ACCESS_DENIED',
            message: 'Anonymous agents can only write to keys prefixed with "anonymous."',
        };
    }

    // 1c. An organism.* key belongs to a shared space, and who may write one is decided by
    //     services/organism-namespace-access.ts — the whole rule, not a floor under it. This used to
    //     check only membership, because the rest of it lived in an Express middleware the MCP path
    //     could not call. What that cost: a member holding a VIEWER grant wrote another member's
    //     workspace content, any active member rewrote the meta.* workspace registry that every
    //     access decision reads, and one member overwrote another's private member namespace.
    if (input.key.startsWith('organism.')) {
        const ownerName = parseGAII(caller.principal)?.owner
            ?? caller.principal.split('@')[0].split('#').pop() ?? '';
        const refusal = await checkOrganismNamespaceAccess({ storage, config }, {
            principal: caller.principal, owner: ownerName, roles: caller.roles,
        }, input.key, 'write');
        if (refusal) return { ok: false, ...refusal };
    }
    // 2. Schema locks apply on EVERY write surface. MCP used to call setMemory directly, so a write
    //    that REST answered with 422 sailed through there.
    const validation = await validateMemoryWrite(input.key, input.value, storage);
    if (!validation.valid) {
        return {
            ok: false, status: 422, code: 'SCHEMA_VALIDATION_FAILED',
            message: 'Value does not match the schema for this key',
            details: {
                key: input.key,
                violations: validation.errors,
                schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
            },
        };
    }

    const existing = await storage.getMemory(caller.targetGaii, input.key);

    // Defence in depth: getMemory is already scoped by GAII, so this can only fire if the target
    // resolution ever hands back a namespace the caller does not own.
    if (existing && existing.ownerGaii !== caller.targetGaii) {
        return {
            ok: false, status: 403, code: 'ACCESS_DENIED',
            message: 'You can only modify your own memory records',
        };
    }

    // Archived is read-only, and it means it. An archived record, or one inside an archived
    // workspace or organism, refuses the write. The MCP tool never checked either, so archiving —
    // which is how an owner says "this is finished, stop changing it" — held on one surface only.
    if (existing?.archived) {
        return {
            ok: false, status: 409, code: 'ARCHIVED',
            message: 'This record is archived (read-only). Unarchive it before writing.',
        };
    }
    if (input.key.startsWith('organism.')) {
        const guard = await isKeyArchived(storage, input.key);
        if (guard.archived) {
            return {
                ok: false, status: 409, code: 'ARCHIVED',
                message: `This ${guard.level} is archived (read-only). Unarchive it before writing.`,
            };
        }
    }

    // The three memory ceilings — value size, key count, byte budget — from the one place that
    // holds them (services/memory-ceilings.ts). A single write is a set of one; the workspace batch
    // path passes its whole set to the same function, which is what stops fifty small records each
    // passing on their own while the batch lands over the byte line.
    const ceiling = await memoryCeilings({ storage, config }, caller.targetGaii, [{ key: input.key, value: input.value }]);
    if (!ceiling.ok) {
        return { ok: false, status: ceiling.refusal.status, code: ceiling.refusal.code, message: ceiling.refusal.message };
    }

    // Warn the owner at 80% and 95%, while reshaping is still cheap. Both numbers came back from the
    // check, so this costs no extra query, and it is fire-and-forget: a warning must never fail the
    // write it is warning about.
    void checkMemoryQuotaAlarm(config, storage, caller.targetGaii, ceiling.measured);

    // 3. The optimistic lock is compared against the record in the TARGET namespace, which is why it
    //    comes after the target is resolved and not before.
    if (input.expectedVersion !== undefined) {
        const current = existing?.version ?? 0;
        if (input.expectedVersion !== current) {
            return {
                ok: false, status: 409, code: 'VERSION_CONFLICT',
                message: `Key "${input.key}" is at version ${current}, and this write expected ${input.expectedVersion}. Read it again and retry.`,
                details: { key: input.key, currentVersion: current, expectedVersion: input.expectedVersion },
            };
        }
    }

    // 4. Is the owner already holding this key while this copy lands in an agent namespace? Silently
    //    succeeding here is how "I saved it" turns into "the app never showed it".
    let shadowedBy: string | null = null;
    if (!existing && !input.ownerScoped) {
        const parsed = parseGAII(caller.principal);
        if (parsed) {
            const ownerCopy = await storage.getMemory(`${parsed.owner}@${config.nodeId}`, input.key);
            if (ownerCopy) shadowedBy = ownerCopy.ownerGaii;
        }
    }

    // 5. Provenance names WHO WROTE it, not whose namespace it lands in.
    const aiProvenanceId = await provenanceForWrite(storage, {
        principal: caller.principal,
        content: memoryContentBytes(input.value),
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance,
        pipeline: input.pipeline,
        surface: { visibility: input.visibility, humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
    });

    const now = new Date().toISOString();
    const record = await storage.setMemory({
        key: input.key,
        ownerGaii: caller.targetGaii,
        value: input.value,
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
        visibility: input.visibility,
        ...(input.visibility === 'group' && input.groupId ? { groupId: input.groupId } : {}),
        ...(input.visibility === 'workspace' && input.workspaceRef !== undefined ? { workspaceRef: input.workspaceRef } : {}),
        tags: Array.isArray(input.tags) ? input.tags : [],
        ttlHours: input.ttlHours ?? null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });

    // 6. The live update. A write over MCP used to reach storage with nobody hearing about it, so an
    //    app watching its owner's memory saw the agent's work only after a reload. No ownerGaii
    //    argument, matching every REST path: an omitted owner is a global broadcast and the SSE
    //    layer's own scope check decides who is entitled to hear it.
    emitChange('memory');

    // 7. And everything else the write sets off. It is part of WRITING, not part of the door, so it
    //    runs here rather than in each caller's tail — which is where it used to live, on one door
    //    only. A caller that cannot offer an optional piece (a node with no peers has no replication
    //    queue; a tool call has no HTTP response) simply omits it, and the rest still happens.
    await afterMemoryWrite(deps, caller.targetGaii, input.key, !!existing);

    return { ok: true, record, shadowedBy };
}



/**
 * Everything a memory write sets off, for every door.
 *
 * WHY IT IS HERE. All of it lived in the tail of POST /v1/memory, so a write made through a tool
 * call reached storage and stopped there. The record was correct and the rest of the node did not
 * know: a Tracked Response watching the key never evaluated, an enabled automation recipe never
 * materialised its task, an event-triggered workflow never started, a connected ecosystem app was
 * never pushed the write, the EXCHANGE listing did not follow a reprice, an organism workspace
 * document did not appear on the screen it was written into, and a federated peer waited for the
 * next scheduled sync instead of getting the record now.
 *
 * Every one of those fires for a person's browser write and, until 2026-08-11, stayed silent for the
 * identical write by that person's own agent. The whole promise of the platform is that those two
 * are the same act.
 *
 * Best-effort and isolated throughout: none of it may fail a write that already happened.
 */
export async function afterMemoryWrite(
    deps: MemoryWriteFanout,
    gaii: string,
    key: string,
    existed: boolean,
): Promise<void> {
    const { storage, config } = deps;

    // Event-driven replication: the scheduled sync would pick the record up later, so a failure
    // here costs latency rather than the record.
    if (deps.peers) {
        enqueueMemoryReplication(gaii, key, config, storage, deps.peers as Map<string, never>).catch(err => {
            logger.warn('memory write: replication enqueue failed, leaving it to the scheduled sync', { key, error: String(err) });
        });
    }

    deps.emitResourceUpdated?.(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (!existed) deps.emitResourceListChanged?.(gaii);

    // The directory refreshes on the two profile keys it indexes.
    if (deps.onDirectoryChange && /^profile\.[^.]+\.(interests|location)$/.test(key)) deps.onDirectoryChange();

    deps.stats?.increment('memory_writes');

    // Memory Contracts: a write to a watched key fires Tracked Response evaluation. The subscriber
    // gates on the track registry, so a write nobody watches does no work.
    emitMemoryWritten(gaii, key, existed ? 'updated' : 'created');

    // An app-tool manifest / agent offers doc IS the source of truth for its EXCHANGE listing —
    // reprice a tool and the market follows, with no separate listing step.
    await reconcileAfterSourceWrite(storage, gaii, key);

    // Organism content lives under organism.{id}.*; the organism views listen on 'organisms' only,
    // rather than on the global 'memory' firehose of every agent's every write.
    if (key.startsWith('organism.')) emitChange('organisms');

    // A write to an owner key may start a workflow. The engine matches the owner-GHII namespace, so
    // an agent-namespace write does not fire owner-keyed triggers.
    getActiveWorkflowEngine()?.onMemoryWrite(gaii, key)
        .catch(e => logger.error('workflow event trigger (memory.write) failed', { key, error: String(e) }));

    // Push memory.write to any subscribed ecosystem app of this owner.
    emitEcosystemMemoryWrite(storage, config, gaii, key)
        .catch(e => logger.error('ecosystem outbound (memory.write) failed', { key, error: String(e) }));

    // When a connected app publishes on a key matching an enabled recipe's glob, materialise an
    // agent task for each configured agent.
    runAutomationRecipesForWrite(storage, config, gaii, key)
        .catch(e => logger.error('ecosystem automation recipe trigger failed', { key, error: String(e) }));

    // Activation: the third way an account first produces something durable is its AGENT writing
    // through the connection. Owner-session and onboarding-marker writes are excluded — the first is
    // the person's own hand, the second is the funnel measuring itself.
    if (deps.fromAgent && deps.ownerName && !key.startsWith('onboarding.')) {
        void import('./onboarding-funnel.js')
            .then(m => m.recordActivation(storage, config, deps.ownerName!, 'agent'))
            .catch(e => logger.warn('memory write: activation marker is best-effort', { error: String(e) }));
    }
}
