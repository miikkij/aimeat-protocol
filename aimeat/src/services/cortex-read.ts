/**
 * @file src/services/cortex-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading one cortex extension: its details (GET /v1/cortex/:name) and its source, the
 *   manifest and lib files (GET /v1/cortex/:name/export). Moved out of routes/cortex.ts so
 *   aimeat_cortex_list can answer `name` and `include_source` with the same code: before, an agent
 *   could replace a cortex (aimeat_cortex_install update: true) but not read what it was replacing.
 * @structure CortexReadRefusal · cortexDetail · cortexSource
 * @usage const out = await cortexDetail(storage, config, caller, name); if (!out.ok) …
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (wish-app-toiminnot-ilman-mcp-ty-kalua-ja-ty-kalujen-m-r-n-hallint).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { canSeeCortex, type CortexCaller } from './cortex-lifecycle.js';
import { listVersions } from './component-versions.js';

export interface CortexReadRefusal { ok: false; status: 403 | 404; code: 'NOT_FOUND' | 'FORBIDDEN'; message: string }

/**
 * One cortex's details, or NOT_FOUND for both "no such cortex" and "not yours to see": a different
 * answer would confirm which private names exist.
 */
export async function cortexDetail(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
    caller: Pick<CortexCaller, 'ownerName' | 'isOperator'>, name: string,
): Promise<{ ok: true; data: Record<string, unknown>; status: string } | CortexReadRefusal> {
    const ext = await storage.getCortexExtension(name);
    if (!ext || !canSeeCortex(caller, ext, config.nodeId)) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Cortex extension not found: ${name}` };
    }
    return {
        ok: true,
        status: ext.status,
        data: {
            name: ext.name,
            namespace: ext.namespace,
            short_name: ext.shortName,
            api_version: ext.apiVersion,
            version: ext.version,
            description: ext.description,
            author: ext.author,
            license: ext.license,
            tags: ext.tags,
            labels: ext.labels,
            aimeat_compat: ext.aimeatCompat,
            status: ext.status,
            visibility: ext.visibility,
            installed_at: ext.installedAt,
            activated_at: ext.activatedAt,
            installed_by: ext.installedBy,
            versions: (await listVersions(storage, 'cortex', name)).map(v => ({ version: v.version, created_at: v.createdAt })),
            components: ext.components.map(c => {
                const base: Record<string, unknown> = { type: c.type };
                if ('name' in c) base.name = c.name;
                if ('filename' in c) base.filename = c.filename;
                if ('exports' in c) base.exports = c.exports;
                if ('api_surface' in c) base.api_surface = c.api_surface;
                if ('key_pattern' in c) base.key_pattern = c.key_pattern;
                if ('apply_to' in c) base.apply_to = c.apply_to;
                return base;
            }),
            activation_artifacts: ext.activationArtifacts,
        },
    };
}

/**
 * A cortex's manifest and lib files, for editing. Only the installing owner or an operator may read
 * it, so nobody can load someone else's extension into an editor to overwrite it.
 */
export async function cortexSource(
    storage: Storage, caller: Pick<CortexCaller, 'ownerName' | 'isOperator'>, name: string,
): Promise<{ ok: true; data: { name: string; status: string; manifest: unknown; libs: Record<string, string> } } | CortexReadRefusal> {
    const ext = await storage.getCortexExtension(name);
    if (!ext) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Cortex extension not found: ${name}` };
    if (ext.installedBy !== caller.ownerName && !caller.isOperator) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not your extension' };
    }
    const libs: Record<string, string> = {};
    for (const comp of ext.components) {
        if (comp.type === 'lib') {
            const content = await storage.getCortexLibFile(name, comp.filename);
            if (content) libs[comp.filename] = content;
        }
    }
    return { ok: true, data: { name: ext.name, status: ext.status, manifest: ext.manifest, libs } };
}
