/**
 * @file src/routes/validate.ts
 * @description Dry-run validation endpoint — POST /v1/validate checks an arbitrary request body
 *   against the Zod schema mapped to a given endpoint+method, letting clients pre-validate before
 *   committing a real call.
 *
 * @structure
 *   - SCHEMA_MAP: path → { method → Zod schema } registry of validatable endpoints
 *   - validateRouter(config): mounts POST /v1/validate returning validity/errors or a no-rules note
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import type { z } from 'zod';
import {
    OwnerRegistrationSchema, AgentRegistrationSchema, AuthTokenRequestSchema,
    MemoryWriteSchema, MemoryUpdateSchema,
    ActionPublishSchema, ActionUpdateSchema,
    WorkRequestSchema, WorkBatchSchema, WorkDeliverySchema, WorkRatingSchema,
    BoardCreateSchema, BoardPostSchema, BoardReactionSchema, BoardReplySchema,
    DisputeOpenSchema, CounterDisputeSchema, PartialOfferSchema, OperatorRulingSchema,
    PeeringRequestSchema, PeeringDecisionSchema,
    MorselRequestSchema, ChunkedUploadInitSchema, ConfigUpdateSchema, RoleGrantSchema,
    ValidateRequestSchema, validateBody,
} from '../models/schemas.js';

// Map path+method to Zod schema
const SCHEMA_MAP: Record<string, Record<string, z.ZodType<unknown>>> = {
    '/v1/owners': { POST: OwnerRegistrationSchema },
    '/v1/agents': { POST: AgentRegistrationSchema },
    '/v1/auth/token': { POST: AuthTokenRequestSchema },
    '/v1/memory': { POST: MemoryWriteSchema },
    '/v1/memory/:key': { PUT: MemoryUpdateSchema },
    '/v1/actions': { POST: ActionPublishSchema },
    '/v1/actions/:id': { PUT: ActionUpdateSchema },
    '/v1/work/request': { POST: WorkRequestSchema },
    '/v1/work/batch': { POST: WorkBatchSchema },
    '/v1/work/:tc/deliver': { POST: WorkDeliverySchema },
    '/v1/work/:tc/rate': { POST: WorkRatingSchema },
    '/v1/work/:tc/dispute': { POST: DisputeOpenSchema },
    '/v1/work/:tc/counter-dispute': { POST: CounterDisputeSchema },
    '/v1/work/:tc/offer-partial': { POST: PartialOfferSchema },
    '/v1/admin/disputes/:id/rule': { POST: OperatorRulingSchema },
    '/v1/boards': { POST: BoardCreateSchema },
    '/v1/boards/:boardId/posts': { POST: BoardPostSchema },
    '/v1/boards/:boardId/posts/:postId/react': { POST: BoardReactionSchema },
    '/v1/boards/:boardId/posts/:postId/replies': { POST: BoardReplySchema },
    '/v1/federation/peer/request': { POST: PeeringRequestSchema },
    '/v1/admin/peering/requests/:id': { PUT: PeeringDecisionSchema },
    '/v1/wallet/request': { POST: MorselRequestSchema },
    '/v1/storage/upload/init': { POST: ChunkedUploadInitSchema },
    '/v1/admin/config': { PUT: ConfigUpdateSchema },
    '/v1/admin/roles/grant': { POST: RoleGrantSchema },
};

export function validateRouter(config: AimeatConfig): Router {
    const router = Router();

    // POST /v1/validate — validate a request body against Zod schemas
    router.post('/v1/validate', validateBody(ValidateRequestSchema, config.nodeId), (req, res) => {
        const { method, endpoint, body } = req.body ?? {};

        const schemaForPath = SCHEMA_MAP[endpoint];
        if (!schemaForPath) {
            res.json(success(config.nodeId, {
                valid: true,
                note: `No schema validation rules defined for ${endpoint}. Request assumed valid.`,
            }));
            return;
        }

        const schema = schemaForPath[method.toUpperCase()];
        if (!schema) {
            res.json(success(config.nodeId, {
                valid: true,
                note: `No schema for ${method} ${endpoint}. Request assumed valid.`,
            }));
            return;
        }

        const result = schema.safeParse(body ?? {});
        if (result.success) {
            res.json(success(config.nodeId, { valid: true, method, endpoint }));
        } else {
            res.json(success(config.nodeId, {
                valid: false,
                errors: result.error.issues.map(i => ({
                    path: i.path.join('.'),
                    message: i.message,
                })),
                method,
                endpoint,
            }));
        }
    });

    return router;
}
