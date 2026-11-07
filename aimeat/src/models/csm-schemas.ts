/**
 * @file src/models/csm-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shapes of the CSM request bodies (routes/csm.ts): validateBody bounds every
 *   field before the handler runs, and a form gets each field's error back. What the fields mean (the
 *   definition, the visibility words, the expected version) is checked once more by
 *   services/csm-service.ts, for the route and the MCP tool alike.
 * @structure CSM_TEXT_MAX · CsmWriteBodySchema · CsmVisibilityBodySchema · CsmDraftBodySchema
 * @usage router.put('/v1/csm/:name', ..., validateBody(CsmWriteBodySchema, config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM visibility, versions and the draft; Jouni, 2026-11-07).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

/** The longest CSM text a write takes: the 1 MB text parser's ceiling would allow more than any CSM needs. */
export const CSM_TEXT_MAX = 200_000;

const visibility = z.string().max(80);

/**
 * POST /v1/csm and PUT /v1/csm/{name}: YAML text (Content-Type text/yaml), or a JSON object carrying
 * `yaml` or `definition` and the settings, or the definition itself as the whole object. The object is
 * kept loose because a definition's own keys (csm, service, data_schema, …) are its fields.
 */
export const CsmWriteBodySchema = z.union([
    z.string().max(CSM_TEXT_MAX),
    z.object({
        yaml: z.string().max(CSM_TEXT_MAX).optional(),
        definition: z.record(z.string(), z.unknown()).optional(),
        visibility: visibility.optional(),
        federate: z.boolean().optional(),
        expected_version: z.union([z.number().int().min(1), z.string().max(12)]).optional(),
    }).passthrough(),
]);

/** PATCH /v1/csm/{name}. */
export const CsmVisibilityBodySchema = z.object({ visibility });

/** POST /v1/csm/draft. */
export const CsmDraftBodySchema = z.object({
    name: z.string().min(1).max(INPUT_LIMITS.name),
    sample: z.unknown(),
    service_type: z.string().max(80).optional(),
    description: z.string().max(500).optional(),
});
