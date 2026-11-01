/**
 * @file src/models/dataspace-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shapes of the Dataspace Protocol request bodies (plan doc-mvwxcas3dom3, D8):
 *   the DSP messages a consumer sends (routes/dsp/), bounded field by field and otherwise passed through,
 *   because a DSP message is JSON-LD and carries fields this node does not read (a TCK message has a
 *   random top-level @id, empty constraint lists, an assigner in a counter-offer); and the owner's and
 *   the operator's bodies (routes/dataspace.ts). The meaning of each DSP field is checked by
 *   services/dataspace/, which answers in the DSP error shapes.
 * @structure DspMessageSchema · DataspaceDeclineSchema · DataspaceSettingsSchema · DataspaceTckResultSchema
 * @usage const m = DspMessageSchema.safeParse(req.body); if (!m.success) dspInvalid(res, m.error);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const iri = z.string().max(INPUT_LIMITS.url);

/** One DSP message: the fields this node reads, bounded; every other field passes through. */
export const DspMessageSchema = z.object({
    '@context': z.union([z.string().max(INPUT_LIMITS.url), z.array(z.unknown()).max(20), z.record(z.string().max(INPUT_LIMITS.id), z.unknown())]).optional(),
    '@type': z.string().max(INPUT_LIMITS.id),
    consumerPid: iri.optional(),
    providerPid: iri.optional(),
    callbackAddress: iri.optional(),
    agreementId: iri.optional(),
    format: z.string().max(INPUT_LIMITS.id).optional(),
    eventType: z.string().max(INPUT_LIMITS.id).optional(),
    code: z.string().max(INPUT_LIMITS.id).optional(),
    reason: z.array(z.unknown()).max(50).optional(),
    filter: z.array(z.unknown()).max(50).optional(),
    offer: z.object({ '@id': iri.optional(), target: iri.optional() }).passthrough().optional(),
}).passthrough();

export const DataspaceDeclineSchema = z.object({ reason: z.string().max(INPUT_LIMITS.line).optional() }).optional();

export const DataspaceSettingsSchema = z.object({
    package: z.string().max(64),
    auto_agree: z.boolean().nullable(),
});

export const DataspaceTckResultSchema = z.object({
    tck: z.string().max(INPUT_LIMITS.name).optional(),
    note: z.string().max(INPUT_LIMITS.line).optional(),
    tests: z.array(z.object({
        id: z.string().max(40), result: z.enum(['pass', 'fail', 'skip']), reason: z.string().max(INPUT_LIMITS.line).optional(),
    })).max(500),
});
