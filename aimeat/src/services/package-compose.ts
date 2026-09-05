/**
 * @file services/package-compose.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Building a package out of apps the owner already published, with the cortexes those
 *   apps load, and an honest list of what the receiving node has to supply itself.
 *
 *   WHY THIS EXISTS. A package's components were written by hand: whoever wanted one had to paste
 *   every app's source, name its cortexes and get the dependency order right, which is why the only
 *   packages on this node were the five the node seeds itself. The node already knows what each app
 *   needs — services/dependency-map.ts reads it from the SOURCE at publish time and stores it — so
 *   composing is reading that map rather than asking a person to repeat it.
 *
 *   THREE KINDS OF DEPENDENCY, AND ONLY ONE OF THEM TRAVELS.
 *     · A cortex the OWNER installed is packaged, once, however many of the chosen apps load it.
 *     · A cortex the NODE ships is never packaged. Copying it would give the installed apps a
 *       private second copy of a shared library while the rest of the node keeps using the first.
 *     · A library pack is never packaged. The node serves those from public/lib and src/static, each
 *       with a licences.json entry; copying one makes an operator redistribute a library nothing
 *       declared.
 *     · An extension is not packaged in this slice, whoever owns it. ExtensionRecord keeps no
 *       verbatim manifest, so packaging one means writing a YAML re-serialiser for a format that
 *       carries config values, pricing, permissions and the email policy — a second implementation
 *       whose lossy round trip installs something broken or over-privileged. It is named as an
 *       expectation, and the compose refuses by default rather than shipping a package that cannot
 *       work.
 *
 *   Everything not packaged lands in `expects`, which travels on the package record so a person
 *   reading the offer sees what their node must already have.
 * @structure ComposeExpectations · PackageComposeResult · composePackageFromApps(deps, caller, input)
 * @usage
 *   import { composePackageFromApps } from '../services/package-compose.js';
 *   const out = await composePackageFromApps({ storage, config }, caller, { name, apps });
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, AppRecord } from '../storage/interface.js';
import { requirementsOf, appRef } from './dependency-map.js';
import {
    createPackageGroup, hashContent,
    type PackageWriteResult, type RawComponentInput,
} from './package-create.js';

/** What the installing node must already have, because this package deliberately does not carry it. */
export interface ComposeExpectations {
    /** Cortexes this node ships. Present on every AIMEAT node, so naming them is enough. */
    cortex: string[];
    /** Extensions the apps call. Not packaged in this slice; the installer installs them. */
    extensions: string[];
    /** Library packs the node serves from its own files. */
    packs: string[];
}

export type PackageComposeResult =
    | { ok: true; package: PackageRecord; expects: ComposeExpectations; notes: string[] }
    | { ok: false; status: number; code: string; message: string };

export interface PackageComposeDeps {
    storage: Storage;
    config: AimeatConfig;
}

export interface PackageComposeCaller {
    owner: string;
    sub: string;
    ownerGhii: string;
}

export interface PackageComposeInput {
    name: string;
    /** Filenames of the caller's own published apps, e.g. ["shop.html", "admin.html"]. */
    apps: string[];
    description?: string;
    category?: string;
    tags?: string[];
    visibility?: string;
    status?: string;
    /** Package the owner's own cortexes too. Default true. */
    includeCortex?: boolean;
    /** Compose even when an app calls an extension this package cannot carry. Default false. */
    allowExpectations?: boolean;
}

/** The last path segment of a dependency name, since a cortex ref may carry a namespace. */
function shortCortexName(name: string): string {
    const parts = name.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? name;
}

/** A component id that survives registeredNameFor and reads as itself in a dependency list. */
function cortexComponentId(name: string): string {
    return `cortex-${shortCortexName(name)}`;
}

/**
 * The app manifest fields that travel with a packaged app.
 *
 * Everything absent here is absent on purpose, and PackageAppMeta in storage/types/apps.ts carries
 * the reason for each one.
 */
function appMetaOf(app: AppRecord): Record<string, unknown> {
    const m = app.manifest;
    const meta: Record<string, unknown> = {
        name: m.name,
        description: m.description,
        category: m.category,
        tags: m.tags ?? [],
    };
    if (m.descriptions) meta.descriptions = m.descriptions;
    if (m.version) meta.version = m.version;
    if (m.icon) meta.icon = m.icon;
    if (m.usesCortex?.length) meta.usesCortex = m.usesCortex;
    return { app: meta };
}

/**
 * A cortex as a package component: the manifest AND its lib files.
 *
 * NOT fetchComponentContent, which returns the manifest alone. That shape is for comparing hashes;
 * packaging with it would ship a cortex whose code is missing, and the install would succeed.
 */
async function cortexComponentContent(storage: Storage, name: string): Promise<string | null> {
    const ctx = await storage.getCortexExtension(name);
    if (!ctx) return null;

    const libs: Record<string, string> = {};
    for (const libName of ctx.activationArtifacts?.libFiles ?? []) {
        const content = await storage.getCortexLibFile(name, libName);
        if (content !== null) libs[libName] = content;
    }
    return JSON.stringify({ manifest: ctx.manifest, libs });
}

/**
 * Compose one package from the caller's own apps.
 *
 * Authorisation happened before this call. What is decided HERE is what an authorised caller may
 * PACKAGE: their own apps, and nobody else's, because packaging another person's app is a copy of
 * their work under the copier's name.
 */
export async function composePackageFromApps(
    deps: PackageComposeDeps,
    caller: PackageComposeCaller,
    input: PackageComposeInput,
): Promise<PackageComposeResult> {
    const { storage, config } = deps;
    const includeCortex = input.includeCortex !== false;

    if (!input.name || typeof input.name !== 'string') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'name is required and must be a string' };
    }
    if (!Array.isArray(input.apps) || input.apps.length === 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'apps must be an array with at least 1 filename' };
    }

    const systemGaii = `system@${config.nodeId}`;
    const expects: ComposeExpectations = { cortex: [], extensions: [], packs: [] };
    const notes: string[] = [];
    const appComponents: RawComponentInput[] = [];
    /** cortex component id -> component, so two apps sharing a cortex package it once. */
    const cortexComponents = new Map<string, RawComponentInput>();
    const seenExpect = { cortex: new Set<string>(), extensions: new Set<string>(), packs: new Set<string>() };

    for (const filename of input.apps) {
        if (typeof filename !== 'string' || !filename) {
            return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'every entry in apps must be a filename' };
        }

        const app = await storage.getApp(caller.ownerGhii, filename);
        if (!app) {
            // 404 rather than 403 whether it is missing or somebody else's: the read doors answer the
            // same way, and saying "that is not yours" tells a stranger it exists.
            return { ok: false, status: 404, code: 'NOT_FOUND', message: `You have no app named ${filename}` };
        }

        const source = app.data.toString('utf-8');
        const needs = await requirementsOf(storage, 'app', appRef(caller.owner, filename));
        const dependencies: string[] = [];

        for (const c of needs.cortex) {
            const record = await storage.getCortexExtension(c.name)
                ?? await storage.getCortexExtension(shortCortexName(c.name));

            // Unknown to this node, or shipped by it: named, never copied.
            if (!record || record.installedBy === systemGaii) {
                if (!seenExpect.cortex.has(c.name)) {
                    seenExpect.cortex.add(c.name);
                    expects.cortex.push(c.name);
                }
                continue;
            }
            if (!includeCortex) {
                if (!seenExpect.cortex.has(c.name)) {
                    seenExpect.cortex.add(c.name);
                    expects.cortex.push(c.name);
                }
                continue;
            }

            const id = cortexComponentId(c.name);
            if (!cortexComponents.has(id)) {
                const content = await cortexComponentContent(storage, record.name);
                if (content === null) {
                    return {
                        ok: false, status: 409, code: 'COMPONENT_UNREADABLE',
                        message: `${filename} loads cortex ${c.name}, which could not be read back for packaging`,
                    };
                }
                cortexComponents.set(id, {
                    id,
                    type: 'cortex',
                    label: record.shortName || shortCortexName(c.name),
                    content,
                    contentHash: hashContent(content),
                    dependencies: [],
                });
            }
            if (!dependencies.includes(id)) dependencies.push(id);
        }

        for (const e of needs.extensions) {
            if (!seenExpect.extensions.has(e.name)) {
                seenExpect.extensions.add(e.name);
                expects.extensions.push(e.name);
            }
        }
        for (const p of needs.packs) {
            if (!seenExpect.packs.has(p.name)) {
                seenExpect.packs.add(p.name);
                expects.packs.push(p.name);
            }
        }

        appComponents.push({
            id: filename,
            type: 'app',
            label: app.manifest.name || filename,
            content: source,
            contentHash: hashContent(source),
            dependencies,
            meta: appMetaOf(app),
        });
    }

    if (expects.extensions.length > 0 && input.allowExpectations !== true) {
        return {
            ok: false, status: 400, code: 'EXTENSION_NOT_PACKAGED',
            message: `These apps call extensions this package cannot carry: ${expects.extensions.join(', ')}. `
                + 'Install them on the target node first, then compose again with allow_expectations to record them as requirements.',
        };
    }

    // A cortex registers before the app that names it. sortByDependencies at install time reads this.
    const components: RawComponentInput[] = [...cortexComponents.values(), ...appComponents];

    if (expects.cortex.length > 0) {
        notes.push(`Expects cortexes this node ships: ${expects.cortex.join(', ')}`);
    }
    if (expects.packs.length > 0) {
        notes.push(`Expects library packs the node serves: ${expects.packs.join(', ')}`);
    }
    if (expects.extensions.length > 0) {
        notes.push(`Expects extensions installed separately: ${expects.extensions.join(', ')}`);
    }
    // Said out loud because the omission is otherwise found by the installer, not by the author.
    notes.push('Screenshots, app tools, agent faces, data maps, saved layouts and bound skills stay behind: '
        + 'each is addressed by a filename that only exists once the package is installed.');

    const written: PackageWriteResult = await createPackageGroup(
        { storage, config },
        { owner: caller.owner, sub: caller.sub },
        {
            name: input.name,
            components,
            // A composed package without a description reads as a blank column on every row that
            // ever shows it, and the composer knows something worth saying: which apps are in it.
            // A caller that gave a description keeps it.
            description: input.description?.trim()
                || appComponents.map(c => (c.meta?.app as { name?: string } | undefined)?.name || c.id).join(', '),
            category: input.category,
            tags: input.tags,
            visibility: input.visibility,
            status: input.status,
            changelog: `Made from ${appComponents.length === 1 ? 'the app' : 'the apps'} ${appComponents.map(c => c.id).join(', ')}`,
            manifest: JSON.stringify({ expects }),
        },
    );

    if (!written.ok) return written;
    return { ok: true, package: written.package, expects, notes };
}
