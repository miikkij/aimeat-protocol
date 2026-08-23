/**
 * @file compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the operator's compliance tools: the node-wide report, and the
 *   use-case register and question set behind it.
 *
 *   THREE TOOL NAMES, NOT FIVE. `part` carries which document is meant, because every name here has
 *   to stay in step across three surfaces — the node MCP, the connector MCP and the CLI dispatch a
 *   fleet daemon actually calls. The smaller the surface, the fewer places parity can quietly break,
 *   and it has broken three times in one week before.
 *
 *   VISIBLE EVERYWHERE, ON PURPOSE. Its nearest sibling, aimeat_admin_organism_ownership, is node-MCP
 *   only — a break-glass a person reaches for once. Keeping the register current is the opposite: a
 *   standing job, and the kind of job an agent should be doing. Locking it to one surface would make
 *   the register a thing you maintain by clicking, which is the failure this whole feature is meant
 *   to avoid on the reporting side.
 * @structure complianceTools — the three definitions
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const complianceTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_compliance_report',
        description: 'The compliance report: AI activity joined to the written record of what AI is used for, and the difference between them. Defaults to scope="mine" — your owner\'s own slice, which any session may read and which needs no special permission. scope="node" is the whole installation across every account, and needs the exact permission "compliance:read" plus an account that runs the installation; no wildcard carries that word. Read `gaps` first — each entry is a model used and mentioned in no entry, an entry with unanswered questions and so no risk class, public content published without a label, or an app that says it generates content while the publish check found a disclosure gap. Read `not_covered` second, and note the two scopes state DIFFERENT limits: a total without its population reads as coverage. Use aimeat_compliance_register_read to see the written record raw, and aimeat_compliance_register_write to change it.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            scope: { type: 'string', enum: ['mine', 'node'], description: 'Whose report. "mine" (the default) is your owner\'s own slice; "node" is the whole installation and is operator-only.' },
            since_days: { type: 'number', description: 'Rolling window in days (default 30). Ignored when month is given.' },
            month: { type: 'string', description: 'A whole calendar month, YYYY-MM. Wins over since_days — a rolling window filed under a month\'s name is wrong in an archive somebody reads later.' },
        },
    },
    {
        name: 'aimeat_compliance_register_read',
        description: 'Operator-only. Read one of the two documents the compliance report is built from. part="usecases" returns what AI is used for on this node — each entry with the models, apps and systems it runs on, and its answers to the risk questions. part="questionnaire" returns the risk-classification question set: the classes, and each question with the answers that imply each class. The question set is DATA, so it can be edited without a release; read it before writing it, because a write replaces the whole document. Needs the exact permission "compliance:read".',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            part: { type: 'string', required: true, enum: ['usecases', 'questionnaire'], description: 'Which document to read.' },
        },
    },
    {
        name: 'aimeat_compliance_register_write',
        description: 'Operator-only. Replace one of the two documents the compliance report is built from. REPLACES, does not merge: send every use case or every question you want to keep, so read the document first. part="usecases" expects { usecases: [...] }; part="questionnaire" expects the whole set with version, classes, defaultClass and questions. A question set that names a class it does not define, a choice question with no options, or a duplicate id is refused rather than stored — each would surface later as a silent default inside a compliance document. Adding a question takes effect on the next report with no release and no restart, which is the reason this is data. Saving re-classifies every use case: one whose answers no longer cover every question becomes unclassified and appears in the report gap list. Needs the exact permission "compliance:write" — "compliance:read" is refused here, and no wildcard carries either.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            part: { type: 'string', required: true, enum: ['usecases', 'questionnaire'], description: 'Which document to replace.' },
            value: { type: 'object', required: true, description: 'The whole document. For "usecases", { usecases: [...] }. For "questionnaire", { version, note, classes, defaultClass, questions }.' },
        },
    },
];
