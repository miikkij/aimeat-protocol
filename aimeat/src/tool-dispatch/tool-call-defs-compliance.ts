/**
 * @file src/tool-dispatch/tool-call-defs-compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The compliance tools in the CLI dispatch (`aimeat connect call` and
 *   POST /local/call/<tool>): the report, the register read and write, and the kept reports. Moved
 *   unchanged out of tool-call-defs-core.ts (max-file-lines) when the register tools took the records
 *   of processing of plan doc-mvlftkh9zmc9.
 * @structure compliancePart() · complianceDocKind() · complianceScopeQuery() · complianceCliTools
 * @usage import { complianceCliTools } from './tool-call-defs-compliance.js';
 * @version-history
 *   v1.0.0 — 2026-10-23 — Moved from tool-call-defs-core.ts; the register read and write reach
 *     /v1/compliance/catalog, /draft, /gaps and /docs/<kind> with the scope (plan doc-mvlftkh9zmc9, C7.1).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean, requiredRecord } from './tool-call-helpers.js';
import { COMPLIANCE_DOC_KINDS } from '../tool-catalog/definitions/compliance.js';

/**
 * The compliance register's `part`, checked against the two documents that exist.
 *
 * It becomes a path segment, so an unchecked value would build a URL the route never declared and
 * the caller would read the resulting 404 as "the report is empty" rather than "you asked for
 * something that is not a thing".
 */
function compliancePart(input: JsonObject, allowDraft = false): 'draft' | 'usecases' | 'questionnaire' {
    const part = requiredString(input, 'part');
    const allowed = allowDraft ? ['draft', 'usecases', 'questionnaire'] : ['usecases', 'questionnaire'];
    if (!allowed.includes(part)) {
        throw new Error(`part has to be one of ${allowed.map(a => `"${a}"`).join(', ')}, not "${part}"`);
    }
    return part as 'draft' | 'usecases' | 'questionnaire';
}

/** A scoped compliance document's kind (plan doc-mvlftkh9zmc9), or null for an AI Act part. */
function complianceDocKind(input: JsonObject): string | null {
    const part = requiredString(input, 'part');
    return (COMPLIANCE_DOC_KINDS as readonly string[]).includes(part) ? part : null;
}

/** The scope query of a scoped compliance document, as the routes read it. */
function complianceScopeQuery(input: JsonObject, extra: Record<string, string | number | undefined> = {}): string {
    return query({
        scope: optionalString(input, 'scope'), organism_id: optionalString(input, 'organism_id'),
        app: optionalString(input, 'app'), app_owner: optionalString(input, 'app_owner'), ...extra,
    });
}

export const complianceCliTools: ConnectCliToolDefinition[] = [
    {
        // `part` is validated against the two literals rather than interpolated, because it lands in
        // a path segment. An unchecked value here would be a path the route never declared.
        name: 'aimeat_compliance_report',
        handler: ({ client }, input) => {
            // Two doors for two reports: the owner slice asks wallet:read of an agent, the whole installation
            // needs an operator account plus the exact word. Defaulting to the slice is least
            // privilege, and it is what almost every caller means.
            const scope = optionalString(input, 'scope');
            const path = scope === 'node' ? '/v1/admin/compliance/report' : '/v1/compliance/report/mine';
            return client.get(`${path}${query({
                month: optionalString(input, 'month'),
                since_days: optionalNumber(input, 'since_days'),
            })}`);
        },
    },
    {
        name: 'aimeat_compliance_register_read',
        handler: ({ client }, input) => {
            // The records of processing and the documents beside them: /v1/compliance/* with the scope.
            const part = requiredString(input, 'part');
            if (part === 'catalog') return client.get('/v1/compliance/catalog');
            if (part === 'registers_draft') return client.get(`/v1/compliance/draft${complianceScopeQuery(input)}`);
            if (part === 'gaps') return client.get(`/v1/compliance/gaps${complianceScopeQuery(input)}`);
            const kind = complianceDocKind(input);
            if (kind) return client.get(`/v1/compliance/docs/${kind}${complianceScopeQuery(input)}`);
            return client.get(`/v1/admin/compliance/${compliancePart(input, true)}${query({
                since_days: optionalNumber(input, 'since_days'),
            })}`);
        },
    },
    {
        name: 'aimeat_compliance_register_write',
        handler: ({ client }, input) => {
            const kind = complianceDocKind(input);
            if (kind) {
                return client.put(`/v1/compliance/docs/${kind}${complianceScopeQuery(input, {
                    dry_run: optionalBoolean(input, 'dry_run') ? 'true' : undefined,
                })}`, requiredRecord(input, 'value'));
            }
            return client.put(
                `/v1/admin/compliance/${compliancePart(input)}${optionalBoolean(input, 'dry_run') ? '?dry_run=true' : ''}`,
                requiredRecord(input, 'value'),
            );
        },
    },
    {
        name: 'aimeat_compliance_snapshot',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            if (action === 'save') {
                const sinceDays = optionalNumber(input, 'since_days');
                return client.post('/v1/admin/compliance/snapshot',
                    sinceDays === undefined ? {} : { since_days: sinceDays });
            }
            // The id is forwarded whenever it is given, rather than only when action says "read".
            // The route already branches on its presence, so gating it here would add a second
            // opinion that can only ever drop a value the caller meant — which is the exact defect
            // this dispatch table has produced three times. It goes through query(), which encodes
            // it: it is caller text landing next to a stored key.
            return client.get(`/v1/admin/compliance/reports${query({
                id: optionalString(input, 'id'),
            })}`);
        },
    },
];
