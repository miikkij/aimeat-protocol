/**
 * @file src/services/site-sync.ts
 * @description Pulls site content from the load-balancer origin into this node's local storage — the
 *   public site template, portal memory keys (with deletions), KV values, and system board posts — so
 *   mirror/edge nodes serve fresh site content. Tracks last-sync/last-error/syncing state and syncs deltas
 *   since the last successful run.
 *
 * @structure
 *   - getSiteSyncState(): snapshot of { lastSync, lastError, syncing }
 *   - doSync(config, storage, siteService): fetch origin /v1/site/sync?since=... and apply template/memory/KV/posts
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { SiteService } from './site.js';
import { logger } from '../utils/logger.js';

export interface SiteSyncState {
    lastSync: string | null;
    lastError: string | null;
    syncing: boolean;
}

const state: SiteSyncState = {
    lastSync: null,
    lastError: null,
    syncing: false,
};

export function getSiteSyncState(): SiteSyncState {
    return { ...state };
}

async function doSync(config: AimeatConfig, storage: Storage, siteService: SiteService): Promise<{ templateUpdated: boolean; memoryKeysSynced: number }> {
    const since = state.lastSync ?? '1970-01-01T00:00:00.000Z';
    const url = `${config.siteLbOriginUrl}/v1/site/sync?since=${encodeURIComponent(since)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Origin returned ${res.status}`);

    const body = await res.json() as {
        data: {
            sync_timestamp: string;
            template: { html: string; updated_at: string } | null;
            memory_keys: Array<{ key: string; value: unknown; updated_at: string }>;
            deleted_memory_keys: string[];
            kv: Record<string, string>;
            system_board_posts: Array<{ id: string; board_id: string; title: string; body: string; created_at: string }>;
            deleted_post_ids: string[];
        }
    };
    const data = body.data;

    let templateUpdated = false;
    let memoryKeysSynced = 0;

    // Sync template
    if (data.template?.html) {
        const buf = Buffer.from(data.template.html, 'utf-8');
        await storage.createStorageFile({
            key: '__site_template__',
            ownerGaii: '__site__',
            visibility: 'public',
            mimeType: 'text/html',
            size: buf.length,
            data: buf,
            createdAt: data.template.updated_at,
        });
        templateUpdated = true;
    }

    // Sync portal memory keys
    for (const mem of data.memory_keys) {
        await storage.setMemory({
            key: mem.key,
            ownerGaii: '__site__',
            value: mem.value,
            visibility: 'public',
            tags: ['site'],
            ttlHours: null,
            version: 1,
            createdAt: mem.updated_at,
            updatedAt: mem.updated_at,
        });
        memoryKeysSynced++;
    }
    for (const key of data.deleted_memory_keys) {
        await storage.deleteMemory('__site__', key);
    }

    // Sync KV values
    if (data.kv) {
        Object.assign(config.siteKv, data.kv);
    }

    // Invalidate cache so next request resolves fresh template
    siteService.invalidateCache();

    state.lastSync = data.sync_timestamp;
    state.lastError = null;

    return { templateUpdated, memoryKeysSynced };
}

export async function triggerSiteSync(config: AimeatConfig, storage: Storage, siteService: SiteService): Promise<{ templateUpdated: boolean; memoryKeysSynced: number }> {
    if (state.syncing) throw new Error('Sync already in progress');
    state.syncing = true;
    try {
        const result = await doSync(config, storage, siteService);
        logger.info(`Portal sync completed from ${config.siteLbOriginUrl}`, result);
        return result;
    } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
        logger.error('Portal sync failed', { error: state.lastError, origin: config.siteLbOriginUrl });
        throw err;
    } finally {
        state.syncing = false;
    }
}

export function startSiteSyncJob(config: AimeatConfig, storage: Storage, siteService: SiteService): void {
    if (!config.siteLbEnabled || !config.siteLbOriginUrl) return;

    const intervalMs = config.siteLbSyncIntervalMin * 60 * 1000;

    const runSync = () => {
        // eslint-disable-next-line aimeat/no-silent-catch -- triggerSiteSync already logs the failure; logging again would double-report one event
        triggerSiteSync(config, storage, siteService).catch(() => {
            // Error already logged in triggerSiteSync
        });
    };

    if (config.siteLbSyncOnStartup) {
        runSync();
    }

    setInterval(runSync, intervalMs);
    logger.info('Site LB sync job started', {
        origin: config.siteLbOriginUrl,
        intervalMin: config.siteLbSyncIntervalMin,
        syncOnStartup: config.siteLbSyncOnStartup,
    });
}
