/**
 * @file src/mcp/calibrator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool aimeat_calibrator: the owner's Prompt Calibrator, one action per
 *   /v1/calibrator route. Each action calls the service function its route calls
 *   (services/calibrator/projects.ts) on the owner's records, with the session's own reader; this
 *   file checks the input and the action's permission word, and decides nothing else.
 * @structure registerCalibratorTools()
 * @usage registerCalibratorTools(mcp, storage, config, caller) — from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { scopeDeniedText } from './scope-denied-answer.js';
import { readerFor } from '../services/classification/reader.js';
import { READ_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';
import { CALIBRATOR_ACTIONS, checkCalibratorInput, calibratorBody } from '../tool-catalog/definitions/calibrator.js';
import {
    calibratorTemplates, listProjects, createProject, getProject, projectDetail, updateProject, deleteProject,
    createVersion, listVersions, getVersion, createBatch, listBatches, getBatch, updateBatch, deleteBatch,
    type CalResult,
} from '../services/calibrator/projects.js';

export function registerCalibratorTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    /** The session's caller: whose records, its reader and its permission words. */
    caller: () => CallerContext,
): void {
    const deps = { storage, config };
    const answer = <T>(out: CalResult<T>) => out.ok
        ? { content: [{ type: 'text' as const, text: JSON.stringify(out.data) }] }
        : { ...toolError(out.code, out.message) };

    mcp.registerTool('aimeat_calibrator', {
        description: descriptionFor('aimeat_calibrator'),
        inputSchema: zodShapeFor('aimeat_calibrator'),
        annotations: annotationsFor('aimeat_calibrator'),
    }, async (args) => {
        // The routes mount only when the calibrator is on (routes-loader.ts); off, they answer 404.
        if (config.calibratorEnabled === false) return { ...toolError('NOT_FOUND', 'The calibrator is switched off on this node.') };
        const a = Object.fromEntries(Object.entries(args as Record<string, unknown>).filter(([, v]) => v !== undefined));
        const checked = checkCalibratorInput(a);
        if (!checked.ok) return { ...toolError('INVALID_INPUT', checked.message) };
        const c = caller();
        // The routes' words: memory:read-as-owner for every action, memory:write-as-owner for a change.
        for (const word of new Set([READ_AS_OWNER_SCOPE, CALIBRATOR_ACTIONS[checked.action].scope])) {
            if (!c.has(word)) {
                return { content: [{ type: 'text' as const, text: scopeDeniedText('aimeat_calibrator', [word], { baseUrl: config.baseUrl, agentGaii: c.principal }) }], isError: true as const };
            }
        }
        // The owner's records, as on the page: an agent works on its owner's calibrations.
        const gaii = c.ownerGhii;
        const reader = readerFor(deps, c.auth);
        const id = String(a.project_id ?? '');
        const batchId = String(a.batch_id ?? '');
        const body = calibratorBody(checked.action, a);
        switch (checked.action) {
            case 'templates': return answer({ ok: true, data: calibratorTemplates() });
            case 'list': return answer(await listProjects(deps, gaii, reader));
            case 'get': return answer(await getProject(deps, gaii, reader, id));
            case 'detail': return answer(await projectDetail(deps, gaii, reader, id));
            case 'versions': return answer(await listVersions(deps, gaii, reader, id));
            case 'version': return answer(await getVersion(deps, gaii, reader, id, String(a.version)));
            case 'batches': return answer(await listBatches(deps, gaii, reader, id, a.version === undefined ? undefined : String(a.version)));
            case 'batch': return answer(await getBatch(deps, gaii, reader, id, batchId));
            case 'create': return answer(await createProject(deps, gaii, body));
            case 'update': return answer(await updateProject(deps, gaii, id, body));
            case 'delete': return answer(await deleteProject(deps, gaii, id));
            case 'version_create': return answer(await createVersion(deps, gaii, id, body));
            case 'batch_create': return answer(await createBatch(deps, gaii, id, body));
            case 'batch_update': return answer(await updateBatch(deps, gaii, id, batchId, body));
            case 'batch_delete': return answer(await deleteBatch(deps, gaii, id, batchId));
            default: return { ...toolError('INVALID_INPUT', `Unknown action "${checked.action}".`) };
        }
    });
}
