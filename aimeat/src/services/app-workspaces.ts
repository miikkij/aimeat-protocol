/**
 * @file services/app-workspaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspaces an app declares it needs, and where an installed copy finds the ones made
 *   for it (docs/specs/package-sale-design.md, section 4; wish
 *   wish-an-app-declares-its-workspace-a-bundle-refers-to-it-and-the-).
 *
 *   THE DECLARATION LIVES IN THE APP'S HTML, as `<script type="application/json" id="aimeat-workspace">`
 *   beside `aimeat-config` and `aimeat-crews`, for the reason app-config.ts gives: every publish
 *   endpoint, the backup, the fork and the package ZIP carry the HTML unchanged. publishApp parses it
 *   and stores it on the manifest as `workspaces`, so the composer reads it without loading the bytes.
 *
 *   THE CONTRACT IS THE JOIN KEY. Apps already find their workspace by a contract string; the
 *   declaration makes that string what the node matches on. Two apps that declare one contract share
 *   one workspace in a set, and two declarations of one contract with different manifests are a
 *   problem the composer names.
 *
 *   WHERE THE INSTALLED APP FINDS IT. An install that creates the workspace writes its ids under
 *   `apps.<filename>.workspaces` in the owner's namespace, public like the app's config, because the
 *   app runs for people who are not its owner and reads the record to know where to look. The ids
 *   are no key to anything: reading the workspace still needs a member's access.
 * @structure
 *   - AppWorkspaceDeclaration · parseAppWorkspaces(html) — the declaration, checked for shape
 *   - checkAppWorkspaces(storage, declarations) — each manifest and schema as provisioning will take it
 *   - appWorkspacesKey() · readAppWorkspaceLinks() · writeAppWorkspaceLinks() — the installed copy's ids
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 4).
 */
import type { Storage } from '../storage/interface.js';
import { checkWorkspaceManifest } from './workspace-provision.js';
import { validateSchemaItself } from './schema-validator.js';
import { emitChange } from './event-bus.js';

export interface AppWorkspaceDeclaration {
    /** What apps match on, e.g. "aimeat.backoffice/1". */
    contract: string;
    /** The name a new workspace gets. */
    name: string;
    manifest: Record<string, unknown>;
    /** Namespace → JSON Schema, locked strict on the workspace's records spaces. */
    schemas?: Record<string, Record<string, unknown>>;
    readme?: string;
}

/** Where one declared contract was made: the organism and the workspace. */
export interface AppWorkspaceLink { organism_id: string; workspace_id: string; name?: string }

const BLOCK_RE = /<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])(?=[^>]*\bid\s*=\s*["']aimeat-workspace["'])[^>]*>([\s\S]*?)<\/script>/i;
/** A manifest with its schemas is larger than a config declaration, and still not megabytes. */
const MAX_BLOCK_BYTES = 128 * 1024;
const MAX_WORKSPACES = 10;
const CONTRACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}(\/[0-9]{1,4})?$/;
const NAMESPACE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The workspaces an app declares, checked for shape. `null` when it declares none; `{ error }` names
 * what is wrong, so publish can refuse with it.
 */
export function parseAppWorkspaces(html: string): { workspaces: AppWorkspaceDeclaration[] } | { error: string } | null {
    const m = BLOCK_RE.exec(html);
    if (!m) return null;
    const raw = (m[1] ?? '').trim();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BLOCK_BYTES) return { error: `the aimeat-workspace block is over ${MAX_BLOCK_BYTES / 1024} kB` };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (err) {
        return { error: `the aimeat-workspace block is not JSON: ${(err as Error).message}` };
    }
    const list = isObject(parsed) ? parsed.workspaces : undefined;
    if (!Array.isArray(list) || list.length === 0) return { error: 'the aimeat-workspace block needs "workspaces": a list with one entry per workspace the app needs' };
    if (list.length > MAX_WORKSPACES) return { error: `an app declares at most ${MAX_WORKSPACES} workspaces` };
    const out: AppWorkspaceDeclaration[] = [];
    const seen = new Set<string>();
    for (const [i, w] of list.entries()) {
        const at = `workspaces[${i}]`;
        if (!isObject(w)) return { error: `${at} is not an object` };
        if (typeof w.contract !== 'string' || !CONTRACT_RE.test(w.contract)) {
            return { error: `${at}.contract is a short name such as "aimeat.backoffice/1": letters, digits, dot, dash, underscore, and an optional /version` };
        }
        if (seen.has(w.contract)) return { error: `${at}.contract "${w.contract}" is declared twice` };
        seen.add(w.contract);
        const name = typeof w.name === 'string' ? w.name.trim() : '';
        if (!name || name.length > 100) return { error: `${at}.name is the workspace's name, 1 to 100 characters` };
        if (!isObject(w.manifest)) return { error: `${at}.manifest is the workspace manifest, an object with objectTypes` };
        let schemas: Record<string, Record<string, unknown>> | undefined;
        if (w.schemas !== undefined) {
            if (!isObject(w.schemas)) return { error: `${at}.schemas is an object of namespace: JSON Schema` };
            schemas = {};
            for (const [ns, s] of Object.entries(w.schemas)) {
                if (!NAMESPACE_RE.test(ns)) return { error: `${at}.schemas."${ns}" is not a namespace name (lower case, digits, dash, underscore)` };
                if (!isObject(s)) return { error: `${at}.schemas."${ns}" is not a JSON Schema object` };
                schemas[ns] = s;
            }
        }
        if (w.readme !== undefined && (typeof w.readme !== 'string' || w.readme.length > 20_000)) return { error: `${at}.readme is text of at most 20000 characters` };
        out.push({ contract: w.contract, name, manifest: w.manifest, ...(schemas ? { schemas } : {}), ...(typeof w.readme === 'string' ? { readme: w.readme } : {}) });
    }
    return { workspaces: out };
}

/**
 * Would provisioning take each declared workspace? The same manifest check an install set runs
 * before it creates anything (workspace-provision.ts), and each schema compiled. Null when it would.
 */
export async function checkAppWorkspaces(storage: Storage, declarations: AppWorkspaceDeclaration[]): Promise<string | null> {
    for (const w of declarations) {
        const why = await checkWorkspaceManifest(storage, 'app-publish-check', w.name, w.manifest);
        if (why) return `the workspace "${w.contract}": ${why}`;
        for (const [ns, s] of Object.entries(w.schemas ?? {})) {
            const bad = validateSchemaItself(s);
            if (bad) return `the workspace "${w.contract}", schema "${ns}": ${bad}`;
        }
    }
    return null;
}

/** Where an installed copy's workspace ids live, in the owner's namespace. */
export function appWorkspacesKey(filename: string): string {
    return `apps.${filename}.workspaces`;
}

/** The workspaces made for an installed app, by contract. Empty when none were. */
export async function readAppWorkspaceLinks(storage: Storage, ownerGhii: string, filename: string): Promise<Record<string, AppWorkspaceLink>> {
    const rec = await storage.getMemory(ownerGhii, appWorkspacesKey(filename));
    const v = rec?.value as { links?: unknown } | undefined;
    if (!isObject(v?.links)) return {};
    const out: Record<string, AppWorkspaceLink> = {};
    for (const [contract, l] of Object.entries(v.links)) {
        if (isObject(l) && typeof l.organism_id === 'string' && typeof l.workspace_id === 'string') {
            out[contract] = { organism_id: l.organism_id, workspace_id: l.workspace_id, ...(typeof l.name === 'string' ? { name: l.name } : {}) };
        }
    }
    return out;
}

/** Add these links to the app's record; a contract linked before is pointed at the new workspace. */
export async function writeAppWorkspaceLinks(storage: Storage, ownerGhii: string, filename: string, links: Record<string, AppWorkspaceLink>): Promise<void> {
    const key = appWorkspacesKey(filename);
    const now = new Date().toISOString();
    const existing = await storage.getMemory(ownerGhii, key);
    const merged = { ...(await readAppWorkspaceLinks(storage, ownerGhii, filename)), ...links };
    await storage.setMemory({
        key, ownerGaii: ownerGhii, value: { spec: 'aimeat.app-workspaces/1', links: merged },
        visibility: 'public', tags: ['app-workspaces'], ttlHours: null,
        version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('apps', ownerGhii);
}
