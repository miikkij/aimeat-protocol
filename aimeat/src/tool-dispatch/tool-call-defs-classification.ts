/**
 * @file src/tool-dispatch/tool-call-defs-classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_classification in the CLI dispatch (`aimeat connect call` and
 *   POST /local/call/aimeat_classification). No input of its own: the catalog's input is the
 *   contract, and classificationCall() checks each call against its action's fields before it sends
 *   anything to /v1/classification/*.
 * @structure classificationCliTools
 * @usage import { classificationCliTools } from './tool-call-defs-classification.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { classificationCall } from './classification-call.js';

export const classificationCliTools: ConnectCliToolDefinition[] = [
    {
        // → the node's REST endpoint for the action; see classification-call.ts for the list.
        name: 'aimeat_classification',
        handler: ({ client }, input) => classificationCall(client, input),
    },
];
