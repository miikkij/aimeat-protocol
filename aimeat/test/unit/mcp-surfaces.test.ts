/**
 * @file mcp-surfaces.test.ts
 * @description Unit tests for the v2 MCP surface registry (src/mcp/catalog/surfaces.ts). Asserts the
 *   role allowlists are catalog-valid, every catalog tool is placed (or explicitly excluded), and the
 *   purpose boundaries hold (e.g. agent has no marketplace tools, appdev is build-only).
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit v2 S1
 */
import { describe, it, expect } from 'vitest';
import { MCP_SURFACES, toolsForSurface, validateSurfaces, V2_EXCLUDED, V2_ROLES, isV2Role } from '../../src/mcp/catalog/surfaces.js';

describe('v2 MCP surfaces', () => {
    it('every surface tool exists in the catalog and every catalog tool is placed or excluded', () => {
        const { unknownTools, uncovered } = validateSurfaces();
        expect(unknownTools).toEqual([]);
        expect(uncovered).toEqual([]); // nothing forgotten
    });

    it('instance_* is excluded from every v2 surface', () => {
        for (const role of V2_ROLES) {
            for (const inst of V2_EXCLUDED) {
                expect(toolsForSurface(role).has(inst)).toBe(false);
            }
        }
    });

    it('appdev is build-focused: has component tools, no memory/task/board', () => {
        const s = toolsForSurface('appdev');
        expect(s.has('aimeat_app_publish')).toBe(true);
        expect(s.has('aimeat_extension_install')).toBe(true);
        expect(s.has('aimeat_cortex_install')).toBe(true);
        expect(s.has('aimeat_handbook_get')).toBe(true);
        expect(s.has('aimeat_memory_write')).toBe(false);
        expect(s.has('aimeat_task_create')).toBe(false);
        expect(s.has('aimeat_board_read')).toBe(false);
    });

    it('agent is owner-facing: memory/task/message/knowledge + board_read, but no marketplace or admin', () => {
        const s = toolsForSurface('agent');
        expect(s.has('aimeat_memory_write')).toBe(true);
        expect(s.has('aimeat_task_create')).toBe(true);
        expect(s.has('aimeat_message_send')).toBe(true);
        expect(s.has('aimeat_knowledge_contribute')).toBe(true);
        expect(s.has('aimeat_capabilities_invoke')).toBe(true);
        expect(s.has('aimeat_board_read')).toBe(true);     // watches the marketplace
        expect(s.has('aimeat_board_post')).toBe(false);    // but does not post
        expect(s.has('aimeat_work_inbox')).toBe(false);    // no marketplace work
        expect(s.has('aimeat_wallet_balance')).toBe(false);
        expect(s.has('aimeat_consent_grant')).toBe(false); // governance = admin
        expect(s.has('aimeat_admin_stats')).toBe(false);
    });

    it('service is marketplace/provider: board/work/wallet/capabilities-provide, no task/message', () => {
        const s = toolsForSurface('service');
        expect(s.has('aimeat_board_post')).toBe(true);
        expect(s.has('aimeat_work_deliver')).toBe(true);
        expect(s.has('aimeat_wallet_balance')).toBe(true);
        expect(s.has('aimeat_capabilities_create')).toBe(true);
        expect(s.has('aimeat_catalogue_search')).toBe(true);
        expect(s.has('aimeat_task_create')).toBe(false);
        expect(s.has('aimeat_message_send')).toBe(false);
        expect(s.has('aimeat_consent_grant')).toBe(false);
    });

    it('admin is governance: admin/flag/group/consent + owner agent-mgmt only', () => {
        const s = toolsForSurface('admin');
        expect(s.has('aimeat_admin_mint')).toBe(true);
        expect(s.has('aimeat_flag_report')).toBe(true);
        expect(s.has('aimeat_group_create')).toBe(true);
        expect(s.has('aimeat_consent_grant')).toBe(true);
        expect(s.has('aimeat_agent_mode_set')).toBe(true);
        expect(s.has('aimeat_memory_write')).toBe(false);
    });

    it('isV2Role guards unknown roles', () => {
        expect(isV2Role('agent')).toBe(true);
        expect(isV2Role('nonsense')).toBe(false);
    });

    it('surface sizes are in the expected ballpark', () => {
        expect(MCP_SURFACES.appdev.length).toBe(20);
        expect(MCP_SURFACES.agent.length).toBe(45); // task_request_changes omitted (connector-only); message_history included
        expect(MCP_SURFACES.service.length).toBe(52);
        expect(MCP_SURFACES.admin.length).toBe(15);
    });
});
