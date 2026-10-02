/**
 * @file services/install-set-spec.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two documents that set up a customer node, parsed and checked before anything is
 *   written: the install bundle and the install set.
 *
 *   THE SPLIT IS JOUNI'S (2026-09-28, wish-asennuspaketit-uusille-nodeille-ja-keskitetty-
 *   pakettireposit). The INSTALL BUNDLE is the product, the same for every customer who buys it: which
 *   packages, which organism skeletons with their workspaces, which crew agents, and the default
 *   config. The INSTALL SET is one customer node's own part: which bundle, the owner user, the other
 *   users with their roles, the organism names, the config values and whether updates apply by
 *   themselves.
 *
 *   THE BUNDLE IS ITSELF A PACKAGE (decision 14). Its manifest is the content of one `memory`
 *   component whose JSON carries `spec: "aimeat.install-bundle/1"`, so a bundle is versioned, signed,
 *   entitled, pulled and updated by the code every other package uses, and installing it leaves the
 *   bundle record in the owner's memory as the account of what the node was set up from.
 *
 *   EVERY USER HAS AN EMAIL (decision 13). A user joins either by an email invitation or by an account
 *   created at install; the person then signs in by a login link, Google, Entra or any other method
 *   the node offers, which all find the account by its verified email.
 *
 *   NO SECRET TRAVELS IN EITHER FILE. A secret config value is given to the apply call, never written
 *   in the install set, and the apply record keeps only which fields were given.
 * @structure BUNDLE_SPEC · INSTALL_SET_SPEC · InstallBundle · InstallSet · parseInstallBundle() ·
 *   parseInstallSet() · parseGroupConfig() · bundleOfPackage() · bundleOfComponents()
 * @usage
 *   const set = parseInstallSet(body.install_set);
 *   if (!set.ok) return refusal(set.message);
 * @version-history
 *   v1.1.0 — 2026-10-02 — A bundle workspace may name the `contract` its apps declare (package sale
 *     design, phase 4: the set composer writes it, and the install links the apps to the workspace).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import type { PackageRecord } from '../storage/interface.js';

export const BUNDLE_SPEC = 'aimeat.install-bundle/1';
export const INSTALL_SET_SPEC = 'aimeat.install-set/1';

const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** The shape of an account name; apply asks validateOwnerName (utils/gaii.ts) for the reserved ones. */
const NAME_RE = /^[a-z0-9-]{3,64}$/;
const NAME_RULE = '3 to 64 lowercase letters, digits and hyphens';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 50;

export type PackageMode = 'managed' | 'editable';
export type JoinMethod = 'invite' | 'account';
export type OrganismRole = 'admin' | 'member';
export type WorkspaceRole = 'viewer' | 'contributor';

export interface BundlePackage {
    groupId: string;
    mode: PackageMode;
    /** Default config per component id, as the install's `config` input takes it. */
    config: Record<string, Record<string, unknown>>;
}

/**
 * A workspace the bundle creates. `manifest`, `schemas` and `readme` are what aimeat_workspace_create
 * takes, and the manifest names at least one object type.
 */
export interface BundleWorkspace {
    key: string;
    name: string;
    manifest: Record<string, unknown>;
    schemas?: Record<string, Record<string, unknown>>;
    readme?: string;
    /**
     * The contract an app declares for this workspace (services/app-workspaces.ts). The install
     * tells every installed app that declares it where the workspace is.
     */
    contract?: string;
}
export interface BundleOrganism { key: string; name: string; description?: string; workspaces: BundleWorkspace[] }
/** A crew agent an app of the bundle declares, deployed through the owner's runner agent. */
export interface BundleAgent { groupId: string; app: string; agent: string; organism?: string }

export interface InstallBundle {
    name: string;
    packages: BundlePackage[];
    organisms: BundleOrganism[];
    agents: BundleAgent[];
}

export interface InstallSetMembership { organism: string; role: OrganismRole; workspaces: Array<{ key: string; role: WorkspaceRole }> }

export interface InstallSetUser {
    email: string;
    /** The account name to create when `join` is `account`; derived from the email when absent. */
    name?: string;
    displayName?: string;
    join: JoinMethod;
    memberships: InstallSetMembership[];
}

export interface InstallSet {
    bundle: { groupId: string; nodeId?: string; version?: string };
    /**
     * The repository node, with its address and public key, for a node that is not yet linked to
     * it: the apply adds it as an active peer under that key. The key comes from the set's author,
     * never from the repository itself.
     */
    repository?: { nodeId: string; url: string; publicKey: string };
    owner: { name: string; email: string; displayName?: string };
    members: InstallSetUser[];
    /** The customer's own organism names, by the bundle's organism key. */
    organismNames: Record<string, string>;
    /** Config per package group, then per component id; merged over the bundle's defaults. */
    config: Record<string, Record<string, Record<string, unknown>>>;
    autoUpdate: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);

class SpecError extends Error {}
const fail = (message: string): never => { throw new SpecError(message); };

function list(v: unknown, where: string): unknown[] {
    if (v === undefined) return [];
    if (!Array.isArray(v)) fail(`${where} is a list.`);
    const items = v as unknown[];
    if (items.length > MAX_ITEMS) fail(`${where} has more than ${MAX_ITEMS} items.`);
    return items;
}

function configMap(v: unknown, where: string): Record<string, Record<string, unknown>> {
    if (v === undefined) return {};
    if (!isObj(v)) fail(`${where} is an object keyed by component id.`);
    const out: Record<string, Record<string, unknown>> = {};
    for (const [component, values] of Object.entries(v as Obj)) {
        if (!isObj(values)) fail(`${where}.${component} is an object of field values.`);
        out[component] = values as Obj;
    }
    return out;
}

function groupIdOf(v: unknown, where: string): string {
    const g = str(v, 300);
    if (!g || !g.includes('::')) fail(`${where} is a package group id such as "crm::acme".`);
    return g as string;
}

function run<T>(fn: () => T): Parsed<T> {
    try { return { ok: true, value: fn() }; } catch (err) {
        if (err instanceof SpecError) return { ok: false, message: err.message };
        throw err;
    }
}

/** Parse a bundle document. Keys are unique, and every agent names a package the bundle lists. */
export function parseInstallBundle(raw: unknown): Parsed<InstallBundle> {
    return run(() => {
        if (!isObj(raw) || raw.spec !== BUNDLE_SPEC) fail(`An install bundle carries spec "${BUNDLE_SPEC}".`);
        const doc = raw as Obj;
        const name = str(doc.name) ?? fail('The bundle has a name.');
        const packages = list(doc.packages, 'packages').map((p, i): BundlePackage => {
            if (!isObj(p)) fail(`packages[${i}] is an object.`);
            const o = p as Obj;
            const mode = o.mode === undefined ? 'managed' : o.mode;
            if (mode !== 'managed' && mode !== 'editable') fail(`packages[${i}].mode is "managed" or "editable".`);
            return { groupId: groupIdOf(o.group_id, `packages[${i}].group_id`), mode: mode as PackageMode, config: configMap(o.config, `packages[${i}].config`) };
        });
        if (new Set(packages.map(p => p.groupId)).size !== packages.length) fail('A package is listed twice.');
        const orgKeys = new Set<string>();
        const organisms = list(doc.organisms, 'organisms').map((g, i): BundleOrganism => {
            if (!isObj(g)) fail(`organisms[${i}] is an object.`);
            const o = g as Obj;
            const key = str(o.key, 40);
            if (!key || !KEY_RE.test(key)) fail(`organisms[${i}].key is lowercase letters, digits and hyphens.`);
            if (orgKeys.has(key as string)) fail(`Organism key "${key}" is used twice.`);
            orgKeys.add(key as string);
            const wsKeys = new Set<string>();
            const workspaces = list(o.workspaces, `organisms[${i}].workspaces`).map((w, j): BundleWorkspace => {
                if (!isObj(w)) fail(`organisms[${i}].workspaces[${j}] is an object.`);
                const wo = w as Obj;
                const wkey = str(wo.key, 40);
                if (!wkey || !KEY_RE.test(wkey)) fail(`organisms[${i}].workspaces[${j}].key is lowercase letters, digits and hyphens.`);
                if (wsKeys.has(wkey as string)) fail(`Workspace key "${wkey}" is used twice in organism "${key}".`);
                wsKeys.add(wkey as string);
                // A workspace holds at least one object type, so its manifest is required; the
                // apply checks it against the manifest meta-schema before it writes anything.
                if (!isObj(wo.manifest)) fail(`Workspace "${wkey}": manifest is required, an object with an objectTypes list of at least one type.`);
                if (wo.schemas !== undefined && !isObj(wo.schemas)) fail(`Workspace "${wkey}": schemas is an object of JSON Schemas by namespace.`);
                const readme = str(wo.readme, 20000);
                if (wo.contract !== undefined && !str(wo.contract, 100)) fail(`Workspace "${wkey}": contract is the name apps declare for it, such as "aimeat.backoffice/1".`);
                const contract = str(wo.contract, 100);
                return {
                    key: wkey as string, name: str(wo.name) ?? fail(`Workspace "${wkey}" has a name.`),
                    manifest: wo.manifest as Obj,
                    ...(isObj(wo.schemas) ? { schemas: wo.schemas as Record<string, Record<string, unknown>> } : {}),
                    ...(readme ? { readme } : {}),
                    ...(contract ? { contract } : {}),
                };
            });
            return { key: key as string, name: str(o.name) ?? fail(`Organism "${key}" has a name.`), ...(str(o.description, 2000) ? { description: str(o.description, 2000) } : {}), workspaces };
        });
        const agents = list(doc.agents, 'agents').map((a, i): BundleAgent => {
            if (!isObj(a)) fail(`agents[${i}] is an object.`);
            const o = a as Obj;
            const groupId = groupIdOf(o.group_id, `agents[${i}].group_id`);
            if (!packages.some(p => p.groupId === groupId)) fail(`agents[${i}] names package "${groupId}", which the bundle does not list.`);
            const app = str(o.app, 100) ?? fail(`agents[${i}].app is the id of an app component in that package.`);
            const agent = str(o.agent, 100) ?? fail(`agents[${i}].agent is the name of a crew agent the app declares.`);
            const organism = str(o.organism, 40);
            if (organism && !orgKeys.has(organism)) fail(`agents[${i}] runs in organism "${organism}", which the bundle does not have.`);
            return { groupId, app: app as string, agent: agent as string, ...(organism ? { organism } : {}) };
        });
        return { name: name as string, packages, organisms, agents };
    });
}

function membershipsOf(v: unknown, where: string, bundle: InstallBundle | null): InstallSetMembership[] {
    return list(v, where).map((m, i): InstallSetMembership => {
        if (!isObj(m)) fail(`${where}[${i}] is an object.`);
        const o = m as Obj;
        const organism = str(o.organism, 40) ?? fail(`${where}[${i}].organism is an organism key of the bundle.`);
        const org = bundle?.organisms.find(g => g.key === organism);
        if (bundle && !org) fail(`${where}[${i}] names organism "${organism}", which the bundle does not have.`);
        const role = o.role === undefined ? 'member' : o.role;
        if (role !== 'admin' && role !== 'member') fail(`${where}[${i}].role is "admin" or "member".`);
        const workspaces = list(o.workspaces, `${where}[${i}].workspaces`).map((w, j) => {
            const wo = typeof w === 'string' ? { key: w } : w;
            if (!isObj(wo)) fail(`${where}[${i}].workspaces[${j}] is a workspace key, or { key, role }.`);
            const key = str((wo as Obj).key, 40) ?? fail(`${where}[${i}].workspaces[${j}] names a workspace key.`);
            if (org && !org.workspaces.some(x => x.key === key)) fail(`Organism "${organism}" has no workspace "${key}".`);
            const wrole = (wo as Obj).role === undefined ? 'contributor' : (wo as Obj).role;
            if (wrole !== 'viewer' && wrole !== 'contributor') fail(`${where}[${i}].workspaces[${j}].role is "viewer" or "contributor".`);
            return { key: key as string, role: wrole as WorkspaceRole };
        });
        return { organism: organism as string, role: role as OrganismRole, workspaces };
    });
}

/**
 * Parse an install set. With `bundle`, every organism and workspace it names is checked against the
 * bundle; without it only the shape is checked (the bundle is not fetched yet).
 */
export function parseInstallSet(raw: unknown, bundle: InstallBundle | null = null): Parsed<InstallSet> {
    return run(() => {
        if (!isObj(raw) || raw.spec !== INSTALL_SET_SPEC) fail(`An install set carries spec "${INSTALL_SET_SPEC}".`);
        const doc = raw as Obj;
        if (!isObj(doc.bundle)) fail('bundle is { group_id, node_id?, version? }.');
        const b = doc.bundle as Obj;
        const nodeId = str(b.node_id, 120);
        const version = str(b.version, 60);
        if (!isObj(doc.owner)) fail('owner is { name, email, display_name? }.');
        const ow = doc.owner as Obj;
        const ownerName = str(ow.name, 64);
        if (!ownerName || !NAME_RE.test(ownerName)) fail(`owner.name is an account name: ${NAME_RULE}.`);
        const ownerEmail = str(ow.email, 254);
        if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) fail('owner.email is required: every user has an email.');
        const seen = new Set<string>([(ownerEmail as string).toLowerCase()]);
        const members = list(doc.members, 'members').map((u, i): InstallSetUser => {
            if (!isObj(u)) fail(`members[${i}] is an object.`);
            const o = u as Obj;
            const email = str(o.email, 254);
            if (!email || !EMAIL_RE.test(email)) fail(`members[${i}].email is required: every user has an email.`);
            const lower = (email as string).toLowerCase();
            if (seen.has(lower)) fail(`${email} is listed twice.`);
            seen.add(lower);
            const join = o.join === undefined ? 'invite' : o.join;
            if (join !== 'invite' && join !== 'account') fail(`members[${i}].join is "invite" (an email invitation) or "account" (created now).`);
            const name = str(o.name, 64);
            if (name && !NAME_RE.test(name)) fail(`members[${i}].name is an account name: ${NAME_RULE}.`);
            const displayName = str(o.display_name, 100);
            return {
                email: email as string, join: join as JoinMethod,
                ...(name ? { name } : {}), ...(displayName ? { displayName } : {}),
                memberships: membershipsOf(o.memberships, `members[${i}].memberships`, bundle),
            };
        });
        const organismNames: Record<string, string> = {};
        if (doc.organism_names !== undefined) {
            if (!isObj(doc.organism_names)) fail('organism_names is an object: { <organism key>: "<name>" }.');
            for (const [k, v] of Object.entries(doc.organism_names as Obj)) {
                if (bundle && !bundle.organisms.some(g => g.key === k)) fail(`organism_names names "${k}", which the bundle does not have.`);
                organismNames[k] = str(v) ?? fail(`organism_names.${k} is a name.`);
            }
        }
        const parsedConfig = parseGroupConfig(doc.config, 'config');
        if (!parsedConfig.ok) fail(parsedConfig.message);
        const config = (parsedConfig as { ok: true; value: InstallSet['config'] }).value;
        for (const g of Object.keys(config)) {
            if (bundle && !bundle.packages.some(p => p.groupId === g)) fail(`config names package "${g}", which the bundle does not list.`);
        }
        if (doc.auto_update !== undefined && typeof doc.auto_update !== 'boolean') fail('auto_update is true or false.');
        let repository: InstallSet['repository'];
        if (doc.repository !== undefined) {
            if (!isObj(doc.repository)) fail('repository is { node_id, url, public_key }.');
            const r = doc.repository as Obj;
            const rNode = str(r.node_id, 120);
            const rUrl = str(r.url, 500);
            const rKey = str(r.public_key, 200);
            if (!rNode || !rUrl || !/^https?:\/\//.test(rUrl) || !rKey) fail('repository is { node_id, url, public_key }: the node id, its http(s) address and its public key.');
            if (nodeId && rNode !== nodeId) fail(`repository.node_id "${rNode}" is not the node bundle.node_id names ("${nodeId}").`);
            repository = { nodeId: rNode as string, url: rUrl as string, publicKey: rKey as string };
        }
        const displayName = str(ow.display_name, 100);
        return {
            bundle: { groupId: groupIdOf(b.group_id, 'bundle.group_id'), ...(nodeId ? { nodeId } : {}), ...(version ? { version } : {}) },
            ...(repository ? { repository } : {}),
            owner: { name: ownerName as string, email: ownerEmail as string, ...(displayName ? { displayName } : {}) },
            members, organismNames, config,
            autoUpdate: doc.auto_update === undefined ? true : doc.auto_update as boolean,
        };
    });
}

/**
 * A config map by package group, then component id: the shape of the set's `config` and of the
 * secrets given to the apply call. `where` names the field in the refusal.
 */
export function parseGroupConfig(raw: unknown, where: string): Parsed<InstallSet['config']> {
    return run(() => {
        const out: InstallSet['config'] = {};
        if (raw === undefined) return out;
        if (!isObj(raw)) fail(`${where} is an object: { <package group id>: { <component id>: { <field>: value } } }.`);
        for (const [g, v] of Object.entries(raw as Obj)) out[g] = configMap(v, `${where}.${g}`);
        return out;
    });
}

/**
 * The bundle a package carries, or null when it is an ordinary package: the one `memory` component
 * whose JSON has the bundle spec.
 */
export function bundleOfPackage(pkg: PackageRecord): Parsed<InstallBundle> | null {
    return bundleOfComponents(pkg.components);
}

/** The same, from the parts of a package that is not stored (a pull's preview). */
export function bundleOfComponents(components: Array<{ type: string; content: string }>): Parsed<InstallBundle> | null {
    for (const c of components) {
        if (c.type !== 'memory') continue;
        let doc: unknown;
        // eslint-disable-next-line aimeat/no-silent-catch -- a memory component that is not JSON is not a bundle
        try { doc = JSON.parse(c.content); } catch { continue; }
        if (isObj(doc) && doc.spec === BUNDLE_SPEC) return parseInstallBundle(doc);
    }
    return null;
}
