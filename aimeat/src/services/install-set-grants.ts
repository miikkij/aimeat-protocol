/**
 * @file services/install-set-grants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an install set does for the apps it installs once they exist: it records the
 *   owner's grant for each of them, and it names the app the owner's welcome link opens.
 *
 *   THE PURCHASE IS THE APPROVAL (Jouni, 2026-10-04). An app a package installed is somebody else's
 *   code under the owner's name, so the silent bridge does not approve it by itself
 *   (package-approvals.ts isPackageApp) and the owner used to press Sign In once in every app. On a
 *   node set up from an install set, the customer chose the bundle when they bought it, so the set
 *   records the grant the consent screen would have written, for exactly the scopes each app declares
 *   in its `<meta name="aimeat-scopes">` at install time. The rest of the grant model is unchanged:
 *   - an update of the app that asks for a scope the grant lacks goes to the consent screen
 *     (`reason: 'app_updated'`), because the customer did not buy that;
 *   - the owner sees each grant among their app permissions and can revoke it;
 *   - a grant this set recorded once is never recorded again, so applying the set again does not
 *     undo a revoke, and a grant the owner already holds is left exactly as it is.
 *   An app with no declaration gets the four words the SDK asks for when a page declares none
 *   (config.js APP_DEFAULT_SCOPES), which is also what the silent bridge falls back to.
 *
 *   A set may say `grant_apps: false`; then every app asks on its first visit, as before.
 * @structure AppGrantStep · grantInstalledApps() · landingPath()
 * @usage await grantInstalledApps(storage, config, owner, record);
 * @version-history
 *   v1.1.0 — 2026-10-05 — The app's scopes come from appScopesOf (protected-resource.ts), the reading
 *     the package approval now uses too, so what the owner approved and what the set grants are read
 *     alike (secaudit 2026-10, PKG-4). DEFAULT_APP_SCOPES moved there.
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageInstanceRecord } from '../storage/interface.js';
import { APP_GRANTABLE_SCOPES } from '../routes/app-grant-vocabulary.js';
import { appScopesOf } from './protected-resource.js';
import { upsertAppGrant } from './app-grant-upsert.js';

/** One app's grant, as the apply record keeps it, by grant target `owner/filename`. */
export interface AppGrantStep {
    result: 'granted' | 'present' | 'skipped' | 'error';
    scopes: string[];
    detail?: string;
    at: string;
}

/** The record fields this file reads and writes (install-set-apply.ts AppliedRecord). */
interface GrantRecord {
    owner: string;
    packages: Record<string, { instance_id?: string }>;
    app_grants?: Record<string, AppGrantStep>;
}

/** The app's own address for the grant row's display field, or '' when it has none of its own yet. */
async function appOriginOf(storage: Storage, config: AimeatConfig, target: string): Promise<string> {
    if (!config.appHost) return '';
    const site = (await storage.listSubdomainSites()).find(s => s.enabled && s.kind === 'app' && s.target === target);
    if (!site) return '';
    const base = new URL(config.baseUrl);
    return `${base.protocol}//${site.subdomain}.${config.appHost}${base.port ? `:${base.port}` : ''}`;
}

/** The scopes an app's HTML declares, in the grant vocabulary; the SDK's default when it declares none. */
function declaredScopes(data: unknown): string[] {
    const html = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8');
    const { scopes, declared } = appScopesOf(html);
    return declared ? scopes.filter(s => Object.prototype.hasOwnProperty.call(APP_GRANTABLE_SCOPES, s)) : scopes;
}

/**
 * Record the owner's grant for each app one installed copy registered, into `steps` by grant target.
 * An app already granted or recorded is left alone. `mayGrant` is the installer's limit: an agent
 * installs for its owner and grants no app a scope it does not hold itself, so an app that asks for
 * more is left to ask on its first visit (`result: 'skipped'`). Null for the owner in person.
 */
export async function grantAppsOfInstance(
    storage: Storage, config: AimeatConfig, owner: string, instance: PackageInstanceRecord,
    steps: Record<string, AppGrantStep>, mayGrant: ((scope: string) => boolean) | null = null,
): Promise<Record<string, AppGrantStep>> {
    const ownerGhii = `${owner}@${config.nodeId}`;
    const now = new Date().toISOString();
    for (const comp of instance.installedComponents.filter(c => c.type === 'app')) {
        const target = `${owner}/${comp.registeredAs}`;
        if (steps[target]?.result === 'granted' || steps[target]?.result === 'present') continue;
        try {
            const live = await storage.getAppGrantByOwnerAndApp(owner, target);
            if (live) { steps[target] = { result: 'present', scopes: live.scopes, at: now }; continue; }
            const app = await storage.getAppByOwnerName(owner, comp.registeredAs);
            if (!app) { steps[target] = { result: 'error', scopes: [], detail: 'The install registered no app under this name.', at: now }; continue; }
            const scopes = declaredScopes(app.data);
            const beyond = mayGrant ? scopes.filter(s => !mayGrant(s)) : [];
            if (beyond.length) {
                steps[target] = { result: 'skipped', scopes, at: now,
                    detail: `The installer does not hold ${beyond.join(', ')}, so it cannot approve them for the app; the app asks on its first visit.` };
                continue;
            }
            const written = await upsertAppGrant(storage, {
                app: target, appName: app.manifest?.name || comp.registeredAs,
                appOrigin: await appOriginOf(storage, config, target),
                owner, gaii: ownerGhii, scopes,
            }, null);
            steps[target] = { result: 'granted', scopes: written.scopes, at: now };
        } catch (err) {
            steps[target] = { result: 'error', scopes: [], detail: String(err instanceof Error ? err.message : err), at: now };
        }
    }
    return steps;
}

/**
 * Record the owner's grant for every app the set's installs registered. Writes `record.app_grants`;
 * one app that cannot be granted is recorded as an error and the others go on, so the customer
 * meets at most that app's consent screen.
 */
export async function grantInstalledApps(storage: Storage, config: AimeatConfig, record: GrantRecord): Promise<void> {
    const steps = record.app_grants ?? {};
    for (const step of Object.values(record.packages)) {
        const instance = step.instance_id ? await storage.getInstance(step.instance_id) : null;
        if (instance) await grantAppsOfInstance(storage, config, record.owner, instance, steps);
    }
    record.app_grants = steps;
}

/**
 * The node path the owner's welcome link opens: the landing app's own page, which sends the browser
 * on to the app's own origin. Null when the set names no landing app or the install has no such app.
 */
export async function landingPath(
    storage: Storage, owner: string, landing: { groupId: string } & { app: string } | undefined,
    packages: Record<string, { instance_id?: string }>,
): Promise<string | null> {
    if (!landing) return null;
    const instanceId = packages[landing.groupId]?.instance_id;
    const instance = instanceId ? await storage.getInstance(instanceId) : null;
    const comp = instance?.installedComponents.find(c => c.type === 'app' && c.componentId === landing.app);
    if (!comp) return null;
    return `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(comp.registeredAs)}?mode=inline`;
}
