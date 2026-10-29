/**
 * @file src/services/cortex-holder-change.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When a bare cortex name changes holder, the apps that loaded the old holder's library
 *   at that address load the new holder's only after their owner allows it once, with one press.
 *
 *   WHY. Account erasure and the operator's held-name settlement delete a cortex in storage, and its
 *   bare name is free for the next install (test/e2e-account-doors.ts case 60: the name registered
 *   again reinstalls the cortex at the bare address). Every other owner's app that loads
 *   `/v1/cortex/<name>/libs/<file>` then ran the next installer's code (secaudit2026oct26,
 *   component-address.ts:releaseBareName:erasure-and-package-uninstall-skip-release). The developer's
 *   decision (2026-10-29, round 8c): the name is released the way the other release paths release it
 *   and stays free for a new holder; callers that used the old holder's code at that address see that
 *   the holder changed, and the new holder's code runs for them only after they approve it once.
 *
 *   HOW.
 *   - The erasure and the settlement write a released-name row whose holder starts with
 *     FREED_RELEASE_PREFIX (storage/types/component-versions.ts). Unlike an uninstall's row it does not
 *     retire the name (component-address.ts installNameFor): it records that the holder changed.
 *   - noteCortexHolderChange(), asked when a new cortex record takes such a name, finds the apps of
 *     other owners that loaded the cortex before it was freed (the dependency map: the apps that load
 *     it, and the apps that load a cortex that loads it), keeps them in one record under the node's own
 *     namespace (HOLDER_CHANGE_KEY), and asks each app owner once in the request store under the
 *     approval standard (services/approval-standard.ts): a notice with Allow and Don't allow, the new
 *     holder hears the answer either way and reads the question as pending.
 *   - The library route asks heldForRequest(): a lib request whose page is one of those apps
 *     (its Origin or Referer, matched to this node's app addresses) answers 404 until the app's owner
 *     allowed it (publish-requests/apply-cortex-holder.ts). Every other request is served as before.
 *
 *   LIMITS. The app is recognised by the address its page sends. A page that sends no Origin and no
 *   Referer (its own `no-referrer` policy) is served as any other request. An app published after the
 *   holder changed is the new holder's caller from its start and is not asked.
 * @structure HOLDER_CHANGE_KEY · CortexHolderChange · noteCortexHolderChange · heldForRequest ·
 *   allowHolderChange · appRefOfRequest
 * @usage
 *   await noteCortexHolderChange({ storage, config }, record, caller.gaii);   // before settleReclaimed
 *   if (await heldForRequest({ storage, config }, found.name, req)) return 404;
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, memory-b-08).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord, MemoryRecord } from '../storage/interface.js';
import { isFreedRelease } from '../storage/types/component-versions.js';
import { dependentsOf } from './dependency-map.js';
import { resolveAppOriginTarget } from './app-origin-target.js';
import { fileAsk } from './publish-requests/ask.js';
import { askerKind } from './approval-standard.js';
import { emitChange } from './event-bus.js';
import { serialByKey } from '../utils/serial-by-key.js';
import { logger } from '../utils/logger.js';

/** The node's record of one cortex name's holder change, under `system@<nodeId>`. */
export const HOLDER_CHANGE_KEY = (name: string): string => `cortex.holder-change.${name}`;

/** One app owner's answer: waiting (or not allowed), or allowed. */
interface AppOwnerAsk { apps: string[]; request_id: string | null; allowed: boolean }

export interface CortexHolderChange {
    name: string;
    /** The account that holds the name now. */
    holder: string;
    /** When the name was freed, and when the new holder installed it. */
    freedAt: string;
    since: string;
    /** By app owner: the apps (`owner/filename`) that loaded the earlier holder's library. */
    owners: Record<string, AppOwnerAsk>;
}

type Deps = { storage: Storage; config: AimeatConfig };
const nodeOwner = (config: AimeatConfig) => `system@${config.nodeId}`;

async function readChange(storage: Storage, config: AimeatConfig, name: string): Promise<{ row: MemoryRecord | null; change: CortexHolderChange | null }> {
    const row = await storage.getMemory(nodeOwner(config), HOLDER_CHANGE_KEY(name));
    const v = row?.value as CortexHolderChange | undefined;
    return { row: row ?? null, change: v && typeof v.holder === 'string' && v.owners && typeof v.owners === 'object' ? v : null };
}

async function writeChange(storage: Storage, config: AimeatConfig, change: CortexHolderChange, before: MemoryRecord | null): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key: HOLDER_CHANGE_KEY(change.name), ownerGaii: nodeOwner(config), value: change, visibility: 'private',
        tags: ['cortex-holder-change'], ttlHours: null, version: before ? before.version + 1 : 1,
        createdAt: before?.createdAt ?? now, updatedAt: now,
    });
}

/** The apps of other owners that loaded `name` before `freedAt`: directly, or through a cortex that loads it. */
async function formerCallerApps(storage: Storage, name: string, holder: string, freedAt: string): Promise<Map<string, string[]>> {
    const direct = await dependentsOf(storage, 'cortex', name);
    const apps = [...direct.apps];
    for (const c of direct.cortexes) apps.push(...(await dependentsOf(storage, 'cortex', c.name)).apps);
    const byOwner = new Map<string, string[]>();
    const freed = Date.parse(freedAt);
    for (const a of apps) {
        if (a.owner === holder) continue;
        const ref = `${a.owner}/${a.filename}`;
        if (byOwner.get(a.owner)?.includes(ref)) continue;
        // Only an app that exists and was there before the name was freed: a later one is the new holder's caller.
        const app = await storage.getAppByOwnerName(a.owner, a.filename);
        if (!app || !(Date.parse(app.createdAt) < freed)) continue;
        byOwner.set(a.owner, [...(byOwner.get(a.owner) ?? []), ref]);
    }
    return byOwner;
}

/**
 * A new cortex record took a bare name the erasure or the settlement freed: ask each owner of an app
 * that loaded the earlier library. Asked before the install settles the released row. Never throws:
 * a failure is logged and the install goes on.
 */
export async function noteCortexHolderChange(deps: Deps, record: Pick<CortexExtensionRecord, 'name' | 'installedBy' | 'installedAt'>, asker: string): Promise<void> {
    const { storage, config } = deps;
    try {
        if (record.name.includes('/') || typeof storage.getReleasedComponentName !== 'function') return;
        const released = await storage.getReleasedComponentName('cortex', record.name);
        if (!released || !isFreedRelease(released)) return;
        const byOwner = await formerCallerApps(storage, record.name, record.installedBy, released.releasedAt);
        // No app of another owner loaded it: nobody to ask, and an older record names another holder.
        if (byOwner.size === 0) return;
        // The acting principal: an agent's GAII, or the account holder, whom the request store keeps as a GHII.
        const principal = asker.includes('@') ? asker : `${asker}@${config.nodeId}`;
        await serialByKey(`cortex-holder:${record.name}`, async () => {
            const { row } = await readChange(storage, config, record.name);
            const change: CortexHolderChange = {
                name: record.name, holder: record.installedBy, freedAt: released.releasedAt, since: record.installedAt, owners: {},
            };
            for (const [owner, apps] of byOwner) {
                const filed = await fileAsk({ storage, config }, owner, { principal, kind: askerKind(principal), sub: principal }, {
                    kind: 'cortex-holder',
                    target: { cortex: record.name, holder: record.installedBy, since: record.installedAt, apps: apps.join(',') },
                    title: `the library ${record.name} from its new holder ${record.installedBy}`,
                    name: record.name,
                    change: { field: 'holder', from: 'an earlier account', to: record.installedBy },
                    approval: {
                        approver: 'owner',
                        asks: `let your apps ${apps.join(', ')} load the library ${record.name}, which now belongs to ${record.installedBy}`,
                        why: `The account that held the library ${record.name} is gone, and ${record.installedBy} installed a new library under the same name. `
                            + `Your apps load it by that name, so they would run code by ${record.installedBy}. Until you allow it, they do not load it.`,
                        approve_scope: 'app:write',
                        i18n: { key: 'approval_cortex_holder', vars: { cortex: record.name, holder: record.installedBy, apps: apps.join(', ') } },
                    },
                });
                change.owners[owner] = { apps, request_id: filed.ok ? filed.request.id : null, allowed: false };
                if (!filed.ok) logger.warn('cortex holder change: an app owner could not be asked; the apps stay held', { cortex: record.name, owner, error: filed.message });
            }
            await writeChange(storage, config, change, row);
        });
    } catch (err) {
        logger.warn('cortex holder change: not recorded', { cortex: record.name, error: String(err) });
    }
}

/** The owner allowed it: their apps load the new holder's library. False when the request no longer fits. */
export async function allowHolderChange(deps: Deps, name: string, holder: string, owner: string, requestId: string): Promise<boolean> {
    const { storage, config } = deps;
    return serialByKey(`cortex-holder:${name}`, async () => {
        const { row, change } = await readChange(storage, config, name);
        const ask = change?.owners[owner];
        if (!change || change.holder !== holder || !ask || ask.request_id !== requestId) return false;
        ask.allowed = true;
        await writeChange(storage, config, change, row);
        emitChange('cortex');
        return true;
    });
}

/** The app (`owner/filename`) whose page asks, from its Origin or Referer, or null. */
export async function appRefOfRequest(
    config: AimeatConfig, storage: Storage, headers: { origin?: string; referer?: string },
): Promise<string | null> {
    const from = headers.origin && headers.origin !== 'null' ? headers.origin : headers.referer;
    if (!from) return null;
    const url = URL.canParse(from) ? new URL(from) : null;
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    // No parsable apex: only the app origins match.
    const apex = URL.canParse(config.baseUrl) ? new URL(config.baseUrl).hostname.toLowerCase() : '';
    const pathRef = (re: RegExp): string | null => {
        const m = re.exec(url.pathname);
        return m ? `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}` : null;
    };
    // The app on the node's own address (no app subdomains), and the path form on the bare app host.
    if (apex && host === apex) return pathRef(/^\/v1\/apps\/([^/]+)\/([^/?#]+)/);
    if (config.appHost && host === config.appHost.toLowerCase()) return pathRef(/^\/([^/]+)\/([^/?#]+)/);
    const target = await resolveAppOriginTarget(config, storage, url.origin);
    return target.ok && target.family === 'app' ? target.target : null;
}

/**
 * Is this lib request from an app whose owner has not allowed the cortex's new holder? A request from a
 * page costs one record read; the app is resolved only when the node holds a holder change for the name.
 */
export async function heldForRequest(
    deps: Deps, name: string, headers: { origin?: string; referer?: string },
): Promise<boolean> {
    // A request with no page behind it is no app's: nothing to read.
    if (!headers.origin && !headers.referer) return false;
    const { change } = await readChange(deps.storage, deps.config, name);
    if (!change) return false;
    // The change is about the holder that installed after it; a later holder is asked anew.
    if ((await deps.storage.getCortexExtension(name))?.installedBy !== change.holder) return false;
    const ref = await appRefOfRequest(deps.config, deps.storage, headers);
    if (!ref) return false;
    const ask = Object.values(change.owners).find(a => a.apps.includes(ref));
    return !!ask && !ask.allowed;
}
