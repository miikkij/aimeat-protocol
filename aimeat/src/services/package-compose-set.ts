/**
 * @file services/package-compose-set.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The set composer (docs/specs/package-sale-design.md, section 4): one call that turns the
 *   author's chosen apps into one package per app and an install bundle that lists them, with the
 *   organism and workspaces the apps declare and the crews they carry. With `dryRun` it writes nothing
 *   and answers what the author must see first.
 *
 *   ONE PACKAGE PER APP, so an update to one app does not republish the others; composing again adds
 *   a version to each group (package-compose.ts). The bundle is a package too, and composing again
 *   adds a version to it.
 *
 *   WORKSPACES COME FROM THE APPS' DECLARATIONS (app-workspaces.ts), joined on the contract: two apps
 *   that declare one contract share one workspace, and two declarations of one contract with different
 *   manifests are a problem. ORGANISMS ARE NOT DECLARED BY APPS: an organism decides who shares what,
 *   which is the set author's decision, so the declared workspaces go into one organism named after
 *   the set, and the author may rename it.
 *
 *   A SET WITH A QUIET MISTAKE IS REFUSED, not passed (wish
 *   wish-a-bundle-with-a-quiet-mistake-is-refused-instead-of-passing): the real call refuses on every
 *   problem the dry run would list, before anything is written.
 * @structure ComposeSetInput · ComposeSetResult · composeSet(deps, caller, input)
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 4).
 */
import type { PackageComponent } from '../storage/interface.js';
import {
    planComposeFromApps, composePackageFromApps,
    type PackageComposeDeps, type PackageComposeCaller, type ComposeExpectations,
} from './package-compose.js';
import { createPackageGroup, addPackageVersion, normalizeComponents, type RawComponentInput } from './package-create.js';
import { packageCapabilities, type CapabilitySummary } from './package-capabilities.js';
import { parseBundledCrews } from './app-bundled-crews.js';
import { checkAppConfigValues, type AppConfigSchema } from './app-config.js';
import { parseInstallBundle, BUNDLE_SPEC } from './install-set-spec.js';
import type { AppWorkspaceDeclaration } from './app-workspaces.js';

export interface ComposeSetInput {
    /** The set's package name; with the owner it forms the bundle's group id. */
    name: string;
    /** Filenames of the caller's own apps. */
    apps: string[];
    /** The name a buyer sees. Defaults to `name`. */
    title?: string;
    /** The organism the declared workspaces go into: its key in the bundle and its default name. */
    organism?: { key?: string; name?: string };
    /** The bundle's default config, by app filename then field: a field given here is not asked. */
    defaults?: Record<string, Record<string, unknown>>;
    description?: string;
    category?: string;
    tags?: string[];
    /** Defaults to private: a set is made to be sold. */
    visibility?: string;
    includeCortex?: boolean;
    includeSkills?: boolean;
    allowExpectations?: boolean;
    outcome?: string;
    prompts?: string[];
    dryRun?: boolean;
}

export interface SetQuestion { package: string; component: string; field: string; required: boolean; secret: false; schema: Record<string, unknown> }

export interface ComposeSetAnswer {
    dry_run: boolean;
    set: { group_id: string; name: string; version?: string; new_version?: boolean };
    packages: Array<{ app: string; group_id: string; version?: string; new_version?: boolean }>;
    bundle: Record<string, unknown>;
    questions: SetQuestion[];
    expects: ComposeExpectations;
    not_carried: string[];
    capabilities: CapabilitySummary['capabilities'];
    problems: string[];
}

export type ComposeSetResult =
    | ({ ok: true } & ComposeSetAnswer)
    | { ok: false; status: number; code: string; message: string; problems?: string[] };

const MAX_APPS = 20;
const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** "Shop Admin.html" → "shop-admin": the package name an app's own package gets. */
export function packageNameOf(filename: string): string {
    const base = filename.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return base || 'app';
}

/** A bundle workspace key from a contract: lower case, a letter first, at most 40. */
function workspaceKeyOf(contract: string, taken: Set<string>): string {
    let base = contract.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
    if (!/^[a-z]/.test(base)) base = `w-${base}`.slice(0, 36);
    let key = base || 'workspace';
    for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
    taken.add(key);
    return key;
}

/** Canonical JSON, keys sorted, so two declarations compare by content and not by key order. */
function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
}

const NOT_CARRIED = ['screenshots', 'app tools', 'agent faces', 'data maps', 'saved layouts'];

/** Compose a set, or with `dryRun` say what it would be. Authorisation happened before this call. */
export async function composeSet(deps: PackageComposeDeps, caller: PackageComposeCaller, input: ComposeSetInput): Promise<ComposeSetResult> {
    const { storage, config } = deps;
    const fail = (status: number, code: string, message: string): ComposeSetResult => ({ ok: false, status, code, message });
    if (typeof input.name !== 'string' || !input.name.trim()) return fail(400, 'INVALID_INPUT', 'name is the set\'s package name.');
    if (!Array.isArray(input.apps) || input.apps.length === 0) return fail(400, 'INVALID_INPUT', 'apps lists the filenames of your apps the set carries.');
    if (input.apps.length > MAX_APPS) return fail(400, 'INVALID_INPUT', `A set carries at most ${MAX_APPS} apps.`);
    if (new Set(input.apps).size !== input.apps.length) return fail(400, 'INVALID_INPUT', 'An app is listed twice.');
    const name = input.name.trim();
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 200) : name;
    const orgKey = input.organism?.key ?? 'main';
    if (!KEY_RE.test(orgKey)) return fail(400, 'INVALID_INPUT', 'organism.key is lower case letters, digits and hyphens, a letter first.');
    const orgName = typeof input.organism?.name === 'string' && input.organism.name.trim() ? input.organism.name.trim().slice(0, 200) : title;
    const defaults = input.defaults ?? {};
    if (typeof defaults !== 'object' || Array.isArray(defaults)) return fail(400, 'INVALID_INPUT', 'defaults is { <app filename>: { <field>: value } }.');

    const problems: string[] = [];
    for (const f of Object.keys(defaults)) if (!input.apps.includes(f)) problems.push(`defaults names ${f}, which is not one of the set's apps.`);
    const expects: ComposeExpectations = { cortex: [], extensions: [], packs: [] };
    const addExpect = (kind: keyof ComposeExpectations, values: string[]) => { for (const v of values) if (!expects[kind].includes(v)) expects[kind].push(v); };
    const components: RawComponentInput[] = [];
    const packages: ComposeSetAnswer['packages'] = [];
    const questions: SetQuestion[] = [];
    const contracts = new Map<string, { decl: AppWorkspaceDeclaration; apps: string[] }>();
    const crews: Array<{ group_id: string; app: string; agent: string }> = [];

    for (const filename of input.apps) {
        if (typeof filename !== 'string' || !filename) return fail(400, 'INVALID_INPUT', 'every entry in apps is a filename.');
        const pkgName = packageNameOf(filename);
        if (pkgName === name) problems.push(`${filename} would get the package name "${pkgName}", which is the set's own name. Give the set another name.`);
        const groupId = `${pkgName}::${caller.owner}`;
        // Collected rather than refused here: the dry run lists it, and the real call refuses below.
        const plan = await planComposeFromApps(deps, caller, { name: pkgName, apps: [filename], includeCortex: input.includeCortex, includeSkills: input.includeSkills, allowExpectations: true });
        if (!plan.ok) return plan;
        components.push(...plan.components);
        addExpect('cortex', plan.expects.cortex);
        addExpect('packs', plan.expects.packs);
        addExpect('extensions', plan.expects.extensions);
        if (plan.expects.extensions.length && input.allowExpectations !== true) {
            problems.push(`${filename} calls extensions a package cannot carry: ${plan.expects.extensions.join(', ')}. Install them on the target node first, then compose with allow_expectations to record them as requirements.`);
        }
        packages.push({ app: filename, group_id: groupId });
        const app = plan.apps[0]!;

        // The questions a buyer is asked: every config field the set's defaults do not fill.
        const schema = app.manifest.configSchema as AppConfigSchema | undefined;
        const given = defaults[filename];
        if (given !== undefined) {
            if (!schema) problems.push(`defaults gives values for ${filename}, which declares no config.`);
            else {
                const ok = checkAppConfigValues(schema, given);
                if (!ok.ok) problems.push(`defaults for ${filename}: ${ok.errors.join('; ')}`);
            }
        }
        for (const [field, prop] of Object.entries(schema?.properties ?? {})) {
            if (given && given[field] !== undefined) continue;
            questions.push({ package: groupId, component: filename, field, required: (schema?.required ?? []).includes(field) && prop.default === undefined, secret: false, schema: prop });
        }

        for (const w of app.manifest.workspaces ?? []) {
            const seen = contracts.get(w.contract);
            if (!seen) { contracts.set(w.contract, { decl: w, apps: [filename] }); continue; }
            seen.apps.push(filename);
            if (canonical({ m: seen.decl.manifest, s: seen.decl.schemas ?? null }) !== canonical({ m: w.manifest, s: w.schemas ?? null })) {
                problems.push(`${seen.apps.join(' and ')} declare the workspace "${w.contract}" with different manifests. Make them the same, or give one another contract.`);
            }
        }
        for (const c of parseBundledCrews(app.data.toString('utf-8')) ?? []) {
            if (typeof c.agent_name === 'string' && c.agent_name) crews.push({ group_id: groupId, app: filename, agent: c.agent_name });
        }
    }

    const wsKeys = new Set<string>();
    const bundleDoc: Record<string, unknown> = {
        spec: BUNDLE_SPEC, name: title,
        packages: packages.map(p => ({ group_id: p.group_id, mode: 'managed', ...(defaults[p.app] ? { config: { [p.app]: defaults[p.app] } } : {}) })),
        organisms: contracts.size ? [{
            key: orgKey, name: orgName,
            workspaces: [...contracts.entries()].map(([contract, { decl }]) => ({
                key: workspaceKeyOf(contract, wsKeys), name: decl.name, manifest: decl.manifest,
                ...(decl.schemas ? { schemas: decl.schemas } : {}), ...(decl.readme ? { readme: decl.readme } : {}), contract,
            })),
        }] : [],
        agents: crews.map(a => ({ ...a, ...(contracts.size ? { organism: orgKey } : {}) })),
    };
    const parsed = parseInstallBundle(bundleDoc);
    if (!parsed.ok) problems.push(`The bundle would not parse: ${parsed.message}`);

    const answer: ComposeSetAnswer = {
        dry_run: input.dryRun === true,
        set: { group_id: `${name}::${caller.owner}`, name: title },
        packages, bundle: bundleDoc, questions, expects,
        not_carried: [...NOT_CARRIED, ...(expects.extensions.length ? [`extensions (${expects.extensions.join(', ')})`] : [])],
        capabilities: packageCapabilities(normalizeComponents(components) as PackageComponent[], config, caller.owner).capabilities,
        problems,
    };
    if (input.dryRun === true) return { ok: true, ...answer };
    if (problems.length) return { ok: false, status: 409, code: 'SET_HAS_PROBLEMS', message: 'The set was not composed, and nothing was written. Each problem says what to change.', problems };

    // Every app's package first, so the bundle never lists a group that failed to write.
    const visibility = input.visibility ?? 'private';
    for (const p of packages) {
        const out = await composePackageFromApps(deps, caller, {
            name: packageNameOf(p.app), apps: [p.app], category: input.category, tags: input.tags, visibility, status: 'published',
            includeCortex: input.includeCortex, includeSkills: input.includeSkills, allowExpectations: input.allowExpectations,
        });
        if (!out.ok) return { ok: false, status: out.status, code: out.code, message: `${p.app}: ${out.message} The packages before it were written; composing again adds a version to them.` };
        p.version = out.package.version;
        p.new_version = out.newVersion;
    }
    const bundleComponent: RawComponentInput = { id: 'install-bundle', type: 'memory', label: 'Install bundle', content: JSON.stringify(bundleDoc), dependencies: [] };
    const changelog = `Composed from ${input.apps.join(', ')}`;
    const sheet = {
        ...(typeof input.outcome === 'string' && input.outcome.trim() ? { outcome: input.outcome.trim().slice(0, 300) } : {}),
        ...(Array.isArray(input.prompts) && input.prompts.length ? { prompts: input.prompts.filter(x => typeof x === 'string' && x.trim()).slice(0, 3) } : {}),
    };
    const manifest = JSON.stringify({ expects, ...(Object.keys(sheet).length ? { sheet } : {}) });
    const exists = (await storage.listVersions(answer.set.group_id, 1, 0)).total > 0;
    const written = exists
        ? await addPackageVersion(deps, caller, { groupId: answer.set.group_id, components: [bundleComponent], changelog, manifest, status: 'published' })
        : await createPackageGroup(deps, caller, {
            name, components: [bundleComponent], description: input.description?.trim() || `${title}: ${input.apps.join(', ')}`,
            category: input.category, tags: input.tags, visibility, status: 'published', changelog, manifest,
        });
    if (!written.ok) return { ok: false, status: written.status, code: written.code, message: `The bundle: ${written.message} The apps' packages were written; composing again adds a version to them.` };
    answer.set.version = written.package.version;
    answer.set.new_version = exists;
    return { ok: true, ...answer };
}
