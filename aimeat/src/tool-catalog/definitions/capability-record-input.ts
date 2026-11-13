/**
 * @file capability-record-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The capability record fields that aimeat_capabilities_create and
 *   aimeat_capabilities_update both take, because POST /v1/capabilities and PUT /v1/capabilities/:id
 *   both take them on capability:write, the word both tools declare. The limits here only bound what
 *   the MCP schema accepts; createCapability and updateCapability (services/capability-record.ts)
 *   normalise each field and apply the source check and the webhook policy for every caller.
 * @structure CAPABILITY_RECORD_INPUT
 * @usage input: { ...ownFields, ...CAPABILITY_RECORD_INPUT }
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 3b).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';

const jsonObject = z.record(z.string(), z.unknown());

export const CAPABILITY_RECORD_INPUT = {
    source: { type: 'object', description: "Where the capability runs: { type, ref, version }. Leave it out for a manual capability you describe yourself. An extension ref names an extension and an action ('ext:<name>:<action>'); a kind only the node writes is refused (INVALID_INPUT).", zod: z.object({
        type: z.string().max(INPUT_LIMITS.name),
        ref: z.string().max(INPUT_LIMITS.key),
        version: z.string().max(INPUT_LIMITS.name).optional(),
    }) },
    authRequired: { type: 'string', enum: ['none', 'anonymous', 'registered'], description: 'Who the capability says may call it: anyone (none), an anonymous session (anonymous) or a registered account (registered, the default). Callers read it in the listing.' },
    exports: { type: 'array', description: 'The named functions the capability offers, each { name, description, inputSchema, outputSchema, example }.', zod: z.array(z.object({
        name: z.string().max(INPUT_LIMITS.name),
        description: z.string().max(INPUT_LIMITS.description),
        inputSchema: jsonObject,
        outputSchema: jsonObject,
        example: z.object({ input: jsonObject, output: jsonObject }).nullable().optional(),
    })).max(50) },
    examples: { type: 'array', description: 'Worked examples for callers, each { description, input, output }.', zod: z.array(z.object({
        description: z.string().max(INPUT_LIMITS.description),
        input: jsonObject,
        output: jsonObject,
    })).max(20) },
    dependencies: { type: 'array', description: 'What the capability needs to run, each { type: sdk | capability, id, required, minVersion }.', zod: z.array(z.object({
        type: z.enum(['sdk', 'capability']),
        id: z.string().max(INPUT_LIMITS.id),
        required: z.boolean(),
        minVersion: z.string().max(INPUT_LIMITS.name).nullable().optional(),
    })).max(50) },
    webhookUrl: { type: 'string', description: "The address the node calls when a manual capability is invoked. The node's webhook setting decides whether it is taken: refused when webhooks are off (WEBHOOKS_DISABLED), or when the address is not on the operator's list. An empty string or null clears it.", zod: z.string().max(INPUT_LIMITS.url).nullable() },
    trustRequired: { type: 'number', description: 'The trust score the capability asks of a caller. The node stores it and shows it in the listing; it does not check it at invoke.', zod: z.number().min(0).nullable() },
    redactedFields: { type: 'array', description: 'Input field names the node blanks out in the log of a successful invocation.', zod: z.array(z.string().max(INPUT_LIMITS.name)).max(100) },
} as const;
