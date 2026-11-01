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
 *   v1.2.0 — 2026-11-01 — "share" takes `email` and `locale`, "send_link" sends a share's one-time link
 *     again; aimeat_admin_app_party_registrations, the operator's list and decision of app signup
 *     requests (plan D4.3; WP9b).
 *   v1.1.0 — 2026-11-01 — "share" takes `recipient`, a person on another AIMEAT node (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3.4).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const PARTY_ACTIONS = ['share', 'send_link', 'create', 'list', 'get', 'update', 'stop', 'resume', 'delete', 'key_create', 'key_delete', 'reads'] as const;

const NAME = z.string().max(40).regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

export const partyTools = [
    {
        name: 'aimeat_party',
        description: 'Share a data package with a person or a program that has no account here (an outside party), and manage those parties. '
            + 'When the person says something like "share the budget signals with Matti\'s Power BI for a month", call action "share" { name: "matti", package, purpose, days: 30 } once: it makes the party when it does not exist, gives it a key, grants the share and answers the connection file. Then tell the person the sentence in `say` (what the party gets, until when, that ending the share stops the next read, and that copies already taken cannot be called back), and hand them the connection file or its key for the party. Never put the key anywhere else. '
            + 'When the person to share with has an AIMEAT account on another node ("share it with bob@their-node"), call "share" { recipient: "bob@their-node", package, purpose, days? } instead of name: no party and no key; they sign in here with their own account and read it, and `sign_in` says whether this node takes sign-ins from their node now. '
            + 'When the person gives the party\'s e-mail ("send Matti the link"), pass `email` with "share": the node mails a one-time link, and Matti opens it with no account, accepts the terms and takes a key made then (the key in this answer stops working when he does). `link.sent` false means this node sends no mail: give the person `link.link` to pass on. "send_link" { name, share?, email? } sends a new link for a share (the old unused one stops working). '
            + 'Actions: "share" { name or recipient, package, purpose, days? or expires?, kind?, display_name?, contact?, pinned_version?, allow_url_key?, terms_required?, new_key?, email?, locale? }; "send_link" { name, share?, email?, locale? }; "create" { name, kind?, display_name?, contact? } (answers the key, shown once); "list"; "get" { name } (its keys, shares and their reads); "update" { name, display_name?, contact?, kind? }; "stop" and "resume" { name } (a stopped party reads nothing; the operator may pass `owner` to stop any account\'s party for abuse); "delete" { name } (its keys, tokens and shares end at once); "key_create" { name } (a new key, shown once); "key_delete" { name, key_id }; "reads" { name } (what it read and what was refused). '
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
            recipient: { type: 'string', description: 'For share, in place of name: a person\'s account on another AIMEAT node, name@their-node. They read signed in as a visitor; an account of this node is refused.', zod: z.string().max(200) },
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
            email: { type: 'string', description: 'For share and send_link: the e-mail address the one-time link goes to. For send_link, the party\'s contact when absent.', zod: z.string().max(320) },
            locale: { type: 'string', enum: ['en', 'fi', 'es'], description: 'For share and send_link: the language of the mail. Default "en".' },
            share: { type: 'string', description: 'For send_link: the share (its id) the link opens. Default: the party\'s newest live share.', zod: z.string().max(120) },
            key_id: { type: 'string', description: 'For key_delete: the key to delete.', zod: z.string().max(40) },
            owner: { type: 'string', description: 'For stop and resume by the operator of this node: the account whose party it is.', zod: z.string().max(120) },
            reason: { type: 'string', description: 'For stop by the operator: why, for the record.', zod: z.string().max(500) },
        },
    },
    {
        name: 'aimeat_admin_app_party_registrations',
        description: 'Operator-only. The apps whose owners asked to let people register to them without an account on this node (AIMEAT_PARTY_SELF_REGISTRATION=apps-ask), and the operator\'s decision on one. '
            + 'Action "list" (the default) answers the setting, whether registration is in effect, and each app with its owner, state (requested, open, refused) and how many parties registered. '
            + 'Action "decide" { owner, app, decision: "approve" or "refuse", reason? } opens the app\'s signup or refuses it; refusing an open app closes it. NOT_REQUESTED when the app has not asked. '
            + 'Same as GET /v1/admin/app-party-registrations and POST /v1/admin/app-party-registrations/{owner}/{filename}.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: App Signup Requests', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            action: { type: 'string', enum: ['list', 'decide'], description: '"list" (the default) or "decide".' },
            owner: { type: 'string', description: 'For decide: the account whose app it is.', zod: z.string().max(120) },
            app: { type: 'string', description: 'For decide: the app\'s filename, e.g. "club.html".', zod: z.string().max(200) },
            decision: { type: 'string', enum: ['approve', 'refuse'], description: 'For decide: "approve" or "refuse".' },
            reason: { type: 'string', description: 'For decide: why, which the owner reads.', zod: z.string().max(500) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
