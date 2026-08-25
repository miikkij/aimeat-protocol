/**
 * @file src/services/site-tags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The portal template tag grammar and its resolver: {{config|memory|storage|kv|board:key}}.
 *   Extracted from site.ts unchanged so a second caller can reuse it without reaching into
 *   SiteService.
 *
 *   ONE TAG IS NOT ESCAPED, AND THAT IS THE WHOLE SECURITY STORY OF THIS FILE. `config`, `storage`
 *   and `kv` resolve to scalars and go through escapeHtml. `memory` substitutes raw, because the
 *   portal template is operator-authored and an operator putting markup in a `portal/*` record is
 *   the feature. What stands between that and stored script execution is the caller: SiteService's
 *   validateTemplate refuses {{memory:*}} inside a <script> block, and injectCspNonce then stamps
 *   every remaining <script> in the resolved document. A caller that does not own that trust
 *   boundary must not resolve `memory` — pass the narrower type list.
 *
 *   `board` emits markup of its own making, with the post title and body escaped. Only system and
 *   public boards render; anything else resolves to the empty string rather than an error, because
 *   a front page that half-renders is worse than one that omits a section.
 * @structure TagType · ALL_TAG_TYPES · TAG_REGEX · CONFIG_WHITELIST · escapeHtml · extractTags ·
 *   getConfigValue · resolveBoardTag · resolveTags · findUnresolvableTags
 * @usage
 *   import { resolveTags, extractTags } from './site-tags.js';
 *   const html = await resolveTags(template, { config, storage, ownerGaii: SITE_OWNER_GAII });
 * @version-history
 *   v1.0.0 — 2026-08-26 — Pure extraction from site.ts (v1.3.0): the tag grammar, escapeHtml, the
 *     config whitelist, the board renderer and the batching resolver move here as free functions
 *     taking their dependencies. No behaviour change; site.ts calls these instead of its own
 *     private copies.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** The five things a portal template may pull in. */
export type TagType = 'config' | 'memory' | 'storage' | 'kv' | 'board';

/** Every tag type, which is what the operator template resolves with. */
export const ALL_TAG_TYPES: readonly TagType[] = ['config', 'memory', 'storage', 'kv', 'board'];

/** Config keys safe to expose via {{config:*}} tags. */
export const CONFIG_WHITELIST = new Set([
    'nodeId', 'nodeType', 'baseUrl', 'nodeName', 'nodeDescription',
    'federationName', 'locale', 'version',
]);

export const TAG_REGEX = /\{\{(config|memory|storage|kv|board):([^}]+)\}\}/g;

/** What the resolver needs to answer a tag. */
export interface TagDeps {
    config: AimeatConfig;
    storage: Storage;
    /** The pseudo-owner whose memory and storage the tags read (SITE_OWNER_GAII). */
    ownerGaii: string;
}

export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Every distinct `type:key` the template names, deduped. */
export function extractTags(template: string): string[] {
    const tags: string[] = [];
    for (const match of template.matchAll(TAG_REGEX)) {
        tags.push(`${match[1]}:${match[2]}`);
    }
    return [...new Set(tags)];
}

export function getConfigValue(config: AimeatConfig, key: string): string {
    if (!CONFIG_WHITELIST.has(key)) return '';
    const val = (config as unknown as Record<string, unknown>)[key];
    return val != null ? String(val) : '';
}

/** Resolve a {{board:slug}} tag to HTML of recent posts. */
export async function resolveBoardTag(storage: Storage, slug: string): Promise<string> {
    // Find board by name or ID
    const boards = await storage.listBoards();
    const board = boards.find(b => b.name === slug || b.id === slug);
    if (!board) return '';

    // Only system and public boards can be rendered in the portal
    if (board.visibility !== 'system' && board.visibility !== 'public') return '';

    const posts = await storage.listPosts(board.id, { limit: 5 });
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

/** Substitute every tag in the template. Lookups are batched per type, then applied in one pass. */
export async function resolveTags(template: string, deps: TagDeps): Promise<string> {
    const { config, storage, ownerGaii } = deps;
    const matches = [...template.matchAll(TAG_REGEX)];
    if (matches.length === 0) return template;

    // Batch memory lookups
    const memoryKeys = [...new Set(matches.filter(m => m[1] === 'memory').map(m => m[2]))];
    const memoryValues = new Map<string, string>();
    for (const key of memoryKeys) {
        const record = await storage.getMemory(ownerGaii, key);
        if (record) {
            memoryValues.set(key, typeof record.value === 'string' ? record.value : JSON.stringify(record.value));
        }
    }

    // Batch storage URL lookups
    const storageKeys = [...new Set(matches.filter(m => m[1] === 'storage').map(m => m[2]))];
    const storageUrls = new Map<string, string>();
    for (const key of storageKeys) {
        // Storage files resolve to the download URL
        storageUrls.set(key, `${config.baseUrl}/v1/storage/${encodeURIComponent(ownerGaii)}/${encodeURIComponent(key)}`);
    }

    // Batch board post lookups
    const boardSlugs = [...new Set(matches.filter(m => m[1] === 'board').map(m => m[2]))];
    const boardHtmlMap = new Map<string, string>();
    for (const slug of boardSlugs) {
        boardHtmlMap.set(slug, await resolveBoardTag(storage, slug));
    }

    return template.replace(TAG_REGEX, (_full, type: string, key: string) => {
        switch (type) {
            case 'config': return escapeHtml(getConfigValue(config, key));
            case 'memory': return memoryValues.get(key) ?? '';
            case 'storage': return escapeHtml(storageUrls.get(key) ?? '');
            case 'kv': return escapeHtml(config.siteKv[key] ?? '');
            case 'board': return boardHtmlMap.get(key) ?? '';
            default: return '';
        }
    });
}

/** Which of the named tags this node cannot answer. kv and storage always resolve, possibly empty. */
export async function findUnresolvableTags(tags: string[], deps: TagDeps): Promise<string[]> {
    const { storage, ownerGaii } = deps;
    const unresolvable: string[] = [];
    for (const tag of tags) {
        const [type, key] = tag.split(':');
        if (type === 'memory') {
            const record = await storage.getMemory(ownerGaii, key);
            if (!record) unresolvable.push(tag);
        } else if (type === 'config') {
            if (!CONFIG_WHITELIST.has(key)) unresolvable.push(tag);
        } else if (type === 'board') {
            // kv and storage are always "resolvable" (might just be empty)
            // board tags are resolvable if the board exists
            const boards = await storage.listBoards();
            const found = boards.some(b => b.name === key || b.id === key);
            if (!found) unresolvable.push(tag);
        }
    }
    return unresolvable;
}
