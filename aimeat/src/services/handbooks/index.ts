/**
 * @file index.ts
 * @description Registry of the v2 per-surface handbooks. Each role has its OWN handbook file (kept
 *   deliberately separate from prompt-defaults.ts and from each other so they never get tangled).
 *   Served via GET /v1/agents/me/handbook/surface/:role and the MCP aimeat_handbook_get(surface=...).
 * @structure SURFACE_HANDBOOKS (role -> markdown) + handbookForRole()
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- Aggregate the 4 v2 surface handbooks
 */
import type { SurfaceRole } from '../../mcp/catalog/surfaces.js';
import { AGENT_HANDBOOK } from './agent.js';
import { APPDEV_HANDBOOK } from './appdev.js';
import { SERVICE_HANDBOOK } from './service.js';
import { ADMIN_HANDBOOK } from './admin.js';

export const SURFACE_HANDBOOKS: Record<SurfaceRole, string> = {
    agent: AGENT_HANDBOOK,
    appdev: APPDEV_HANDBOOK,
    service: SERVICE_HANDBOOK,
    admin: ADMIN_HANDBOOK,
};

/** The operating handbook markdown for a v2 surface role. */
export function handbookForRole(role: SurfaceRole): string {
    return SURFACE_HANDBOOKS[role];
}
