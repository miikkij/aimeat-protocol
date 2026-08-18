/**
 * @file src/models/schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Central Zod request-body schemas for every AIMEAT API domain (identity, auth, memory,
 *   actions, work queue, disputes, boards, federation, admin, wallet, storage, schema-locking, consent,
 *   TOTP), plus the `validateBody()` Express middleware factory that enforces them and returns the
 *   standard error envelope on failure.
 *
 * @structure
 *   - Identity/Auth: OwnerRegistrationSchema, AgentRegistrationSchema, TokenRequestSchema, OtkGenerateSchema
 *   - Memory/Actions: MemoryWriteSchema, MemoryUpdateSchema, ActionPublishSchema, ActionPricingSchema
 *   - Work/Disputes: WorkRequestSchema, WorkBatchSchema, WorkDeliverySchema, DisputeOpenSchema
 *   - Boards/Federation/Admin: BoardCreateSchema, PeeringRequestSchema, ConfigUpdateSchema, RoleGrantSchema
 *   - validateBody(schema, nodeId): Express middleware wiring a schema to the request pipeline
 *
 * @version-history
 *   Password floor unsplit — 2026-08-12 — GhiiRegistrationSchema drops password.min(8). The rule was
 *     duplicated in validatePasswordStrength, and the schema copy answered first, so a short password
 *     came back VALIDATION_ERROR instead of the WEAK_PASSWORD the route documents and clients branch on.
 *   Text limits raised — 2026-07-30 — descriptions/reasons/messages to 10 000, bodies to 200 000.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { z } from 'zod';

// ── Semantic Ontology (Phase 0.7b) ─────────────────────────

export const SemanticAnnotationSchema = z.object({
    '@context': z.record(z.string(), z.string()).optional(),
    '@type': z.string().optional(),
}).passthrough();  // Allow ontology-specific fields (schema:category, qudt:unit, etc.)

// ── Personal Nodes ──────────────────────────────────────────

export const AnchorRequestSchema = z.object({
    node_id: z.string().min(3).max(80).regex(/^personal-[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    owner_name: z.string().min(3).max(64),
    public_key: z.string().min(10),
    agent_gaiis: z.array(z.string()).optional(),
    visibility: z.enum(['private', 'public']).optional(),
});

export const VisibilityUpdateSchema = z.object({
    visibility: z.enum(['private', 'public']),
});

// ── Identity ────────────────────────────────────────────────

export const OwnerRegistrationSchema = z.object({
    name: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
    public_key: z.string().min(1),
    display_name: z.string().max(128).optional(),
});

export const AgentRegistrationSchema = z.object({
    name: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
    owner: z.string().min(3).max(64),
    display_name: z.string().max(128).optional(),
    description: z.string().max(10_000).optional(),
    capabilities: z.array(z.string()).optional(),
    scopes: z.array(z.string().max(64)).max(50).optional(),
    mode: z.enum(['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation']).optional(),
});

// ── Auth ────────────────────────────────────────────────────

export const TokenRequestSchema = z.object({
    gaii: z.string().min(1),
    timestamp: z.string().min(1),
    signature: z.string().min(1),
});

export const OwnerTokenRequestSchema = z.object({
    owner: z.string().min(1),
    timestamp: z.string().min(1),
    signature: z.string().min(1),
});

export const AuthTokenRequestSchema = z.object({
    gaii: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    timestamp: z.string().min(1),
    signature: z.string().min(1),
});

export const OtkGenerateSchema = z.object({
    action: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    ttl_minutes: z.number().int().positive().max(1440).optional(),
});

// ── Memory ──────────────────────────────────────────────────

export const MemoryWriteSchema = z.object({
    key: z.string().min(1).max(256),
    value: z.unknown(),
    visibility: z.enum(['private', 'owner', 'group', 'members', 'public']).optional(),
    group_id: z.string().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().max(8760).optional(), // max 1 year
    // Owner-session only: target GAII to store this entry under one of the
    // owner's own agents (instead of the owner's GHII). Ignored for agents.
    agent: z.string().optional(),
    /**
     * Attach an ALREADY-MINTED AI provenance record to this write (TARGET-058) — typically the one
     * `/v1/ai/complete` returned in `meta.provenance`. This is the publish path: the record is
     * minted private at generation and becomes anonymously resolvable exactly while the item
     * carrying it is public. It must belong to the caller's own account, or the write is refused.
     */
    ai_provenance_id: z.string().max(100).optional(),
});

export const MemoryUpdateSchema = z.object({
    value: z.unknown().optional(),
    visibility: z.enum(['private', 'owner', 'group', 'members', 'public']).optional(),
    group_id: z.string().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().max(8760).nullable().optional(),
    version: z.number().int().nonnegative(),
    /** See MemoryWriteSchema.ai_provenance_id. Must belong to the caller's own account. */
    ai_provenance_id: z.string().max(100).optional(),
});

// ── Actions ─────────────────────────────────────────────────

export const ActionPricingSchema = z.object({
    base_morsels: z.number().int().nonnegative(),
    per_unit: z.object({
        unit: z.string(),
        morsels_per_1000: z.number(),
    }).optional(),
});

export const ActionPublishSchema = z.object({
    id: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]{0,126}[a-z0-9]$/),
    display_name: z.string().min(1).max(256),
    description: z.string().min(1).max(10_000),
    category: z.string().max(64).optional(),
    input_schema: z.record(z.string(), z.unknown()),
    output_schema: z.record(z.string(), z.unknown()),
    pricing: ActionPricingSchema,
    estimated_time_seconds: z.number().int().positive().optional(),
    max_input_size_bytes: z.number().int().positive().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    webhook_url: z.string().url().max(2048).optional(),
    semantic: SemanticAnnotationSchema.optional(),
});

export const ActionUpdateSchema = z.object({
    display_name: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(10_000).optional(),
    category: z.string().max(64).optional(),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    output_schema: z.record(z.string(), z.unknown()).optional(),
    pricing: ActionPricingSchema.optional(),
    estimated_time_seconds: z.number().int().positive().optional(),
    max_input_size_bytes: z.number().int().positive().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    semantic: SemanticAnnotationSchema.optional(),
});

// ── Work Queue ──────────────────────────────────────────────

export const WorkRequestSchema = z.object({
    action_id: z.string().min(1),
    provider_gaii: z.string().min(1),
    input: z.unknown(),
    callback_url: z.string().url().optional(),
    ttl_hours: z.number().positive().max(720).optional(), // max 30 days
    priority: z.enum(['low', 'normal', 'high']).optional(),
});

export const WorkBatchSchema = z.object({
    requests: z.array(WorkRequestSchema).min(1).max(10),
});

export const WorkDeliverySchema = z.object({
    output: z.unknown(),
    metadata: z.unknown().optional(),
});

export const WorkRatingSchema = z.object({
    rating: z.enum(['positive', 'negative']),
    comment: z.string().max(10_000).optional(),
});

export const WorkRejectSchema = z.object({
    reason: z.string().max(10_000).optional(),
});

// ── Disputes ────────────────────────────────────────────────

export const DisputeOpenSchema = z.object({
    reason: z.string().min(1).max(10_000),
});

export const CounterDisputeSchema = z.object({
    reason: z.string().min(1).max(10_000),
});

export const PartialOfferSchema = z.object({
    refund_morsels: z.number().int().positive(),
    message: z.string().max(10_000).optional(),
});

export const OperatorRulingSchema = z.object({
    ruling: z.string().min(1),
    distribution: z.object({
        to_requester: z.number().int().nonnegative().optional(),
        to_provider: z.number().int().nonnegative().optional(),
        burned: z.number().int().nonnegative().optional(),
    }),
    reason: z.string().max(10_000).optional(),
});

// ── Boards ──────────────────────────────────────────────────

export const BoardCreateSchema = z.object({
    name: z.string().min(1).max(128),
    visibility: z.enum(['private', 'shared', 'public', 'system']),
    description: z.string().max(10_000).optional(),
    allowed_gaiis: z.array(z.string()).optional(),
});

export const BoardPostSchema = z.object({
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(200_000),
    category: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().optional(),
});

export const BoardReactionSchema = z.object({
    reaction: z.string().min(1).max(32),
});

export const BoardReplySchema = z.object({
    body: z.string().min(1).max(200_000),
});

// ── Federation ──────────────────────────────────────────────

export const PeeringRequestSchema = z.object({
    target_url: z.string().url(),
    target_node_id: z.string().optional(),
    public_key: z.string().optional(),
    message: z.string().max(10_000).optional(),
});

export const PeeringDecisionSchema = z.object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(10_000).optional(),
});

export const HeartbeatSchema = z.object({
    node_id: z.string().min(1),
    timestamp: z.string().min(1),
    signature: z.string().min(1),
});

// ── Admin ───────────────────────────────────────────────────

export const ConfigUpdateSchema = z.object({
    welcomeBonus: z.number().int().nonnegative().optional(),
    dailyAllowance: z.number().int().nonnegative().optional(),
    dailyAllowanceCap: z.number().int().nonnegative().optional(),
    burnRate: z.number().min(0).max(1).optional(),
    jwtTtlSeconds: z.number().int().positive().optional(),
    keyedBrowseEnabled: z.boolean().optional(),
    rateLimits: z.record(z.string(), z.unknown()).optional(),
});

export const RoleGrantSchema = z.object({
    owner: z.string().min(1),
    role: z.enum(['operator']),
});

// ── Wallet ──────────────────────────────────────────────────

export const MorselRequestSchema = z.object({
    amount: z.number().int().positive().max(1000),
    reason: z.string().max(10_000).optional(),
});

// ── Storage ─────────────────────────────────────────────────

export const ChunkedUploadInitSchema = z.object({
    key: z.string().min(1).max(256),
    mime_type: z.string().min(1),
    chunk_size: z.number().int().positive(),
    visibility: z.enum(['private', 'owner', 'group', 'public']).optional(),
    total_chunks: z.number().int().positive().optional(),
});

// ── Schema Locking (Phase 0.1) ──────────────────────────────

export const SchemaSetSchema = z.object({
    schema: z.record(z.string(), z.unknown()),
    apply_to: z.enum(['exact', 'prefix']),
    schema_mode: z.enum(['open', 'strict']).optional().default('open'),
});

export const SchemaListQuerySchema = z.object({
    prefix: z.string().optional(),
});

// ── Consent Layer (Phase 0.3) ────────────────────────────────

export const ConsentCreateSchema = z.object({
    data_pattern: z.string().min(1).max(256),
    recipient: z.string().min(1).max(256),
    purpose: z.string().min(1).max(512),
    scope: z.enum(['private', 'dmz', 'federation', 'auth']).optional().default('federation'),
    expires: z.string().datetime().nullable().optional().default(null),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConsentAuditQuerySchema = z.object({
    days: z.coerce.number().int().positive().max(365).optional().default(30),
    accessor_gaii: z.string().optional(),
    consent_id: z.string().optional(),
});

// ── TOTP / 2FA (Phase 0.5) ──────────────────────────────────

export const TotpVerifySchema = z.object({
    code: z.string().min(6).max(8),
});

export const TotpDisableSchema = z.object({
    code: z.string().min(6).max(8).optional(),
    backup_code: z.string().min(6).max(16).optional(),
}).refine(data => data.code || data.backup_code, {
    message: 'Either code or backup_code is required',
});

// ── Validate ────────────────────────────────────────────────

export const ValidateRequestSchema = z.object({
    endpoint: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    body: z.record(z.string(), z.unknown()).optional(),
});

// ── Helper: validation middleware ────────────────────────────

import type { Request, Response, NextFunction } from 'express';

export function validateBody<T>(schema: z.ZodType<T>, nodeId: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const { error: zodError } = result;
            res.status(400).json({
                ok: false,
                protocol: 'aimeat',
                version: 'v1',
                node: nodeId,
                timestamp: new Date().toISOString(),
                request_id: `req-${Date.now().toString(36)}`,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request body validation failed',
                    details: zodError.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message,
                    })),
                },
                hints: {
                    next_actions: [
                        { description: 'View API documentation', method: 'GET', url: '/v1/docs' },
                    ],
                    help_url: '/v1/docs',
                },
            });
            return;
        }
        (req as Request & { validated: T }).validated = result.data;
        next();
    };
}

// ── GHII Registration & Login (security audit -- public endpoints) ──

export const GhiiRegistrationSchema = z.object({
    username: z.string().min(1).max(64),
    display_name: z.string().max(128).optional(),
    bio: z.string().max(10_000).optional(),
    avatar: z.string().max(128).optional(),
    locale: z.string().max(10).optional(),
    // No min() here on purpose, and the 8-character floor it used to carry still holds: every
    // strength rule for a NEW password lives in validatePasswordStrength (utils/password-validation.ts),
    // which the POST /v1/ghii handler calls and which answers WEAK_PASSWORD plus the sentence naming
    // what to fix. A min(8) at this layer refused a short password one step earlier as
    // VALIDATION_ERROR with the message "Request body validation failed": the same 400, but the
    // caller lost both the code it branches on and any way to tell the user what was wrong. Length
    // was the only one of the five strength rules split across two layers, so it was the only one
    // that answered with the wrong code.
    // The floor exists because the sign-in modal once advertised "min 4 chars", and a 4-character
    // password on an account that owns data and can spend is not a defensible default. Existing
    // accounts are unaffected either way: this gates registration, and login still accepts whatever
    // an account already has. max(256) stays here: it bounds the string before scrypt hashes it,
    // which no strength rule does.
    password: z.string().max(256).optional(),
    // Optional at the schema level; REQUIRED at runtime when the node runs with the email gate on
    // (AIMEAT_EMAIL_CONFIRMATION_REQUIRED). When present it is recorded + a verification code is sent.
    email: z.string().email().max(256).optional(),
});

export const GhiiWebRegistrationSchema = z.object({
    username: z.string().min(3).max(64),
    display_name: z.string().max(128).optional(),
    email: z.string().email().max(256).optional(),
    locale: z.string().max(10).optional(),
    city: z.string().max(128).optional(),
    area: z.string().max(128).optional(),
    interests: z.array(z.string().max(64)).max(50).optional(),
});

export const GhiiLoginSchema = z.object({
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(256),
    totp_code: z.string().max(10).optional(),
    backup_code: z.string().max(32).optional(),
    // Set by clients that hold no owner signing key locally (a brand-new device),
    // asking the server to mint a fresh owner keypair. Omitted/false reuses the
    // existing key so other devices' signing keys stay valid. See ghii.ts login.
    request_owner_key: z.boolean().optional(),
});

// ── Flags (security audit -- authenticated endpoints) ──

export const FlagCreateSchema = z.object({
    // `app` and `ai_provenance` added for the AI Act correction procedure (TARGET-058 Phase 8):
    // Section 2, Commitment 2 of the Code of Practice requires a way for a person to report content
    // that should carry an AI label and does not. That path is THIS queue — the one operators and
    // organism admins already review — rather than a fourth inbox nobody would watch. `app` names a
    // published app as `owner/filename`; `ai_provenance` names a record id from a label's own
    // "details" link, which is the identifier a reader actually has in front of them.
    targetType: z.enum(['memory', 'board_post', 'action', 'agent', 'app', 'ai_provenance']),
    targetId: z.string().min(1).max(256),
    reason: z.enum(['unreliable', 'inappropriate', 'illegal', 'spam', 'other', 'undisclosed_ai']),
    description: z.string().max(10_000).optional(),
});

// ── Extensions Install (security audit -- authenticated endpoints) ──

export const ExtensionInstallSchema = z.object({
    // Presigned mode carries no manifest: the ZIP does. `mode:'presigned'` returns an upload_url
    // and the install happens on PUT /v1/upload/:token (mirrors POST /v1/apps).
    mode: z.literal('presigned').optional(),
    manifest: z.string().min(1).max(100_000).optional(),
    scripts: z.record(z.string(), z.string().max(512_000)).optional(),
    /** Presigned only: upsert an existing extension instead of 409 (carried in the token meta). */
    update: z.boolean().optional(),
    /** Presigned only: activate immediately after install/update. */
    activate: z.boolean().optional(),
}).refine(v => v.mode === 'presigned' || (typeof v.manifest === 'string' && v.manifest.length > 0), {
    message: 'manifest is required unless mode is "presigned"', path: ['manifest'],
});
