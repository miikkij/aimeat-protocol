/**
 * @file src/mcp/catalog/definitions/decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for the decision tools (TARGET-080, AIMEAT.decide): ask the decision
 *   model, read what it decided, record a person's review, run one decision over many records, and
 *   read the owner's decide settings.
 *
 *   These exist on THREE surfaces: the node MCP (src/mcp/decide.ts), the connector MCP
 *   (src/cli/connect/mcp/tools/decide.ts) and the CLI dispatch (src/cli/connect/tool-call-defs-decide.ts).
 *   This file is the one description each of them reads through `descriptionFor()`.
 *
 *   There is no tool that CHANGES the settings, on purpose. The settings are the owner's own key and
 *   the switch that tells the scrubber what may leave unscrubbed; an agent that could change them could
 *   turn off the cleaning of its own traffic, and a key typed into a chat is a key in a transcript.
 *   The owner changes them on the AI settings page. The read tool says so.
 * @structure decideTools -- AimeatToolDefinition[]
 * @usage imported by mcp/catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { type AimeatToolDefinition, agentEverywhere } from './types.js';

const QUESTIONS_HELP = 'A map of YOUR ids to questions. Three types: {type:"noul", instructions, criteria?:{true?,false?}} returns the probability (0-1) that the statement is true; {type:"choice", instructions, criteria:{"<option>":"<what it means>"|null}} picks one of 2-240 options and returns a probability per option and a confidence; {type:"score", instructions, criteria:["<lowest level>", ..., "<highest level>"]} rates on 2-10 ordered levels. Write instructions and criteria in ENGLISH whatever language the state is in: the model is trained on English first. Ask everything you might need in ONE call (cost is in the state, answers are free), keep one judgment per question, add a "none of these" option to a choice, and keep arithmetic, counting and date comparison in code.';

export const decideTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_decide',
        description: `Ask the DECISION model (TypeSafe Jev) typed questions about a piece of text or data and get typed answers with probabilities back. It writes no text: use it to classify, route, screen, score, gate an action or pick among candidates you found in code, never to generate or summarise. The node removes personal data before anything leaves (e-mails, phones, Finnish personal identity codes, IBANs, street addresses, and names of the owner's contacts or under name fields), puts real option names back into the answers, meters the call on the owner's AI budget and records the decision so the owner can later ask what was decided about a record and on what basis. Pass \`subject\` (what the decision is about), \`gates\` (what it decides) and \`thresholds\` (the numbers you will compare against) so that record can be audited. ${QUESTIONS_HELP}`,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            state: { type: 'object', required: true, description: 'What is being judged: a string, an object with named fields (preferred), or an array of records. Send only what the questions need; unrelated content lowers accuracy and is what you pay for.' },
            questions: { type: 'object', required: true, description: QUESTIONS_HELP },
            subject: { type: 'string', description: 'What the decision is about: a memory key or a record id. The owner asks by this later.' },
            gates: { type: 'string', description: 'What the answer decides, in plain words ("send the reply automatically").' },
            thresholds: { type: 'object', description: 'The thresholds you will apply, e.g. {"urgent": 0.8}. Recorded with the decision.' },
            names: { type: 'array', description: 'Extra person names to remove before sending, beyond the owner\'s contacts.' },
            public_content: { type: 'boolean', description: 'The content is already public and needs no scrubbing. Honoured only when the owner\'s policy allows it.' },
            cache: { type: 'boolean', description: 'Reuse an identical earlier decision (default true).' },
            app_id: { type: 'string', description: 'App attribution for the per-app quota.' },
        },
    },
    {
        name: 'aimeat_decision_list',
        description: 'Read what the decision model decided for this owner, newest first: the model version that answered, the questions as sent, every answer with its probabilities, the thresholds in force, what it gated, whether a person reviewed it, and what personal data was removed first. Give `decision_id` for one decision, or filter by `subject` to answer "what did an AI decide about this record".',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            decision_id: { type: 'string', description: 'Read one decision.' },
            subject: { type: 'string', description: 'Only decisions about this subject.' },
            app_id: { type: 'string', description: 'Only decisions made for this app.' },
            limit: { type: 'number', description: 'How many (1-200, default 50).' },
            before: { type: 'string', description: 'Only decisions made before this ISO time (paging cursor: the createdAt of the last one you have).' },
        },
    },
    {
        name: 'aimeat_decision_review',
        description: 'Record that a person looked at a decision and confirmed it or overrode it. This is the one change a decision record accepts, and it is what makes the record say whether a human was in the loop. Record it when the person actually decided, not on their behalf.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            decision_id: { type: 'string', required: true, description: 'The decision.' },
            outcome: { type: 'string', required: true, description: 'confirmed | overridden', enum: ['confirmed', 'overridden'] },
            note: { type: 'string', description: 'Why, in the person\'s words.' },
            override: { type: 'object', description: 'What the person decided instead, when overridden.' },
        },
    },
    {
        name: 'aimeat_decide_run',
        description: `Ask the same questions of MANY records in the background: the node keeps at most a few requests open, waits out rate limits, records every decision, and keeps progress so a stopped run resumes where it stopped. action="start" with the questions and exactly one of \`items\` ([{subject, state}]), \`keys\` (owner memory keys, each value one state) or \`prefix\` (every owner record under it); \`fields\` narrows each state to the named fields. It answers at once with a run id; read it with action="get". action="list", "resume" and "stop" do what they say. At most 1000 items per run. ${QUESTIONS_HELP}`,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, description: 'start | get | list | resume | stop', enum: ['start', 'get', 'list', 'resume', 'stop'] },
            run_id: { type: 'string', description: 'The run, for get, resume and stop.' },
            questions: { type: 'object', description: 'For start: the questions, as for aimeat_decide.' },
            items: { type: 'array', description: 'For start: [{ subject, state }].' },
            keys: { type: 'array', description: 'For start: owner memory keys; each record\'s value is one state.' },
            prefix: { type: 'string', description: 'For start: every owner record under this key prefix.' },
            fields: { type: 'array', description: 'For start: keep only these top-level fields of each state.' },
            gates: { type: 'string', description: 'What the answers decide.' },
            thresholds: { type: 'object', description: 'The thresholds you will apply.' },
            names: { type: 'array', description: 'Extra person names to remove before sending.' },
            app_id: { type: 'string', description: 'App attribution for the per-app quota.' },
        },
    },
    {
        name: 'aimeat_decide_settings',
        description: 'Read the owner\'s decision-model settings: whether the operator has it on, the pinned model version, whether the owner has their own TypeSafe key or the node\'s key pays, and which classes of personal data the owner lets leave unscrubbed. It never shows a key. Nothing here can change them: the owner changes the key and the data policy on the AI settings page, because they decide what the scrubber lets through.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
];
