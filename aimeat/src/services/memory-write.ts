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
import { provenanceForWrite } from './ai-provenance.js';
import { memoryContentBytes } from '../routes/memory/shared.js';
import { emitChange } from './event-bus.js';
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
        code: 'SCOPE_DENIED' | 'SCHEMA_VALIDATION_FAILED' | 'VERSION_CONFLICT';
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
