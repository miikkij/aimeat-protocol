/**
 * @file src/models/party-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shapes of the outside-party request bodies (routes/parties.ts; plan
 *   doc-mvwxcas3dom3, D2, D3): validateBody bounds every field before the handler runs, and a form
 *   gets each field's error back. The meaning of each field is checked once more by
 *   services/parties/ (a name's pattern and the reserved words, a package that exists, a version, the
 *   expiry cap). A body the endpoint does not read (a stop, a key, a rotation) is an empty object.
 * @structure PartyCreateSchema · PartyUpdateSchema · PartyShareSchema · PartyTokenSchema ·
 *   PartyStopSchema · EmptyPartyBodySchema
 * @usage router.post('/v1/parties', ..., validateBody(PartyCreateSchema, config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const partyName = z.string().max(40);
const kind = z.enum(['program', 'person', 'dataspace']);
const displayName = z.string().max(120);
const contact = z.string().max(320);

export const PartyCreateSchema = z.object({
    name: partyName, kind: kind.optional(), display_name: displayName.optional(), contact: contact.optional(),
    with_key: z.boolean().optional(),
});

export const PartyUpdateSchema = z.object({
    kind: kind.optional(), display_name: displayName.optional(), contact: contact.nullable().optional(),
});

export const PartyShareSchema = z.object({
    name: partyName, package: z.string().max(64), purpose: z.string().max(512),
    days: z.number().positive().max(3650).optional(), expires: z.string().max(64).optional(),
    kind: kind.optional(), display_name: displayName.optional(), contact: contact.optional(),
    pinned_version: z.string().max(80).optional(), allow_url_key: z.boolean().optional(),
    terms_required: z.boolean().optional(), new_key: z.boolean().optional(),
});

/** OAuth 2.0 client credentials, as a form or JSON; the pair may come as HTTP Basic instead. */
export const PartyTokenSchema = z.object({
    grant_type: z.string().max(64).optional(),
    client_id: z.string().max(INPUT_LIMITS.id).optional(),
    client_secret: z.string().max(INPUT_LIMITS.id).optional(),
    scope: z.string().max(INPUT_LIMITS.line).optional(),
});

export const PartyStopSchema = z.object({ reason: z.string().max(500).optional() });

/** A body the endpoint does not read: absent or an empty object. */
export const EmptyPartyBodySchema = z.object({}).optional();
