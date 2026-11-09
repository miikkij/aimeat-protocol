/**
 * @file src/tool-catalog/definitions/csm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_csm: the data descriptions (CSM, Community Service Manifest) of the owner's
 *   account in ONE tool with an `action` parameter: what shape the data an outside program sends must
 *   have, its versions, who may read it, and a draft from one sample. The pattern of aimeat_app_manage:
 *   CSM_ACTIONS is the only place an action's fields, required fields, permission word and summary are
 *   written; the catalog input, the description, the per-action permission check
 *   (tool-catalog/action-scopes.ts) and checkCsmInput(), which the node MCP handler calls first, are
 *   derived from it. Every action is a call of services/csm-service.ts on the node MCP and of the
 *   /v1/csm routes on the CLI dispatch.
 * @structure CSM_FIELDS · CSM_ACTIONS · CSM_ACTION_NAMES · checkCsmInput · csmTools
 * @usage
 *   const checked = checkCsmInput(input);
 *   if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
 * @version-history
 *   2026-11-08 — The delete summary says incoming webhook where it said receiver (secaudit2026nov08b round 15b).
 *   2026-11-08 — The delete summary says only the account's own uses refuse it (ruling 2 of 2026-11-08; secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, draft; Jouni, 2026-11-07).
 */
import { z } from 'zod';
import type { AimeatToolDefinition, ToolInputField } from './types.js';
import { agentEverywhere } from './types.js';

/** Every field any action takes. A field's description names the actions that read it. */
export const CSM_FIELDS: Record<string, ToolInputField> = {
    name: { type: 'string', description: 'The CSM\'s name, e.g. "alice.ruuvi-nakyma". For from_sample: what the data is, e.g. "ruuvi-nakyma"; the node puts your account name and a dot in front.', zod: z.string().max(200) },
    yaml: { type: 'string', description: 'For create and update: the whole CSM as YAML text (action "templates" shows complete examples). Send yaml or definition.', zod: z.string().max(200_000) },
    definition: { type: 'object', description: 'For create and update: the whole CSM as an object, in the YAML\'s shape (csm, service, data_schema, …) or as from_sample answered it. Send yaml or definition.' },
    visibility: { type: 'string', description: 'For create (default: the node\'s setting, normally public) and set_visibility: who may read it. "public": anyone, without signing in, so the program\'s author can read what to send. "members": everyone signed in to this node. "private": only your account and its agents and apps. "organism:<organism id>": the members of that organism (you must be one). Ask the person before narrowing it: a program that cannot read it cannot know the shape.', zod: z.string().max(80) },
    federate: { type: 'boolean', description: 'For create: share the CSM with this node\'s federation peers.' },
    expected_version: { type: 'number', description: 'For update: the version you read with get. A CSM that changed since answers VERSION_CONFLICT; read it again and send your change on its new version.', zod: z.number().int().min(1) },
    version: { type: 'number', description: 'For versions: one version to read in full. Omit it for the list.', zod: z.number().int().min(1) },
    sample: { type: 'object', description: 'For from_sample: one example of the data the program sends, as a JSON object, e.g. { "temperature": 21.5, "measured_at": "2026-11-07T10:00:00Z" }.' },
    service_type: { type: 'string', description: 'For list: only CSMs of this service type. For from_sample: the service type to write (default "data").', zod: z.string().max(80) },
    description: { type: 'string', description: 'For from_sample: one line on what the data is. Default: a sentence naming the name.', zod: z.string().max(500) },
    type: { type: 'string', description: 'For templates: one template\'s YAML (e.g. "marketplace"). Omit it for the list.', zod: z.string().max(80) },
};

interface CsmAction {
    /** field → required */
    fields: Record<string, boolean>;
    /** The permission word the action needs beyond a session; null: none. */
    scope: string | null;
    summary: string;
    /** At least one of these must be present. */
    oneOf?: string[];
}

const F = (required: string[], optional: string[]): Record<string, boolean> =>
    Object.fromEntries([...required.map(f => [f, true] as const), ...optional.map(f => [f, false] as const)]);

/** The one table: every action, its fields, its permission word and what it does. */
export const CSM_ACTIONS: Record<string, CsmAction> = {
    list: { fields: F([], ['service_type']), scope: null,
        summary: 'the CSMs you may read: your own, the public ones, and those shared with you' },
    get: { fields: F(['name'], []), scope: null,
        summary: 'one CSM: its definition, the JSON Schema data is checked against, its hash, version and visibility' },
    versions: { fields: F(['name'], ['version']), scope: null,
        summary: 'every version of a CSM, oldest first; with version, that one in full' },
    templates: { fields: F([], ['type']), scope: null,
        summary: 'the built-in CSM templates; with type, one template as YAML' },
    from_sample: { fields: F(['name', 'sample'], ['service_type', 'description']), scope: 'csm:write',
        summary: 'a CSM drafted from one sample of the data (YAML, definition and JSON Schema); stores nothing, so show it to the person and create it when they agree' },
    create: { fields: F([], ['yaml', 'definition', 'visibility', 'federate']), scope: 'csm:write', oneOf: ['yaml', 'definition'],
        summary: 'register a new CSM in your account; its name gets your account name in front, and the answer says the final name' },
    update: { fields: F(['name', 'expected_version'], ['yaml', 'definition']), scope: 'csm:write', oneOf: ['yaml', 'definition'],
        summary: 'replace a CSM\'s definition with the next version; the name stays, the old version is kept, data is checked against the new one from now on' },
    set_visibility: { fields: F(['name', 'visibility'], []), scope: 'csm:write',
        summary: 'change who may read a CSM' },
    delete: { fields: F(['name'], []), scope: 'csm:write',
        summary: 'delete a CSM and its versions; refused with IN_USE while your own account still uses it (another account\'s incoming webhook keeps its copy, and its owner is told)' },
};

export const CSM_ACTION_NAMES = Object.keys(CSM_ACTIONS);

function fieldList(action: CsmAction): string {
    const names = Object.entries(action.fields).sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([f, req]) => (req ? `${f} (required)` : f));
    return names.length ? names.join(', ') : 'none';
}

export type CsmCheck = { ok: true; action: string } | { ok: false; message: string };

/**
 * Check one call against its action's field list, naming everything wrong at once: an unknown action,
 * every missing required field, and every field the action does not take. `extra` names parameters an
 * interface adds itself (the connector's agent_name).
 */
export function checkCsmInput(input: Record<string, unknown>, extra: string[] = []): CsmCheck {
    const actionName = typeof input.action === 'string' ? input.action : '';
    const action = CSM_ACTIONS[actionName];
    if (!action) return { ok: false, message: `action must be one of: ${CSM_ACTION_NAMES.join(', ')}.${actionName ? ` "${actionName}" is not one.` : ''}` };
    const present = (f: string) => input[f] !== undefined && input[f] !== null;
    const missing = Object.entries(action.fields).filter(([f, req]) => req && !present(f)).map(([f]) => f);
    const allowed = new Set(['action', ...Object.keys(action.fields), ...extra]);
    const foreign = Object.keys(input).filter(f => present(f) && !allowed.has(f));
    const parts: string[] = [];
    if (missing.length) parts.push(`is missing: ${missing.join(', ')}`);
    if (foreign.length) parts.push(`does not take: ${foreign.join(', ')}`);
    if (!missing.length && action.oneOf && !action.oneOf.some(present)) parts.push(`needs one of: ${action.oneOf.join(', ')}`);
    if (!parts.length) return { ok: true, action: actionName };
    return { ok: false, message: `action "${actionName}" ${parts.join('. It ')}. Its fields: ${fieldList(action)}.` };
}

const DESCRIPTION = 'The data descriptions (CSM) of this account: the shape and rules the data an outside program sends here must have, so the node can check every write. '
    + 'Call it when the person wants the data an outside program sends to be checked, or asks what shape a writer must send. '
    + 'When they show what their program sends, call from_sample with a name and that one sample, show the person the fields in plain words (which are required, which are numbers or times), and call create with the definition when they agree. '
    + 'To change one, get it, then update with its version as expected_version. Tell the person the final name (it starts with their account name) and who can read it; a public one can be read by the program\'s author without an account. Actions:\n'
    + CSM_ACTION_NAMES.map(n => `- ${n} (${fieldList(CSM_ACTIONS[n]!)}): ${CSM_ACTIONS[n]!.summary}.`).join('\n')
    + '\nThe reads need no permission beyond this session; from_sample, create, update, set_visibility and delete need csm:write, which the owner grants on the agent\'s page. '
    + 'Same as /v1/csm on REST.';

export const csmTools = [
    {
        name: 'aimeat_csm',
        description: DESCRIPTION,
        caller: 'agent',
        visibility: agentEverywhere,
        // Destructive because delete is, and update replaces the definition data is checked against.
        // Not idempotent: create refuses a name taken by an earlier call. A client that confirms each
        // call is the safe reading of a mixed tool.
        annotations: { title: 'Data descriptions (CSM)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        surfaces: ['agent', 'appdev'],
        input: {
            action: { type: 'string', required: true, enum: CSM_ACTION_NAMES, description: 'What to do. The description lists each action with its fields.' },
            ...CSM_FIELDS,
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
