/**
 * @file src/services/organism-shape-apply.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gives a new organism the workspaces of a starting shape (data/organism-shapes.ts):
 *   each through services/workspace-provision.ts, the same path POST /v1/organisms/:id/workspaces
 *   and aimeat_workspace_create take, so a shaped workspace is locked, registered and rolled back on
 *   failure exactly like any other. Called from createOrganismRecord, which REST and MCP share.
 * @structure resolveShape(input) · applyOrganismShape(deps, orgId, owner, shape, lang)
 * @usage const created = await applyOrganismShape({ storage, config }, org.id, owner, shape, 'fi');
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (guided journey P5).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ORGANISM_SHAPES, shapeById, shapeWorkspaceInput, type OrganismShape } from '../data/organism-shapes.js';
import { provisionWorkspace } from './workspace-provision.js';
import { logger } from '../utils/logger.js';

export interface ShapedWorkspace { ws: string; name: string }

/**
 * The shape a create call asked for. Undefined when it asked for none; a string error when it named
 * one that does not exist, so the caller can refuse before it writes anything.
 */
export function resolveShape(shape: unknown): OrganismShape | undefined | string {
    if (shape === undefined || shape === null || shape === '') return undefined;
    const found = shapeById(shape);
    return found ?? `Unknown shape "${String(shape)}". The shapes are: ${ORGANISM_SHAPES.map(s => s.id).join(', ')}.`;
}

/**
 * Create the shape's workspaces in an organism that already exists. A workspace that fails is
 * logged and left out; the organism and the workspaces made before it stay, and the answer names
 * what was made, so the caller says the truth rather than "done".
 */
export async function applyOrganismShape(
    deps: { storage: Storage; config: AimeatConfig },
    orgId: string, ownerName: string, shape: OrganismShape, lang: string,
): Promise<ShapedWorkspace[]> {
    const made: ShapedWorkspace[] = [];
    for (let i = 0; i < shape.workspaces.length; i++) {
        const input = shapeWorkspaceInput(shape, i, lang);
        try {
            const result = await provisionWorkspace(deps.storage, deps.config, {
                orgId, ownerName, ownerGhii: `${ownerName}@${deps.config.nodeId}`,
                name: input.name, manifest: input.manifest, schemas: input.schemas, readme: input.readme,
            });
            made.push({ ws: result.ws, name: input.name });
        } catch (err) {
            logger.warn('applyOrganismShape: a workspace of the shape was not created', { orgId, shape: shape.id, index: i, error: String(err) });
        }
    }
    return made;
}
