/**
 * @file src/tool-catalog/definitions/receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_receiver and aimeat_admin_receivers: incoming webhooks, the
 *   address and API key an outside program writes into one place of the owner's data with
 *   (services/receivers/). One name with an `action`, as aimeat_party and aimeat_app_manage are, because
 *   the developer ruled on 2026-09-27 that a new capability is one tool with an action parameter.
 *
 *   ONE TABLE. RECEIVER_ACTIONS is the only place an action's fields, required fields, permission word
 *   and summary are written. The catalog input, the description's action list, the per-action
 *   permission (catalog/action-scopes.ts) and checkReceiverInput(), which the node MCP and the CLI
 *   dispatch call before anything else, are derived from it.
 * @structure RECEIVER_ACTIONS · RECEIVER_ACTION_NAMES · checkReceiverInput · receiverTools ·
 *   ADMIN_RECEIVER_ACTIONS
 * @usage const checked = checkReceiverInput(input); if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
 * @version-history
 *   v1.1.0 — 2026-11-08 — The descriptions say incoming webhook and API key; the tool names, actions,
 *     fields and scopes stay as they are (secaudit2026nov08b round 15b).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const READ = 'receivers:read';
const MANAGE = 'receivers:manage';

interface ReceiverAction { fields: Record<string, boolean>; scope: string; summary: string }

/** action → { fields (true = required), permission word, what it does }. */
export const RECEIVER_ACTIONS: Record<string, ReceiverAction> = {
    list: { fields: {}, scope: READ, summary: 'every incoming webhook of the owner: its address, what it writes, its state, the last delivery and today\'s counts' },
    get: { fields: { name: true }, scope: READ, summary: 'one incoming webhook and its 20 newest deliveries' },
    deliveries: { fields: { name: true, only_refused: false }, scope: READ, summary: 'the 200 newest deliveries: when, the result and the reason of a refusal; never the content' },
    propose: {
        fields: { name: true, target: true, csm: false, csm_version: false, verbs: false, limits: false, visibility: false, display_name: false, description: false, expires_days: false },
        scope: READ,
        summary: 'store an incoming webhook WITHOUT an API key, waiting for the owner; the answer carries approve_url for the person, and the API key is shown to the owner when they approve, never to you',
    },
    create: {
        fields: { name: true, target: true, csm: false, csm_version: false, verbs: false, limits: false, visibility: false, display_name: false, description: false, expires_days: false },
        scope: MANAGE,
        summary: 'make it now; the answer carries the API key as `key` ONCE: put it straight into the program\'s secret store and nowhere else',
    },
    update: {
        fields: { name: true, verbs: false, limits: false, visibility: false, display_name: false, description: false, expires_days: false, csm_version: false, target_max_keys: false },
        scope: MANAGE,
        summary: 'change limits, verbs, the end date (expires_days from now), names, the visibility of what it writes, or move to another version of the same CSM; name, target and CSM never change',
    },
    pause: { fields: { name: true }, scope: MANAGE, summary: 'stop taking messages until resumed' },
    resume: { fields: { name: true }, scope: MANAGE, summary: 'take messages again (not one the operator stopped)' },
    rotate: { fields: { name: true, overlap_minutes: false }, scope: MANAGE, summary: 'a new API key, answered once; the old one works for overlap_minutes more (default 15, 0 ends it now)' },
    delete: { fields: { name: true }, scope: MANAGE, summary: 'remove it; the API key stops at once, what it wrote stays the owner\'s' },
};

export const RECEIVER_ACTION_NAMES = Object.keys(RECEIVER_ACTIONS);

/** The operator's actions on aimeat_admin_receivers. */
export const ADMIN_RECEIVER_ACTIONS = ['list', 'stop', 'start', 'decide'] as const;

/** The checks the three interfaces run before calling anything: a known action and its required fields. */
export function checkReceiverInput(input: Record<string, unknown>): { ok: true; action: string } | { ok: false; message: string } {
    const action = typeof input.action === 'string' ? input.action : '';
    const spec = RECEIVER_ACTIONS[action];
    if (!spec) return { ok: false, message: `action must be one of: ${RECEIVER_ACTION_NAMES.join(', ')}.${action ? ` "${action}" is not one.` : ''}` };
    const missing = Object.entries(spec.fields).filter(([f, req]) => req && (input[f] === undefined || input[f] === null || input[f] === '')).map(([f]) => f);
    if (missing.length) return { ok: false, message: `action "${action}" needs ${missing.join(', ')}.` };
    const allowed = new Set(['action', ...Object.keys(spec.fields)]);
    const extra = Object.keys(input).filter(k => !allowed.has(k) && input[k] !== undefined);
    if (extra.length) return { ok: false, message: `action "${action}" takes no ${extra.join(', ')}.` };
    return { ok: true, action };
}

const NAME = z.string().max(40).regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const actionList = RECEIVER_ACTION_NAMES.map(a => `"${a}" (${RECEIVER_ACTIONS[a].summary}; ${RECEIVER_ACTIONS[a].scope === MANAGE ? 'needs receivers:manage' : 'receivers:read'})`).join('; ');

export const receiverTools = [
    {
        name: 'aimeat_receiver',
        description: 'Incoming webhooks. Give an outside program (an AWS Lambda, a home sensor, a CRM export, a scheduled script) an incoming webhook: its own address and API key that write into EXACTLY ONE place of the owner\'s data over plain REST, with no agent and no MCP on the program\'s side. When you speak to the person, call it an incoming webhook and its credential an API key. '
            + 'Use it when the person says something like "make an address the Lambda writes the sensor views to" or "let our CRM push new leads into the team\'s workspace". Do not hand such a program an access token or an agent: a token writes into its own test identity, and an agent with write-as-owner reaches all of the owner\'s memory. '
            + 'First read what will READ the data (the app and the keys it reads, or the row space), so the target matches. Then call "propose" { name, target: { prefix: "ruuvit" } (or { key } or { organism_id, ws, space }), csm? } and give the person the approve_url from the answer, saying the sentence in `say`. With receivers:manage, "create" makes it at once and answers the API key as `key` ONCE: put it straight into the program\'s secret store (AWS Secrets Manager, an environment secret), never into a chat, a file in a repository or a memory record. '
            + 'A CSM shape is optional and recommended: with csm, every message is checked against it and a message that does not match is refused with each field named (make one with aimeat_csm, from_sample builds it from one example message). Without it any JSON is taken, and the node\'s own checks (size, depth, reserved keys, a key\'s schema lock, quotas) still apply. '
            + 'The program calls POST/PUT/PATCH/GET/DELETE /v1/receive/{owner}/{name} or /v1/receive/{owner}/{name}/{sub} on this server with "Authorization: Bearer aimeat_rcv_…" and Content-Type application/json; GET .../_self says what the incoming webhook takes; ?dry_run=true checks without storing; Idempotency-Key makes a retry replace the same row instead of adding another. A prefix target names the key\'s last part as {sub} (with prefix "ruuvit", sub "olohuone" writes ruuvit.olohuone). Only POST/PUT is on by default: `verbs` adds "merge" (PATCH), "read" (GET of its own target) and "delete". '
            + 'Records it writes are marked as written by a program (provenance level machine), never as the person\'s own or as AI. '
            + `Actions: ${actionList}. `
            + 'target is exactly one of { key: "a.b" }, { prefix: "a", max_keys? } or { organism_id, ws, space } (a row space of a workspace the owner belongs to). limits: { per_minute?, per_day?, max_bytes? }. visibility of the records it writes: "private" (default), "owner" or "organism:<id>", never public. '
            + 'Refusals come back as CODE: message with the codes the REST routes /v1/receivers answer (SCOPE_DENIED, NOT_FOUND, NAME_TAKEN, RESERVED_TARGET, CSM_NOT_FOUND, RECEIVERS_OFF, INVALID_INPUT).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Incoming webhooks: an address an outside program writes to', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: READ,
        surfaces: ['agent', 'service'],
        input: {
            action: { type: 'string', required: true, enum: RECEIVER_ACTION_NAMES, description: 'What to do. To give a program an address, "propose" (or "create" with receivers:manage).' },
            name: { type: 'string', description: 'The incoming webhook\'s name: lowercase letters, digits and dashes, unique per owner (e.g. "ruuvi-lambda"). Every action but list.', zod: NAME },
            target: { type: 'object', description: 'For propose and create: exactly one of { key }, { prefix, max_keys? } or { organism_id, ws, space }.', zod: z.record(z.string(), z.unknown()) },
            csm: { type: 'string', description: 'For propose and create: the CSM every message is checked against (aimeat_csm lists them). Leave it out to take any JSON.', zod: z.string().max(200) },
            csm_version: { type: 'number', description: 'For propose, create and update: a version of the CSM; default the current one.', zod: z.number().int().positive() },
            verbs: { type: 'array', description: 'What the program may do besides write (POST, PUT): "merge" (PATCH), "read" (GET of its own target), "delete".', zod: z.array(z.enum(['write', 'merge', 'read', 'delete'])).max(4) },
            limits: { type: 'object', description: '{ per_minute? (default 60), per_day? (default 5000), max_bytes? (default 65536) }.', zod: z.record(z.string(), z.unknown()) },
            visibility: { type: 'string', description: 'Who may read the records it writes: "private" (default), "owner" or "organism:<id>". Never public.', zod: z.string().max(80) },
            display_name: { type: 'string', description: 'The name the person recognises, e.g. "Ruuvi Lambda".', zod: z.string().max(120) },
            description: { type: 'string', description: 'One sentence on what the program sends.', zod: z.string().max(500) },
            expires_days: { type: 'number', description: 'Days until it stops by itself (default 365, at most 730). For update: from now.', zod: z.number().int().positive().max(730) },
            target_max_keys: { type: 'number', description: 'For update of a prefix target: the most keys it may make.', zod: z.number().int().positive().max(500) },
            overlap_minutes: { type: 'number', description: 'For rotate: minutes the old API key keeps working (default 15, 0 ends it now).', zod: z.number().int().min(0).max(1440) },
            only_refused: { type: 'boolean', description: 'For deliveries: only the refused ones.' },
        },
    },
    {
        name: 'aimeat_admin_receivers',
        description: 'Operator-only. Every incoming webhook on this node (the addresses outside programs write into owners\' data through), the counts and the setting receivers.mode, and the operator\'s stop, start and decision. '
            + 'Action "list" (the default) { owner? } answers the mode, the counts (incoming webhooks, owners, active, waiting, writes and refusals today, wrong API keys) and every incoming webhook with its owner, target, state and last delivery; no API key and no content. '
            + '"stop" { owner, name, reason } stops one for everybody until the operator starts it; the owner sees that the operator stopped it and why. "start" { owner, name } lets it work again. '
            + '"decide" { owner, name, decision: "approve" or "refuse", reason? } answers one that waits for the operator (receivers.mode operator). The setting itself is changed with aimeat_admin_config_set (visibility.receivers_mode). '
            + 'Same as GET /v1/admin/receivers and POST /v1/admin/receivers/{owner}/{name}/stop|start|decide.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Incoming webhooks', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            action: { type: 'string', enum: [...ADMIN_RECEIVER_ACTIONS], description: '"list" (the default), "stop", "start" or "decide".' },
            owner: { type: 'string', description: 'For list (a filter), stop, start and decide: the account whose incoming webhook it is.', zod: z.string().max(120) },
            name: { type: 'string', description: 'For stop, start and decide: the incoming webhook\'s name.', zod: NAME },
            decision: { type: 'string', enum: ['approve', 'refuse'], description: 'For decide.' },
            reason: { type: 'string', description: 'For stop (required) and decide: why, which the owner reads.', zod: z.string().max(500) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
