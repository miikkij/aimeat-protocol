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
 *   NO DEAD END (rule 1: the owner always has a way to release the hold).
 *   - While an app is held and no question waits for its owner (none could be filed, the question
 *     expired or went out of date, or a declined one reached the end of its 30-day record), the next
 *     library request from that app files the question again (askAgainIfDue). A filed question is asked
 *     at most once a day per app owner and holder, so a busy page does not fill the bell; a filing the
 *     owner's full queue refused is tried again on a later load, at most once a minute, so it is filed
 *     as soon as there is room.
 *   - Don't allow holds the apps back until the owner changes it: no question is filed while the
 *     declined one exists, and the owner allows later by approving that same request (POST
 *     /v1/publish-requests/:id/decision, aimeat_publish_requests and its CLI twin; decide.ts
 *     REVERSIBLE_KINDS).
 *
 *   LIMITS. The app is recognised by the address its page sends. A page that sends no Origin and no
 *   Referer (its own `no-referrer` policy) is served as any other request. An app published after the
 *   holder changed is the new holder's caller from its start and is not asked.
 * @structure HOLDER_CHANGE_KEY · CortexHolderChange · noteCortexHolderChange · heldForRequest ·
 *   askAgainIfDue · allowHolderChange · appRefOfRequest
 * @usage
 *   await noteCortexHolderChange({ storage, config }, record, caller.gaii);   // before settleReclaimed
 *   if (await heldForRequest({ storage, config }, found.name, req)) return 404;
 * @version-history
 *   v1.1.0 — 2026-10-30 — No dead end: a held app with no waiting question files it again on its next
 *     library request (once a day per owner and holder; a full queue is tried again once a minute), and
 *     a Don't allow is released by approving the same request later (coordinator, round 8c).
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, memory-b-08).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord, MemoryRecord } from '../storage/interface.js';
import { isFreedRelease } from '../storage/types/component-versions.js';
import { dependentsOf } from './dependency-map.js';
import { resolveAppOriginTarget } from './app-origin-target.js';
import { fileAsk, accountGhii } from './publish-requests/ask.js';
import { readPublishRequest, effectiveState } from './publish-requests/store.js';
import { askerKind } from './approval-standard.js';
import { emitChange } from './event-bus.js';
import { serialByKey } from '../utils/serial-by-key.js';
import { logger } from '../utils/logger.js';

/** The node's record of one cortex name's holder change, under `system@<nodeId>`. */
export const HOLDER_CHANGE_KEY = (name: string): string => `cortex.holder-change.${name}`;

/** A filed question is asked again at most this often per app owner and holder. */
export const ASK_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;
/** A filing the owner's full queue refused is tried again at most this often. */
export const RETRY_FULL_QUEUE_AFTER_MS = 60 * 1000;

/** One app owner's answer: waiting (or not allowed), or allowed. */
interface AppOwnerAsk {
    apps: string[];
    request_id: string | null;
    allowed: boolean;
    /** When a question was last filed, and when a filing was last tried and refused. */
    asked_at?: string;
    tried_at?: string;
    /** Earlier questions for the same apps and holder, so approving one of them still releases them. */
    earlier?: string[];
}

export interface CortexHolderChange {
    name: string;
    /** The account that holds the name now. */
    holder: string;
    /** When the name was freed, and when the new holder installed it. */
    freedAt: string;
    since: string;
    /** Who installed it (an agent's GAII or the account's GHII): the one a question names as asking. */
    asker?: string;
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
 * File one app owner's question, and write on `ask` what came of it: the request id and when it was
 * asked, or when a filing was tried and refused (the owner's queue is full). Never throws.
 */
async function fileOwnerAsk(deps: Deps, change: CortexHolderChange, owner: string, ask: AppOwnerAsk): Promise<void> {
    const { storage, config } = deps;
    const principal = change.asker ?? accountGhii(change.holder, config.nodeId);
    const apps = ask.apps;
    const now = new Date().toISOString();
    try {
        const filed = await fileAsk({ storage, config }, owner, { principal, kind: askerKind(principal), sub: principal }, {
            kind: 'cortex-holder',
            target: { cortex: change.name, holder: change.holder, since: change.since, apps: apps.join(',') },
            title: `the library ${change.name} from its new holder ${change.holder}`,
            name: change.name,
            change: { field: 'holder', from: 'an earlier account', to: change.holder },
            approval: {
                approver: 'owner',
                asks: `let your apps ${apps.join(', ')} load the library ${change.name}, which now belongs to ${change.holder}`,
                why: `The account that held the library ${change.name} is gone, and ${change.holder} installed a new library under the same name. `
                    + `Your apps load it by that name, so they would run code by ${change.holder}. Until you allow it, they do not load it.`,
                approve_scope: 'app:write',
                i18n: { key: 'approval_cortex_holder', vars: { cortex: change.name, holder: change.holder, apps: apps.join(', ') } },
            },
        });
        if (filed.ok) {
            if (ask.request_id && ask.request_id !== filed.request.id) ask.earlier = [...(ask.earlier ?? []), ask.request_id].slice(-10);
            ask.request_id = filed.request.id;
            ask.asked_at = now;
            delete ask.tried_at;
            return;
        }
        ask.tried_at = now;
        logger.warn('cortex holder change: an app owner could not be asked yet; the next load from the app tries again', { cortex: change.name, owner, error: filed.message });
    } catch (err) {
        ask.tried_at = now;
        logger.warn('cortex holder change: an app owner could not be asked yet', { cortex: change.name, owner, error: String(err) });
    }
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
        await serialByKey(`cortex-holder:${record.name}`, async () => {
            const { row } = await readChange(storage, config, record.name);
            const change: CortexHolderChange = {
                name: record.name, holder: record.installedBy, freedAt: released.releasedAt, since: record.installedAt,
                // The acting principal: an agent's GAII, or the account holder, whom the request store keeps as a GHII.
                asker: asker.includes('@') ? asker : accountGhii(asker, config.nodeId),
                owners: {},
            };
            for (const [owner, apps] of byOwner) {
                const ask: AppOwnerAsk = { apps, request_id: null, allowed: false };
                await fileOwnerAsk(deps, change, owner, ask);
                change.owners[owner] = ask;
            }
            await writeChange(storage, config, change, row);
        });
    } catch (err) {
        logger.warn('cortex holder change: not recorded', { cortex: record.name, error: String(err) });
    }
}

/**
 * The app owner's apps are held and no question of theirs waits: file it again. Waiting means a
 * question still awaiting the owner, or a declined one (Don't allow holds until the owner approves that
 * same request). A question expired, gone out of date, never filed, or a record gone at the end of its
 * lifetime is filed again, at most once a day; a refused filing is tried again at most once a minute.
 * Never throws.
 */
export async function askAgainIfDue(deps: Deps, name: string, owner: string, now = Date.now()): Promise<void> {
    const { storage, config } = deps;
    try {
        await serialByKey(`cortex-holder:${name}`, async () => {
            const { row, change } = await readChange(storage, config, name);
            const ask = change?.owners[owner];
            if (!change || !ask || ask.allowed) return;
            if (ask.request_id) {
                const r = await readPublishRequest(storage, accountGhii(owner, config.nodeId), ask.request_id);
                const state = r ? effectiveState(r, now) : null;
                if (state === 'awaiting_owner' || state === 'declined' || state === 'approved') return;
            }
            const since = (t: string | undefined) => (t ? now - Date.parse(t) : Infinity);
            if (since(ask.asked_at) < ASK_AGAIN_AFTER_MS || since(ask.tried_at) < RETRY_FULL_QUEUE_AFTER_MS) return;
            // The holder may have installed the name again since; the question names the install that runs.
            const live = await storage.getCortexExtension(name);
            if (!live || live.installedBy !== change.holder) return;
            change.since = live.installedAt;
            await fileOwnerAsk(deps, change, owner, ask);
            await writeChange(storage, config, change, row);
        });
    } catch (err) {
        logger.warn('cortex holder change: the question could not be asked again', { cortex: name, owner, error: String(err) });
    }
}

/** The owner allowed it: their apps load the new holder's library. False when the request no longer fits. */
export async function allowHolderChange(deps: Deps, name: string, holder: string, owner: string, requestId: string): Promise<boolean> {
    const { storage, config } = deps;
    return serialByKey(`cortex-holder:${name}`, async () => {
        const { row, change } = await readChange(storage, config, name);
        const ask = change?.owners[owner];
        if (!change || change.holder !== holder || !ask) return false;
        if (ask.request_id !== requestId && !(ask.earlier ?? []).includes(requestId)) return false;
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
 * A held app with no waiting question files it again (askAgainIfDue), without delaying the answer.
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
    const owner = Object.keys(change.owners).find(o => change.owners[o].apps.includes(ref));
    if (!owner || change.owners[owner].allowed) return false;
    void askAgainIfDue(deps, name, owner);
    return true;
}
