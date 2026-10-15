/**
 * @file src/services/organism-shape-apply.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gives a new organism the workspaces of a starting shape (data/organism-shapes.ts):
 *   each through services/workspace-provision.ts, the same path POST /v1/organisms/:id/workspaces
 *   and aimeat_workspace_create take, so a shaped workspace is locked, registered and rolled back on
 *   failure exactly like any other. Called from createOrganismRecord, which REST and MCP share.
 * @structure resolveShape(input) · applyOrganismShape(deps, orgId, owner, shape, lang) -> { made, notCreated }
 * @usage const { made, notCreated } = await applyOrganismShape({ storage, config }, org.id, owner, shape, 'fi');
 * @version-history
 *   2026-10-15 — applyOrganismShape() answers { made, notCreated }: a workspace of the shape that
 *     failed is named in the answer with its reason, so POST /v1/organisms and aimeat_organism_create
 *     say it in the response instead of only the log (feature-list audit #56).
 *   v1.0.1 — 2026-10-02 — resolveShape() answers { shape } or { error } instead of one value that was
 *     either, so the error's quoted request text never shares a variable with the shape.
 *   v1.0.0 — 2026-10-01 — Initial (guided journey P5).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ORGANISM_SHAPES, shapeById, shapeWorkspaceInput, type OrganismShape } from '../data/organism-shapes.js';
import { provisionWorkspace, WorkspaceProvisionError, WorkspaceMetaError } from './workspace-provision.js';
import { logger } from '../utils/logger.js';

export interface ShapedWorkspace { ws: string; name: string }
/** A workspace of the shape that the node could not create: its name, its place in the shape, why. */
export interface ShapedWorkspaceFailure { name: string; index: number; reason: string }

/**
 * The shape a create call asked for: `shape` from the catalogue, `error` when the call named one that
 * does not exist (so the caller can refuse before it writes anything), neither when it asked for none.
 * The two are separate fields because the error quotes the request: one return value for both let the
 * request's text reach the loop over a shape's workspaces (CodeQL js/loop-bound-injection, alert 1695).
 */
export function resolveShape(shape: unknown): { shape?: OrganismShape; error?: string } {
    if (shape === undefined || shape === null || shape === '') return {};
    const found = shapeById(shape);
    if (found) return { shape: found };
    return { error: `Unknown shape "${String(shape)}". The shapes are: ${ORGANISM_SHAPES.map(s => s.id).join(', ')}.` };
}

/**
 * Create the shape's workspaces in an organism that already exists. A workspace that fails is
 * logged and left out; the organism and the workspaces made before it stay. The answer names what
 * was made AND what was not, so the caller's response says the truth rather than "done": until
 * 2026-10-15 a failed workspace showed only in the log and the create still answered 201 with
 * nothing to tell the caller a workspace was missing (feature-list audit #56).
 */
export async function applyOrganismShape(
    deps: { storage: Storage; config: AimeatConfig },
    orgId: string, ownerName: string, shape: OrganismShape, lang: string,
): Promise<{ made: ShapedWorkspace[]; notCreated: ShapedWorkspaceFailure[] }> {
    const made: ShapedWorkspace[] = [];
    const notCreated: ShapedWorkspaceFailure[] = [];
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
            // A manifest refusal is the provisioning service's own sentence; any other failure (storage)
            // stays in the log, and the caller gets a reason it can act on.
            const reason = err instanceof WorkspaceProvisionError || err instanceof WorkspaceMetaError
                ? err.message
                : 'The node could not save this workspace. Create it again in this organism.';
            notCreated.push({ name: input.name, index: i, reason });
        }
    }
    return { made, notCreated };
}
