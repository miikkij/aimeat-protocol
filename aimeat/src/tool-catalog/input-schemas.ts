/**
 * @file src/tool-catalog/input-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Zod schemas that more than one catalog field uses, or that a field's exact schema
 *   names (secaudit 2026-10, M3). Each one was a constant in the node MCP file that registered the
 *   tool, written there and nowhere else; the catalog is now where a field's exact schema lives, so
 *   they moved here unchanged, without the `.describe()` the catalog field now carries.
 * @structure flexibleBoolean · partsSchema · LinkSchema · itemShape · MAX_WAIT_SECONDS ·
 *   questionsSchema · boardRulesInput · wsGrantShape · tokenMap
 * @usage import { flexibleBoolean } from '../input-schemas.js';  owner_scope: { …, zod: flexibleBoolean }
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved from src/mcp/{schema-flags,agent-v2-messaging,agent-v2-tasks,contacts,
 *     commerce,agent-crew,decide,boards,organisms-name-invites,themes}.ts (secaudit 2026-10, M3).
 */
import { z } from 'zod';

/**
 * A boolean flag that also accepts the strings "true" and "false".
 *
 * Deliberately NOT `z.coerce.boolean()`: that maps the string "false" to TRUE, because a non-empty
 * string is truthy. For a flag whose job is to redirect a write into someone else's namespace, that
 * is the wrong direction to be lenient in.
 */
export const flexibleBoolean = z.union([z.boolean(), z.enum(['true', 'false'])])
    .transform(v => v === true || v === 'true');

/** An A2A parts array, as the v2 message and task tools declare it. The model layer behind the ops validates each part. */
export const partsSchema = z.array(z.record(z.string(), z.unknown()));

/** The link shape both MCP surfaces accept for a contact. */
export const LinkSchema = z.object({
    label: z.string().max(60).optional().describe('What to call this place.'),
    url: z.string().max(500).describe('http(s) address.'),
});

/** The items of a checkout session (src/commerce/session-service.ts). */
export const itemShape = z.array(z.object({
    kind: z.enum(['offer', 'app-tool', 'ext-call', 'package']).optional(),
    agent: z.string().max(300).optional(),
    offer_id: z.string().max(100).optional(),
    org: z.string().max(200).optional(),
    app: z.string().max(300).optional(),
    tool: z.string().max(100).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    quantity: z.number().int().positive().max(1000).optional(),
})).min(1).max(20);

/** The longest one aimeat_crew_try call waits for a trial before handing back a try_id to continue with. */
export const MAX_WAIT_SECONDS = 120;

/** aimeat_decide's questions: your ids to questions. */
export const questionsSchema = z.record(z.string(), z.object({
    type: z.enum(['noul', 'choice', 'score']),
    instructions: z.unknown(),
    criteria: z.unknown().optional(),
}));

/** The rule set an agent may send for a board. Strict, so a misspelled rule is refused instead of dropped. */
export const boardRulesInput = z.strictObject({
    posting: z.enum(['owner', 'members', 'anyone']).optional(),
    categories: z.array(z.string()).optional(),
    default_ttl_hours: z.number().optional(),
    post_cost: z.number().optional(),
});

/** Per-workspace grants applied when an invitee joins an organism. */
export const wsGrantShape = z.array(z.object({
    ws: z.string().describe('Workspace id'),
    role: z.enum(['viewer', 'contributor']).describe('viewer = read only; contributor = read + write'),
}));

/** A theme's token → colour map for one mode. */
export const tokenMap = z.record(z.string(), z.string());
