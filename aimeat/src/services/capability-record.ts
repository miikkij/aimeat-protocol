/**
 * @file src/services/capability-record.ts
 * @description Writing a capability, once, for whichever door is doing the writing.
 *
 *   WHY THIS FILE EXISTS. `POST/PUT/DELETE /v1/capabilities`, the vouch and invoke routes, and the
 *   `aimeat_capabilities_*` tools are the same operations, and each door had written them out for
 *   itself. Step 3 of the August 2026 audit moved the record SHAPE here: thirty fields, written
 *   twice, agreeing on twenty-nine, with nobody in a position to notice the thirtieth drifting.
 *   Step 8 moved the rest of the write, because the rest is where the differences were:
 *
 *     - The operator was exempt from the node's publishing policy on the HTTP door and nowhere
 *       else. `capabilityPublishing` defaults to 'disabled', so on an ordinary node the operator's
 *       own agent was refused a capability the operator could create by hand a minute later.
 *     - Publishing a PUBLIC capability on a MODERATED node waits for review at create, on both
 *       doors. At UPDATE only the tool applied it, so `PUT /v1/capabilities/:id { status:'active' }`
 *       walked straight past the review the tool respected.
 *     - An operator could act on another owner's capability over HTTP and not over MCP.
 *     - Every invocation through the HTTP door wrote a call-log entry, with the owner's redaction
 *       rules applied to the input. The same invocation through the tool surface wrote none, so the
 *       log a capability owner reads to see who called them had a hole exactly the shape of the
 *       agent traffic, which is most of it.
 *
 *   WHAT IS STILL PER-DOOR, deliberately. The caller's identity: an HTTP session resolves it with
 *   `resolveIdentity()`, a tool session builds it from the agent's GAII. Both arrive here as
 *   `CapabilityCaller.gaii` and this file compares whatever it is given, so the day that decision is
 *   settled it is settled in the doors rather than in the write.
 * @structure
 *   - CapabilityCaller / CapabilityResult — who is asking, and the refusal each door renders itself
 *   - moderatedStatus() / buildCapabilityRecord() — the status rule, and the thirty-field record
 *   - createCapability() / updateCapability() / deleteCapability() / vouchCapability()
 *   - recordCapabilityInvocation() — stats and the redacted call log, after an invoke
 * @usage
 *   const out = await createCapability({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own answer
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 *   v1.1.0 — 2026-08-11 — The whole write moves here (August 2026 audit step 8): create, update,
 *     delete, vouch and the post-invoke record, with the four differences above collapsed onto the
 *     HTTP door's behaviour, apart from the update-time moderation gate where the tool was right.
 *   v1.2.0 — 2026-08-14 — The webhook policy gate reads the NORMALISED source (audit NEW-1). It read
 *     the caller's own `source`, so a body with a webhookUrl and no `source` skipped WEBHOOKS_DISABLED
 *     and the domain allowlist and was stored as the manual webhook capability the gate would have
 *     refused. Both doors were affected: the gate lives here, and the tools reach the same function.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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

/** What a door hands the create path: the input above, plus the two fields it validates itself. */
export interface CapabilityCreateInput extends Omit<CapabilityInput, 'source'> {
    /** The caller's source descriptor, in whatever shape it arrived. Normalised below. */
    source?: unknown;
    /** 'draft' (the default) or 'active'. A public capability on a moderated node still waits. */
    status?: CapabilityRecord['status'];
}

export interface CapabilityDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** Who is asking. Each door resolves this from its own session and hands over the result. */
export interface CapabilityCaller {
    /** The identity a new capability is stored under, and the one ownership is compared against. */
    gaii: string;
    /** Exempt from the publishing policy, and allowed to act on another owner's capability. */
    isOperator: boolean;
}

export type CapabilityResult<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; code: string; message: string };

type CapabilityRefusal = Extract<CapabilityResult<never>, { ok: false }>;

function refuse(status: number, code: string, message: string): CapabilityRefusal {
    return { ok: false, status, code, message };
}

const CAPABILITY_SOURCE_TYPES: CapabilityRecord['source']['type'][] = ['extension', 'action', 'cortex', 'app', 'manual', 'ecosystem'];

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
 * Build the record. `status` is already decided by the caller, because the moderation rule needs to
 * know whether the caller is an operator and that is a per-door fact.
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

/**
 * `source` is required in full by CapabilityRecord (type + ref + version), and sourceRef is NOT NULL
 * on both backends. Defaulting only when source was ABSENT let a partial object — the natural
 * `{type:'manual'}` — reach the insert with ref undefined and crash it into a 500. Normalise per
 * field, and refuse the cases where a placeholder ref would produce an unresolvable record.
 *
 * This is also what the webhook policy gate reads, so the defaults here are a security decision as
 * well as a storage one: whatever type this returns is the type the record is built with, and the
 * gate must see the same one. Move the call after the gate and the gap it closed reopens.
 */
function normaliseSource(raw: unknown): CapabilityResult<CapabilityRecord['source']> {
    const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const type = (obj.type ?? 'manual') as CapabilityRecord['source']['type'];
    if (!CAPABILITY_SOURCE_TYPES.includes(type)) {
        return refuse(400, 'INVALID_INPUT', `source.type must be one of: ${CAPABILITY_SOURCE_TYPES.join(', ')}`);
    }
    const ref = typeof obj.ref === 'string' && obj.ref ? obj.ref : (type === 'manual' ? 'manual' : '');
    if (!ref) return refuse(400, 'INVALID_INPUT', `source.ref is required for source.type '${type}'`);
    const version = typeof obj.version === 'string' && obj.version ? obj.version : '1.0.0';
    return { ok: true, value: { type, ref, version } };
}

/** Register one capability. Policy first, then the shape, then the insert. */
export async function createCapability(
    deps: CapabilityDeps,
    caller: CapabilityCaller,
    input: CapabilityCreateInput,
): Promise<CapabilityResult<CapabilityRecord>> {
    const { storage, config } = deps;

    // Who may offer work to others is the operator's decision, not a per-surface accident. The
    // operator is exempt: this was the HTTP door's rule and nowhere else, which on a default node
    // ('disabled') meant the operator's own agent could not create what the operator could.
    if (!caller.isOperator) {
        if (config.capabilityPublishing === 'disabled') {
            return refuse(403, 'PUBLISHING_DISABLED', 'Only the operator can create capabilities on this node');
        }
        if (config.capabilityPublishing === 'self_only' && input.visibility === 'public') {
            return refuse(403, 'PUBLIC_DISABLED', 'Public capabilities require operator approval. Use visibility: private');
        }
    }

    // Normalise BEFORE the webhook gate, and gate on the normalised value. This ordering is the
    // fix, not a tidy-up: the gate used to read `input.source.type` while the record was built from
    // a source that defaults a missing type to 'manual', so a body carrying a webhookUrl and no
    // `source` at all skipped both WEBHOOKS_DISABLED and the domain allowlist and was then stored
    // as exactly the manual webhook capability the gate would have refused. The gate and the record
    // disagreed about what the request was, and on a node running 'disabled' or 'allowlist_only'
    // the operator's setting was one omitted field away from meaning nothing. Invariant 13 in
    // docs/coding-guidelines/security-development-dna.md. Nothing may be read from `input.source`
    // below this line.
    const source = normaliseSource(input.source);
    if (!source.ok) return source;

    // Webhook policy, on the source the record will actually carry.
    if (input.webhookUrl && source.value.type === 'manual') {
        if (config.capabilityWebhooks === 'disabled') {
            return refuse(403, 'WEBHOOKS_DISABLED', 'Webhook capabilities are disabled on this node');
        }
        if (config.capabilityWebhooks === 'allowlist_only') {
            let domain: string;
            try {
                domain = new URL(input.webhookUrl).hostname;
            } catch {
                return refuse(400, 'INVALID_WEBHOOK_URL', 'Invalid webhook URL');
            }
            if (!config.capabilityWebhookDomainAllowlist.includes(domain)) {
                return refuse(403, 'WEBHOOK_DOMAIN_NOT_ALLOWED', `Domain '${domain}' is not on the webhook allowlist`);
            }
        }
    }

    const schemaHash = createHash('sha256')
        .update(JSON.stringify(input.inputSchema ?? {}) + JSON.stringify(input.outputSchema ?? {}))
        .digest('hex').slice(0, 16);

    const now = new Date().toISOString();
    const record = buildCapabilityRecord(
        {
            ownerGhii: caller.gaii,
            schemaHash,
            now,
            // Default 'draft': nothing reaches the catalogue that the owner did not mean to put
            // there. The moderation rule can still override an 'active' request.
            status: moderatedStatus(config, input.visibility, caller.isOperator, input.status || 'draft'),
        },
        { ...input, source: source.value },
    );

    try {
        return { ok: true, value: await storage.createCapability(record) };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('UNIQUE') || message.includes('duplicate')) {
            return refuse(409, 'CAPABILITY_EXISTS', `Capability '${record.id}' already exists`);
        }
        throw err;
    }
}

/**
 * Apply one patch. WHICH fields a door accepts is the door's own declaration — an MCP tool publishes
 * a parameter list, an HTTP route takes a body — so the patch arrives already shaped. What happens
 * to it is the same either way.
 */
export async function updateCapability(
    deps: CapabilityDeps,
    caller: CapabilityCaller,
    id: string,
    patch: Record<string, unknown>,
): Promise<CapabilityResult<CapabilityRecord>> {
    const { storage, config } = deps;

    const cap = await storage.getCapability(id);
    if (!cap) return refuse(404, 'NOT_FOUND', 'Capability not found');
    if (cap.ownerGhii !== caller.gaii && !caller.isOperator) {
        return refuse(403, 'FORBIDDEN', 'Not the owner');
    }

    const updates: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() };
    // Identity and birth date belong to the record, never to the patch.
    delete updates.id;
    delete updates.ownerGhii;
    delete updates.createdAt;

    // Going ACTIVE with a public capability on a moderated node is the same decision as at create,
    // and it was enforced on the tool door only: the HTTP door published past the review. Only a
    // request to go active is redirected, so unpublishing or retiring never waits for anyone.
    if (updates.status === 'active') {
        updates.status = moderatedStatus(
            config,
            (updates.visibility as string | undefined) ?? cap.visibility,
            caller.isOperator,
            'active',
        );
    }

    const updated = await storage.updateCapability(id, updates as Partial<CapabilityRecord>);
    if (!updated) return refuse(404, 'NOT_FOUND', 'Capability not found');
    return { ok: true, value: updated };
}

/** Remove one capability. Only a manual one: the rest belong to whatever produced them. */
export async function deleteCapability(
    deps: CapabilityDeps,
    caller: CapabilityCaller,
    id: string,
): Promise<CapabilityResult<{ id: string }>> {
    const { storage } = deps;

    const cap = await storage.getCapability(id);
    if (!cap) return refuse(404, 'NOT_FOUND', 'Capability not found');
    if (cap.ownerGhii !== caller.gaii && !caller.isOperator) {
        return refuse(403, 'FORBIDDEN', 'Not the owner');
    }
    if (cap.source.type !== 'manual') {
        return refuse(400, 'CANNOT_DELETE', 'Only manual capabilities can be deleted. Auto-aggregated capabilities are removed when their source is removed.');
    }

    await storage.deleteCapability(id);
    return { ok: true, value: { id } };
}

/** Vouch for someone else's capability. Your own does not count, which is the whole point. */
export async function vouchCapability(
    deps: CapabilityDeps,
    caller: CapabilityCaller,
    id: string,
): Promise<CapabilityResult<{ vouchCount: number }>> {
    const { storage } = deps;

    const cap = await storage.getCapability(id);
    if (!cap) return refuse(404, 'NOT_FOUND', 'Capability not found');
    if (cap.ownerGhii === caller.gaii) {
        return refuse(400, 'CANNOT_VOUCH_OWN', 'Cannot vouch for your own capability');
    }

    await storage.incrementVouchCount(id);
    const updated = await storage.getCapability(id);
    return { ok: true, value: { vouchCount: updated?.trust.vouchCount ?? 0 } };
}

/**
 * Hide the fields the capability owner marked. `*` replaces the whole input with a hash, which still
 * proves two calls carried the same arguments without keeping either.
 */
function redactInput(input: Record<string, unknown>, redactedFields: string[]): Record<string, unknown> {
    if (!redactedFields.length) return input;
    if (redactedFields.includes('*')) return { _redacted: true, _hash: createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16) };
    const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    for (const field of redactedFields) {
        const parts = field.split('.');
        let obj: Record<string, unknown> | null = copy;
        for (let i = 0; i < parts.length - 1; i++) {
            if (obj && typeof obj === 'object' && parts[i] in obj) obj = obj[parts[i]] as Record<string, unknown> | null;
            else { obj = null; break; }
        }
        if (obj && typeof obj === 'object') {
            const last = parts[parts.length - 1];
            if (last in obj) obj[last] = '[REDACTED]';
        }
    }
    return copy;
}

/**
 * What an invocation leaves behind: the counters, and one line in the capability's call log. The
 * tool surface wrote the counters and no log at all, so the log the owner reads to see who has been
 * calling them was missing the agent traffic.
 *
 * A failed input is logged in full, because a redacted argument list cannot be debugged and the
 * owner is the only reader. A successful one is logged through the owner's redaction rules.
 *
 * Never throws: the call already happened and its answer is owed to the caller either way.
 */
export async function recordCapabilityInvocation(
    deps: { storage: Storage },
    cap: CapabilityRecord,
    callerGhii: string,
    input: Record<string, unknown>,
    outcome: { ok: true; durationMs: number } | { ok: false; message: string },
): Promise<void> {
    const { storage } = deps;

    try {
        await storage.incrementCapabilityStats(cap.id, outcome.ok
            ? { success: 1, error: 0, totalMs: outcome.durationMs }
            : { success: 0, error: 1, totalMs: 0, lastError: outcome.message });
    } catch (err) {
        logger.warn('capability stats not recorded', { capabilityId: cap.id, error: String(err) });
    }

    try {
        await storage.addCapabilityLog({
            id: randomUUID(),
            capabilityId: cap.id,
            callerGhii,
            input: outcome.ok ? redactInput(input, cap.redactedFields) : input,
            status: outcome.ok ? 'success' : 'error',
            durationMs: outcome.ok ? outcome.durationMs : 0,
            error: outcome.ok ? null : outcome.message,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        logger.warn('capability call log not written', { capabilityId: cap.id, error: String(err) });
    }
}
