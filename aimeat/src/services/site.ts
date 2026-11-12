/**
 * @file src/services/site.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SiteService — serves the portal HTML (custom operator template or default spa.html
 *   fallback, cached), and holds the operator's portal content: the template file, the `portal/*`
 *   memory records and the header-nav config. The {{...}} tag grammar itself lives in site-tags.ts.
 *
 * @structure
 *   - SiteService.getPortalHtml(): returns portal HTML with tag substitution and TTL caching
 *   - SiteService.getTemplatePage(reader): the stored page a reader gets (the default page or a
 *     language version), with the languages the front page has
 *   - uploadTemplate / getTemplate / deleteTemplate take an optional language; listTemplates()
 *   - HeaderNavConfig / PUBLIC_NAV_LINK_IDS: operator-configurable public header link order/visibility
 *   - validateTemplate(): the refusals an uploaded template must survive, script-tag rule included
 *
 * @version-history
 *   v1.6.0 — 2026-11-12 — The template has language versions: one whole page per language, stored
 *     beside the default page under `__site_template__.<code>`. getTemplatePage picks the reader's
 *     page (site/template-languages.ts); the resolved HTML is cached per page. Deleting the default
 *     page deletes its language versions.
 *   v1.5.0 — 2026-08-29 — PUBLIC_NAV_LINK_IDS drops `exchange`: the EXCHANGE app is a site-footer link
 *     now, like the store. A stored order or hidden list naming it is filtered out on read.
 *   v1.4.0 — 2026-08-26 — Pure extraction: the tag grammar (CONFIG_WHITELIST, TAG_REGEX, escapeHtml)
 *     and its resolver (resolveTemplate, resolveBoardTag, getConfigValue, extractTags,
 *     findUnresolvableTags) move to site-tags.ts as free functions, so a second surface can resolve
 *     tags without reaching into this class. No behaviour change; validateTemplate stays here
 *     because the trust boundary it guards belongs to the template, not to the grammar.
 *   v1.3.0 — 2026-08-09 — PUBLIC_NAV_LINK_IDS drops `try` (it pointed at /v1/portal, where the brand
 *     link already goes) and `devView` (moved to the SPA's site footer). A stored order or hidden
 *     list naming either is filtered out by getHeaderNav, so no node needs a migration.
 *   v1.2.0 — 2026-07-28 — PUBLIC_NAV_LINK_IDS gains `learn` and `exchange` (operator-owned apps;
 *     the SPA renders them only when AIMEAT_SITE_*_URL is configured). getHeaderNav now slots a
 *     newly-declared link next to its declared neighbour instead of appending it, so shipping a
 *     nav item is visible on nodes that already saved an order rather than buried after "Help".
 *   v1.1.0 — 2026-07-14 — Inject the WebMCP bridge script into every portal HTML (custom or
 *     default) at this chokepoint — both GET / routes call getPortalHtml (TARGET-034 phase C)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage, SiteChangeLogEntry } from '../storage/interface.js';
import { getSiteSyncState } from './site-sync.js';
import { substituteVariables, resolvePromptContent } from './prompt-variables.js';
import { extractTags, findUnresolvableTags, resolveTags, type TagDeps } from './site-tags.js';
import { isReservedSurfaceKey } from './surface-layout/keys.js';
import { documentLanguage, pickTemplateVersion, type TemplateReader, type TemplateVersions } from './site/template-languages.js';
import { logger } from '../utils/logger.js';

const __dirname_site = dirname(fileURLToPath(import.meta.url));

/** Resolve path to public/spa.html (works from both src/ and dist/). */
function resolveSpaHtmlPath(): string {
    const candidates = [
        join(__dirname_site, '..', '..', 'public', 'spa.html'),      // dev: src/services/../../public
        join(__dirname_site, '..', '..', '..', 'public', 'spa.html'), // dist: dist/src/services/../../../public
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return candidates[0]; // fallback
}

const SPA_HTML_PATH = resolveSpaHtmlPath();

// Reserved storage key for the portal template
const SITE_TEMPLATE_KEY = '__site_template__';
/** The storage key of the default page, or of the language version `lang` stored beside it. */
export function siteTemplateKey(lang?: string): string {
    return lang ? `${SITE_TEMPLATE_KEY}.${lang}` : SITE_TEMPLATE_KEY;
}
/** The language of a language version's storage key; undefined for any other key. */
function versionOfKey(key: string): string | undefined {
    return key.match(/^__site_template__\.([a-z]{2})$/)?.[1];
}

/** The stored page a reader gets. */
export interface TemplatePage {
    /** The resolved HTML, tags substituted. */
    html: string;
    /** The language version served; undefined when it is the default page. */
    version?: string;
    /** The language of the served page: the version's, or the one the default page states. */
    lang?: string;
    /** Every page the front page has, for the hreflang links. */
    versions: TemplateVersions;
}

/** One stored page of the front page, without its bytes. */
export interface TemplateListing {
    /** null for the default page. */
    lang: string | null;
    sizeBytes: number;
    updatedAt: string;
}
/**
 * System owner GAII used for site template storage, and for every other piece of node-level content
 * that belongs to nobody in particular: the `portal/*` records, the email templates, and the surface
 * layouts. Exported because the surface-layout service stores under the same pseudo-owner and a
 * second copy of the string is a second thing to keep in step.
 */
export const SITE_OWNER_GAII = '__site__';
// Portal memory key holding the header navigation configuration (order + hidden)
const HEADER_NAV_KEY = 'portal/header-nav';
// Canonical ids of the public header links an operator may show/hide/reorder.
// Auth/role-gated links (Apps, Profile, Admin) are NOT configurable — they stay
// forced by their existing session/role rules in the SPA header.
// `learn` points at an app this node's operator owns; the SPA renders it only when
// AIMEAT_SITE_LEARN_URL is set. It is listed here so an operator who HAS it can still reorder or
// hide it from the Portal tab.
// The first three are logged-out links (PUBLIC_NAV_LINKS `when: 'anon'` in spa.html); `help`
// shows in both states. What a signed-in person needs is not configurable and not here.
// `try` and `devView` left on 2026-08-09: the first was the brand link's destination under a
// second name, the second moved to the site footer with `members`. `exchange` followed them to
// the footer on 2026-08-29 (an app opened now and then, not a place visited every time); a
// stored order naming it is filtered out on read like the two before it.
export const PUBLIC_NAV_LINK_IDS = ['howItWorks', 'learn', 'business', 'help'] as const;

export interface HeaderNavConfig {
    /** Display order of public link ids (always normalized to cover all known ids). */
    order: string[];
    /** Subset of public link ids that should be hidden. */
    hidden: string[];
}

export class SiteService {
    /** Resolved HTML per stored page; the default page is under the empty key. */
    private cache = new Map<string, { html: string; expiresAt: number }>();
    /** Which pages are stored, held as long as the HTML. */
    private versionsCache: { versions: TemplateVersions | null; expiresAt: number } | null = null;

    constructor(
        private config: AimeatConfig,
        private storage: Storage,
    ) { }

    /** What site-tags.ts needs to answer a {{...}} tag on this node's behalf. */
    private get tagDeps(): TagDeps {
        return { config: this.config, storage: this.storage, ownerGaii: SITE_OWNER_GAII };
    }

    /**
     * WebMCP bridge (TARGET-034 phase C): every served homepage — operator-custom template or the
     * default portal — carries the bridge script so in-browser agents + readiness scanners see
     * the node-level tools on document/navigator.modelContext. Injected here, THE portal-HTML
     * chokepoint (both `GET /` routes call this), so custom templates need no edits. Idempotent;
     * same-origin script; a page without the agent API gets a no-op.
     */
    private withWebmcpTag(html: string): string {
        if (html.includes('/v1/libs/aimeat-webmcp.js')) return html;
        const tag = '<script src="/v1/libs/aimeat-webmcp.js?expose=node" defer></script>';
        const i = html.search(/<\/head>/i);
        return i === -1 ? tag + html : html.slice(0, i) + tag + '\n' + html.slice(i);
    }

    /** Serve the portal HTML — custom template or default fallback. */
    async getPortalHtml(
        langParam: string | undefined,
        cookieHeader: string | undefined,
        acceptLang: string | undefined,
    ): Promise<string> {
        const page = await this.getTemplatePage({ lang: langParam, cookie: cookieHeader, acceptLanguage: acceptLang });
        if (page) return page.html;
        // No custom template — use default portal
        return this.withWebmcpTag(await this.renderDefault(langParam, cookieHeader, acceptLang));
    }

    /**
     * The custom front page a reader gets: the language version that fits them, or the default
     * page. null when the operator has stored no page. The pick is pickTemplateVersion's; a version
     * that was deleted while its name was still cached falls back to the default page.
     */
    async getTemplatePage(reader: TemplateReader): Promise<TemplatePage | null> {
        const versions = await this.templateVersions();
        if (!versions) return null;
        const version = pickTemplateVersion(versions, reader);
        const versionHtml = version ? await this.resolvedPage(version) : null;
        const html = versionHtml ?? await this.resolvedPage(undefined);
        if (html === null) return null;
        const served = versionHtml !== null ? version : undefined;
        return { html, version: served, lang: served ?? versions.defaultLang, versions };
    }

    /** The resolved HTML of one stored page, from the cache or from storage; null when it is not stored. */
    private async resolvedPage(lang: string | undefined): Promise<string | null> {
        const cacheKey = lang ?? '';
        const hit = this.cache.get(cacheKey);
        if (hit && Date.now() < hit.expiresAt) return hit.html;
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, siteTemplateKey(lang));
        if (!record) { this.cache.delete(cacheKey); return null; }
        const html = this.withWebmcpTag(await resolveTags(record.data.toString('utf-8'), this.tagDeps));
        this.cache.set(cacheKey, { html, expiresAt: Date.now() + this.config.siteCacheTtlSeconds * 1000 });
        return html;
    }

    /** Which pages the custom front page has; null when there is no default page. */
    async templateVersions(): Promise<TemplateVersions | null> {
        if (this.versionsCache && Date.now() < this.versionsCache.expiresAt) return this.versionsCache.versions;
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        let versions: TemplateVersions | null = null;
        if (record) {
            const files = await this.storage.listStorageFiles(SITE_OWNER_GAII);
            const languages = files.map(f => versionOfKey(f.key)).filter((l): l is string => !!l).sort();
            versions = { defaultLang: documentLanguage(record.data.toString('utf-8')), languages };
        }
        this.versionsCache = { versions, expiresAt: Date.now() + this.config.siteCacheTtlSeconds * 1000 };
        return versions;
    }

    /** Check if a custom template exists. */
    async hasCustomTemplate(): Promise<boolean> {
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        return record !== null;
    }

    /** The stored pages of the front page, the default page first, without their bytes. */
    async listTemplates(): Promise<TemplateListing[]> {
        const files = await this.storage.listStorageFiles(SITE_OWNER_GAII);
        const out: TemplateListing[] = [];
        for (const f of files) {
            const lang = f.key === SITE_TEMPLATE_KEY ? null : versionOfKey(f.key);
            if (lang === undefined) continue;
            out.push({ lang, sizeBytes: f.size, updatedAt: f.createdAt });
        }
        return out.sort((a, b) => (a.lang ?? '').localeCompare(b.lang ?? ''));
    }

    /** Get the raw template HTML (unresolved tags): the default page, or the language version `lang`. */
    async getTemplate(lang?: string): Promise<{ template: string; sizeBytes: number; updatedAt: string; tagsFound: string[] } | null> {
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, siteTemplateKey(lang));
        if (!record) return null;
        const template = record.data.toString('utf-8');
        const tags = extractTags(template);
        return {
            template,
            sizeBytes: record.size,
            updatedAt: record.createdAt,
            tagsFound: tags,
        };
    }

    /**
     * Upload the default page, or with `lang` the language version stored beside it. Returns tags
     * found and any unresolvable tags. A language version needs the default page, which every
     * reader without a version of their own gets, and its own `<html lang>` must not name another
     * language: the page would be served and announced under the wrong one.
     */
    async uploadTemplate(template: string, changedBy: string, lang?: string): Promise<{ tagsFound: string[]; unresolvableTags: string[] }> {
        this.validateTemplate(template);
        if (lang) {
            this.validateVersion(template, lang);
            if (!await this.hasCustomTemplate()) {
                throw new SiteError('TEMPLATE_DEFAULT_MISSING',
                    'Save the default page first. A language version is served beside it, to the readers of that language.', 409);
            }
        }

        const size = await this.storeTemplate(template, lang);
        const tags = extractTags(template);
        const unresolvable = await findUnresolvableTags(tags, this.tagDeps);
        this.invalidateCache();

        await this.addChangeLog('template_upload',
            `Updated portal template${lang ? ` in ${lang}` : ''} (${(size / 1024).toFixed(1)} KB)`, changedBy);

        return { tagsFound: tags, unresolvableTags: unresolvable };
    }

    /** Write one page of the front page over the stored one. Returns its size in bytes. */
    private async storeTemplate(template: string, lang: string | undefined): Promise<number> {
        const data = Buffer.from(template, 'utf-8');
        // Delete existing template first (createStorageFile uses unique constraint)
        await this.storage.deleteStorageFile(SITE_OWNER_GAII, siteTemplateKey(lang));
        await this.storage.createStorageFile({
            key: siteTemplateKey(lang),
            ownerGaii: SITE_OWNER_GAII,
            visibility: 'public',
            mimeType: 'text/html',
            size: data.length,
            data,
            createdAt: new Date().toISOString(),
        });
        return data.length;
    }

    /**
     * Delete the custom template: with `lang` that language version only, and without it the default
     * page and every language version, so the portal reverts to the default. Returns false when the
     * named language version did not exist.
     */
    async deleteTemplate(changedBy: string, lang?: string): Promise<boolean> {
        if (lang) {
            const deleted = await this.storage.deleteStorageFile(SITE_OWNER_GAII, siteTemplateKey(lang));
            this.invalidateCache();
            if (deleted) await this.addChangeLog('template_delete', `Deleted the ${lang} version of the custom template`, changedBy);
            return deleted;
        }
        for (const page of await this.listTemplates()) {
            await this.storage.deleteStorageFile(SITE_OWNER_GAII, siteTemplateKey(page.lang ?? undefined));
        }
        this.invalidateCache();
        await this.addChangeLog('template_delete', 'Deleted custom template, reverted to default', changedBy);
        return true;
    }

    /**
     * A copy's side of the origin sync (services/site-sync.ts): store the language versions the
     * origin changed, and drop the ones it no longer has. `existing` is the origin's whole list; an
     * origin that sends none (an older node) leaves this copy's versions as they are.
     */
    async applySyncedVersions(
        changed: ReadonlyArray<{ lang: string; html: string; updated_at: string }>,
        existing: readonly string[] | undefined,
    ): Promise<number> {
        let stored = 0;
        for (const version of changed) {
            if (!/^[a-z]{2}$/.test(version.lang) || typeof version.html !== 'string') continue;
            const data = Buffer.from(version.html, 'utf-8');
            await this.storage.createStorageFile({
                key: siteTemplateKey(version.lang),
                ownerGaii: SITE_OWNER_GAII,
                visibility: 'public',
                mimeType: 'text/html',
                size: data.length,
                data,
                createdAt: version.updated_at,
            });
            stored++;
        }
        if (existing) {
            for (const page of await this.listTemplates()) {
                if (page.lang && !existing.includes(page.lang)) {
                    await this.storage.deleteStorageFile(SITE_OWNER_GAII, siteTemplateKey(page.lang));
                }
            }
        }
        this.invalidateCache();
        return stored;
    }

    /** Import a portal bundle: template + language versions + memory keys + KV pairs. */
    async importBundle(
        bundle: { template?: string; templates?: Record<string, string>; memory?: Record<string, string>; kv?: Record<string, string> },
        changedBy: string,
    ): Promise<{ templateStored: boolean; templateVersionsStored: number; memoryKeysWritten: number; kvPairsUpdated: number; changelogEntryId: string }> {
        let templateStored = false;
        let templateVersionsStored = 0;
        let memoryKeysWritten = 0;
        let kvPairsUpdated = 0;

        // Every page is checked before the first one is written.
        const versions = Object.entries(bundle.templates ?? {});
        if (bundle.template) this.validateTemplate(bundle.template);
        for (const [lang, page] of versions) {
            this.validateTemplate(page);
            this.validateVersion(page, lang);
        }
        if (versions.length > 0 && !bundle.template && !await this.hasCustomTemplate()) {
            throw new SiteError('TEMPLATE_DEFAULT_MISSING',
                'Send the default page as "template" with the language versions, or save it first.', 409);
        }

        // 1. Template, then its language versions
        if (bundle.template) {
            await this.storeTemplate(bundle.template, undefined);
            templateStored = true;
        }
        for (const [lang, page] of versions) {
            await this.storeTemplate(page, lang);
            templateVersionsStored++;
        }

        // 2. Memory keys (portal/* namespace)
        if (bundle.memory) {
            for (const [key, value] of Object.entries(bundle.memory)) {
                await this.storage.setMemory({
                    key,
                    ownerGaii: SITE_OWNER_GAII,
                    value,
                    visibility: 'public',
                    tags: ['site'],
                    ttlHours: null,
                    version: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
                memoryKeysWritten++;
            }
        }

        // 3. KV pairs
        if (bundle.kv) {
            for (const [key, value] of Object.entries(bundle.kv)) {
                this.config.siteKv[key] = value;
                kvPairsUpdated++;
            }
        }

        this.invalidateCache();

        const parts: string[] = [];
        if (templateStored) parts.push('template');
        if (templateVersionsStored > 0) parts.push(`${templateVersionsStored} language versions`);
        if (memoryKeysWritten > 0) parts.push(`${memoryKeysWritten} memory keys`);
        if (kvPairsUpdated > 0) parts.push(`${kvPairsUpdated} KV pairs`);
        const entryId = await this.addChangeLog('import', `Imported portal bundle: ${parts.join(' + ')}`, changedBy);

        return { templateStored, templateVersionsStored, memoryKeysWritten, kvPairsUpdated, changelogEntryId: entryId };
    }

    /** Set a single portal memory key (portal/* namespace, public). Used by the admin Portal Memory Keys editor. */
    async setPortalMemory(key: string, value: string, changedBy: string): Promise<void> {
        if (!key.startsWith('portal/')) {
            throw new SiteError('MEMORY_INVALID', 'Portal memory key must start with "portal/"', 422);
        }
        // A surface layout lives under `portal/` so it mirrors and imports like any other portal
        // record, which means this generic door can reach it. It must not: the layout is validated
        // against the block registry before it is written, and a raw string dropped in here would
        // be a second way past that. The same applies to a passage's storage key.
        if (isReservedSurfaceKey(key)) {
            throw new SiteError('MEMORY_RESERVED',
                `"${key}" belongs to a page layout and is written through the layout editor, not as a portal record.`, 422);
        }
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key,
            ownerGaii: SITE_OWNER_GAII,
            value,
            visibility: 'public',
            tags: ['site'],
            ttlHours: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
        });
        this.invalidateCache();
        await this.addChangeLog('memory_set', `Set portal memory key ${key}`, changedBy);
    }

    /** Delete a single portal memory key. Returns false if the key did not exist. */
    async deletePortalMemory(key: string, changedBy: string): Promise<boolean> {
        // The Memory Keys card lists every `portal/*` record with a delete cross beside it. Without
        // this an operator clears their node's home by tidying away a JSON blob they did not
        // recognise, and nothing would tell them what they had done.
        if (isReservedSurfaceKey(key)) {
            throw new SiteError('MEMORY_RESERVED',
                `"${key}" belongs to a page layout. Revert the surface to its built-in layout instead of deleting the record.`, 422);
        }
        const deleted = await this.storage.deleteMemory(SITE_OWNER_GAII, key);
        if (deleted) {
            this.invalidateCache();
            await this.addChangeLog('memory_delete', `Deleted portal memory key ${key}`, changedBy);
        }
        return deleted;
    }

    /** Force-clear the resolved HTML cache. */
    async invalidateCacheAction(changedBy: string): Promise<void> {
        this.invalidateCache();
        await this.addChangeLog('cache_invalidate', 'Cache manually invalidated', changedBy);
    }

    invalidateCache(): void {
        this.cache.clear();
        this.versionsCache = null;
    }

    /** Get portal metadata for API clients. */
    async getMetadata(): Promise<Record<string, unknown>> {
        const hasTemplate = await this.hasCustomTemplate();
        const templateInfo = hasTemplate ? await this.getTemplate() : null;
        const meta: Record<string, unknown> = {
            node_id: this.config.nodeId,
            node_type: this.config.nodeType,
            base_url: this.config.baseUrl,
            has_custom_template: hasTemplate,
            template_languages: hasTemplate ? (await this.templateVersions())?.languages ?? [] : [],
            kv: this.config.siteKv,
            template_updated_at: templateInfo?.updatedAt ?? null,
            cache_ttl_seconds: this.config.siteCacheTtlSeconds,
        };
        if (this.config.siteLbEnabled) {
            const syncState = getSiteSyncState();
            meta.lb_mode = {
                enabled: true,
                origin_url: this.config.siteLbOriginUrl,
                last_sync: syncState.lastSync,
                last_error: syncState.lastError,
                syncing: syncState.syncing,
            };
        }
        return meta;
    }

    /** Generate a context-aware prompt for AI-assisted portal editing. */
    async getPrompt(): Promise<string> {
        const record = await this.storage.getSystemPrompt('site-portal');
        if (!record || !record.active) return '';
        const promptContent = resolvePromptContent(record);
        return substituteVariables(promptContent, {
            node_id: this.config.nodeId,
            node_name: (this.config as unknown as Record<string, unknown>).nodeName as string ?? this.config.nodeId,
            node_url: this.config.baseUrl,
            template_state: await this.templateState(),
        });
    }

    /**
     * One line for the prompt: whether this node has its own HTML page, the default page's
     * language and the language versions. An AI asked to add a language reads from it which
     * pages exist, so it adds a version and does not write a second default page.
     */
    private async templateState(): Promise<string> {
        const versions = await this.templateVersions();
        if (!versions) return 'none yet; the front page is the one the node ships with';
        const stated = versions.defaultLang
            ? `default page in "${versions.defaultLang}"`
            : 'default page with no <html lang> stated';
        return versions.languages.length > 0
            ? `yes; ${stated}; language versions: ${versions.languages.join(', ')}`
            : `yes; ${stated}; no language versions`;
    }

    /** List memory keys under portal/* namespace. */
    private async listPortalMemoryKeys(): Promise<string[]> {
        try {
            const records = await this.storage.listMemory(SITE_OWNER_GAII);
            return records
                .filter(r => r.key.startsWith('portal/'))
                .map(r => r.key);
        } catch (err) {
          logger.warn('site: suppressed failure, continuing', { error: String(err) });
            return [];
        }
    }

    async getPortalMemoryEntries(): Promise<Array<{ key: string; value: unknown }>> {
        try {
            const records = await this.storage.listMemory(SITE_OWNER_GAII);
            return records
                .filter(r => r.key.startsWith('portal/'))
                .map(r => ({ key: r.key, value: r.value }));
        } catch (err) {
          logger.warn('site: suppressed failure, continuing', { error: String(err) });
            return [];
        }
    }

    /**
     * Get the header navigation config (public links order + hidden set).
     * Always returns a normalized config: `order` covers every known public id
     * (stored order first, then any newly-added built-ins), and `hidden` is the
     * stored hidden ids intersected with the known set. Missing/invalid stored
     * data falls back to all links visible in their default order.
     */
    async getHeaderNav(): Promise<HeaderNavConfig> {
        const known = PUBLIC_NAV_LINK_IDS as readonly string[];
        let storedOrder: string[] = [];
        let storedHidden: string[] = [];
        try {
            const record = await this.storage.getMemory(SITE_OWNER_GAII, HEADER_NAV_KEY);
            if (record) {
                const raw = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
                if (raw && typeof raw === 'object') {
                    if (Array.isArray(raw.order)) storedOrder = raw.order.filter((id: unknown) => typeof id === 'string');
                    if (Array.isArray(raw.hidden)) storedHidden = raw.hidden.filter((id: unknown) => typeof id === 'string');
                }
            }
        } catch (err) {
            // Corrupt JSON or storage miss → fall back to defaults below.
          logger.warn('getHeaderNav: continuing after a suppressed failure', { error: String(err) });
        }
        // Normalize: keep the operator's arrangement for ids they saved, and slot any link
        // added since then next to the neighbour it is DECLARED beside. Appending newcomers
        // to the end instead would bury every future nav item behind "Help" on any node that
        // has ever opened the Portal tab.
        const order = storedOrder.filter(id => known.includes(id));
        let anchor = -1;
        for (const id of known) {
            const at = order.indexOf(id);
            if (at !== -1) { anchor = at; continue; }
            anchor = anchor === -1 ? 0 : anchor + 1;
            order.splice(anchor, 0, id);
        }
        const hidden = storedHidden.filter(id => known.includes(id));
        return { order, hidden };
    }

    /** Persist the header navigation config. Validates ids against the known public set. */
    async setHeaderNav(input: { order?: unknown; hidden?: unknown }, changedBy: string): Promise<HeaderNavConfig> {
        const known = PUBLIC_NAV_LINK_IDS as readonly string[];
        const order = Array.isArray(input.order) ? input.order : [];
        const hidden = Array.isArray(input.hidden) ? input.hidden : [];
        for (const id of [...order, ...hidden]) {
            if (typeof id !== 'string' || !known.includes(id)) {
                throw new SiteError('HEADER_NAV_INVALID', `Unknown header link id: ${String(id)}`, 422);
            }
        }
        const value = JSON.stringify({
            order: order.filter((id: unknown) => typeof id === 'string'),
            hidden: hidden.filter((id: unknown) => typeof id === 'string'),
        });
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key: HEADER_NAV_KEY,
            ownerGaii: SITE_OWNER_GAII,
            value,
            visibility: 'public',
            tags: ['site'],
            ttlHours: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
        });
        this.invalidateCache();
        await this.addChangeLog('memory_set', `Updated header navigation config (${HEADER_NAV_KEY})`, changedBy);
        return this.getHeaderNav();
    }

    // ── Internal ──

    private validateTemplate(template: string): void {
        const maxBytes = this.config.siteMaxTemplateSizeKb * 1024;
        if (Buffer.byteLength(template, 'utf-8') > maxBytes) {
            throw new SiteError('TEMPLATE_TOO_LARGE', `Template exceeds ${this.config.siteMaxTemplateSizeKb} KB limit`, 422);
        }
        const trimmed = template.trimStart().toLowerCase();
        if (!trimmed.startsWith('<!doctype') && !trimmed.startsWith('<html')) {
            throw new SiteError('TEMPLATE_INVALID', 'Template must be valid HTML (start with <!DOCTYPE or <html)', 422);
        }
        // Block script injection via memory tags: <script>...{{memory:*}}...</script>
        const scriptBlocks = template.match(/<script[^>]*>[\s\S]*?<\/script>/gi) ?? [];
        for (const block of scriptBlocks) {
            if (/\{\{memory:[^}]+\}\}/.test(block)) {
                throw new SiteError('TEMPLATE_INVALID', 'Template must not contain {{memory:*}} tags inside <script> blocks', 422);
            }
        }
    }

    /** A language version says, when it says anything, that it is in the language it is stored under. */
    private validateVersion(template: string, lang: string): void {
        if (!/^[a-z]{2}$/.test(lang)) {
            throw new SiteError('TEMPLATE_LANG_INVALID', `"${lang}" is not a language code. Use two letters, such as "fi" or "en".`, 422);
        }
        const stated = documentLanguage(template);
        if (stated && stated !== lang) {
            throw new SiteError('TEMPLATE_LANG_MISMATCH',
                `The page states <html lang="${stated}"> and you are saving it as the ${lang} version. Save it as the ${stated} version, or change the page's lang attribute.`, 422);
        }
    }

    private async addChangeLog(action: SiteChangeLogEntry['action'], summary: string, changedBy: string): Promise<string> {
        const id = `site-${Date.now()}-${randomBytes(4).toString('hex')}`;
        await this.storage.addSiteChangeLog({
            id,
            action,
            summary,
            changedBy,
            changedAt: new Date().toISOString(),
        });
        return id;
    }

    private async renderDefault(
        _langParam: string | undefined,
        _cookieHeader: string | undefined,
        _acceptLang: string | undefined,
    ): Promise<string> {
        // Serve the SPA shell (language detection happens client-side)
        return readFileSync(SPA_HTML_PATH, 'utf-8');
    }
}

export class SiteError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly httpStatus: number,
    ) {
        super(message);
        this.name = 'SiteError';
    }
}
