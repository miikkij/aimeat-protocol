/**
 * @file test/unit/task-request-changes-surface.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description No tool surface offers aimeat_task_request_changes.
 *
 *   POST /v1/agents/:name/tasks/:id/request-changes admits only the owner in person (an agent does
 *   not ask for changes to its own plan; the owner reviews). The tool lived only on `aimeat connect
 *   serve`, which always calls with the agent's identity, so every call answered 403 (feature-list
 *   audit #79). The tool is gone from the catalog and from the CLI dispatch the connector MCP and
 *   /local/call are built from; the route and the task card stay.
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #79).
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/tool-catalog/definitions.js';
import { V2_EXCLUDED } from '../../src/tool-catalog/surfaces.js';

const TOOL = 'aimeat_task_request_changes';

describe('aimeat_task_request_changes (feature-list audit #79)', () => {
    it('has no connector dispatch definition, so neither the connector MCP nor /local/call offers it', () => {
        expect(CONNECT_CLI_TOOLS.some(t => t.name === TOOL)).toBe(false);
    });

    it('has no catalog entry and no surface exclusion left behind', () => {
        expect(CLI_FALLBACK_TOOL_DEFINITIONS.some(t => t.name === TOOL)).toBe(false);
        expect(V2_EXCLUDED).not.toContain(TOOL);
    });
});
