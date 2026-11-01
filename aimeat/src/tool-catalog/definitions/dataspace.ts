/**
 * @file dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_dataspace: the owner's side of the Eclipse Dataspace
 *   Protocol provider (plan doc-mvwxcas3dom3, D8.3). One name with an `action`, as aimeat_party does.
 * @structure dataspaceTools · DATASPACE_ACTIONS
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const DATASPACE_ACTIONS = ['list', 'get', 'approve', 'decline', 'settings'] as const;

export const dataspaceTools = [
    {
        name: 'aimeat_dataspace',
        description: 'The person\'s data packages in data spaces (Eclipse Dataspace Protocol): who asked for which package, and what was agreed. '
            + 'A participant of a data space reads the catalogue of this server, asks for a package and, once the person agrees, pulls the data with a token that ends when the agreement ends. '
            + 'When the person asks "who wants my data" or "is anyone waiting", call action "list" with waiting true and tell them, for each, who asks (the participant) and for which package, in plain words. '
            + 'Approve only when the person says so: action "approve" { provider_pid }. Then tell them the sentence in `say`. Decline with action "decline" { provider_pid, reason? }; on an agreement that is already in force, decline ends it, and the next read is refused, though copies already taken stay with the participant. '
            + 'A package can agree on its own to offers within the published policy: action "settings" { package, auto_agree: true } (false or null puts it back to waiting, the default). A priced offer always waits, because the price is paid by invoice outside this server. '
            + 'Actions: "list" { state?, waiting? }; "get" { provider_pid } (with its transfers); "approve" { provider_pid }; "decline" { provider_pid, reason? }; "settings" (read) or { package, auto_agree } (set). '
            + 'Needs party:manage, which only the owner gives, on the agent\'s page.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Data spaces: requests and agreements', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        scope: 'party:manage',
        surfaces: ['agent', 'service'],
        input: {
            action: { type: 'string', required: true, enum: [...DATASPACE_ACTIONS], description: 'What to do. To see who waits for an answer, "list" with waiting true.' },
            provider_pid: { type: 'string', description: 'For get, approve and decline: the negotiation, as list answers it (urn:aimeat:dsp:cn:…).', zod: z.string().max(200) },
            state: { type: 'string', enum: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'AGREED', 'VERIFIED', 'FINALIZED', 'TERMINATED'], description: 'For list: only negotiations in this state.' },
            waiting: { type: 'boolean', description: 'For list: only the requests that wait for the person.' },
            reason: { type: 'string', description: 'For decline: why, in a sentence; the participant receives it.', zod: z.string().max(300) },
            package: { type: 'string', description: 'For settings: the data package, by name.', zod: z.string().max(64) },
            auto_agree: { type: 'boolean', description: 'For settings: true agrees at once on offers within the published policy; false waits for the person. Send null (with package) to go back to the default.', zod: z.boolean().nullable() },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
