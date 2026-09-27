/**
 * @file src/cli/connect/tool-call-defs-app-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage in the CLI dispatch (`aimeat connect call` and
 *   POST /local/call/aimeat_app_manage). No input of its own: the catalog's input is the contract,
 *   and appManageCall() checks each call against its action's fields before it sends anything.
 * @structure appManageCliTools
 * @usage import { appManageCliTools } from './tool-call-defs-app-manage.js';
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { appManageCall } from './app-manage-call.js';

export const appManageCliTools: ConnectCliToolDefinition[] = [
    {
        // → the node's REST endpoint for the action; see app-manage-call.ts for the list.
        name: 'aimeat_app_manage',
        handler: ({ client, config }, input) => appManageCall(client, config.owner, input),
    },
];
