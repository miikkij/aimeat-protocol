/**
 * @file src/tool-catalog/definitions/secret-addresses.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a vault secret may be sent: set or change its address without the value, and
 *   withdraw an approval the owner gave an extension. The other three secret tools sit in
 *   capabilities-groups-skills.ts, which is at its line ceiling.
 *
 *   ALLOWING IS NOT HERE. A first use the node refused is allowed by the account holder signed in, on
 *   the page whose address the refusal names (POST /v1/secrets/{name}/approvals asks for the owner in
 *   person). Withdrawing only narrows, so secrets:manage is enough for it.
 * @structure secretAddressTools — aimeat_secret_host_set · aimeat_secret_approval_withdraw · aimeat_secret_host_ask
 * @usage imported by tool-catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.2.0 — 2026-10-25 — aimeat_secret_host_ask: the owner's "Ask me before my secret is sent to a
 *     new address for the first time", read and switched (secaudit2026oct22; Jouni, 2026-10-25).
 *   v1.1.0 — 2026-10-21 — aimeat_secret_host_set gives only a FIRST address; changing or removing one
 *     is the owner's in person (secaudit 2026-10, R62).
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const secretAddressTools = [
    {
        name: 'aimeat_secret_host_set',
        description: "Give one secret in your owner's vault its address (host), without the value, when it has none yet. With an address, the secret goes only there, through any extension, from its next call on. Use it when an extension's call was refused because the secret had no address yet: set the address the extension needs, and the call works. Changing or removing an address the secret already has is the owner's own decision, signed in on the Access page: this tool answers IN_PERSON_ONLY for it, and an empty host (remove) too. Needs secrets:manage, which no wildcard carries.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set a Secret\'s Address', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent', 'admin'],
        input: {
            name: { type: 'string', required: true, description: 'The secret, exactly as it was stored.' },
            host: { type: 'string', required: true, description: 'The host it may be sent to, as api.example.com or api.example.com:8443: no https:// and no path. An empty string removes the address.' },
        },
    },
    {
        name: 'aimeat_secret_approval_withdraw',
        description: "Withdraw an approval your owner gave an extension to send one of their secrets to a host, or drop a request still waiting for an answer. aimeat_secret_list shows each secret's approvals (extension, installer, host, approvedAt; an entry without approvedAt is waiting). After this, that extension's next call to that host is refused and asks the owner again. Needs secrets:manage, which no wildcard carries.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Withdraw a Secret Approval', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent', 'admin'],
        input: {
            name: { type: 'string', required: true, description: 'The secret, exactly as it was stored.' },
            extension: { type: 'string', required: true, description: 'The extension the approval names.' },
            installer: { type: 'string', required: true, description: 'The account that installed it, as the approval names it.' },
            host: { type: 'string', required: true, description: 'The host the approval names.' },
        },
    },
    {
        name: 'aimeat_secret_host_ask',
        description: "Your owner's setting \"Ask me before my secret is sent to a new address for the first time\". While it is on (the default), when code you or another of their agents wrote, or an address such an agent set, would send one of their stored secrets to an address it has never gone to, the owner is asked first with one press, unless that agent holds secrets:manage. While it is off, it is sent and the address is kept. Without `on`: the setting, whether the owner chose it, and the node's default. With `on: true`: switched on at once. With `on: false`: switched off at once if you hold secrets:manage; otherwise your owner is asked, the answer carries approval_request (give them its approve_url), and it stays on until they allow it. Change it only when your owner asks.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask Before a Secret Goes Somewhere New', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // GET /v1/ghii/me/secret-host-ask takes memory:read; the PUT takes memory:write, asked by the
        // route the CLI twin calls and by the node MCP handler before it writes.
        scope: 'memory:read',
        surfaces: ['agent', 'service'],
        input: {
            on: { type: 'boolean', description: 'true: ask the owner first; false: do not ask. Omit to read the setting.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
