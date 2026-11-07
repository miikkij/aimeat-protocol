/**
 * @file src/models/receiver-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The body schemas of the receivers' management routes (routes/receivers.ts): the shape
 *   and the length of every field before the handler runs. The meaning of each field (exactly one
 *   target, the limits' ranges, the visibility words) is checked once more by
 *   services/receivers/contract.ts normalizeReceiverInput, which the MCP tools reach too, so a
 *   message here is about form and the service's message about sense. An unknown field is left out
 *   rather than refused, as the service reads only the names it knows. The program's own address
 *   (/v1/receive) takes any JSON by design and has no schema here.
 * @structure ReceiverCreateSchema · ReceiverUpdateSchema · ReceiverDecisionSchema · ReceiverRotateSchema ·
 *   ReceiverStopSchema · ReceiverOperatorDecisionSchema · EmptyReceiverBodySchema
 * @usage router.post('/v1/receivers', ..., validateBody(ReceiverCreateSchema, config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const name = z.string().max(40);
const target = z.object({
    key: z.string().max(INPUT_LIMITS.key).optional(),
    prefix: z.string().max(INPUT_LIMITS.key).optional(),
    max_keys: z.number().int().optional(),
    organism_id: z.string().max(INPUT_LIMITS.id).optional(),
    ws: z.string().max(INPUT_LIMITS.id).optional(),
    space: z.string().max(INPUT_LIMITS.name).optional(),
});
const limits = z.object({
    per_minute: z.number().int().optional(),
    per_day: z.number().int().optional(),
    max_bytes: z.number().int().optional(),
});
const verbs = z.array(z.enum(['write', 'merge', 'read', 'delete'])).max(4);

/** POST /v1/receivers and POST /v1/receivers/proposals. */
export const ReceiverCreateSchema = z.object({
    name,
    target,
    csm: z.string().max(INPUT_LIMITS.name).nullable().optional(),
    csm_version: z.number().int().optional(),
    verbs: verbs.optional(),
    limits: limits.optional(),
    visibility: z.string().max(INPUT_LIMITS.id).optional(),
    display_name: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    expires_days: z.number().int().optional(),
});

/** PATCH /v1/receivers/{name}: the name, the target and the CSM never change (the service says so). */
export const ReceiverUpdateSchema = z.object({
    verbs: verbs.optional(),
    limits: limits.optional(),
    visibility: z.string().max(INPUT_LIMITS.id).optional(),
    display_name: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    expires_days: z.number().int().optional(),
    csm_version: z.number().int().optional(),
    target_max_keys: z.number().int().optional(),
});

/** POST /v1/receivers/{name}/decide. */
export const ReceiverDecisionSchema = z.object({ decision: z.enum(['approve', 'refuse']) });

/** POST /v1/receivers/{name}/rotate. */
export const ReceiverRotateSchema = z.object({ overlap_minutes: z.number().int().optional() }).optional();

/** POST /v1/admin/receivers/{owner}/{name}/stop: the reason the owner reads. */
export const ReceiverStopSchema = z.object({ reason: z.string().max(500) });

/** POST /v1/admin/receivers/{owner}/{name}/decide. */
export const ReceiverOperatorDecisionSchema = z.object({
    decision: z.enum(['approve', 'refuse']),
    reason: z.string().max(500).optional(),
});

/** The routes that take no body: pause, resume, start. */
export const EmptyReceiverBodySchema = z.object({}).optional();
