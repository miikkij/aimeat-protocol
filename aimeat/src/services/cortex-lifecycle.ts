/**
 * @file src/services/cortex-lifecycle.ts
 * @description Installing, activating, deactivating and uninstalling a cortex extension. One
 *   implementation of each, for the HTTP door and the MCP tool.
 *
 *   WHY THIS FILE EXISTS. Each of those four operations was written out twice, once in
 *   routes/cortex.ts and once in mcp/cortex.ts, and the two copies had drifted into doing
 *   different things under the same name. What the extraction found:
 *
 *   - ACTIVATE. The route calls activateExtension(), which is what a cortex activation IS: the
 *     schemas, prompts, actions, boards and seed-data are materialised and recorded in
 *     activationArtifacts. The tool set status to 'active' and stopped. A cortex an agent
 *     activated reported itself active with none of its components existing, its
 *     activationArtifacts empty, and nothing anywhere saying so.
 *   - DEACTIVATE. The route tears those artifacts down and clears the record of them. The tool
 *     flipped the status back, so a cortex activated over HTTP and deactivated over MCP left its
 *     schemas locked and its actions callable on a node that listed the cortex as off.
 *   - DELETE. The route deactivates first and removes the seed-data memory the cortex created.
 *     The tool removed the record and the lib files, leaving live schemas and seed-data behind
 *     with nothing left pointing at them, because the record naming them was gone.
 *   - INSTALL. The tool refused to write over a cortex belonging to another owner. The route did
 *     not, and it writes lib bytes BEFORE the record, so a same-named install replaced another
 *     owner's served JavaScript and then answered 409 CONFLICT.
 *
 *   None of those four is visible from either file alone, which is the argument for this one: an
 *   operation that exists twice is two operations that happen to share a name.
 *
 *   The two doors still differ on ONE thing, and it is passed in rather than decided here:
 *   whether the caller counts as an operator. HTTP reads the role off the session; the MCP tool
 *   grants it for the namespace claim on install and withholds it on the lifecycle three, on the
 *   ground that an MCP session is an agent and an operator managing somebody else's cortex uses
 *   the HTTP door. That disagreement is real and belongs to the developer, so `isOperator` is a
 *   parameter and neither door's answer is assumed here.
 * @structure
 *   - CortexRefusal / CortexOutcome — the refusal both doors render in their own format
 *   - installCortex() — validate, parse, gate the namespace and the prior owner, write libs, create
 *   - activateCortex() — materialise the components, record the artifacts
 *   - deactivateCortex() — tear them down, preserving seed-data and lib files
 *   - deleteCortex() — deactivate, drop seed-data, drop lib files, drop the record
 * @usage
 *   const out = await installCortex({ storage, config }, caller, { manifest, libs });
 *   if (!out.ok) { res.status(out.refusal.status).json(error(nodeId, out.refusal.code, out.refusal.message)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from routes/cortex.ts and mcp/cortex.ts (August 2026 audit
 *     step 8). The four differences above were what the extraction turned up.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord, CortexActivationArtifacts } from '../storage/interface.js';
import { parseCortexManifest, validateNamespaceOwnership } from './cortex-manifest.js';
import { cortexInstallRefusal } from './install-quotas.js';
import { emitChange } from './event-bus.js';
import { activateExtension, deactivateExtension } from '../routes/cortex/activation.js';

export interface CortexDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** Who is asking. */
export interface CortexCaller {
    /** The bare owner name. `installedBy` holds this, so every ownership check compares against it. */
    ownerName: string;
    /**
     * The acting principal: an owner's bare name, or an agent's GAII. Recorded as the actor on
     * everything an activation materialises (schema locks, prompt and ontology memory, actions,
     * boards), and used again to tear the same things down.
     */
    gaii: string;
    /** May claim any namespace and act on another owner's cortex. Each door decides this itself. */
    isOperator: boolean;
}

/** A refusal, in the terms the HTTP door speaks. The tool renders the code and message as text. */
export interface CortexRefusal {
    status: number;
    code: string;
    message: string;
    /** Manifest parse output, carried on INVALID_MANIFEST so the caller sees what to fix. */
    details?: unknown;
}

export type CortexOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; refusal: CortexRefusal };

function refuse(status: number, code: string, message: string, details?: unknown): { ok: false; refusal: CortexRefusal } {
    return { ok: false, refusal: { status, code, message, details } };
}

export interface CortexInstallResult {
    record: CortexExtensionRecord;
    /** Manifest warnings: unsafe lib patterns, undiscoverable exports. Not a refusal. */
    warnings?: string[];
}

export interface CortexActivationResult {
    /** The record as it stood before the call. */
    extension: CortexExtensionRecord;
    /** When it went active. On an already-active call this is the timestamp it has held since. */
    activatedAt?: string;
    /** What the activation materialised. Absent when nothing ran because it was already active. */
    artifacts?: CortexActivationArtifacts;
    alreadyActive: boolean;
}

export interface CortexDeactivationResult {
    extension: CortexExtensionRecord;
    alreadyInactive: boolean;
}

/**
 * Install a cortex extension from a YAML manifest and its lib sources.
 *
 * Refuses before any write when the manifest is oversized, the node is at its cortex ceiling, a lib
 * is oversized, the manifest does not validate, the namespace belongs to someone else, or the name
 * is already taken by another owner. That last one is a gate about bytes, not about tidiness: lib
 * files are written before the record and are served back as JavaScript from the apex origin, so
 * installing over another owner's name replaces the code their users are running.
 */
export async function installCortex(
    deps: CortexDeps,
    caller: CortexCaller,
    input: { manifest: unknown; libs?: unknown },
): Promise<CortexOutcome<CortexInstallResult>> {
    const { storage, config } = deps;
    const { manifest } = input;

    if (!manifest || typeof manifest !== 'string') {
        return refuse(400, 'INVALID_INPUT', 'manifest is required and must be a YAML string');
    }

    // Manifest size limit (the lib size config doubles as a reasonable upper bound).
    const manifestSizeKb = Buffer.byteLength(manifest, 'utf-8') / 1024;
    if (manifestSizeKb > config.cortexMaxLibSizeKb) {
        return refuse(413, 'MANIFEST_TOO_LARGE',
            `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB`);
    }

    // The node's cortex ceiling, from services/install-quotas.ts.
    const overQuota = await cortexInstallRefusal({ storage, config }, true);
    if (overQuota) return refuse(overQuota.status, overQuota.code, overQuota.message);

    const libs: Record<string, string> = {};
    let hasLibs = false;
    if (input.libs && typeof input.libs === 'object') {
        for (const [filename, content] of Object.entries(input.libs as Record<string, unknown>)) {
            if (typeof content !== 'string') {
                return refuse(400, 'INVALID_INPUT', `libs["${filename}"] must be a string`);
            }
            const sizeKb = Buffer.byteLength(content, 'utf8') / 1024;
            if (sizeKb > config.cortexMaxLibSizeKb) {
                return refuse(413, 'QUOTA_EXCEEDED',
                    `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB`);
            }
            libs[filename] = content;
            hasLibs = true;
        }
    }

    const result = parseCortexManifest(manifest, caller.ownerName, hasLibs ? libs : undefined);
    if (!result.ok || !result.extension) {
        return refuse(400, 'INVALID_MANIFEST', 'Manifest validation failed', {
            errors: result.errors,
            warnings: result.warnings,
        });
    }
    const ext = result.extension;

    // The namespace comes out of the uploaded manifest, and lib files are served as JavaScript from
    // the apex origin, so claiming a namespace you do not own is squatting on someone else's front
    // door. Operators may use any namespace.
    if (!caller.isOperator && !validateNamespaceOwnership(ext.namespace, caller.ownerName)) {
        return refuse(403, 'NAMESPACE_DENIED',
            `You cannot install extensions in namespace "${ext.namespace}". `
            + `Use your own namespace "${caller.ownerName}" or "community".`);
    }

    // A name already held by another owner is refused BEFORE the lib write below. Install never
    // replaces a record (createCortexExtension throws on a collision), but it does replace lib
    // bytes, so without this the refusal arrives after the damage. No operator bypass: an operator
    // gains nothing here except the ability to overwrite those bytes.
    const prior = await storage.getCortexExtension(ext.name);
    if (prior && prior.installedBy !== caller.ownerName) {
        return refuse(403, 'FORBIDDEN', 'Not your extension');
    }

    for (const [filename, content] of Object.entries(libs)) {
        await storage.setCortexLibFile(ext.name, filename, content);
    }

    let record: CortexExtensionRecord;
    try {
        record = await storage.createCortexExtension(ext);
    } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg.includes('already exists')) {
            return refuse(409, 'CONFLICT', `Extension "${ext.name}" is already installed`);
        }
        throw e;
    }

    emitChange('cortex');
    return { ok: true, value: { record, warnings: result.warnings } };
}

/**
 * Activate a cortex: materialise its components and record what was created.
 *
 * The artifacts list is the only record of what activation put on the node, and deactivation and
 * uninstall both read it to know what to remove. Flipping the status without it produces a cortex
 * that claims to be active with nothing behind it, and a later teardown with nothing to find.
 */
export async function activateCortex(
    deps: CortexDeps,
    caller: CortexCaller,
    name: string,
): Promise<CortexOutcome<CortexActivationResult>> {
    const { storage, config } = deps;

    const ext = await storage.getCortexExtension(name);
    if (!ext) return refuse(404, 'NOT_FOUND', `Cortex extension not found: ${name}`);
    if (ext.installedBy !== caller.ownerName && !caller.isOperator) {
        return refuse(403, 'FORBIDDEN', 'Not your extension');
    }

    if (ext.status === 'active') {
        emitChange('cortex');
        return { ok: true, value: { extension: ext, activatedAt: ext.activatedAt, alreadyActive: true } };
    }

    const artifacts = await activateExtension(ext, config, storage, caller.gaii);
    const activatedAt = new Date().toISOString();
    await storage.updateCortexExtension(name, {
        status: 'active',
        activatedAt,
        activationArtifacts: artifacts,
    });

    emitChange('cortex');
    return { ok: true, value: { extension: ext, activatedAt, artifacts, alreadyActive: false } };
}

/**
 * Deactivate a cortex: remove the schemas, prompts, ontologies, actions and boards it materialised,
 * and clear the record of them. Seed-data and lib files survive a deactivation, so their entries
 * are carried forward; uninstall is what removes those.
 */
export async function deactivateCortex(
    deps: CortexDeps,
    caller: CortexCaller,
    name: string,
): Promise<CortexOutcome<CortexDeactivationResult>> {
    const { storage } = deps;

    const ext = await storage.getCortexExtension(name);
    if (!ext) return refuse(404, 'NOT_FOUND', `Cortex extension not found: ${name}`);
    if (ext.installedBy !== caller.ownerName && !caller.isOperator) {
        return refuse(403, 'FORBIDDEN', 'Not your extension');
    }

    if (ext.status === 'inactive') {
        emitChange('cortex');
        return { ok: true, value: { extension: ext, alreadyInactive: true } };
    }

    await deactivateExtension(ext, storage, caller.gaii);

    await storage.updateCortexExtension(name, {
        status: 'inactive',
        activatedAt: undefined,
        activationArtifacts: {
            schemaKeys: [],
            promptKeys: [],
            actionIds: [],
            boardIds: [],
            seedDataKeys: ext.activationArtifacts.seedDataKeys,  // preserve
            ontologyKeys: [],
            libFiles: ext.activationArtifacts.libFiles,  // preserve
        },
    });

    emitChange('cortex');
    return { ok: true, value: { extension: ext, alreadyInactive: false } };
}

/**
 * Uninstall a cortex: tear down an active one, delete the seed-data memory it wrote, delete its lib
 * files, delete the record. Seed-data is removed under `installedBy`, the identity it was created
 * with when the installing owner activated it.
 */
export async function deleteCortex(
    deps: CortexDeps,
    caller: CortexCaller,
    name: string,
): Promise<CortexOutcome<{ name: string }>> {
    const { storage } = deps;

    const ext = await storage.getCortexExtension(name);
    if (!ext) return refuse(404, 'NOT_FOUND', `Cortex extension not found: ${name}`);
    if (ext.installedBy !== caller.ownerName && !caller.isOperator) {
        return refuse(403, 'FORBIDDEN', 'Not your extension');
    }

    if (ext.status === 'active') {
        await deactivateExtension(ext, storage, caller.gaii);
    }

    // Uninstall removes seed-data; deactivation deliberately does not.
    for (const key of ext.activationArtifacts.seedDataKeys) {
        await storage.deleteMemory(ext.installedBy, key);
    }

    for (const comp of ext.components) {
        if (comp.type === 'lib') {
            await storage.deleteCortexLibFile(name, comp.filename);
        }
    }

    await storage.deleteCortexExtension(name);

    emitChange('cortex');
    return { ok: true, value: { name } };
}
