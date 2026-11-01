/**
 * @file party.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_party: outside parties (people and programs with no account
 *   on this node) and the named shares of data packages to them (plan doc-mvwxcas3dom3, D2, D3.4). One
 *   name with an `action`, as aimeat_dataproduct does, because the actions share one shape and every
 *   name has to stay in step on three surfaces.
 * @structure partyTools · PARTY_ACTIONS
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3.4).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const PARTY_ACTIONS = ['share', 'create', 'list', 'get', 'update', 'stop', 'resume', 'delete', 'key_create', 'key_delete', 'reads'] as const;

const NAME = z.string().max(40).regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

export const partyTools = [
    {
        name: 'aimeat_party',
        description: 'Share a data package with a person or a program that has no account here (an outside party), and manage those parties. '
            + 'When the person says something like "share the budget signals with Matti\'s Power BI for a month", call action "share" { name: "matti", package, purpose, days: 30 } once: it makes the party when it does not exist, gives it a key, grants the share and answers the connection file. Then tell the person the sentence in `say` (what the party gets, until when, that ending the share stops the next read, and that copies already taken cannot be called back), and hand them the connection file or its key for the party. Never put the key anywhere else. '
            + 'Actions: "share" { name, package, purpose, days? or expires?, kind?, display_name?, contact?, pinned_version?, allow_url_key?, terms_required?, new_key? }; "create" { name, kind?, display_name?, contact? } (answers the key, shown once); "list"; "get" { name } (its keys, shares and their reads); "update" { name, display_name?, contact?, kind? }; "stop" and "resume" { name } (a stopped party reads nothing; the operator may pass `owner` to stop any account\'s party for abuse); "delete" { name } (its keys, tokens and shares end at once); "key_create" { name } (a new key, shown once); "key_delete" { name, key_id }; "reads" { name } (what it read and what was refused). '
            + 'A party reads only the package shared with it: over OData (Excel, Power BI, Tableau: HTTP Basic with user <owner>/<name> and the key as the password), the CSV and row addresses, or a token from POST /v1/parties/token. A person party accepts the terms before the first read unless terms_required is false. End one share with aimeat_consent_revoke (its id is the share id). '
            + 'Needs party:manage, which only the owner gives, on the agent\'s page.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Outside parties and named shares', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        scope: 'party:manage',
        surfaces: ['agent', 'service'],
        input: {
            action: { type: 'string', required: true, enum: [...PARTY_ACTIONS], description: 'What to do. To share data with someone outside, "share".' },
            name: { type: 'string', description: 'The party: lowercase letters, digits and dashes, unique per owner (e.g. "matti" or "budget-powerbi"). Every action but list.', zod: NAME },
            package: { type: 'string', description: 'For share: the data package to share, by name.', zod: z.string().max(64) },
            purpose: { type: 'string', description: 'For share: what the party uses the data for, in one sentence. The party sees it with the terms.', zod: z.string().max(512) },
            days: { type: 'number', description: 'For share: how many days the share lasts (at most the node\'s limit, 365 by default).', zod: z.number().positive().max(3650) },
            expires: { type: 'string', description: 'For share: the end as an ISO 8601 time, in place of days.', zod: z.string().max(64) },
            kind: { type: 'string', enum: ['program', 'person', 'dataspace'], description: 'For create, share and update: a program (the default), a person, or a data space participant. A person accepts the terms before reading.' },
            display_name: { type: 'string', description: 'For create, share and update: the name the person recognises, e.g. "Matti Virtanen, Power BI".', zod: z.string().max(120) },
            contact: { type: 'string', description: 'For create, share and update: how to reach the party. For a person this is personal data you hold.', zod: z.string().max(320) },
            pinned_version: { type: 'string', description: 'For share: one version of the package (sha256:<hex>) instead of the newest.', zod: z.string().max(80) },
            allow_url_key: { type: 'boolean', description: 'For share: let the CSV address carry the key (for Google Sheets, which cannot send headers). Off by default.' },
            terms_required: { type: 'boolean', description: 'For share: the party accepts the terms before the first read. Default: true for a person, false for a program.' },
            new_key: { type: 'boolean', description: 'For share: make a new key for a party that already has one.' },
            key_id: { type: 'string', description: 'For key_delete: the key to delete.', zod: z.string().max(40) },
            owner: { type: 'string', description: 'For stop and resume by the operator of this node: the account whose party it is.', zod: z.string().max(120) },
            reason: { type: 'string', description: 'For stop by the operator: why, for the record.', zod: z.string().max(500) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
