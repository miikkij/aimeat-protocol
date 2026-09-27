/**
 * @file src/services/app-tools-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which key an app's tool manifest lives under, decided once: `apps.{filename}.tools`,
 *   the app's published filename with its extension.
 *
 *   WHY. aimeat_app_tools_publish took any `app_id` and wrote `apps.{app_id}.tools`, while both app
 *   catalogues (/app-catalog.html and /v1/appcat), the WebMCP manifest (routes/webmcp.ts), the app's
 *   legal page (services/app-legal.ts) and the tool-name lookup (services/app-tool-names.ts) read
 *   `apps.{filename}.tools`. A seller who named the app "ai-slop-detector" for the app
 *   "ai-slop-detector.html" had a manifest the market could sell and no catalogue could show. On
 *   aimeat.io on 2026-09-27, 18 of the 20 public manifests used the filename; the reported one did not.
 *
 *   THE RULE. When the owner has an app whose filename is the given id, the id stands. When they have
 *   none, but have one named `{id}.html`, the manifest belongs to that app and takes its filename.
 *   Otherwise the id stands as given: a manifest may be written before its app is published, and a
 *   seller may list tools that no app carries (happydude500001/company-brief on aimeat.io).
 *
 *   WHERE IT RUNS. In the shared memory write (services/memory-write.ts), which every door that writes
 *   a manifest goes through: POST /v1/memory, the node MCP's aimeat_app_tools_publish, and the
 *   connector and CLI surfaces, which post to /v1/memory. And once per node on boot, for the manifests
 *   written before the rule (migrateAppToolsKeysOnce).
 * @structure canonicalAppToolsId · canonicalAppToolsKey · APP_TOOLS_KEY_MIGRATION_KEY · migrateAppToolsKeysOnce
 * @usage
 *   const key = await canonicalAppToolsKey(storage, ownerGhii, 'apps.nuotta.tools'); // 'apps.nuotta.html.tools'
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (wish-tools-for-sale-published-over-mcp-do-not-show-in-the-app-cat).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appToolsKey, appIdFromToolsKey } from '../models/app-tool-schemas.js';
import { parseGAII } from '../utils/gaii.js';
import { listAllOfferings } from './exchange-market.js';
import { reconcileAfterSourceWrite } from './exchange-projection.js';
import { logger } from '../utils/logger.js';

/**
 * The app id a tool manifest belongs under, for an owner GHII. See THE RULE in the header.
 * An agent's namespace is never an app owner, so an id there stands as given.
 */
export async function canonicalAppToolsId(storage: Storage, ownerGaii: string, appId: string): Promise<string> {
    if (parseGAII(ownerGaii)) return appId;
    if (await storage.getApp(ownerGaii, appId)) return appId;
    const withExtension = `${appId}.html`;
    if (await storage.getApp(ownerGaii, withExtension)) return withExtension;
    return appId;
}

/** The key a write to `key` belongs under. Any key that is not a tool manifest comes back as it is. */
export async function canonicalAppToolsKey(storage: Storage, ownerGaii: string, key: string): Promise<string> {
    const appId = appIdFromToolsKey(key);
    if (!appId) return key;
    const canonical = await canonicalAppToolsId(storage, ownerGaii, appId);
    return canonical === appId ? key : appToolsKey(canonical);
}

/** The record that says this node has carried its manifests over, under `system@<nodeId>`. */
export const APP_TOOLS_KEY_MIGRATION_KEY = 'migrations.app-tools-keys';

/** What one call did. */
export interface AppToolsKeyMigration {
    /** False when this node had already run it: nothing was read or written. */
    ran: boolean;
    /** Each manifest carried over, as `owner: from -> to`. */
    moved: string[];
    /** Each manifest left where it was, and why, for the operator to decide. */
    left: string[];
}

/**
 * Once per node: carry every tool manifest written under an app id that is not its app's filename
 * over to the filename key, so the catalogues show it. The value, visibility, tags, version and
 * creation time go with it; the EXCHANGE projection is reconciled for the new key and then for the
 * old one, so a listing follows its manifest.
 *
 * Two cases stay where they are, named in `left` and in the log: a filename key that already holds a
 * manifest (two records, and which one is right is the owner's call), and a manifest with a live
 * EXCHANGE listing, because a contract names its listing and would lose it.
 *
 * Throws when a write fails and then leaves no record, so the next boot tries again; a manifest
 * already carried over is not found a second time.
 */
export async function migrateAppToolsKeysOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<AppToolsKeyMigration> {
    const system = `system@${config.nodeId}`;
    if (await storage.getMemory(system, APP_TOOLS_KEY_MIGRATION_KEY)) return { ran: false, moved: [], left: [] };

    const moved: string[] = [];
    const left: string[] = [];
    let listed: Awaited<ReturnType<typeof listAllOfferings>> | null = null;

    for (const owner of await storage.listOwners()) {
        const ownerGhii = `${owner.name}@${config.nodeId}`;
        const records = (await storage.listMemory(ownerGhii, { prefix: 'apps.' }))
            .filter(r => appIdFromToolsKey(r.key) !== null);
        for (const summary of records) {
            const appId = appIdFromToolsKey(summary.key)!;
            const canonical = await canonicalAppToolsId(storage, ownerGhii, appId);
            if (canonical === appId) continue;
            const label = `${owner.name}: ${appId} -> ${canonical}`;
            const toKey = appToolsKey(canonical);
            if (await storage.getMemory(ownerGhii, toKey)) {
                left.push(`${label} (the filename key already holds a manifest)`);
                continue;
            }
            listed ??= (await listAllOfferings(storage)).filter(o => o.state === 'listed');
            if (listed.some(o => o.providerOwner === owner.name && o.surface?.appId === appId)) {
                left.push(`${label} (it has a live EXCHANGE listing)`);
                continue;
            }
            const rec = await storage.getMemory(ownerGhii, summary.key);
            if (!rec) continue;
            await storage.setMemory({ ...rec, key: toKey, updatedAt: new Date().toISOString() });
            await reconcileAfterSourceWrite(storage, ownerGhii, toKey);
            await storage.deleteMemory(ownerGhii, summary.key, system);
            await reconcileAfterSourceWrite(storage, ownerGhii, summary.key);
            moved.push(label);
        }
    }

    const now = new Date().toISOString();
    await storage.setMemory({
        key: APP_TOOLS_KEY_MIGRATION_KEY,
        ownerGaii: system,
        value: { at: now, moved, left },
        visibility: 'private',
        tags: ['migration'],
        // Never swept: a record that expired would run the migration again at the next boot.
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
    });
    if (moved.length || left.length) {
        logger.info('app tool manifests: carried over to the app filename key', { moved, left });
    }
    return { ran: true, moved, left };
}
