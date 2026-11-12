/**
 * @file test/unit/front-page-template.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's portal template at `/`, on the real bootstrap router and SiteService over
 *   in-memory SQLite:
 *   - a template that states only a title and a description is served with the node's head metadata
 *     (canonical, og:*, twitter:*, the three JSON-LD blocks) and keeps its own title and description;
 *   - a tag the template states for itself stays as written, whichever order its attributes use, and
 *     is not written a second time;
 *   - a `$` sequence in the template's title reaches the reader unchanged;
 *   - the template's body is sent as stored.
 * @usage cd aimeat && pnpm exec vitest run test/unit/front-page-template.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial. A node whose front page is an operator template sent it without a
 *     canonical link, og:* or JSON-LD, the defect the static front pages had until 2026-10-27
 *     (AGENTSCAN S10, S12, S13).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { bootstrapRouter } from '../../src/routes/bootstrap.js';
import { SiteService } from '../../src/services/site.js';

let storage: Storage;
let config: AimeatConfig;
let site: SiteService;
let url: string;
let server: http.Server;

const BODY = '<body><h1>Alice bakes bread</h1><p>Order by Thursday.</p></body>';

/** Upload `head` + the fixed body as the node's template, and read `/` as a browser does. */
async function served(head: string): Promise<{ html: string; head: string }> {
    await site.uploadTemplate(`<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n${BODY}\n</html>`, 'test');
    const res = await fetch(`${url}/`, { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    const html = await res.text();
    return { html, head: html.slice(0, html.search(/<\/head\s*>/i)) };
}

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

beforeAll(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = {
        ...loadConfig().config,
        nodeId: 'aimeat-test-front-template',
        baseUrl: 'https://node.test',
        siteEnabled: true,
        siteCacheTtlSeconds: 0,
        frontPage: 'classic',
        seoOgImage: '/og-image.png',
    };
    site = new SiteService(config, storage);
    const app = express();
    app.use(bootstrapRouter(config, storage, undefined, site));
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('the operator template at /', () => {
    it('carries the node head metadata and keeps its own title and description', async () => {
        const { html, head } = await served(
            '<title>Alice\'s bakery · bread on Fridays</title>\n'
            + '<meta name="description" content="Sourdough from Alice\'s oven, baked every Friday morning.">');

        expect(head).toContain('<link rel="canonical" href="https://node.test/">');
        expect(head).toContain('<meta property="og:url" content="https://node.test/">');
        expect(head).toContain('<meta property="og:title" content="Alice&#39;s bakery · bread on Fridays">');
        expect(head).toContain('<meta property="og:description" content="Sourdough from Alice&#39;s oven, baked every Friday morning.">');
        expect(head).toContain('<meta property="og:image" content="https://node.test/og-image.png">');
        expect(head).toMatch(/<meta name="twitter:card" content="summary_large_image">/);
        expect(count(head, /<title>/g)).toBe(1);
        expect(count(head, /<meta name="description"/g)).toBe(1);
        expect(head).toContain('bread on Fridays</title>');

        const blocks = [...head.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)]
            .map(m => JSON.parse(m[1]!) as { '@type': string; name?: string; url?: string });
        expect(blocks.map(b => b['@type']).sort()).toEqual(['Organization', 'SoftwareApplication', 'WebPage']);
        const webPage = blocks.find(b => b['@type'] === 'WebPage');
        expect(webPage?.name).toBe('Alice\'s bakery · bread on Fridays');
        expect(webPage?.url).toBe('https://node.test/');
        // The head names one address for this page: no markdown mirror of another document.
        expect(head).not.toContain('rel="alternate"');

        expect(html).toContain(BODY);
    });

    it('keeps a tag the template states for itself, in any attribute order, and writes it once', async () => {
        const { head } = await served(
            '<title>Alice\'s bakery</title>\n'
            + '<meta content="Bread, baked on Fridays." name="description">\n'
            + '<meta content="Fresh bread this Friday" property="og:title">\n'
            + '<meta property=\'og:image\' content=\'https://cdn.example/loaf.png\'>\n'
            + '<meta name="twitter:title" content="Bread > cake">\n'
            + '<link href="https://bakery.example/" rel="canonical">');

        expect(head).toContain('content="Fresh bread this Friday"');
        expect(count(head, /og:title/g)).toBe(1);
        expect(head).toContain('https://cdn.example/loaf.png');
        expect(count(head, /og:image/g)).toBe(1);
        // The picture stated for Open Graph is the twitter picture too; the node's own is not written.
        expect(head).toContain('<meta name="twitter:image" content="https://cdn.example/loaf.png">');
        expect(head).not.toContain('https://node.test/og-image.png');
        expect(head).toContain('Bread > cake');
        expect(count(head, /twitter:title/g)).toBe(1);
        expect(head).toContain('https://bakery.example/');
        expect(count(head, /rel="canonical"/g)).toBe(1);
        expect(count(head, /name="description"/g)).toBe(1);
        expect(head).toContain('Bread, baked on Fridays.');
        // What the template leaves out still comes from the node, described by the template's own words.
        expect(head).toContain('<meta property="og:description" content="Bread, baked on Fridays.">');
        expect(head).toMatch(/"@type":"WebPage"/);
        // The canonical address the template states is the one og:url and the WebPage block name.
        expect(head).toContain('<meta property="og:url" content="https://bakery.example/">');
        expect(head).toContain('"url":"https://bakery.example/"');
        expect(head).not.toContain('https://node.test/index.md');
    });

    it('sends a $ sequence in the title unchanged', async () => {
        const { head } = await served('<title>Save $$ and $& on bread</title>\n<meta name="description" content="Costs $$ less.">');
        expect(head).toContain('<title>Save $$ and $&amp; on bread</title>');
        expect(head).toContain('<meta property="og:title" content="Save $$ and $&amp; on bread">');
        expect(head).toContain('<meta name="description" content="Costs $$ less.">');
    });

    it('stamps a template whose head end tag is written in capitals', async () => {
        await site.uploadTemplate(`<!DOCTYPE HTML><HTML><HEAD><title>Bob's page</title></HEAD>${BODY}</HTML>`, 'test');
        const html = await (await fetch(`${url}/`, { headers: { Accept: 'text/html' } })).text();
        const head = html.slice(0, html.search(/<\/head\s*>/i));
        expect(head).toContain('<link rel="canonical" href="https://node.test/">');
        expect(head).toContain('<meta property="og:title" content="Bob&#39;s page">');
    });
});
