/**
 * @file test/unit/app-tool-invoke-scope.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_tool_invoke declares both scopes its call needs. The tool runs the app tool's
 *   backing extension action with the caller's token, and that route (POST /v1/ext/...) asks ext:invoke
 *   from node 4.0.0 (REST_SCOPE_GATES_ENFORCED_IN). Until 2026-10-13 the tool declared only
 *   exchange:write, so an agent without ext:invoke was offered the tool and then refused by the route.
 *
 *   Checked on the tool catalog, with the running version passed in, as the MCP surface decides it:
 *     - the declared words are exchange:write and ext:invoke;
 *     - at 4.0.0 both decide whether the tool is offered: an agent with both words gets it, an agent
 *       with one of them does not;
 *     - before 4.0.0 only exchange:write decides, and a call without ext:invoke is counted (deferred),
 *       as the extension action route counts it;
 *     - a tool whose `scopeEnforcedFrom` is one release still defers every word together.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tool-invoke-scope.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (wish-aimeat-app-tool-invoke-ilmoittaa-vain-exchange-write-vaikka-).
 */
import { describe, it, expect } from 'vitest';
import {
    requiredScopesForTool, deferredScopesForTool, enforcedScopesForTool, scopeAllowsTool,
} from '../../src/tool-catalog/scopes.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../../src/utils/rest-scope-release.js';

const TOOL = 'aimeat_app_tool_invoke';
const OLD = '3.26.1';
const NEW = '4.0.0';

describe('aimeat_app_tool_invoke declares exchange:write and ext:invoke', () => {
    it('the release that enforces ext:invoke is the REST scope gates release, 4.0.0', () => {
        expect(REST_SCOPE_GATES_ENFORCED_IN).toBe(NEW);
    });

    it('the declared scopes include ext:invoke beside exchange:write', () => {
        expect(requiredScopesForTool(TOOL).sort()).toEqual(['exchange:write', 'ext:invoke']);
    });

    it('at 4.0.0 both words decide: a caller with both is offered the tool, a caller with one is not', () => {
        expect(deferredScopesForTool(TOOL, NEW)).toEqual([]);
        expect(enforcedScopesForTool(TOOL, NEW).sort()).toEqual(['exchange:write', 'ext:invoke']);
        expect(scopeAllowsTool(['exchange:write', 'ext:invoke'], TOOL, NEW)).toBe(true);
        expect(scopeAllowsTool(['exchange:write'], TOOL, NEW)).toBe(false);
        expect(scopeAllowsTool(['ext:invoke'], TOOL, NEW)).toBe(false);
        expect(scopeAllowsTool(['exchange:*', 'ext:*'], TOOL, NEW)).toBe(true);
        expect(scopeAllowsTool(['*'], TOOL, NEW)).toBe(true);
    });

    it('before 4.0.0 only exchange:write decides, and ext:invoke is deferred (counted when missing)', () => {
        expect(deferredScopesForTool(TOOL, OLD)).toEqual(['ext:invoke']);
        expect(enforcedScopesForTool(TOOL, OLD)).toEqual(['exchange:write']);
        expect(scopeAllowsTool(['exchange:write'], TOOL, OLD)).toBe(true);
        expect(scopeAllowsTool(['ext:invoke'], TOOL, OLD)).toBe(false);
        expect(scopeAllowsTool(['exchange:write', 'ext:invoke'], TOOL, OLD)).toBe(true);
    });

    it('a tool with one release for all its words still defers them together', () => {
        // aimeat_workspace_list names organism:read with scopeEnforcedFrom: REST_SCOPE_GATES_ENFORCED_IN.
        expect(deferredScopesForTool('aimeat_workspace_list', OLD)).toEqual(requiredScopesForTool('aimeat_workspace_list'));
        expect(enforcedScopesForTool('aimeat_workspace_list', OLD)).toEqual([]);
        expect(enforcedScopesForTool('aimeat_workspace_list', NEW)).toEqual(requiredScopesForTool('aimeat_workspace_list'));
    });
});
