/**
 * @file workspace-create.ts
 * @description aimeat_workspace_create, moved out of mcp/workspaces.ts by pure extraction when that
 *   file passed the 800-line limit. The body is verbatim; only the surrounding function and its
 *   dependency bag are new, following the same shape workspace-members.ts and workspace-transfer.ts
 *   already use.
 * @structure registerWorkspaceCreateTool(mcp, storage, config, deps)
 * @usage import { registerWorkspaceCreateTool } from './workspace-create.js';
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/workspaces.ts (max-file-lines), no behaviour change.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { normalizeObjectTypes, backfillManifestEnvelope, WorkspaceMetaError } from '../services/workspace-meta.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type ObjType = { name: string; namespace?: string; mode?: string };
type Manifest = { name?: string; objectTypes: ObjType[] };

/** The helpers this tool shares with the rest of the workspace surface, passed rather than copied. */
export interface WorkspaceCreateDeps {
    ownerName: string;
    ownerGhii: string;
    writerGaii: string;
    ok: (data: unknown) => TextResult;
    fail: (message: string) => TextResult;
    denyReason: (organismId: string) => Promise<string | null>;
    parseObj: (v: unknown) => unknown;
    wsRoot: (orgId: string, ws: string) => string;
    writeRecord: (key: string, value: unknown, existing: MemoryRecord | null, ownerGaii: string) => Promise<unknown>;
}

export function registerWorkspaceCreateTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    deps: WorkspaceCreateDeps,
): void {
    const { ownerName, ownerGhii, writerGaii, ok, fail, denyReason, parseObj, wsRoot, writeRecord } = deps;

    // ── aimeat_workspace_create ──
    mcp.tool('aimeat_workspace_create', descriptionFor('aimeat_workspace_create'),
        {
            organism_id: z.string(),
            name: z.string().describe('Workspace name'),
            manifest: z.any().describe('The workspace manifest (objectTypes + policy) as a JSON OBJECT, not a string.'),
            schemas: z.any().optional().describe('Map of namespace → JSON Schema for records types, as a JSON OBJECT.'),
            readme: z.string().optional().describe('Optional markdown intro'),
        },
        annotationsFor('aimeat_workspace_create'),
        async ({ organism_id, name, manifest, schemas, readme }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const man = parseObj(manifest) as Manifest | undefined;
            if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) {
                return fail('manifest must be an object with an objectTypes array.');
            }
            // Gate: reject unsupported backings + infer mode from kind BEFORE anything is written,
            // so a misdeclared space fails the very first call instead of becoming invisible data.
            try {
                man.objectTypes = normalizeObjectTypes(man.objectTypes as Array<Record<string, unknown>>) as ObjType[];
            } catch (e) {
                if (e instanceof WorkspaceMetaError) return fail(e.message);
                throw e;
            }
            const schemaMap = (parseObj(schemas) ?? {}) as Record<string, Record<string, unknown>>;
            const wsId = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
            const root = wsRoot(organism_id, wsId);
            const now = new Date().toISOString();
            // 1. Lock the records schemas under the owner GHII (direct storage — bypasses the route's
            //    owner/operator gate, which an agent token would fail).
            for (const [namespace, schema] of Object.entries(schemaMap)) {
                if (!schema || typeof schema !== 'object') continue;
                await storage.setSchema({ keyPattern: `${root}.${namespace}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: ownerGhii, setAt: now, updatedAt: now });
            }
            // 2. Write the manifest (validated against the manifest meta-schema). Backfill the envelope
            //    (manifestVersion/id/name/kind/status) the model routinely omits — so a create with just
            //    objectTypes validates first try instead of bouncing off the required-field check.
            const manifestValue = backfillManifestEnvelope(man as Record<string, unknown>, { orgId: organism_id, fallbackName: name });
            const mkey = `${root}.meta.manifest`;
            const valid = await validateMemoryWrite(mkey, manifestValue, storage);
            if (!valid.valid) return fail('Manifest rejected by schema: ' + JSON.stringify(valid.errors));
            await writeRecord(mkey, manifestValue, null, ownerGhii);          // manifest = creator meta
            // 3. Readme.
            const summary = (man as Record<string, unknown>).summary;
            await writeRecord(`${root}.meta.readme`, readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, null, ownerGhii);
            // 4. Register in the workspace registry.
            const regKey = `organism.${organism_id}.meta.workspaces`;
            const regRec = await storage.getMemory(ownerGhii, regKey);
            const workspaces = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
            await writeRecord(regKey, { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now, createdBy: ownerName }] }, regRec, ownerGhii);
            emitChange('organisms');
            void updateOrganismStructure(storage, config, organism_id, { event: 'workspace created', actor: writerGaii }).catch((err: unknown) => { logger.warn('workspaces: timeline best-effort', { error: String(err) }); });
            return ok({ created: true, ws: wsId, types: man.objectTypes.map(o => o.name), schemas_locked: Object.keys(schemaMap) });
        });
}
