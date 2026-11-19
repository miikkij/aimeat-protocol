/**
 * @file src/tool-dispatch/tool-call-defs-kyc.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The customer due diligence tools on the CLI dispatch (`aimeat connect call`,
 *   POST /local/call/<tool>) and the connector MCP: aimeat_kyc_customer, aimeat_kyc_suspicion_mark and
 *   aimeat_kyc_settings. A thin proxy over /v1/kyc/:org/* (routes/kyc/routes.ts): each action is one route,
 *   and the route runs the scope check, the validation and the role decision (services/kyc/access.ts).
 * @structure kycCliTools — the three definitions
 * @usage import { kycCliTools } from './tool-call-defs-kyc.js';   // tool-dispatch/index.ts
 * @version-history
 *   v1.1.0 — 2026-11-19 — aimeat_kyc_settings: risk_assessment and dpia_draft (GET routes).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord, optionalArray, query } from './tool-call-helpers.js';
import { KYC_CUSTOMER_ACTION_NAMES, KYC_SETTINGS_ACTION_NAMES } from '../tool-catalog/definitions/kyc.js';

/** The organism's KYC base path; the id is caller text landing in a path segment, so it is encoded. */
const base = (org: string): string => `/v1/kyc/${encodeURIComponent(org)}`;

export const kycCliTools: ConnectCliToolDefinition[] = [
    {
        // → the route of the action named (routes/kyc/routes.ts, "Customer cards")
        name: 'aimeat_kyc_customer',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            const customers = `${base(requiredString(input, 'organism'))}/customers`;
            const card = () => `${customers}/${encodeURIComponent(requiredString(input, 'customer_id'))}`;
            const note = optionalString(input, 'note');
            const withNote = (body: Record<string, unknown>) => (note ? { ...body, note } : body);
            switch (action) {
                case 'list': return client.get(`${customers}${query({ due: optionalBoolean(input, 'due') ? 'true' : undefined, status: optionalString(input, 'status') })}`);
                case 'open': return client.post(customers, optionalRecord(input, 'fields') ?? {});
                case 'read': return client.get(card());
                case 'as_of': return client.get(`${card()}${query({ as_of: requiredString(input, 'as_of') })}`);
                case 'update': return client.patch(card(), withNote({ ...(optionalRecord(input, 'fields') ?? {}) }));
                case 'identify': return client.post(`${card()}/identity`, withNote({ ...(optionalRecord(input, 'identity') ?? {}) }));
                case 'screen': return client.post(`${card()}/screen`, {});
                case 'review': return client.post(`${card()}/review`, withNote({}));
                case 'end': {
                    const endedAt = optionalString(input, 'ended_at');
                    return client.post(`${card()}/end`, withNote(endedAt ? { ended_at: endedAt } : {}));
                }
                case 'link': return client.post(`${card()}/link`, {});
                default: throw new Error(`action is one of ${KYC_CUSTOMER_ACTION_NAMES.join(', ')}.`);
            }
        },
    },
    {
        // → POST /v1/kyc/:org/suspicions; the answer is { id, received } and nothing more.
        name: 'aimeat_kyc_suspicion_mark',
        handler: ({ client }, input) => {
            const customerId = optionalString(input, 'customer_id');
            return client.post(`${base(requiredString(input, 'organism'))}/suspicions`, {
                observation: requiredString(input, 'observation'),
                ...(customerId ? { customer_id: customerId } : {}),
            });
        },
    },
    {
        // → GET or PUT /v1/kyc/:org/settings; the PUT carries only the fields given (the service keeps the rest).
        // → GET /v1/kyc/:org/risk-assessment and GET /v1/kyc/:org/dpia-draft for the two drafts.
        name: 'aimeat_kyc_settings',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            const org = base(requiredString(input, 'organism'));
            const at = `${org}/settings`;
            if (action === 'read') return client.get(at);
            if (action === 'risk_assessment') return client.get(`${org}/risk-assessment`);
            if (action === 'dpia_draft') return client.get(`${org}/dpia-draft`);
            if (action !== 'update') throw new Error(`action is one of ${KYC_SETTINGS_ACTION_NAMES.join(', ')}.`);
            const body: Record<string, unknown> = {};
            for (const key of ['staff', 'officers', 'highRiskCountries'] as const) {
                const list = optionalArray(input, key);
                if (list !== undefined) body[key] = list;
            }
            const reviewMonths = optionalRecord(input, 'reviewMonths');
            if (reviewMonths !== undefined) body.reviewMonths = reviewMonths;
            return client.put(at, body);
        },
    },
];
