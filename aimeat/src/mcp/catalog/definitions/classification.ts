/**
 * @file src/mcp/catalog/definitions/classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification tool (TARGET-082 V2): the classification of a piece of content,
 *   and the policy at the node, owner or organism level. On the node's MCP endpoint only until the
 *   connector and the CLI get it with the other surfaces (V5).
 * @structure classificationTools
 * @usage imported by catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import type { AimeatToolDefinition } from './types.js';

export const classificationTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_classification',
        description: 'How sensitive a piece of content is, and the rules for that. Every memory record, workspace record or document, stored file and workspace row has a classification: public, internal, confidential, highly confidential, or a level the owner or an organism added, such as top secret. The classification decides which people and which AI may read it and whether it may leave its organism. ACTIONS: get (the classification of one item, its waiting suggestion and its last changes), set (give it a classification), review (the person accepts or rejects a waiting suggestion; relay their words in human_said), policy_get (the labels, detection rules, default and AI mode that apply at level node, owner or organism, and whether classification is on), policy_set (replace a level: read it with policy_get and send `stored` back changed). WHAT YOU MAY DO: your own judgement never lowers a classification and never changes one a person set; it becomes a suggestion the person accepts or rejects. When the person told you what to set, pass their own words, verbatim, in human_said: the classification is then theirs. A policy change that only tightens applies at once. One that gives anything away (turns classification off, lets an AI see more, drops an audit trail or a rule, lowers the default) waits until the person accepts it signed in themselves; you cannot accept it. A lower level only tightens the node: an owner or an organism adds its own labels between the node\'s ones and adds rules, and a refusal names the node\'s rule it would have loosened.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            action: { type: 'string', required: true, enum: ['get', 'set', 'review', 'policy_get', 'policy_set'], description: 'What to do.' },
            kind: { type: 'string', enum: ['memory', 'file', 'row'], description: 'get, set, review: what the content is. Default memory.' },
            key: { type: 'string', description: 'get, set, review: the memory key (an organism workspace key included) or the stored file key.' },
            organism_id: { type: 'string', description: 'A row: its organism. policy_get, policy_set at level organism: the organism.' },
            ws: { type: 'string', description: 'A row: its workspace id.' },
            space: { type: 'string', description: 'A row: its row space.' },
            row_id: { type: 'string', description: 'A row: its id.' },
            label: { type: 'string', description: 'set: the label id, from policy_get.' },
            justification: { type: 'string', description: 'set: why the content is less sensitive, when lowering from a label that needs a reason.' },
            human_said: { type: 'string', description: "The person's own words, verbatim, when you relay their instruction. Never your own summary." },
            confidence: { type: 'number', description: 'set: how sure you are, 0 to 1, when the label is your own judgement.' },
            reason: { type: 'string', description: 'set: why you chose the label, when it is your own judgement.' },
            decision: { type: 'string', enum: ['accept', 'reject'], description: "review: the person's decision on the waiting suggestion." },
            level: { type: 'string', enum: ['node', 'owner', 'organism'], description: 'policy_get, policy_set: which level. Default owner.' },
            policy: { type: 'object', description: 'policy_set: the WHOLE level as policy_get returned it in `stored`, changed. It replaces the level. A label: { id, name: { fi, en, es }, rank 0-999, color, description, aiVisibility hidden|warning|allowed, audit, mayLeaveOrganism, lowerNeedsJustification, audience: { roles, groups, people } }. A rule: { id, name, kind keyword|regex|classifier, pattern, flags, minLabel, enabled, appliesTo: { kinds, organismId, ws, keyPrefix } }. An owner or organism level also carries enabled, which turns classification on for its content when the node lets each owner decide.' },
        },
    },
];
