/**
 * @file src/mcp/catalog/definitions/install-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entry for aimeat_admin_install_set: the operator sets up this node from an
 *   install set (install packages, phase 4). The node MCP (src/mcp/admin-install-sets.ts), the
 *   connector (src/cli/connect/mcp/tools/install-sets.ts) and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-admin.ts) all read this description.
 * @structure installSetTools
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const installSetTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_admin_install_set',
        description: 'Operator-only. Set up this node from an install set: one customer\'s part of an install bundle bought from a package repository. The set names the bundle (its group id, and the repository node when it comes from one), the owner user everything is installed for, the other users (each with an email, and join "account" to create the account now with the login link on, or "invite" to send an email invitation), the names of the organisms, the config values, and whether updates apply by themselves. The bundle names the packages, the organisms with their workspaces, and the crew agents. Always run action "plan" first: it writes nothing and lists `problems`, such as a required config value the set does not give; ask the person for each one and put it in the set, or a secret in `secrets`, which is never stored. Then "apply". Applying again creates nothing twice, so it is also how a crew agent that waited for a runner is deployed once the owner has connected one. "list" shows what was applied on this node. Needs the exact permission "operator:admin", which no wildcard carries. The same as POST /v1/install-sets/apply and GET /v1/install-sets.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, enum: ['plan', 'apply', 'list'], description: 'plan: what the set would make, and every problem, writing nothing. apply: make it. list: the sets applied on this node.' },
            install_set: { type: 'object', description: 'For plan and apply: the install set, a JSON object with spec "aimeat.install-set/1".' },
            secrets: { type: 'object', description: 'For plan and apply: secret config values, { <package group id>: { <component id>: { <field>: value } } }. Never stored in the record.' },
        },
    },
];
