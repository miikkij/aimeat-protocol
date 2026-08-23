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
        description: 'Operator-only. Read what the compliance report is built from. part="draft" is the one to start with: the node composes a first draft of the register out of what actually ran, grouped by which agent or app called the model rather than by the model, with each agent\'s own name and description as the entry, and the two questions it can answer from the record already answered and marked as evidence. Nothing in a draft is stored. part="usecases" is the register as stored; part="questionnaire" is the risk-classification question set — the classes, and each question with the answers that imply each class. The question set is DATA and can be edited without a release. Read before writing, because a write replaces the whole document. Needs the exact permission "compliance:read".',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            part: { type: 'string', required: true, enum: ['draft', 'usecases', 'questionnaire'], description: 'Which document to read. Start with "draft".' },
            since_days: { type: 'number', description: 'For "draft": how far back to look for activity (default 30).' },
        },
    },
    {
        name: 'aimeat_compliance_register_write',
        description: 'Operator-only. Replace one of the two stored documents. REPLACES, does not merge: send every use case or every question you want to keep, so read first. Pass dry_run=true to get back exactly what WOULD be stored, validated, without storing it — show that to the person and let them approve it before the real write. part="usecases" expects { usecases: [...] }; part="questionnaire" expects the whole set with version, classes, defaultClass and questions. Mark each answer in answerSources as "human", "ai" or "evidence": an auditor\'s question is which of the three, and answers that all read as considered would answer it wrongly. A question set naming a class it does not define, a choice question with no options, or a duplicate id is refused rather than stored. Adding a question takes effect on the next report with no release. Saving re-classifies everything: an entry whose answers no longer cover every question becomes unclassified and appears in the gap list. Needs the exact permission "compliance:write" — "compliance:read" is refused here, and no wildcard carries either.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            part: { type: 'string', required: true, enum: ['usecases', 'questionnaire'], description: 'Which document to replace.' },
            value: { type: 'object', required: true, description: 'The whole document. For "usecases", { usecases: [...] }. For "questionnaire", { version, note, classes, defaultClass, questions }.' },
            dry_run: { type: 'boolean', description: 'Validate and return what would be stored, storing nothing. Use this to show somebody the result before it goes in.' },
        },
    },
];
