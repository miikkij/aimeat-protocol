/**
 * @file src/services/capability-record.ts
 * @description Building one CapabilityRecord, for whichever door is registering it.
 *
 *   Thirty fields, written out twice — once in routes/capabilities.ts and once in
 *   mcp/capabilities.ts. They agreed on twenty-nine of them. Nobody would notice the thirtieth
 *   drifting, which is the whole problem with a thirty-field literal existing twice.
 *
 *   STATUS IS AN ARGUMENT, deliberately. The two doors genuinely differ there today: the web door
 *   parks a new capability as a draft the owner reviews, and the tool surface publishes it live. That
 *   is a product decision rather than a copied line, it is recorded in the drift map as one, and it
 *   is not this function's to make. Everything around it is shared, so when the decision is taken it
 *   changes in one place.
 * @structure
 *   - CapabilityInput — what a caller supplies
 *   - buildCapabilityRecord() — the record, moderation rule applied
 *   - moderatedStatus() — the one status rule both doors DO share
 * @usage
 *   const record = buildCapabilityRecord(config, { ownerGhii, schemaHash, status }, input);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { CapabilityRecord } from '../storage/interface.js';

/** The fields a caller may set. Everything absent takes the shape's own default. */
export interface CapabilityInput {
    id?: string;
    name?: string;
    summary?: string;
    visibility?: CapabilityRecord['visibility'];
    authRequired?: CapabilityRecord['authRequired'];
    callable?: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
    exports?: unknown;
    usage?: string;
    whenToUse?: string;
    whenNotToUse?: string;
    examples?: unknown[];
    dependencies?: unknown[];
    webhookUrl?: string | null;
    cost?: unknown;
    trustRequired?: unknown;
    redactedFields?: string[];
    tags?: string[];
    source?: CapabilityRecord['source'];
}

/**
 * A PUBLIC capability on a moderated node waits for review, whoever registered it and whichever door
 * they came through. An operator is exempt — moderating your own node is not a queue you join.
 */
export function moderatedStatus(
    config: AimeatConfig,
    visibility: string | undefined,
    isOperator: boolean,
    requested: CapabilityRecord['status'],
): CapabilityRecord['status'] {
    if (!isOperator && config.capabilityPublishing === 'moderated' && visibility === 'public') return 'pending_review';
    return requested;
}

/**
 * Build the record. `status` is already decided by the caller — see the file header for why that one
 * field is an argument and the other twenty-nine are not.
 */
export function buildCapabilityRecord(
    ctx: { ownerGhii: string; schemaHash: string; status: CapabilityRecord['status']; now: string },
    input: CapabilityInput,
): CapabilityRecord {
    return {
        id: input.id || randomUUID(),
        name: input.name || '',
        summary: input.summary || '',
        ownerGhii: ctx.ownerGhii,
        visibility: input.visibility || 'private',
        scope: 'local',
        status: ctx.status,
        rejectionReason: null,
        deprecationMessage: null,
        replacedBy: null,
        source: input.source ?? { type: 'manual', ref: 'manual', version: '1.0.0' },
        authRequired: input.authRequired || 'registered',
        callable: input.callable ?? false,
        inputSchema: (input.inputSchema ?? null) as CapabilityRecord['inputSchema'],
        outputSchema: (input.outputSchema ?? null) as CapabilityRecord['outputSchema'],
        exports: (input.exports ?? null) as CapabilityRecord['exports'],
        usage: input.usage || '',
        whenToUse: input.whenToUse || '',
        whenNotToUse: input.whenNotToUse || '',
        examples: (input.examples || []) as CapabilityRecord['examples'],
        dependencies: (input.dependencies || []) as CapabilityRecord['dependencies'],
        schemaHash: ctx.schemaHash,
        webhookUrl: input.webhookUrl ?? null,
        cost: (input.cost ?? null) as CapabilityRecord['cost'],
        trustRequired: (input.trustRequired ?? null) as CapabilityRecord['trustRequired'],
        trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
        redactedFields: input.redactedFields || [],
        operatorOverride: null,
        stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
        tags: input.tags || [],
        createdAt: ctx.now,
        updatedAt: ctx.now,
    };
}
