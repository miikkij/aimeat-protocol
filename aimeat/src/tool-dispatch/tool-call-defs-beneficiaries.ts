/**
 * @file src/tool-dispatch/tool-call-defs-beneficiaries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Beneficiary splits on the CLI dispatch (`aimeat connect call` and
 *   `POST /local/call/<tool>`): a seller declares who else earns from a sale, releases what accrued
 *   and pays it out; a beneficiary reads its own earnings; the operator approves a beneficiary.
 *   Thin REST proxies over /v1/commerce/beneficiary* (src/routes/commerce-beneficiaries.ts): the
 *   arithmetic, the verification gate and the ledger all stay on the node.
 *
 *   Until 2026-10-12 these six tools had a handler only on the connector MCP
 *   (src/cli/connect/mcp/tools/commerce.ts), so a fleet daemon and crew code could not call them.
 *   The handlers moved here unchanged in what they send; the connector MCP runs them through
 *   dispatch-tools.ts.
 *
 *   Each route address is written out as a literal in its own call, because the field-reach check
 *   matches a tool to its route by the path it calls and a computed path matches nothing.
 * @structure beneficiaryCliTools[] — the handler table, spread by index.ts
 * @usage import { beneficiaryCliTools } from './tool-call-defs-beneficiaries.js';
 * @version-history
 *   2026-10-27 — aimeat_commerce_beneficiary_payout forwards possible_payment_not_arrived (secaudit2026oct26).
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP module (wish: every MCP tool on aimeat connect serve).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

export const beneficiaryCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/commerce/beneficiary-splits — the declared fields, as given. The route validates
        //   the shares and decides whether the split is live or waits for approval.
        name: 'aimeat_commerce_beneficiary_split_set',
        handler: ({ client }, input) => client.post('/v1/commerce/beneficiary-splits', {
            ext: requiredString(input, 'ext'),
            action: requiredString(input, 'action'),
            pool_percent: input.pool_percent,
            beneficiaries: input.beneficiaries,
            dynamic: input.dynamic,
            capability: input.capability,
            state: input.state,
            roles: input.roles,
            mode: input.mode,
        }),
    },
    {
        // → GET /v1/commerce/beneficiary-splits, or DELETE with ?ext=&action= to withdraw one.
        name: 'aimeat_commerce_beneficiary_splits',
        handler: ({ client }, input) => {
            const removeExt = optionalString(input, 'remove_ext');
            const removeAction = optionalString(input, 'remove_action');
            if (removeExt || removeAction) {
                if (!removeExt || !removeAction) {
                    return Promise.resolve({ ok: false as const, error: { code: 'INVALID_INPUT', message: 'withdrawing needs both remove_ext and remove_action' } });
                }
                return client.delete(`/v1/commerce/beneficiary-splits${query({ ext: removeExt, action: removeAction })}`);
            }
            return client.get('/v1/commerce/beneficiary-splits');
        },
    },
    {
        // → GET /v1/commerce/beneficiary/earnings, or /obligations with role "provider".
        name: 'aimeat_commerce_beneficiary_earnings',
        handler: ({ client }, input) => {
            const filter = query({ status: optionalString(input, 'status'), limit: optionalNumber(input, 'limit') });
            if (optionalString(input, 'role') === 'provider') return client.get(`/v1/commerce/beneficiary/obligations${filter}`);
            return client.get(`/v1/commerce/beneficiary/earnings${filter}`);
        },
    },
    {
        // → POST /v1/commerce/beneficiary/release
        name: 'aimeat_commerce_beneficiary_release',
        handler: ({ client }, input) => client.post('/v1/commerce/beneficiary/release', {
            tracking_code: requiredString(input, 'tracking_code'),
            beneficiary: requiredString(input, 'beneficiary'),
        }),
    },
    {
        // → GET /v1/commerce/beneficiary/approvals without a state (read), POST with one (decide).
        name: 'aimeat_commerce_beneficiary_approve',
        handler: ({ client }, input) => {
            const ghii = optionalString(input, 'ghii');
            const state = optionalString(input, 'state');
            if (!state) return client.get(`/v1/commerce/beneficiary/approvals${query({ ghii })}`);
            return client.post('/v1/commerce/beneficiary/approvals', {
                ghii, state, method: input.method, subject: input.subject, evidence: input.evidence,
            });
        },
    },
    {
        // → GET /v1/commerce/beneficiary/payout without a payment (the quote), POST with one (settle).
        name: 'aimeat_commerce_beneficiary_payout',
        handler: ({ client }, input) => {
            const beneficiary = requiredString(input, 'beneficiary');
            const currency = optionalString(input, 'currency');
            const notArrived = optionalString(input, 'possible_payment_not_arrived');
            if (!input.payment && !notArrived) return client.get(`/v1/commerce/beneficiary/payout${query({ beneficiary, currency })}`);
            return client.post('/v1/commerce/beneficiary/payout', {
                beneficiary, currency, ...(notArrived ? { possible_payment_not_arrived: notArrived } : { payment: input.payment }),
            });
        },
    },
];
