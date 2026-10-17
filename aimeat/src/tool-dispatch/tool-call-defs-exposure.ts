/**
 * @file src/tool-dispatch/tool-call-defs-exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_exposure_report for the shell / local-call dispatch and the connector MCP: a
 *   thin proxy over GET /v1/exposure/mine (routes/exposure.ts), which decides who may read it. The
 *   tool takes no parameter; test/unit/cli-tool-param-forwarding.test.ts invokes this handler.
 * @structure exposureCliTools[]
 * @usage import { exposureCliTools } from './tool-call-defs-exposure.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.3).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';

export const exposureCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/exposure/mine
    name: 'aimeat_exposure_report',
    handler: ({ client }) => client.get('/v1/exposure/mine'),
  },
];
