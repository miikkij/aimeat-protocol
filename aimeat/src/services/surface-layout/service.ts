/**
 * @file src/services/surface-layout/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading, writing, versioning and restoring a surface layout, and the free-form
 *   passages its blocks point at. Every door — the HTTP routes, the import bundle and the MCP
 *   tools — comes through here, so the refusals and the changelog happen once.
 *
 *   TWO PREFIXES, BECAUSE THEY ARE NOT THE SAME KIND OF THING. The layout goes under `portal/`,
 *   which the LB mirror already syncs and the import bundle already understands; it is a list of
 *   block names, and on the portal it describes a public page anyway. The free-form BODIES do not:
 *   GET /v1/site/sync has no auth and returns every `portal/*` key WITH its value, and site writes
 *   are visibility 'public', so a department's internal note on its members' home would have been
 *   world-readable. Those go under `site/` at visibility 'owner' and are read only through the
 *   routes here. The cost is that they do not mirror yet; that is a known trade and its own work.
 *
 *   THE LAYOUT IS ONE VALUE, WRITTEN WHOLE. Never a key per block: the mirror never propagates a
 *   deletion (the origin ships an empty deleted_memory_keys on every sync), so a per-block key
 *   would be removable on the origin and permanent on every mirror.
 *
 *   UNDO IS FREE AND WAS NOT BUILT. `trackable: true` archives the previous value to memory_history
 *   on every overwrite, in both providers, and listMemoryHistory reads it back. A restore is
 *   re-validated before it is written: a version naming a block that has since left the registry is
 *   refused by name rather than restored into something that renders wrong.
 * @structure LAYOUT_KEY_PREFIX · FREEFORM_KEY_PREFIX · isReservedSurfaceKey · SurfaceLayoutService
 * @usage
 *   const svc = new SurfaceLayoutService(config, storage);
 *   const { layout, degraded } = await svc.resolve('home');
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, SiteChangeLogEntry } from '../../storage/interface.js';
import type { MemoryVersionRecord } from '../../storage/repositories/memory.repository.js';
import { SITE_OWNER_GAII, SiteError } from '../site.js';
import { defaultLayout } from './registry.js';
import type { ResolvedLayout, SurfaceId, SurfaceLayout } from './types.js';
import { SURFACE_IDS } from './types.js';
import { MAX_FREEFORM_BYTES, SLUG_RE, parseLayout, refuseMarkup, validateLayout } from './validate.js';
import { freeformKey, layoutKey } from './keys.js';

export { LAYOUT_KEY_PREFIX, FREEFORM_KEY_PREFIX, layoutKey, freeformKey, isReservedSurfaceKey } from './keys.js';

/** A checked layout and its passages, accepted but not yet stored. */
export interface PreparedLayout {
    surface: SurfaceId;
    layout: SurfaceLayout;
    /** Block key → the words that belong behind it. */
    bodies: Record<string, string>;
}

/** A layout as it arrives from an operator or their AI, with free-form text still inline. */
export interface LayoutSubmission {
    v?: number;
    surface?: string;
    /**
     * Untyped on purpose: this is what arrived over the wire, and it may carry a block's words
     * inline on `body`, which the stored shape has no field for. validateLayout is what decides
     * whether any of it is a block.
     */
    blocks?: unknown[];
    freeform?: Record<string, { ref: string; format: 'markdown' }>;
    meta?: { note?: string };
}

export class SurfaceLayoutService {
    constructor(
        private config: AimeatConfig,
        private storage: Storage,
    ) { }

    /** Whether the string names a surface. Routes take it from the path, so it is never trusted. */
    static isSurface(value: string): value is SurfaceId {
        return (SURFACE_IDS as readonly string[]).includes(value);
    }

    // ── Reading ──

    /**
     * What this surface should render. Falls back to the built-in layout when nothing is stored, when
     * the stored value cannot be read, or when repairing it left nothing. Never throws: this is on
     * the path of every page load.
     */
    async resolve(surface: SurfaceId): Promise<ResolvedLayout> {
        let stored: unknown;
        try {
            const record = await this.storage.getMemory(SITE_OWNER_GAII, layoutKey(surface));
            stored = record?.value;
        } catch (err) {
            // A storage failure must not blank the page. It is loud in the log and invisible to the
            // visitor, who gets the built-in layout.
            return {
                layout: defaultLayout(surface, this.config),
                degraded: true,
                problems: [`The stored layout could not be read (${(err as Error).message}); the built-in one is being shown.`],
                source: 'default',
            };
        }
        if (stored === undefined || stored === null) {
            return { layout: defaultLayout(surface, this.config), degraded: false, problems: [], source: 'default' };
        }

        const parsed = parseLayout(stored, surface, this.config);
        if (parsed.layout.blocks.length === 0) {
            return {
                layout: defaultLayout(surface, this.config),
                degraded: true,
                problems: parsed.problems.length
                    ? parsed.problems
                    : ['The stored layout held no blocks this node could show, so the built-in one is being shown.'],
                source: 'default',
            };
        }
        return { ...parsed, source: 'stored' };
    }

    /** The words behind the free-form blocks in a layout, keyed by the block's own key. */
    async readFreeform(layout: SurfaceLayout): Promise<Record<string, string>> {
        const out: Record<string, string> = {};
        for (const [key, entry] of Object.entries(layout.freeform ?? {})) {
            const record = await this.storage.getMemory(SITE_OWNER_GAII, freeformKey(entry.ref));
            if (record && typeof record.value === 'string') out[key] = record.value;
        }
        return out;
    }

    // ── Writing ──

    /**
     * Store a layout. Validates the whole thing first and writes nothing if any part of it is
     * refused. Free-form text may arrive inline on the block (which is what one paste from an AI
     * looks like); it is split out to its own record here so the layout stays small and each
     * passage gets its own history.
     */
    async write(
        surface: SurfaceId,
        submission: LayoutSubmission,
        changedBy: string,
        source: SurfaceLayout['meta']['source'],
    ): Promise<ResolvedLayout> {
        return this.commit(this.prepare(surface, submission, changedBy, source), changedBy);
    }

    /**
     * Everything that can be refused, done and nothing stored. Split out of write() so a paste
     * covering several surfaces can be checked in full before the first of them is written: half an
     * import applied leaves a page in a state nobody designed, and the operator with no way to tell
     * which half.
     */
    prepare(
        surface: SurfaceId,
        submission: LayoutSubmission,
        changedBy: string,
        source: SurfaceLayout['meta']['source'],
    ): PreparedLayout {
        const bodies = this.extractInlineBodies(submission);
        // `v` is passed through rather than forced: a submission written against a schema this node
        // does not know must be REFUSED, and stamping 1 over it would accept a shape nobody checked.
        // The rule itself lives in validateLayout, so every door gives the same answer.
        const layout = validateLayout(
            { ...submission, v: submission.v ?? 1, surface, meta: { ...submission.meta, updatedBy: changedBy, source } },
            surface,
            this.config,
        );
        // Every body is refused before any of them is stored, for the same reason.
        for (const [blockKey, body] of Object.entries(bodies)) {
            refuseMarkup(body, `the free-form block "${blockKey}"`);
        }
        return { surface, layout, bodies };
    }

    /** Write what prepare() already accepted. Nothing here can refuse. */
    async commit(prepared: PreparedLayout, changedBy: string): Promise<ResolvedLayout> {
        const { surface, layout, bodies } = prepared;
        for (const [blockKey, body] of Object.entries(bodies)) {
            const ref = layout.freeform?.[blockKey]?.ref;
            if (!ref) continue;
            await this.putMemory(freeformKey(ref), body, 'owner', ['site', 'freeform']);
        }
        await this.putMemory(layoutKey(surface), JSON.stringify(layout), 'public', ['site', 'layout']);
        await this.log('layout_set', `Set the ${surface} layout (${layout.blocks.length} blocks)`, changedBy);
        return { layout, degraded: false, problems: [], source: 'stored' };
    }

    /** Store one free-form passage on its own, without rewriting the layout around it. */
    async writeFreeform(slug: string, body: string, changedBy: string): Promise<void> {
        if (!SLUG_RE.test(slug)) {
            throw new SiteError('FREEFORM_INVALID',
                `"${slug}" is not a usable name for a passage: lower-case letters, numbers and dashes.`, 422);
        }
        refuseMarkup(body, `the passage "${slug}"`);
        await this.putMemory(freeformKey(slug), body, 'owner', ['site', 'freeform']);
        await this.log('layout_set', `Set the passage ${slug} (${Buffer.byteLength(body, 'utf-8')} bytes)`, changedBy);
    }

    /** Go back to the built-in layout for a surface. The free-form passages are left where they are. */
    async remove(surface: SurfaceId, changedBy: string): Promise<void> {
        await this.storage.deleteMemory(SITE_OWNER_GAII, layoutKey(surface));
        await this.log('layout_delete', `Reverted the ${surface} surface to the built-in layout`, changedBy);
    }

    // ── Versions ──

    /** Earlier versions of this surface's layout, newest first. */
    async versions(surface: SurfaceId, limit = 50): Promise<MemoryVersionRecord[]> {
        return this.storage.listMemoryHistory(SITE_OWNER_GAII, layoutKey(surface), { limit });
    }

    /**
     * Put an earlier version back. It is re-validated first: a version naming a block that has since
     * left the registry, or one this node can no longer serve, is refused by name rather than
     * restored into a page that renders wrong.
     */
    async restore(surface: SurfaceId, version: number, changedBy: string): Promise<ResolvedLayout> {
        const history = await this.versions(surface, 200);
        const found = history.find(h => h.version === version);
        if (!found) {
            throw new SiteError('VERSION_NOT_FOUND', `There is no version ${version} of the ${surface} layout.`, 404);
        }
        let value: unknown = found.value;
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch {
                throw new SiteError('VERSION_UNREADABLE', `Version ${version} of the ${surface} layout cannot be read.`, 422);
            }
        }
        const candidate = validateLayout(
            { ...(value as object), surface, meta: { updatedBy: changedBy, source: 'admin', note: `Restored version ${version}` } },
            surface,
            this.config,
        );
        await this.putMemory(layoutKey(surface), JSON.stringify(candidate), 'public', ['site', 'layout']);
        await this.log('layout_restore', `Restored the ${surface} layout to version ${version}`, changedBy);
        return { layout: candidate, degraded: false, problems: [], source: 'stored' };
    }

    // ── Internal ──

    /**
     * Pull `body` off the blocks it arrived on and leave a reference in its place. One paste from an
     * AI carries the words inside the block, which is the right shape to write and the wrong shape
     * to store.
     */
    private extractInlineBodies(submission: LayoutSubmission): Record<string, string> {
        const bodies: Record<string, string> = {};
        const freeform: Record<string, { ref: string; format: 'markdown' }> = { ...(submission.freeform ?? {}) };
        const strip = (list: unknown[] | undefined): void => {
            for (const item of list ?? []) {
                if (!item || typeof item !== 'object') continue;
                const inst = item as Record<string, unknown>;
                if (Array.isArray(inst.children)) strip(inst.children);
                if (inst.id !== 'common.freeform' || typeof inst.body !== 'string') continue;
                const key = typeof inst.key === 'string' && inst.key ? inst.key : '';
                if (!key) continue;
                bodies[key] = inst.body;
                delete inst.body;
                if (!freeform[key]) freeform[key] = { ref: slugFor(key), format: 'markdown' };
            }
        };
        strip(submission.blocks);
        // Also pick up bodies for entries that already carried a ref, so an edit-in-place still writes.
        submission.freeform = Object.keys(freeform).length ? freeform : submission.freeform;
        return bodies;
    }

    private async putMemory(
        key: string,
        value: string,
        visibility: 'public' | 'owner',
        tags: string[],
    ): Promise<void> {
        const now = new Date().toISOString();
        const existing = await this.storage.getMemory(SITE_OWNER_GAII, key);
        await this.storage.setMemory({
            key,
            ownerGaii: SITE_OWNER_GAII,
            value,
            visibility,
            tags,
            ttlHours: null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            // The previous value is archived on overwrite, which is where undo comes from.
            trackable: true,
        });
    }

    private async log(action: SiteChangeLogEntry['action'], summary: string, changedBy: string): Promise<string> {
        const id = `site-${Date.now()}-${randomBytes(4).toString('hex')}`;
        await this.storage.addSiteChangeLog({ id, action, summary, changedBy, changedAt: new Date().toISOString() });
        return id;
    }
}

/** A storage name derived from the block's own key, so the two stay legible next to each other. */
function slugFor(blockKey: string): string {
    const slug = blockKey.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    return SLUG_RE.test(slug) ? slug : `p${randomBytes(4).toString('hex')}`;
}

export { MAX_FREEFORM_BYTES };
