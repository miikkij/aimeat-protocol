/**
 * @file src/mcp/catalog/definitions/classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification tool (TARGET-082 V2): the classification of a piece of content,
 *   and the policy at the node, owner or organism level. On all three surfaces: the node's MCP
 *   endpoint (src/mcp/classification.ts), the connector MCP (src/cli/connect/mcp/tools/classification.ts)
 *   and the CLI dispatch (src/tool-dispatch/tool-call-defs-classification.ts); the last two send the
 *   call to /v1/classification/* through src/tool-dispatch/classification-call.ts.
 * @structure classificationTools · POLICY_PENDING_NEXT · CLASSIFICATION_ACTION_FIELDS ·
 *   CLASSIFICATION_ACTIONS · checkClassificationInput()
 * @usage imported by catalog/definitions.ts and src/tool-dispatch/classification-call.ts
 * @version-history
 *   v1.4.0 — 2026-09-29 — The explorer action (the classifications on the caller's own content and
 *     the items where a suggestion waits, paged) and switch_set (the node's switch, an operator's,
 *     refused from an AI when it gives protection away, and kept in the audit log). get, set and
 *     review take `owner`: the agent or app of the owner that holds the key.
 *   v1.3.0 — 2026-09-29 — V5: visibility agentEverywhere (the connector MCP and the CLI dispatch);
 *     POLICY_PENDING_NEXT, the hint added to a policy change that waits; and the field list per
 *     action with checkClassificationInput(), which the REST-backed surfaces use to refuse a field
 *     its action does not read.
 *   v1.2.0 — 2026-09-29 — V3: the scan action.
 *   v1.1.0 — 2026-09-29 — V4: the audit action, and what an AI sees of classified content.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

/**
 * Added to a policy_set answer that the node kept as a proposal, on every surface, so an AI knows
 * the next step is the person's and not its own.
 */
export const POLICY_PENDING_NEXT = 'This gives something away, so it waits. Ask the person to accept or reject it signed in themselves (POST /v1/classification/policy/review); an AI cannot accept it.';

const TARGET_FIELDS = ['kind', 'key', 'organism_id', 'ws', 'space', 'row_id', 'owner'];

/** The fields each action reads. A field outside its action's list would be ignored in silence. */
export const CLASSIFICATION_ACTION_FIELDS: Record<string, string[]> = {
    get: TARGET_FIELDS,
    set: [...TARGET_FIELDS, 'label', 'justification', 'human_said', 'confidence', 'reason'],
    review: [...TARGET_FIELDS, 'decision', 'justification', 'human_said'],
    policy_get: ['level', 'organism_id'],
    policy_set: ['level', 'organism_id', 'policy', 'human_said'],
    audit: ['level', 'organism_id', 'since', 'audit_action', 'limit'],
    scan: ['keys', 'prefix', 'key'],
    explorer: ['level', 'organism_id', 'label', 'pending', 'kind', 'limit', 'cursor'],
    switch_set: ['level', 'mode'],
};

/** Every action, in the order the tool's enum lists them on all three surfaces. */
export const CLASSIFICATION_ACTIONS = ['get', 'set', 'review', 'policy_get', 'policy_set', 'audit', 'scan', 'explorer', 'switch_set'] as const;

/** Fields an interface or a wrapper adds to every call, which no action reads itself. */
const INTERFACE_FIELDS = ['action', 'agent_name', 'response_format', 'ai_provenance', 'ai_provenance_id'];

/**
 * Check one call against its action's field list: an unknown action, or a field the action does not
 * read, is refused with every problem named at once, so the caller does not lose a value it meant.
 * @param {Record<string, unknown>} input the call's arguments
 * @returns {{ ok: true, action: string } | { ok: false, message: string }}
 */
export function checkClassificationInput(input: Record<string, unknown>): { ok: true; action: string } | { ok: false; message: string } {
    const action = typeof input.action === 'string' ? input.action : '';
    const fields = CLASSIFICATION_ACTION_FIELDS[action];
    if (!fields) {
        return { ok: false, message: `action is one of: ${Object.keys(CLASSIFICATION_ACTION_FIELDS).join(', ')}.${action ? ` "${action}" is not one.` : ''}` };
    }
    const allowed = new Set([...fields, ...INTERFACE_FIELDS]);
    const foreign = Object.keys(input).filter(f => input[f] !== undefined && input[f] !== null && !allowed.has(f));
    if (!foreign.length) return { ok: true, action };
    return { ok: false, message: `action "${action}" does not take: ${foreign.join(', ')}. Its fields: ${fields.join(', ')}.` };
}

export const classificationTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_classification',
        description: 'How sensitive a piece of content is, and the rules for that. Every memory record, workspace record or document, stored file and workspace row has a classification: public, internal, confidential, highly confidential, or a level the owner or an organism added, such as top secret. The classification decides which people and which AI may read it and whether it may leave its organism. ACTIONS: get (the classification of one item, its waiting suggestion and its last changes), set (give it a classification), review (the person accepts or rejects a waiting suggestion; relay their words in human_said), policy_get (the labels, detection rules, default and AI mode that apply at level node, owner or organism, and whether classification is on), policy_set (replace a level: read it with policy_get and send `stored` back changed), audit (the log of a level: which classified items were shown to or used by an AI, which were refused and which classifications changed; one row per reader, item and action per minute, with a count), scan (the Content Classifier judges memory keys: `key` or up to 20 `keys` at once, more keys or a `prefix` wait in a queue the server works through within the daily caps; detection rules run first, then the decision model or the text model the policy names, with personal data removed before anything leaves; its label follows the same AI rules as yours), explorer (a page of the classifications stored on your owner\'s content, theirs and their agents\', or at level organism on an organism\'s content for its creator or an admin: filter with `label`, or with `pending: true` for the items where a suggestion waits for the person; pass `next` back as `cursor` for the next page; content with no stored classification reads as the default and is not listed), switch_set (the operator\'s own agent, with the operator:admin permission: set the node\'s switch `mode` to off, owner or all. Turning classification on, or from owner to all, applies at once; turning it off, or from all to owner, gives protection away and is refused from an AI with PERSON_REQUIRED, because the operator does that on the admin Config page. Every change is kept in the audit log at level node). WHAT YOU SEE: an item whose classification hides it from AI is not in your lists and reads as absent; an AI call that names one is refused (CLASSIFIED); an item with a warning classification carries classification_warning, and you use it only for the task you were given. WHAT YOU MAY DO: your own judgement never lowers a classification and never changes one a person set; it becomes a suggestion the person accepts or rejects. When the person told you what to set, pass their own words, verbatim, in human_said: the classification is then theirs. A policy change that only tightens applies at once. One that gives anything away (turns classification off, lets an AI see more, drops an audit trail or a rule, lowers the default) waits until the person accepts it signed in themselves; you cannot accept it. A lower level only tightens the node: an owner or an organism adds its own labels between the node\'s ones and adds rules, and a refusal names the node\'s rule it would have loosened.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, enum: [...CLASSIFICATION_ACTIONS], description: 'What to do.' },
            keys: { type: 'array', description: 'scan: memory keys to classify.' },
            prefix: { type: 'string', description: 'scan: classify every memory key under this prefix (queued).' },
            since: { type: 'string', description: 'audit: only rows from this ISO time on.' },
            audit_action: { type: 'string', enum: ['shown', 'used', 'refused', 'changed'], description: 'audit: only this kind of row.' },
            limit: { type: 'number', description: 'audit: at most this many rows, default 200. explorer: items per page, default 50, at most 200.' },
            pending: { type: 'boolean', description: 'explorer: only the items where a suggestion waits for a person.' },
            cursor: { type: 'string', description: 'explorer: the `next` value of the previous page.' },
            mode: { type: 'string', enum: ['off', 'owner', 'all'], description: "switch_set: the node's switch. off: nothing is classified; owner: each owner decides for their own content; all: on for every owner." },
            kind: { type: 'string', enum: ['memory', 'file', 'row'], description: 'get, set, review: what the content is. Default memory. explorer: only this kind.' },
            key: { type: 'string', description: 'get, set, review: the memory key (an organism workspace key included) or the stored file key.' },
            organism_id: { type: 'string', description: 'A row: its organism. policy_get, policy_set at level organism: the organism.' },
            ws: { type: 'string', description: 'A row: its workspace id.' },
            space: { type: 'string', description: 'A row: its row space.' },
            row_id: { type: 'string', description: 'A row: its id.' },
            owner: { type: 'string', description: 'get, set, review: the identity that holds the key when it is one of your agents or apps (a memory key or a stored file). Absent: your own.' },
            label: { type: 'string', description: 'set: the label id, from policy_get. explorer: only items with this label.' },
            justification: { type: 'string', description: 'set: why the content is less sensitive, when lowering from a label that needs a reason.' },
            human_said: { type: 'string', description: "The person's own words, verbatim, when you relay their instruction. Never your own summary." },
            confidence: { type: 'number', description: 'set: how sure you are, 0 to 1, when the label is your own judgement.' },
            reason: { type: 'string', description: 'set: why you chose the label, when it is your own judgement.' },
            decision: { type: 'string', enum: ['accept', 'reject'], description: "review: the person's decision on the waiting suggestion." },
            level: { type: 'string', enum: ['node', 'owner', 'organism'], description: 'policy_get, policy_set, audit: which level. Default owner. explorer: owner or organism. switch_set: node, the only one.' },
            policy: { type: 'object', description: 'policy_set: the WHOLE level as policy_get returned it in `stored`, changed. It replaces the level. A label: { id, name: { fi, en, es }, rank 0-999, color, description, aiVisibility hidden|warning|allowed, audit, mayLeaveOrganism, lowerNeedsJustification, audience: { roles, groups, people } }. A rule: { id, name, kind keyword|regex|classifier, pattern, flags, minLabel, enabled, appliesTo: { kinds, organismId, ws, keyPrefix } }. An owner or organism level also carries enabled, which turns classification on for its content when the node lets each owner decide.' },
        },
    },
];
