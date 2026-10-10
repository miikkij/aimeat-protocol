/**
 * @file services/install-set-apply.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Apply an install set to this node: the one implementation behind the REST endpoint,
 *   the MCP tool on its three surfaces and the start-up file (config.installSetPath).
 *
 *   WHAT IT DOES, IN ORDER (plan docs/internal/asennuspaketit/02-suunnitelma.md, phase 4):
 *   1. Reads the set, the owner and the bundle, pulls the bundle and its packages from the repository
 *      when the set names one, and asks each package's own dry run whether it would install. Every
 *      refusal is found here, before an account, an organism or an install exists.
 *   2. Creates the owner account when it does not exist (decision 6: everything installs for one
 *      owner user, who owns the organisms).
 *   3. Installs each package for the owner with the bundle's mode and the merged config, and sets
 *      whether its updates apply by themselves.
 *   4. Creates each organism and its workspaces, under the customer's own names.
 *   5. Brings in the other users (install-set-people.ts).
 *   4b. Records the owner's grant for each installed app, unless the set says `grant_apps: false`
 *      (install-set-grants.ts: the purchase is the approval).
 *   6. Deploys each crew agent through the owner's runner agent. With no runner connected the agent is
 *      left pending, and applying the set again after the runner connects deploys it (decision 4).
 *
 *   APPLYING TWICE CREATES NOTHING TWICE. What an apply made is kept in one record per owner and
 *   bundle in the system namespace `install-sets` (no principal can address it, the pattern of
 *   package-entitlements.ts), and the next apply reads it: an organism already made is reused, an
 *   install that exists is left to the update flow, a membership that exists is reported, an agent
 *   deployed once is not deployed again. A later bundle for the same owner is a second record.
 *
 *   SECRETS. The set file carries none. They are given to the call (`secrets`, the same shape as the
 *   set's `config`), merged into the extension config the install encrypts, and the record keeps only
 *   which fields were given.
 * @structure NS_INSTALL_SETS · ApplyDeps · ApplyInput · ApplyResult · applyInstallSet() ·
 *   listAppliedSets()
 * @usage
 *   const out = await applyInstallSet({ storage, config, peers }, { installSet, secrets, dryRun: true });
 * @version-history
 *   v1.10.0 — 2026-10-10 — A real apply runs the plan first and links the repository and pulls only
 *     when the plan found nothing to refuse (I17); the plan checks a package's expects before it is
 *     pulled. The start-up apply marks its record `via: 'startup'`, and reach() passes `installSet` to
 *     the pull only when its caller says so: the owner's bundle install no longer passes the package
 *     federation switch (I18). Both secaudit 2026-10-10.
 *   v1.9.0 — 2026-10-05 — An apply into an account that existed before writes the operator trail in
 *     that account (recordOperatorAction, area install-set): its holder reads in their feed which set
 *     was installed and how many apps were given permissions (secaudit 2026-10, S4; Jouni: "this
 *     exception should be just logged and user notified about this change by operator").
 *   v1.8.1 — 2026-10-05 — The record keeps `landing_path`, the path the owner's welcome link opens
 *     (no token), so a test can check the landing without reading the mail (aimeat-commercial).
 *   v1.8.0 — 2026-10-04 — After the apps are linked to their workspaces, the owner's grant for each
 *     installed app is recorded (`app_grants`), and the owner's welcome link opens the set's
 *     `landing` app. The plan shows both. Jouni: the purchase is the approval.
 *   v1.7.0 — 2026-10-02 — After the workspaces are made, each installed app whose declaration names a
 *     workspace's contract is told where it is (linkAppsToWorkspaces, app-workspaces.ts). The record
 *     helpers, reach, createOrganisms and the link are exported for the owner's own set install
 *     (install-bundle-owner.ts). Package sale design, phase 4.
 *   v1.6.1 — 2026-10-01 — Reads `task_id` only from a deploy view that has one (a deploy can now answer
 *     a proposal, though not to an install set, which passes no principal).
 *   v1.6.0 — 2026-10-01 — The repository the set names is linked only after its own card answers with
 *     the same node id and key, and how the peer arrived is recorded (peer-origin.ts). A repository
 *     that does not answer is PEER_UNREACHABLE, which the start-up apply tries again. The
 *     peer-registration incident (finding F).
 *   v1.5.0 — 2026-09-30 — The install's warnings reach the operator: each package step keeps them,
 *     the apply answer lists them (`warnings`) and so does the plan. A skill the owner already had
 *     of their own was skipped in silence (aimeat-apps, 2026-09-29).
 *   v1.4.0 — 2026-09-29 — The owner's welcome no longer depends on nobody having signed in: the
 *     shop's crew image signs in as the owner at boot (ownerToWelcome()).
 *   v1.3.0 — 2026-09-29 — An owner account the shop created before the set is welcomed too, while
 *     nobody has signed in to it and its verified address is the set's (ownerToWelcome()).
 *   v1.2.0 — 2026-09-29 — The record keeps the accounts the set created (`accounts_created`) and the
 *     ones sent the welcome sign-in link (`welcomed`); a finished apply mails the rest.
 *   v1.1.0 — 2026-09-29 — The apply's pulls say they come from an install set, so the named repository
 *     is reached with package federation off (install-set-trust.ts); NS_INSTALL_SETS moved there.
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, PackageComponent, InstalledComponent } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import type { PeerInfo } from './federation.js';
import { parseInstallSet, parseGroupConfig, bundleOfComponents, type InstallSet, type InstallBundle, type BundlePackage } from './install-set-spec.js';
import { registerSkillComponent } from './packages/install/package-skill-component.js';
import { checkOwner, ensureOwner, joinMember, ownerToWelcome, welcomeCreated, type MemberOutcome, type CreatedOrganisms } from './install-set-people.js';
import { installPackage, type PackageInstallCaller, type PackageInstallPreview } from './packages/install/package-install.js';
import { pullPackage } from './packages/peer/package-pull.js';
import { getPackageFor } from './packages/compose/package-read.js';
import { planPackageConfig, missingConfigMessage } from './packages/compose/package-config.js';
import { expectsMissingMessage, missingExpects, type PackageExpects } from './packages/compose/package-expects.js';
import { createOrganismRecord } from './organism-lifecycle.js';
import { provisionWorkspace, checkWorkspaceManifest, type ProvisionWorkspaceInput } from './workspace-provision.js';
import { deployAppAgent } from './app-agent-deploy.js';
import { deriveTierFlags } from './federation-tiers.js';
import { proveNodeCard } from './packages/peer/package-peer-register.js';
import { recordPeerOrigin } from './peer-origin.js';
import { NS_INSTALL_SETS } from './install-set-trust.js';
import { writeAppWorkspaceLinks, type AppWorkspaceLink } from './app-workspaces.js';
import { grantInstalledApps, landingPath, type AppGrantStep } from './install-set-grants.js';
import { recordOperatorAction } from './operator-access-audit.js';
import { ownerGhiiOf } from '../utils/gaii.js';

// The namespace lives with the trust check (install-set-trust.ts), which package-pull.ts reads
// without importing this file back.
export { NS_INSTALL_SETS };
const RECORD_SPEC = 'aimeat.install-set-applied/1';

export interface ApplyDeps { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo>; scheduler?: Scheduler }

type ConfigBySet = InstallSet['config'];

export interface ApplyInput {
    installSet: unknown;
    /** Secret config values, `{ <group id>: { <component id>: { <field>: value } } }`. Never stored. */
    secrets?: unknown;
    dryRun?: boolean;
    /** Who applies it, for the record: the operator's name, or `startup` for the start-up file. */
    appliedBy: string;
    /**
     * The start-up file's apply (install-set-startup.ts passes it, nothing else does): the record gets
     * `via: 'startup'`, which install-set-trust.ts reads. `appliedBy` is not proof of that.
     */
    startup?: boolean;
}

export interface PackageStep {
    group_id: string; local_group_id: string; instance_id?: string; result: 'installed' | 'present' | 'would_install' | 'would_pull'; mode: string;
    /** What the install left out and why (a skill the owner already has of their own). Kept across runs. */
    warnings?: string[];
}
export interface AgentStep { group_id: string; app: string; agent: string; result: 'deployed' | 'present' | 'pending' | 'error' | 'would_deploy'; task_id?: string; detail?: string }

export interface AppliedRecord {
    spec: typeof RECORD_SPEC;
    owner: string;
    bundle: { group_id: string; local_group_id: string; node_id: string | null; version: string; name: string };
    organisms: CreatedOrganisms;
    packages: Record<string, PackageStep>;
    members: Record<string, MemberOutcome>;
    agents: Record<string, AgentStep>;
    /** The owner's grant this set recorded for each installed app, by `owner/filename` (install-set-grants.ts). */
    app_grants?: Record<string, AppGrantStep>;
    secrets_given: string[];
    /** Emails of the accounts this set created, and of those already sent the welcome sign-in link. */
    accounts_created?: string[];
    welcomed?: string[];
    /** The node path the owner's welcome link opens (the set's `landing`), or null; never the token. */
    landing_path?: string | null;
    applied_by: string;
    /** 'startup' when the start-up file applied this set (ApplyInput.startup); kept on later runs. */
    via?: 'startup';
    created_at: string;
    applied_at: string;
    runs: number;
}

export type ApplyResult =
    | { ok: true; dry_run: true; plan: Record<string, unknown> }
    | { ok: true; dry_run: false; record: AppliedRecord; owner_created: boolean; warnings: string[] }
    | { ok: false; status: number; code: string; message: string; problems?: string[] };

export const appliedRecordKey = (owner: string, localGroupId: string): string =>
    `install-sets.${owner}.${localGroupId.replace(/[^a-zA-Z0-9-]+/g, '-')}`;

/** A first record for an owner and a bundle, before anything is made. */
export function newAppliedRecord(owner: string, bundle: AppliedRecord['bundle'], appliedBy: string): AppliedRecord {
    const now = new Date().toISOString();
    return { spec: RECORD_SPEC, owner, bundle, organisms: {}, packages: {}, members: {}, agents: {}, secrets_given: [], applied_by: appliedBy, created_at: now, applied_at: now, runs: 0 };
}

export async function readRecord(storage: Storage, key: string): Promise<AppliedRecord | null> {
    const rec = await storage.getMemory(NS_INSTALL_SETS, key);
    const value = rec?.value as AppliedRecord | undefined;
    return value?.spec === RECORD_SPEC ? value : null;
}

export async function writeRecord(storage: Storage, key: string, value: AppliedRecord): Promise<void> {
    const existing = await storage.getMemory(NS_INSTALL_SETS, key);
    await storage.setMemory({
        key, ownerGaii: NS_INSTALL_SETS, value, visibility: 'private', tags: ['install-set'], ttlHours: null,
        version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? value.created_at, updatedAt: value.applied_at,
    });
}

/** Every install set applied on this node, newest first. */
export async function listAppliedSets(storage: Storage): Promise<AppliedRecord[]> {
    const rows = await storage.listMemory(NS_INSTALL_SETS, { prefix: 'install-sets.' });
    return rows
        .map(r => r.value as AppliedRecord)
        .filter(v => v?.spec === RECORD_SPEC)
        .sort((a, b) => b.applied_at.localeCompare(a.applied_at));
}

/** The bundle's defaults, then the set's values, then the secrets: the later one wins per field. */
function mergedConfig(pkg: BundlePackage, set: InstallSet, secrets: ConfigBySet): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const layer of [pkg.config, set.config[pkg.groupId] ?? {}, secrets[pkg.groupId] ?? {}]) {
        for (const [component, values] of Object.entries(layer)) out[component] = { ...(out[component] ?? {}), ...values };
    }
    return out;
}

function ownerCaller(owner: string, config: AimeatConfig): PackageInstallCaller {
    return { owner, sub: owner, ownerGhii: `${owner}@${config.nodeId}`, roles: ['owner'], scopes: [] };
}

export const localGroupOf = (groupId: string, owner: string, remote: boolean): string =>
    remote ? `${groupId.split('::')[0]}::${owner}` : groupId;

export async function installedInstanceOf(storage: Storage, owner: string, groupId: string) {
    const { instances } = await storage.listInstances({ owner, packageGroupId: groupId, status: 'installed', limit: 1, offset: 0 });
    return instances[0] ?? null;
}

/**
 * The parts of one package: the owner's local copy, or, from a repository, a copy pulled into the
 * owner's packages. In a plan the pull is a preview and stores nothing; a copy already on this node
 * and current is read from here in both cases.
 *
 * `installSet` lets the pull reach the repository with package federation off (package-pull.ts). Only
 * the operator's and the start-up apply pass it; an owner's own bundle install (install-bundle-owner.ts)
 * does not, so its pulls meet the federation switch like any other pull (secaudit 2026-10-10, I18).
 */
export async function reach(
    deps: ApplyDeps, owner: string, remote: { nodeId: string } | null, groupId: string,
    opts: { preview: boolean; installSet: boolean; version?: string },
): Promise<{ ok: true; local: PackageRecord | null; components: PackageComponent[]; version: string; expects?: PackageExpects } | { ok: false; message: string }> {
    const { preview, installSet, version } = opts;
    const localGroup = localGroupOf(groupId, owner, !!remote);
    if (remote) {
        const out = await pullPackage({ storage: deps.storage, config: deps.config, peers: deps.peers }, { owner, isOperator: false },
            { groupId, nodeId: remote.nodeId, ...(version ? { version } : {}), preview, installSet });
        if (!out.ok) return { ok: false, message: `${groupId}: ${out.code}: ${out.message}` };
        if (out.applied === false && out.reason === 'preview') {
            return { ok: true, local: null, components: out.parsed.components as PackageComponent[], version: out.upstream.version, ...(out.parsed.expects ? { expects: out.parsed.expects } : {}) };
        }
    }
    const local = await getPackageFor(deps.storage, localGroup, owner);
    if (!local) return { ok: false, message: `${groupId}: NOT_FOUND: no published version you may install.` };
    return { ok: true, local, components: local.components, version: local.version };
}

/** What a package's own dry run says would stop the real install: an empty required field, a missing dependency. */
function installProblems(groupId: string, preview: PackageInstallPreview): string[] {
    const out: string[] = [];
    for (const e of preview.config) {
        const missing = (e.missing as Array<{ field: string; description?: string }> | undefined) ?? [];
        if (missing.length) out.push(`${groupId}: CONFIG_REQUIRED: ${e.component_id} needs ${missing.map(m => m.field + (m.description ? ` (${m.description})` : '')).join(', ')}`);
    }
    if (preview.expects_missing) out.push(`${groupId}: EXPECTS_MISSING: ${expectsMissingMessage(preview.expects_missing)}`);
    return out;
}

/**
 * The repository the set names, as a peer of this node. A new customer node has no link to it yet,
 * and the set's author gives its address and key, so the apply adds it: active, sharing the catalogue,
 * at the member tier, pinned to that key. A plan adds it to a copy of the peers only. A peer that
 * exists under another key, or that the operator switched off, is refused and left as it is.
 *
 * Written here rather than through POST /v1/federation/peers because that route leaves a new peer
 * pending for a person to activate, and the set is that person's decision made in advance. The
 * repository's own card must answer with the id and key the set names before anything is linked.
 */
async function linkRepository(
    deps: ApplyDeps, set: InstallSet, write: boolean,
): Promise<{ ok: true; peers: Map<string, PeerInfo> } | { ok: false; status: number; code: string; message: string }> {
    const repo = set.repository;
    if (!repo) return { ok: true, peers: deps.peers };
    const known = deps.peers.get(repo.nodeId);
    if (known) {
        if (known.publicKey !== repo.publicKey) return { ok: false, status: 409, code: 'PEER_KEY_MISMATCH', message: `${repo.nodeId} is a peer of this node under another key than the set names. Check which key is right before applying.` };
        if (known.status !== 'active' || known.shareCatalogue === false) return { ok: false, status: 409, code: 'PEER_NOT_ACTIVE', message: `${repo.nodeId} is a peer of this node, but not active with the catalogue shared. Activate it on the Federation page, then apply the set.` };
        return { ok: true, peers: deps.peers };
    }
    const proof = await proveNodeCard(repo.nodeId, repo.url, repo.publicKey, deps.config.federationTimeoutMs ?? 10000);
    if (proof.kind === 'refused') return proof.refusal;
    if (proof.kind === 'unreachable') {
        return { ok: false, status: 503, code: 'PEER_UNREACHABLE', message: `The repository ${repo.nodeId} did not answer at ${repo.url} (${proof.detail}), so its key could not be checked. Nothing was linked.` };
    }
    const raced = deps.peers.get(repo.nodeId);
    if (raced && raced.publicKey !== repo.publicKey) return { ok: false, status: 409, code: 'PEER_KEY_MISMATCH', message: `${repo.nodeId} is a peer of this node under another key than the set names. Check which key is right before applying.` };
    if (raced) return { ok: true, peers: deps.peers };
    const now = new Date().toISOString();
    const peer: PeerInfo = {
        nodeId: repo.nodeId, url: repo.url, publicKey: repo.publicKey, status: 'active', addedAt: now, lastSeen: now,
        ...deriveTierFlags('member'), tier: 'member', shareCatalogue: true,
    };
    if (!write) return { ok: true, peers: new Map(deps.peers).set(repo.nodeId, peer) };
    deps.peers.set(repo.nodeId, peer);
    await deps.storage.saveFederationPeer(peer);
    await recordPeerOrigin(deps.storage, {
        nodeId: repo.nodeId, source: 'install-set-repository', by: 'install-set', url: repo.url, publicKey: repo.publicKey,
        proof: 'node-card', requestedAt: now, provenAt: now,
    });
    return { ok: true, peers: deps.peers };
}

/**
 * Read the set, reach the bundle and check everything that can refuse, before an account, an install
 * or an organism exists. A real apply writes only the repository link and the pulled package copies
 * here; a plan writes nothing. applyInstallSet runs it as a plan first, so a real run starts only on a
 * set the plan found no refusal and no problem in.
 */
async function prepare(deps: ApplyDeps, input: ApplyInput): Promise<
    | { ok: false; status: number; code: string; message: string; problems?: string[] }
    | { ok: true; set: InstallSet; bundle: InstallBundle; bundleVersion: string; bundleLocalGroup: string; remote: boolean; secrets: ConfigBySet; ownerExists: boolean; problems: string[]; warnings: string[] }
> {
    const { storage, config } = deps;
    const shape = parseInstallSet(input.installSet);
    if (!shape.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: shape.message };
    const parsedSecrets = parseGroupConfig(input.secrets ?? undefined, 'secrets');
    if (!parsedSecrets.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: parsedSecrets.message };
    const secrets = parsedSecrets.value;
    const owner = await checkOwner(storage, config, shape.value.owner);
    if (!owner.ok) return owner;
    const ownerName = shape.value.owner.name;
    const remote = shape.value.bundle.nodeId ? { nodeId: shape.value.bundle.nodeId } : null;
    const preview = input.dryRun === true;
    const linked = await linkRepository(deps, shape.value, !preview);
    if (!linked.ok) return linked;
    const ctx: ApplyDeps = { ...deps, peers: linked.peers };

    const reached = await reach(ctx, ownerName, remote, shape.value.bundle.groupId, { preview, installSet: true, version: shape.value.bundle.version });
    if (!reached.ok) return { ok: false, status: remote ? 502 : 404, code: 'BUNDLE_UNAVAILABLE', message: `The bundle could not be read. ${reached.message}` };
    const parsedBundle = bundleOfComponents(reached.components);
    if (!parsedBundle) return { ok: false, status: 400, code: 'NOT_A_BUNDLE', message: `${shape.value.bundle.groupId} is a package, and it carries no install bundle (a memory component with spec "aimeat.install-bundle/1").` };
    if (!parsedBundle.ok) return { ok: false, status: 400, code: 'INVALID_BUNDLE', message: parsedBundle.message };
    const bundle = parsedBundle.value;
    const full = parseInstallSet(input.installSet, bundle);
    if (!full.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: full.message };
    for (const g of Object.keys(secrets)) {
        if (!bundle.packages.some(p => p.groupId === g)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `secrets names package "${g}", which the bundle does not list.` };
    }

    const problems: string[] = [];
    const warnings: string[] = [];
    for (const org of bundle.organisms) {
        for (const ws of org.workspaces) {
            const why = await checkWorkspaceManifest(storage, 'install-set-check', ws.name, ws.manifest);
            if (why) problems.push(`Workspace "${org.key}/${ws.key}": ${why}`);
        }
    }
    for (const pkg of bundle.packages) {
        const localGroup = localGroupOf(pkg.groupId, ownerName, !!remote);
        if (await installedInstanceOf(storage, ownerName, localGroup)) continue;
        const got = await reach(ctx, ownerName, remote, pkg.groupId, { preview, installSet: true });
        if (!got.ok) { problems.push(got.message); continue; }
        const merged = mergedConfig(pkg, full.value, secrets);
        if (got.local) {
            const dry = await installPackage({ storage, config, scheduler: deps.scheduler }, ownerCaller(ownerName, config), {
                groupId: localGroup, mode: pkg.mode, config: merged, dryRun: true,
            });
            if (!dry.ok) problems.push(`${pkg.groupId}: ${dry.code}: ${dry.message}`);
            else if (dry.kind === 'dry-run') {
                problems.push(...installProblems(pkg.groupId, dry.preview));
                warnings.push(...(dry.preview.warnings ?? []).map(w => `${pkg.groupId}: ${w}`));
            }
            continue;
        }
        // A preview: nothing is stored, so the config is checked against the verified parts.
        const planned: InstalledComponent[] = got.components.map(c => ({ componentId: c.id, type: c.type, registeredAs: c.id, originalHash: '', customized: false }));
        const plan = planPackageConfig(got.components, planned, merged, { config, owner: ownerName });
        if (!plan.ok) problems.push(`${pkg.groupId}: ${plan.code}: ${plan.message}`);
        else if (plan.missingCount > 0) problems.push(`${pkg.groupId}: CONFIG_REQUIRED: ${missingConfigMessage(plan)}`);
        // The install's own expects check, so a real apply's plan finds it before anything is pulled.
        const missing = got.expects ? await missingExpects(storage, got.expects) : null;
        if (missing) problems.push(`${pkg.groupId}: EXPECTS_MISSING: ${expectsMissingMessage(missing)}`);
        // The skills the install would leave out, by the check the install itself makes.
        warnings.push(...(await skillsLeftOut(deps, ownerName, localGroup, got.components)).map(w => `${pkg.groupId}: ${w}`));
    }
    return { ok: true, set: full.value, bundle, bundleVersion: reached.version, bundleLocalGroup: localGroupOf(shape.value.bundle.groupId, ownerName, !!remote), remote: !!remote, secrets, ownerExists: owner.exists, problems, warnings };
}

/** Apply (or with dryRun, plan) an install set. The caller has already been checked as the operator. */
export async function applyInstallSet(deps: ApplyDeps, input: ApplyInput): Promise<ApplyResult> {
    const { storage, config } = deps;
    // The plan first, for a real apply too: a real prepare links the repository as an active peer and
    // stores the pulled copies, and it used to do that before the refusals it then returned
    // (NOT_A_BUNDLE, CANNOT_APPLY and the rest said "nothing was created"; secaudit 2026-10-10, I17).
    const checked = await prepare(deps, { ...input, dryRun: true });
    if (!checked.ok) return checked;
    const cannotApply = (problems: string[]): ApplyResult =>
        ({ ok: false, status: 409, code: 'CANNOT_APPLY', message: 'The set was not applied, and nothing was created. Each problem names its package.', problems });

    if (input.dryRun) {
        const { set, bundle, bundleVersion } = checked;
        const plan: Record<string, unknown> = {
            owner: { name: set.owner.name, email: set.owner.email, exists: checked.ownerExists },
            bundle: { group_id: set.bundle.groupId, node_id: set.bundle.nodeId ?? null, name: bundle.name, version: bundleVersion },
            packages: bundle.packages.map(p => ({ group_id: p.groupId, mode: p.mode })),
            organisms: bundle.organisms.map(o => ({ key: o.key, name: set.organismNames[o.key] ?? o.name, workspaces: o.workspaces.map(w => w.key) })),
            members: set.members.map(m => ({ email: m.email, join: m.join, organisms: m.memberships.map(x => x.organism) })),
            agents: bundle.agents.map(a => ({ group_id: a.groupId, app: a.app, agent: a.agent })),
            auto_update: set.autoUpdate,
            grant_apps: set.grantApps,
            landing: set.landing ? { group_id: set.landing.groupId, app: set.landing.app } : null,
            problems: checked.problems,
            // What the install would leave out: not a problem, the set applies, but the operator hears it.
            warnings: checked.warnings,
        };
        return { ok: true, dry_run: true, plan };
    }
    if (checked.problems.length > 0) return cannotApply(checked.problems);

    const prep = await prepare(deps, input);
    if (!prep.ok) return prep;
    if (prep.problems.length > 0) return cannotApply(prep.problems);
    const { set, bundle, bundleVersion, remote, secrets } = prep;
    const ownerName = set.owner.name;

    const owner = await ensureOwner(storage, config, set.owner);
    if (!owner.ok) return owner;
    const localBundle = prep.bundleLocalGroup;
    const key = appliedRecordKey(ownerName, localBundle);
    const now = new Date().toISOString();
    const prev = await readRecord(storage, key);
    const record: AppliedRecord = prev ?? newAppliedRecord(ownerName,
        { group_id: set.bundle.groupId, local_group_id: localBundle, node_id: set.bundle.nodeId ?? null, version: bundleVersion, name: bundle.name },
        input.appliedBy);
    record.bundle.version = bundleVersion;
    record.applied_by = input.appliedBy;
    if (input.startup === true) record.via = 'startup';
    record.applied_at = now;
    record.runs += 1;
    record.secrets_given = [...new Set([...record.secrets_given, ...Object.entries(secrets).flatMap(([g, comps]) =>
        Object.entries(comps).flatMap(([c, fields]) => Object.keys(fields).map(f => `${g}/${c}/${f}`)))])];
    const created = new Set(record.accounts_created ?? []);
    if (owner.created) created.add(set.owner.email.toLowerCase());
    // An owner the shop created before the set is welcomed as well, once, at its verified address.
    const ownerWelcome = !owner.created && await ownerToWelcome(storage, config, set.owner);

    // An existing account is the operator's to install into, and its holder reads afterwards what was
    // done: the operator trail in their feed, on both exits below (Jouni, 2026-10-05; secaudit 2026-10,
    // S4). An account this apply created is the person's welcome, not news of a change.
    const trail = async (): Promise<void> => {
        if (owner.created) return;
        const granted = Object.values(record.app_grants ?? {}).filter(g => g.result === 'granted').length;
        await recordOperatorAction(storage, config, {
            operatorGhii: ownerGhiiOf(input.appliedBy), actorGaii: input.appliedBy, ownerOf: `${ownerName}@${config.nodeId}`,
            area: 'install-set', action: 'apply', subject: bundle.name,
            data: { set: bundle.name, packages: String(Object.keys(record.packages).length), apps: String(granted) },
        });
    };

    // A step that fails part-way stops the apply, and what was made before it is still recorded, so
    // applying the set again continues from there instead of making it twice.
    try {
        await installPackages(deps, set, bundle, remote, secrets, record);
        await createOrganisms(deps, ownerName, set.organismNames, bundle, record);
        await linkAppsToWorkspaces(deps, ownerName, bundle, record);
        if (set.grantApps) await grantInstalledApps(storage, config, record);
        for (const user of set.members) {
            const outcome = await joinMember(storage, config, ownerName, user, record.organisms);
            record.members[user.email.toLowerCase()] = outcome;
            if (outcome.created) created.add(user.email.toLowerCase());
        }
        await deployAgents(deps, bundle, record);
    } catch (err) {
        record.accounts_created = [...created];
        await writeRecord(storage, key, record);
        await trail();
        return { ok: false, status: 500, code: 'APPLY_FAILED', message: `The set was applied in part: ${String(err instanceof Error ? err.message : err)}. What was made is recorded, and applying the set again continues from there.` };
    }
    // The welcome goes out once everything the person was given exists.
    record.accounts_created = [...created];
    const toWelcome = ownerWelcome ? [...created, set.owner.email.toLowerCase()] : [...created];
    // The owner's link opens the set's landing app, signed in, when the set names one.
    const landing = await landingPath(storage, ownerName, set.landing, record.packages);
    const landingByEmail: Record<string, string> = landing ? { [set.owner.email.toLowerCase()]: landing } : {};
    // Where the owner's link opens, without the token, so the landing can be checked with no mailbox.
    record.landing_path = landing;
    record.welcomed = [...(record.welcomed ?? []), ...await welcomeCreated(storage, config, toWelcome, record.welcomed ?? [], landingByEmail)];
    await writeRecord(storage, key, record);
    await trail();
    return { ok: true, dry_run: false, record, owner_created: owner.created, warnings: setWarnings(record) };
}

/**
 * For a package still on the repository: the skill components the owner already has a skill of that
 * name for, in the words the install would use (registerSkillComponent, as a dry run).
 */
async function skillsLeftOut(deps: ApplyDeps, owner: string, localGroup: string, components: PackageComponent[]): Promise<string[]> {
    const appNames = new Map(components.filter(c => c.type === 'app').map(c => [c.id, `${c.id}.html`] as [string, string]));
    const out: string[] = [];
    for (const c of components.filter(k => k.type === 'skill')) {
        const dry = await registerSkillComponent(deps.storage, {
            config: deps.config, owner, ownerGaii: `${owner}@${deps.config.nodeId}`, publisher: `${owner}@${deps.config.nodeId}`,
            content: c.content, meta: c.meta, packageContext: { groupId: localGroup, instanceId: 'plan', appNames }, dryRun: true,
        });
        if (dry.ok && dry.skipped) out.push(dry.skipped);
    }
    return out;
}

/** Every package step's warnings, each prefixed with its package, for the apply answer. */
function setWarnings(record: AppliedRecord): string[] {
    return Object.values(record.packages).flatMap(p => (p.warnings ?? []).map(w => `${p.group_id}: ${w}`));
}

async function installPackages(deps: ApplyDeps, set: InstallSet, bundle: InstallBundle, remote: boolean, secrets: ConfigBySet, record: AppliedRecord): Promise<void> {
    const { storage, config } = deps;
    const owner = set.owner.name;
    for (const pkg of bundle.packages) {
        const local = localGroupOf(pkg.groupId, owner, remote);
        const present = await installedInstanceOf(storage, owner, local);
        if (present) {
            const before = record.packages[pkg.groupId]?.warnings;
            record.packages[pkg.groupId] = { group_id: pkg.groupId, local_group_id: local, instance_id: present.id, result: 'present', mode: present.mode ?? 'editable', ...(before?.length ? { warnings: before } : {}) };
            continue;
        }
        const out = await installPackage({ storage, config, scheduler: deps.scheduler }, ownerCaller(owner, config), {
            groupId: local, mode: pkg.mode, config: mergedConfig(pkg, set, secrets), label: bundle.name,
        });
        if (!out.ok) throw new Error(`${pkg.groupId}: ${out.code}: ${out.message}`);
        if (out.kind !== 'installed') continue;
        if ((out.instance.autoUpdate ?? false) !== set.autoUpdate) await storage.updateInstance(out.instance.id, { autoUpdate: set.autoUpdate });
        // The install's warnings (a skill left out because the owner has one of that name) were
        // dropped here until 2026-09-30, so the operator never learned a skill was skipped.
        record.packages[pkg.groupId] = { group_id: pkg.groupId, local_group_id: local, instance_id: out.instance.id, result: 'installed', mode: pkg.mode, ...(out.warnings.length ? { warnings: out.warnings } : {}) };
    }
}

/** Each organism of the bundle and its workspaces, under the owner's own names; one made before is reused. */
export async function createOrganisms(deps: ApplyDeps, owner: string, organismNames: Record<string, string>, bundle: InstallBundle, record: AppliedRecord): Promise<void> {
    const { storage, config } = deps;
    const ownerGhii = `${owner}@${config.nodeId}`;
    for (const org of bundle.organisms) {
        let made = record.organisms[org.key];
        if (!made || !(await storage.getOrganism(made.id))) {
            const named = organismNames[org.key];
            const out = await createOrganismRecord({ storage, config }, owner, {
                name: typeof named === 'string' && named.trim() ? named.trim() : org.name, description: org.description,
                joinPolicy: 'invite_only', visibility: 'private',
            });
            if (!out.ok) throw new Error(`Organism "${org.key}": ${out.code}: ${out.message}`);
            made = { id: out.organism.id, workspaces: {} };
            record.organisms[org.key] = made;
        }
        for (const ws of org.workspaces) {
            if (made.workspaces[ws.key]) continue;
            const out = await provisionWorkspace(storage, config, {
                orgId: made.id, ownerName: owner, ownerGhii, name: ws.name,
                manifest: structuredClone(ws.manifest) as ProvisionWorkspaceInput['manifest'],
                ...(ws.schemas ? { schemas: ws.schemas } : {}), ...(ws.readme ? { readme: ws.readme } : {}),
            });
            made.workspaces[ws.key] = out.ws;
        }
    }
}

/**
 * Tell every installed app of the set where the workspace its declared contract names was made
 * (app-workspaces.ts): the app reads the ids by contract through AIMEAT.data.appWorkspace().
 */
export async function linkAppsToWorkspaces(deps: ApplyDeps, owner: string, bundle: InstallBundle, record: AppliedRecord): Promise<void> {
    const { storage, config } = deps;
    const made = new Map<string, AppWorkspaceLink>();
    for (const org of bundle.organisms) {
        const ids = record.organisms[org.key];
        for (const ws of org.workspaces) {
            const wsId = ids?.workspaces[ws.key];
            if (ws.contract && ids && wsId) made.set(ws.contract, { organism_id: ids.id, workspace_id: wsId, name: ws.name });
        }
    }
    if (made.size === 0) return;
    const ownerGhii = `${owner}@${config.nodeId}`;
    for (const step of Object.values(record.packages)) {
        const instance = step.instance_id ? await storage.getInstance(step.instance_id) : null;
        for (const comp of instance?.installedComponents.filter(c => c.type === 'app') ?? []) {
            const app = await storage.getApp(ownerGhii, comp.registeredAs);
            const links: Record<string, AppWorkspaceLink> = {};
            for (const w of app?.manifest.workspaces ?? []) {
                const link = made.get(w.contract);
                if (link) links[w.contract] = link;
            }
            if (Object.keys(links).length) await writeAppWorkspaceLinks(storage, ownerGhii, comp.registeredAs, links);
        }
    }
}

async function deployAgents(deps: ApplyDeps, bundle: InstallBundle, record: AppliedRecord): Promise<void> {
    const { storage, config } = deps;
    for (const a of bundle.agents) {
        const id = `${a.groupId}/${a.app}/${a.agent}`;
        if (record.agents[id]?.result === 'deployed') { record.agents[id] = { ...record.agents[id], result: 'present' }; continue; }
        if (record.agents[id]?.result === 'present') continue;
        const instanceId = record.packages[a.groupId]?.instance_id;
        const instance = instanceId ? await storage.getInstance(instanceId) : null;
        const app = instance?.installedComponents.find(c => c.componentId === a.app && c.type === 'app');
        if (!app) {
            record.agents[id] = { group_id: a.groupId, app: a.app, agent: a.agent, result: 'error', detail: `Package ${a.groupId} has no app component "${a.app}".` };
            continue;
        }
        const out = await deployAppAgent(storage, config, {
            callerOwner: record.owner, appOwner: record.owner, filename: app.registeredAs, agentName: a.agent,
            organismId: a.organism ? record.organisms[a.organism]?.id : undefined, undeploy: false,
        });
        record.agents[id] = out.ok
            ? { group_id: a.groupId, app: a.app, agent: a.agent, result: 'deployed', task_id: 'task_id' in out.view ? out.view.task_id : undefined }
            : { group_id: a.groupId, app: a.app, agent: a.agent, result: out.code === 'RUNNER_NOT_FOUND' ? 'pending' : 'error', detail: `${out.code}: ${out.message}` };
    }
}
