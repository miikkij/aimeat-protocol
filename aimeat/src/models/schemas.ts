import { z } from 'zod';

// ── Personal Nodes ──────────────────────────────────────────

export const AnchorRequestSchema = z.object({
    node_id: z.string().min(3).max(80).regex(/^personal-[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    owner_name: z.string().min(3).max(64),
    public_key: z.string().min(10),
    agent_gaiis: z.array(z.string()).optional(),
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
    description: z.string().max(1024).optional(),
    capabilities: z.array(z.string()).optional(),
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
    visibility: z.enum(['private', 'owner', 'public']).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().max(8760).optional(), // max 1 year
});

export const MemoryUpdateSchema = z.object({
    value: z.unknown().optional(),
    visibility: z.enum(['private', 'owner', 'public']).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().max(8760).nullable().optional(),
    version: z.number().int().nonnegative(),
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
    description: z.string().min(1).max(4096),
    category: z.string().max(64).optional(),
    input_schema: z.record(z.string(), z.unknown()),
    output_schema: z.record(z.string(), z.unknown()),
    pricing: ActionPricingSchema,
    estimated_time_seconds: z.number().int().positive().optional(),
    max_input_size_bytes: z.number().int().positive().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    webhook_url: z.string().url().max(2048).optional(),
});

export const ActionUpdateSchema = z.object({
    display_name: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(4096).optional(),
    category: z.string().max(64).optional(),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    output_schema: z.record(z.string(), z.unknown()).optional(),
    pricing: ActionPricingSchema.optional(),
    estimated_time_seconds: z.number().int().positive().optional(),
    max_input_size_bytes: z.number().int().positive().optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
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
    comment: z.string().max(1024).optional(),
});

export const WorkRejectSchema = z.object({
    reason: z.string().max(1024).optional(),
});

// ── Disputes ────────────────────────────────────────────────

export const DisputeOpenSchema = z.object({
    reason: z.string().min(1).max(4096),
});

export const CounterDisputeSchema = z.object({
    reason: z.string().min(1).max(4096),
});

export const PartialOfferSchema = z.object({
    refund_morsels: z.number().int().positive(),
    message: z.string().max(1024).optional(),
});

export const OperatorRulingSchema = z.object({
    ruling: z.string().min(1),
    distribution: z.object({
        to_requester: z.number().int().nonnegative().optional(),
        to_provider: z.number().int().nonnegative().optional(),
        burned: z.number().int().nonnegative().optional(),
    }),
    reason: z.string().max(4096).optional(),
});

// ── Boards ──────────────────────────────────────────────────

export const BoardCreateSchema = z.object({
    name: z.string().min(1).max(128),
    visibility: z.enum(['private', 'shared', 'public']),
    description: z.string().max(1024).optional(),
    allowed_gaiis: z.array(z.string()).optional(),
});

export const BoardPostSchema = z.object({
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(10000),
    category: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    ttl_hours: z.number().positive().optional(),
});

export const BoardReactionSchema = z.object({
    reaction: z.string().min(1).max(32),
});

export const BoardReplySchema = z.object({
    body: z.string().min(1).max(10000),
});

// ── Federation ──────────────────────────────────────────────

export const PeeringRequestSchema = z.object({
    target_url: z.string().url(),
    target_node_id: z.string().optional(),
    public_key: z.string().optional(),
    message: z.string().max(1024).optional(),
});

export const PeeringDecisionSchema = z.object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(1024).optional(),
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
    reason: z.string().max(256).optional(),
});

// ── Storage ─────────────────────────────────────────────────

export const ChunkedUploadInitSchema = z.object({
    key: z.string().min(1).max(256),
    mime_type: z.string().min(1),
    chunk_size: z.number().int().positive(),
    visibility: z.enum(['private', 'owner', 'public']).optional(),
    total_chunks: z.number().int().positive().optional(),
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
