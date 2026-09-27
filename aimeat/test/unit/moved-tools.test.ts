/**
 * @file test/unit/moved-tools.test.ts
 * @description The ten tools aimeat_app_manage replaced answer with the call that replaces them: the
 *   message names the action and every field, the names stay out of the catalog, and the CLI command
 *   (`aimeat connect call`) prints TOOL_MOVED as JSON. The node MCP server and aimeat_invoke are
 *   proved end to end by test/e2e-app-manage.ts, the connector MCP and /local/call by
 *   test/e2e-connect-serve-loopback.ts.
 * @usage pnpm test -- moved-tools
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MOVED_TOOLS, movedToolMessage } from '../../src/mcp/catalog/moved-tools.js';
import { APP_MANAGE_ACTIONS } from '../../src/mcp/catalog/definitions/app-manage.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/mcp/catalog/definitions.js';
import { runToolCall } from '../../src/cli/connect/tool-call.js';

afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

describe('the tools that moved', () => {
    it('are the ten, each pointing at an action aimeat_app_manage has', () => {
        expect(Object.keys(MOVED_TOOLS).sort()).toEqual([
            'aimeat_app_audit', 'aimeat_app_legal_set', 'aimeat_app_marks_set', 'aimeat_app_screenshot', 'aimeat_app_seo_set',
            'aimeat_app_ui_get', 'aimeat_app_ui_set', 'aimeat_app_versions', 'aimeat_app_visitors', 'aimeat_app_visitors_measure',
        ]);
        for (const { tool, action } of Object.values(MOVED_TOOLS)) {
            expect(tool).toBe('aimeat_app_manage');
            expect(APP_MANAGE_ACTIONS[action], action).toBeDefined();
        }
    });

    it('are not in the catalog, so tools/list does not carry them', () => {
        const names = new Set(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => d.name));
        for (const old of Object.keys(MOVED_TOOLS)) expect(names.has(old), old).toBe(false);
    });

    it('answer with the action and every field the action takes', () => {
        for (const [old, { action }] of Object.entries(MOVED_TOOLS)) {
            const m = movedToolMessage(old)!;
            expect(m).toContain(`aimeat_app_manage with action "${action}"`);
            for (const f of Object.keys(APP_MANAGE_ACTIONS[action]!.fields)) expect(m, `${old} names ${f}`).toContain(f);
        }
        expect(movedToolMessage('aimeat_app_legal_set')).toContain('ai_provenance');
        expect(movedToolMessage('aimeat_app_versions')).toContain('`owner` is now optional');
        expect(movedToolMessage('aimeat_app_manage')).toBeNull();
    });

    it('`aimeat connect call` prints TOOL_MOVED as JSON and exits 1, without calling the node', async () => {
        const out: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((s: unknown) => { out.push(String(s)); });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await runToolCall('aimeat_app_marks_set', {});
        const printed = JSON.parse(out.join('\n'));
        expect(printed.ok).toBe(false);
        expect(printed.error.code).toBe('TOOL_MOVED');
        expect(printed.error.message).toContain('aimeat_app_manage with action "marks"');
        expect(process.exitCode).toBe(1);
    });
});
