/**
 * @file src/tool-dispatch/tool-call-defs-exchange-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Acting on the EXCHANGE on the CLI dispatch (`aimeat connect call` and
 *   `POST /local/call/<tool>`): call a published app tool, start, deliver and list contracted work,
 *   and read and decide proposals. Thin REST proxies over the app-tool invoke route
 *   (src/routes/webmcp.ts), /v1/exchange/work (src/routes/exchange-agent-work.ts) and
 *   /v1/exchange/proposals (src/routes/exchange.ts): the contract check, the metering and the
 *   charge stay on the node. The node MCP twins are in src/mcp/exchange-run.ts.
 *
 *   Until 2026-10-12 these six tools had a handler only on the connector MCP
 *   (src/cli/connect/mcp/tools/exchange.ts), so a fleet daemon and crew code could not call them.
 *   The handlers moved here unchanged in what they send; the connector MCP runs them through
 *   dispatch-tools.ts.
 * @structure exchangeRunCliTools[] — the handler table, spread by index.ts
 * @usage import { exchangeRunCliTools } from './tool-call-defs-exchange-run.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP module (wish: every MCP tool on aimeat connect serve).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, withProvenanceFields } from './tool-call-helpers.js';

export const exchangeRunCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/apps/:owner/:filename/webmcp/tools/:tool — the route decides the caller, the
        //   contract, the pacing and the price.
        name: 'aimeat_app_tool_invoke',
        handler: ({ client }, input) => {
            const owner = requiredString(input, 'owner');
            const o = owner.split('@')[0];
            return client.post(
                `/v1/apps/${encodeURIComponent(o)}/${encodeURIComponent(requiredString(input, 'app'))}/webmcp/tools/${encodeURIComponent(requiredString(input, 'tool'))}`,
                { input: input.input ?? {} },
            );
        },
    },
    {
        // → POST /v1/exchange/work — start one piece of contracted work on an offering.
        name: 'aimeat_exchange_work',
        handler: ({ client }, input) => {
            const body: JsonObject = { offering_id: requiredString(input, 'offering_id') };
            if (input.input) body.input = input.input;
            const note = optionalString(input, 'note'); if (note) body.note = note;
            return client.post('/v1/exchange/work', body);
        },
    },
    {
        // → POST /v1/exchange/work/:id/deliver — the route records ai_provenance and
        //   ai_provenance_id and names the record on the work it answers (a recorded-by-route
        //   carrier in ai-provenance-carry.ts), so both go in the body.
        name: 'aimeat_exchange_work_deliver',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            if (input.output !== undefined) body.output = input.output;
            const note = optionalString(input, 'note'); if (note) body.note = note;
            return client.post(
                `/v1/exchange/work/${encodeURIComponent(requiredString(input, 'work_id'))}/deliver`,
                withProvenanceFields(body, input),
            );
        },
    },
    {
        // → GET /v1/exchange/work — the caller's work, as consumer or as provider.
        name: 'aimeat_exchange_work_list',
        handler: ({ client }, input) => {
            const role = optionalString(input, 'role');
            return client.get(`/v1/exchange/work${role ? `?role=${encodeURIComponent(role)}` : ''}`);
        },
    },
    {
        // → GET /v1/exchange/proposals
        name: 'aimeat_exchange_proposals',
        input: {},
        handler: ({ client }) => client.get('/v1/exchange/proposals'),
    },
    {
        // → POST /v1/exchange/proposals/:id/accept, /decline or /withdraw. The three addresses are
        //   written out because the field-reach check matches a tool to its route by the path it calls.
        name: 'aimeat_exchange_proposal_decide',
        handler: ({ client }, input) => {
            const id = encodeURIComponent(requiredString(input, 'proposal_id'));
            const decision = requiredString(input, 'decision');
            if (decision === 'accept') return client.post(`/v1/exchange/proposals/${id}/accept`, {});
            if (decision === 'decline') return client.post(`/v1/exchange/proposals/${id}/decline`, {});
            if (decision === 'withdraw') return client.post(`/v1/exchange/proposals/${id}/withdraw`, {});
            throw new Error('decision must be accept, decline or withdraw');
        },
    },
];
