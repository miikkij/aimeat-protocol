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
 *   - a front page stored as one page per language sends each reader one language, with that
 *     language's canonical address and the hreflang set, and refuses a version it cannot serve.
 * @version-history
 *   v1.1.0 — 2026-11-12 — The template's language versions.
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

describe('the operator template in several languages', () => {
    const page = (lang: string, title: string, h1: string): string =>
        `<!doctype html>\n<html lang="${lang}">\n<head>\n<title>${title}</title>\n`
        + `<meta name="description" content="${title}, described.">\n</head>\n<body><h1>${h1}</h1></body>\n</html>`;

    /** Read `/` (or `/?lang=`) as a browser with the given language list and cookie. */
    async function read(query: string, headers: Record<string, string> = {}): Promise<{ res: Response; html: string; head: string }> {
        const res = await fetch(`${url}/${query}`, { headers: { Accept: 'text/html', ...headers } });
        const html = await res.text();
        return { res, html, head: html.slice(0, html.search(/<\/head\s*>/i)) };
    }

    beforeAll(async () => {
        await site.deleteTemplate('test');
    });

    it('refuses a language version before the default page, and one whose <html lang> names another language', async () => {
        await expect(site.uploadTemplate(page('en', 'Bakery', 'Bread'), 'test', 'en'))
            .rejects.toMatchObject({ code: 'TEMPLATE_DEFAULT_MISSING' });
        await site.uploadTemplate(page('fi', 'Leipomo', 'Leipää perjantaisin'), 'test');
        await expect(site.uploadTemplate(page('es', 'Panadería', 'Pan'), 'test', 'en'))
            .rejects.toMatchObject({ code: 'TEMPLATE_LANG_MISMATCH' });
        await expect(site.uploadTemplate(page('en', 'Bakery', 'Bread'), 'test', 'english'))
            .rejects.toMatchObject({ code: 'TEMPLATE_LANG_INVALID' });
        expect((await site.listTemplates()).map(p => p.lang)).toEqual([null]);
    });

    it('a front page in one language names no alternate and does not vary by language', async () => {
        const { res, head } = await read('', { 'Accept-Language': 'en' });
        expect(head).not.toContain('hreflang');
        expect(res.headers.get('vary') ?? '').not.toMatch(/Accept-Language/i);
        expect(res.headers.get('content-language')).toBe('fi');
        expect(head).toContain('"inLanguage":"fi"');
    });

    it('serves each reader one language, with one h1 and the address of that language', async () => {
        await site.uploadTemplate(page('en', 'Bakery', 'Bread on Fridays'), 'test', 'en');
        await site.uploadTemplate(page('es', 'Panadería', 'Pan los viernes'), 'test', 'es');

        const en = await read('', { 'Accept-Language': 'en-GB,en;q=0.9' });
        expect(count(en.html, /<h1[\s>]/g)).toBe(1);
        expect(en.html).toContain('<h1>Bread on Fridays</h1>');
        expect(en.res.headers.get('content-language')).toBe('en');
        expect(en.res.headers.get('vary') ?? '').toMatch(/Accept-Language/i);
        expect(en.res.headers.get('vary') ?? '').toMatch(/Cookie/i);
        expect(en.head).toContain('<link rel="canonical" href="https://node.test/?lang=en">');
        expect(en.head).toContain('<meta property="og:url" content="https://node.test/?lang=en">');
        expect(en.head).toContain('<meta property="og:title" content="Bakery">');
        expect(en.head).toContain('"url":"https://node.test/?lang=en"');
        expect(en.head).toContain('"inLanguage":"en"');

        // The same four links on every page of the front page.
        const links = [
            '<link rel="alternate" hreflang="en" href="https://node.test/?lang=en">',
            '<link rel="alternate" hreflang="es" href="https://node.test/?lang=es">',
            '<link rel="alternate" hreflang="fi" href="https://node.test/">',
            '<link rel="alternate" hreflang="x-default" href="https://node.test/">',
        ];
        const fi = await read('', { 'Accept-Language': 'en-US,en;q=0.9,fi;q=0.8' });
        const es = await read('?lang=es', { 'Accept-Language': 'fi' });
        for (const reply of [en, fi, es]) {
            for (const link of links) expect(reply.head).toContain(link);
            expect(count(reply.head, /hreflang=/g)).toBe(4);
            expect(count(reply.head, /rel="canonical"/g)).toBe(1);
        }

        // Finnish anywhere in the browser's list is the default page, at the root address.
        expect(fi.html).toContain('<h1>Leipää perjantaisin</h1>');
        expect(fi.head).toContain('<link rel="canonical" href="https://node.test/">');
        // ?lang beats the browser.
        expect(es.html).toContain('<h1>Pan los viernes</h1>');
        expect(es.head).toContain('<link rel="canonical" href="https://node.test/?lang=es">');
    });

    it('a request that names no language gets the default page, and a picked language beats the browser', async () => {
        const crawler = await read('');
        expect(crawler.html).toContain('<h1>Leipää perjantaisin</h1>');
        expect(crawler.head).toContain('<link rel="canonical" href="https://node.test/">');

        const picked = await read('', { 'Accept-Language': 'fi', Cookie: 'aimeat-lang=es; aimeat-lang-chosen=1' });
        expect(picked.html).toContain('<h1>Pan los viernes</h1>');

        const german = await read('', { 'Accept-Language': 'de-DE,de;q=0.9' });
        expect(german.html).toContain('<h1>Bread on Fridays</h1>');
    });

    it('the markdown of / follows the language', async () => {
        const res = await fetch(`${url}/?format=md&lang=es`);
        expect(await res.text()).toContain('Pan los viernes');
    });

    it('deleting one version leaves the others, and deleting the default page deletes them all', async () => {
        expect(await site.deleteTemplate('test', 'es')).toBe(true);
        expect(await site.deleteTemplate('test', 'es')).toBe(false);
        const es = await read('?lang=es');
        expect(es.html).toContain('<h1>Leipää perjantaisin</h1>');
        expect(es.head).toContain('<link rel="canonical" href="https://node.test/">');
        expect(count(es.head, /hreflang=/g)).toBe(3);

        await site.deleteTemplate('test');
        expect(await site.listTemplates()).toEqual([]);
        expect(await site.hasCustomTemplate()).toBe(false);
    });
});
