/**
 * @file src/routes/validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Dry-run validation endpoint — POST /v1/validate checks an arbitrary request body
 *   against the Zod schema mapped to a given endpoint+method, letting clients pre-validate before
 *   committing a real call.
 *
 * @structure
 *   - SCHEMA_MAP: path → { method → Zod schema } registry of validatable endpoints
 *   - findValidationRule(method, endpoint): the rule for a concrete address, by route pattern
 *   - validateRouter(config): mounts POST /v1/validate returning validity/errors or a no-rules note
 *
 * @version-history
 *   2026-10-15 — A concrete address (/v1/memory/my-key) finds its rule by route pattern; an address
 *     with no rule answers `valid: null, checked: false` instead of `valid: true`; answers carry
 *     `checked` and the `matched` pattern (feature-list audit #187).
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
    '/v1/admin/roles/revoke': { POST: RoleGrantSchema },
};

/** One SCHEMA_MAP pattern as a matcher: a `:name` segment matches any one non-empty path segment. */
function patternMatches(pattern: string, path: string): boolean {
    const want = pattern.split('/');
    const got = path.split('/');
    return want.length === got.length && want.every((seg, i) => (seg.startsWith(':') ? got[i] !== '' : seg === got[i]));
}

/**
 * The rule for a concrete address such as `/v1/memory/my-key`, looked up by the route PATTERN it
 * matches (`/v1/memory/:key`), not by string equality, which found only the literal pattern text
 * (feature-list audit #187). The query string is not part of the address. A literal entry wins over
 * a pattern. Null when this node has no rule for that address and method.
 */
export function findValidationRule(method: string, endpoint: string): { pattern: string; schema: z.ZodType<unknown> } | null {
    const path = endpoint.split('?')[0]!.replace(/\/+$/, '') || '/';
    const verb = method.toUpperCase();
    const pattern = SCHEMA_MAP[path] ? path : Object.keys(SCHEMA_MAP).find(p => p.includes(':') && patternMatches(p, path));
    const schema = pattern ? SCHEMA_MAP[pattern]![verb] : undefined;
    return pattern && schema ? { pattern, schema } : null;
}

export function validateRouter(config: AimeatConfig): Router {
    const router = Router();

    // POST /v1/validate — validate a request body against Zod schemas
    router.post('/v1/validate', validateBody(ValidateRequestSchema, config.nodeId), (req, res) => {
        const { method, endpoint, body } = req.body ?? {};

        // No rule is not a pass. `valid: null` and `checked: false` say that nothing was checked; the
        // answer was `valid: true` for any content, which a client read as a pass (feature-list audit #187).
        const rule = findValidationRule(method, endpoint);
        if (!rule) {
            res.json(success(config.nodeId, {
                valid: null,
                checked: false,
                method,
                endpoint,
                note: 'This node has no validation rules for this address and method, so nothing was checked. '
                    + 'Send the request itself and read its answer instead.',
            }));
            return;
        }

        const result = rule.schema.safeParse(body ?? {});
        if (result.success) {
            res.json(success(config.nodeId, { valid: true, checked: true, method, endpoint, matched: rule.pattern }));
        } else {
            res.json(success(config.nodeId, {
                valid: false,
                checked: true,
                errors: result.error.issues.map(i => ({
                    path: i.path.join('.'),
                    message: i.message,
                })),
                method,
                endpoint,
                matched: rule.pattern,
            }));
        }
    });

    return router;
}
