/**
 * @file src/services/page-frame.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address an HTML page's frame loads, and the public documents as the share routes
 *   hand them out. The caller has already passed the page's gate (membership, or the share's access
 *   mode); this mints the frame token for exactly the record that gate admitted, and nothing else
 *   (services/page-frame-token.ts). Without a page host on this node there is no frame address, and
 *   a viewer shows the page as its text.
 * @structure frameUrlFor() · servePublicDocs()
 * @usage
 *   const url = await frameUrlFor(config, { org, ws, sp, ns, id, r: 'latest', k: 'pub' });   // null without a page host
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import type { AimeatConfig } from '../config.js';
import { pageOriginOf } from './html-page.js';
import { generatePageFrameToken, type PageFrameClaims } from './page-frame-token.js';

/** The frame address of one page, or null when this node has no page host. Ends in `/`, so the page's relative file names resolve under it. */
export async function frameUrlFor(config: AimeatConfig, claims: PageFrameClaims): Promise<string | null> {
    const origin = pageOriginOf(config);
    if (!origin) return null;
    return `${origin}/p/${await generatePageFrameToken(claims)}/`;
}

/**
 * The public documents as the share routes send them: an HTML page gets its `frame_url` (null without
 * a page host), its namespace stays on the server, and its HTML goes out only where one page was
 * asked for (`withHtml`), so a whole-workspace read does not carry every page's markup twice.
 */
export async function servePublicDocs(
    config: AimeatConfig, items: ReadonlyArray<object>, at: { orgId: string; ws: string; withHtml: boolean },
): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (const item of items as ReadonlyArray<Record<string, unknown>>) {
        if (item.kind !== 'html') { out.push(item); continue; }
        const { namespace, html, ...rest } = item;
        const frame_url = typeof namespace === 'string'
            ? await frameUrlFor(config, { org: at.orgId, ws: at.ws, sp: String(item.type), ns: namespace, id: String(item.id), r: 'latest', k: 'pub' })
            : null;
        out.push({ ...rest, frame_url, ...(at.withHtml ? { html } : {}) });
    }
    return out;
}
