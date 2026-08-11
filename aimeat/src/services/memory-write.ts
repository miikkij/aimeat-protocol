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
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B: shared service, gate inside).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { validateMemoryWrite } from './schema-validator.js';
import { checkMemoryQuota, chargeOverage } from './quota.js';
import { checkMemoryQuotaAlarm } from './quota-alarm.js';
import { isKeyArchived } from './archive.js';
import { provenanceForWrite } from './ai-provenance.js';
import { memoryContentBytes, isAnonymousGaii } from '../routes/memory/shared.js';
import { emitChange } from './event-bus.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { parseGAII } from '../utils/gaii.js';

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
    deps: { storage: Storage; config: AimeatConfig },
    caller: MemoryWriteCaller,
    input: MemoryWriteInput,
): Promise<MemoryWriteResult> {
    const { storage, config } = deps;

    // 1. The gate, inside. REST had this in middleware and MCP had it in a lookup table, which is
    //    two places to forget it and the reason the audit could find surfaces that had neither.
    //    Owner and operator pass on the role, exactly as requireScope lets them.
    const privileged = caller.roles.includes('owner') || caller.roles.includes('operator');
    if (!privileged && !hasScope(caller.scopes, 'memory:write')) {
        return {
            ok: false, status: 403, code: 'SCOPE_DENIED',
            message: 'Writing memory needs the "memory:write" permission, which this session does not carry.',
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

    // The three memory ceilings. Every one of them lived in the HTTP route, so a write over MCP had
    // no size limit, no key limit and no byte budget — on a store whose whole shape argument is that
    // a value holds a record rather than a field.
    const maxValueBytes = config.memoryMaxValueSizeKb * 1024;
    const valueSize = Buffer.byteLength(JSON.stringify(input.value), 'utf8');
    if (valueSize > maxValueBytes) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED',
            message: `Value size ${valueSize} bytes exceeds limit of ${maxValueBytes} bytes`,
        };
    }

    // An UPDATE never grows the key count, so the count is only taken on a new key.
    let keyCount: number | undefined;
    if (!existing) {
        keyCount = await storage.countMemory([caller.targetGaii]);
        if (keyCount >= config.memoryMaxKeysPerAgent) {
            // The remedy named here matters: "delete unused keys" sends someone who hit the wall
            // through one-key-per-small-fact off to delete data instead of fixing the shape that
            // will refill the space next week.
            return {
                ok: false, status: 413, code: 'QUOTA_EXCEEDED',
                message: `Memory key limit reached (${config.memoryMaxKeysPerAgent}). One value may hold `
                    + `${config.memoryMaxValueSizeKb} kB, so fold a set of small keys into one record holding `
                    + 'an array or an object keyed by id, rather than deleting data.',
            };
        }
    }

    const existingSize = existing ? Buffer.byteLength(JSON.stringify(existing.value), 'utf8') : 0;
    const quotaCheck = await checkMemoryQuota(config, storage, caller.targetGaii, valueSize, existingSize);
    if (!quotaCheck.allowed) {
        return { ok: false, status: 413, code: 'QUOTA_EXCEEDED', message: quotaCheck.reason! };
    }

    // Overage is charged where the quota is measured. It was billed on the HTTP path only, so a
    // write over MCP consumed the space and nobody paid for it.
    if (quotaCheck.overageMorsels > 0) {
        await chargeOverage(storage, caller.targetGaii, quotaCheck.overageMorsels, 'memory_overage');
    }

    // Warn the owner at 80% and 95%, while reshaping is still cheap. Both numbers are already in
    // hand, so this costs no extra query, and it is fire-and-forget: a warning must never fail the
    // write it is warning about.
    void checkMemoryQuotaAlarm(config, storage, caller.targetGaii, {
        ...(keyCount !== undefined ? { keyCount: keyCount + 1 } : {}),
        usedBytes: quotaCheck.currentBytes - existingSize + valueSize,
    });

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

    return { ok: true, record, shadowedBy };
}
