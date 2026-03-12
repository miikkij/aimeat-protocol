import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage, SiteChangeLogEntry } from '../storage/interface.js';
import { getSiteSyncState } from './site-sync.js';
import { substituteVariables, resolvePromptContent } from './prompt-variables.js';

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
// System owner GAII used for site template storage
const SITE_OWNER_GAII = '__site__';

// Config keys safe to expose via {{config:*}} tags
const CONFIG_WHITELIST = new Set([
    'nodeId', 'nodeType', 'baseUrl', 'nodeName', 'nodeDescription',
    'federationName', 'locale', 'version',
]);

const TAG_REGEX = /\{\{(config|memory|storage|kv|board):([^}]+)\}\}/g;

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class SiteService {
    private cache: { html: string; expiresAt: number } | null = null;

    constructor(
        private config: AimeatConfig,
        private storage: Storage,
    ) { }

    /** Serve the portal HTML — custom template or default fallback. */
    async getPortalHtml(
        langParam: string | undefined,
        cookieHeader: string | undefined,
        acceptLang: string | undefined,
    ): Promise<string> {
        // Check cache first
        if (this.cache && Date.now() < this.cache.expiresAt) {
            return this.cache.html;
        }

        // Check for custom template
        const templateRecord = await this.storage.getStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        if (!templateRecord) {
            // No custom template — use default portal
            return this.renderDefault(langParam, cookieHeader, acceptLang);
        }

        const raw = templateRecord.data.toString('utf-8');
        const html = await this.resolveTemplate(raw);

        // Cache resolved HTML
        this.cache = {
            html,
            expiresAt: Date.now() + this.config.siteCacheTtlSeconds * 1000,
        };
        return html;
    }

    /** Check if a custom template exists. */
    async hasCustomTemplate(): Promise<boolean> {
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        return record !== null;
    }

    /** Get the raw template HTML (unresolved tags). */
    async getTemplate(): Promise<{ template: string; sizeBytes: number; updatedAt: string; tagsFound: string[] } | null> {
        const record = await this.storage.getStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        if (!record) return null;
        const template = record.data.toString('utf-8');
        const tags = this.extractTags(template);
        return {
            template,
            sizeBytes: record.size,
            updatedAt: record.createdAt,
            tagsFound: tags,
        };
    }

    /** Upload a new template. Returns tags found and any unresolvable tags. */
    async uploadTemplate(template: string, changedBy: string): Promise<{ tagsFound: string[]; unresolvableTags: string[] }> {
        this.validateTemplate(template);

        const data = Buffer.from(template, 'utf-8');
        await this.storage.createStorageFile({
            key: SITE_TEMPLATE_KEY,
            ownerGaii: SITE_OWNER_GAII,
            visibility: 'public',
            mimeType: 'text/html',
            size: data.length,
            data,
            createdAt: new Date().toISOString(),
        });

        const tags = this.extractTags(template);
        const unresolvable = await this.findUnresolvableTags(tags);
        this.invalidateCache();

        await this.addChangeLog('template_upload', `Updated portal template (${(data.length / 1024).toFixed(1)} KB)`, changedBy);

        return { tagsFound: tags, unresolvableTags: unresolvable };
    }

    /** Delete the custom template. Portal reverts to default. */
    async deleteTemplate(changedBy: string): Promise<void> {
        await this.storage.deleteStorageFile(SITE_OWNER_GAII, SITE_TEMPLATE_KEY);
        this.invalidateCache();
        await this.addChangeLog('template_delete', 'Deleted custom template, reverted to default', changedBy);
    }

    /** Import a portal bundle: template + memory keys + KV pairs. */
    async importBundle(
        bundle: { template?: string; memory?: Record<string, string>; kv?: Record<string, string> },
        changedBy: string,
    ): Promise<{ templateStored: boolean; memoryKeysWritten: number; kvPairsUpdated: number; changelogEntryId: string }> {
        let templateStored = false;
        let memoryKeysWritten = 0;
        let kvPairsUpdated = 0;

        // 1. Template
        if (bundle.template) {
            this.validateTemplate(bundle.template);
            const data = Buffer.from(bundle.template, 'utf-8');
            await this.storage.createStorageFile({
                key: SITE_TEMPLATE_KEY,
                ownerGaii: SITE_OWNER_GAII,
                visibility: 'public',
                mimeType: 'text/html',
                size: data.length,
                data,
                createdAt: new Date().toISOString(),
            });
            templateStored = true;
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
        if (memoryKeysWritten > 0) parts.push(`${memoryKeysWritten} memory keys`);
        if (kvPairsUpdated > 0) parts.push(`${kvPairsUpdated} KV pairs`);
        const entryId = await this.addChangeLog('import', `Imported portal bundle: ${parts.join(' + ')}`, changedBy);

        return { templateStored, memoryKeysWritten, kvPairsUpdated, changelogEntryId: entryId };
    }

    /** Force-clear the resolved HTML cache. */
    async invalidateCacheAction(changedBy: string): Promise<void> {
        this.invalidateCache();
        await this.addChangeLog('cache_invalidate', 'Cache manually invalidated', changedBy);
    }

    invalidateCache(): void {
        this.cache = null;
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
        });
    }

    /** List memory keys under portal/* namespace. */
    private async listPortalMemoryKeys(): Promise<string[]> {
        try {
            const records = await this.storage.listMemory(SITE_OWNER_GAII);
            return records
                .filter(r => r.key.startsWith('portal/'))
                .map(r => r.key);
        } catch {
            return [];
        }
    }

    async getPortalMemoryEntries(): Promise<Array<{ key: string; value: unknown }>> {
        try {
            const records = await this.storage.listMemory(SITE_OWNER_GAII);
            return records
                .filter(r => r.key.startsWith('portal/'))
                .map(r => ({ key: r.key, value: r.value }));
        } catch {
            return [];
        }
    }

    // ── Internal ──

    /** Resolve a {{board:slug}} tag to HTML of recent posts. */
    private async resolveBoardTag(slug: string): Promise<string> {
        // Find board by name or ID
        const boards = await this.storage.listBoards();
        const board = boards.find(b => b.name === slug || b.id === slug);
        if (!board) return '';

        // Only system and public boards can be rendered in the portal
        if (board.visibility !== 'system' && board.visibility !== 'public') return '';

        const posts = await this.storage.listPosts(board.id, { limit: 5 });
        if (posts.length === 0) return '<div class="board-posts"><p class="board-empty">No posts yet.</p></div>';

        const articles = posts.map(p => {
            const date = new Date(p.createdAt);
            const dateStr = date.toISOString().slice(0, 10);
            return [
                '<article class="board-post">',
                `  <h3>${escapeHtml(p.title)}</h3>`,
                `  <time datetime="${date.toISOString()}">${dateStr}</time>`,
                `  <p>${escapeHtml(p.body)}</p>`,
                '</article>',
            ].join('\n');
        });

        return `<div class="board-posts">\n${articles.join('\n')}\n</div>`;
    }

    private async resolveTemplate(template: string): Promise<string> {
        const matches = [...template.matchAll(TAG_REGEX)];
        if (matches.length === 0) return template;

        // Batch memory lookups
        const memoryKeys = [...new Set(matches.filter(m => m[1] === 'memory').map(m => m[2]))];
        const memoryValues = new Map<string, string>();
        for (const key of memoryKeys) {
            const record = await this.storage.getMemory(SITE_OWNER_GAII, key);
            if (record) {
                memoryValues.set(key, typeof record.value === 'string' ? record.value : JSON.stringify(record.value));
            }
        }

        // Batch storage URL lookups
        const storageKeys = [...new Set(matches.filter(m => m[1] === 'storage').map(m => m[2]))];
        const storageUrls = new Map<string, string>();
        for (const key of storageKeys) {
            // Storage files resolve to the download URL
            storageUrls.set(key, `${this.config.baseUrl}/v1/storage/${encodeURIComponent(SITE_OWNER_GAII)}/${encodeURIComponent(key)}`);
        }

        // Batch board post lookups
        const boardSlugs = [...new Set(matches.filter(m => m[1] === 'board').map(m => m[2]))];
        const boardHtmlMap = new Map<string, string>();
        for (const slug of boardSlugs) {
            boardHtmlMap.set(slug, await this.resolveBoardTag(slug));
        }

        return template.replace(TAG_REGEX, (_full, type: string, key: string) => {
            switch (type) {
                case 'config': return escapeHtml(this.getConfigValue(key));
                case 'memory': return memoryValues.get(key) ?? '';
                case 'storage': return escapeHtml(storageUrls.get(key) ?? '');
                case 'kv': return escapeHtml(this.config.siteKv[key] ?? '');
                case 'board': return boardHtmlMap.get(key) ?? '';
                default: return '';
            }
        });
    }

    private getConfigValue(key: string): string {
        if (!CONFIG_WHITELIST.has(key)) return '';
        const val = (this.config as unknown as Record<string, unknown>)[key];
        return val != null ? String(val) : '';
    }

    private extractTags(template: string): string[] {
        const tags: string[] = [];
        for (const match of template.matchAll(TAG_REGEX)) {
            tags.push(`${match[1]}:${match[2]}`);
        }
        return [...new Set(tags)];
    }

    private async findUnresolvableTags(tags: string[]): Promise<string[]> {
        const unresolvable: string[] = [];
        for (const tag of tags) {
            const [type, key] = tag.split(':');
            if (type === 'memory') {
                const record = await this.storage.getMemory(SITE_OWNER_GAII, key);
                if (!record) unresolvable.push(tag);
            } else if (type === 'config') {
                if (!CONFIG_WHITELIST.has(key)) unresolvable.push(tag);
            } else if (type === 'board') {
                // kv and storage are always "resolvable" (might just be empty)
                // board tags are resolvable if the board exists
                const boards = await this.storage.listBoards();
                const found = boards.some(b => b.name === key || b.id === key);
                if (!found) unresolvable.push(tag);
            }
        }
        return unresolvable;
    }

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
