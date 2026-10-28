/**
 * @file test/unit/front-page-start.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "start" value of the front page switch (AIMEAT_FRONT_PAGE), on the real
 *   bootstrap router over in-memory SQLite:
 *   - the env value is read case- and space-insensitively, and an unknown value stays classic;
 *   - with frontPage 'start', GET / for a browser answers public/front-start.fi.html for a
 *     Finnish Accept-Language and public/front-start.html for ?lang=en, with Vary on the language;
 *   - with frontPage 'classic', GET / answers the SPA shell and not the start page;
 *   - JSON negotiation is untouched by the switch;
 *   - the served page carries the node's head metadata (canonical, og:*, JSON-LD) and keeps its
 *     own title and description.
 * @usage cd aimeat && pnpm exec vitest run test/unit/front-page-start.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-27 — The head metadata the shell gets: the page was sent as read from disk, so
 *     aimeat.io's front page had no canonical, og:* or JSON-LD from 2026-10-21 (AGENTSCAN S10, S12, S13).
 *   v1.0.0 — 2026-10-21 — Initial (the "accelerate your AI" front page, staged before the flip).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { bootstrapRouter } from '../../src/routes/bootstrap.js';

const NODE_ID = 'aimeat-test-front-start';

let storage: Storage;
let base: AimeatConfig;
const servers: http.Server[] = [];

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    for (const [k, val] of Object.entries(vars)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    try { return fn(); } finally {
        for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    }
}

async function serve(config: AimeatConfig): Promise<string> {
    const app = express();
    app.use(bootstrapRouter(config, storage));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    base = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
});

afterAll(async () => {
    await Promise.all(servers.map(s => new Promise<void>(resolve => s.close(() => resolve()))));
});

describe('AIMEAT_FRONT_PAGE=start', () => {
    it('is read case- and space-insensitively, and an unknown value stays classic', () => {
        expect(withEnv({ AIMEAT_FRONT_PAGE: ' Start ' }, () => loadConfig().config.frontPage)).toBe('start');
        expect(withEnv({ AIMEAT_FRONT_PAGE: 'starts' }, () => loadConfig().config.frontPage)).toBe('classic');
        expect(withEnv({ AIMEAT_FRONT_PAGE: undefined }, () => loadConfig().config.frontPage)).toBe('classic');
    });

    it('serves the Finnish page to a Finnish browser and the English page for ?lang=en', async () => {
        const url = await serve({ ...base, frontPage: 'start' });

        const fi = await fetch(`${url}/`, { headers: { Accept: 'text/html', 'Accept-Language': 'fi-FI,fi;q=0.9' } });
        expect(fi.status).toBe(200);
        expect(fi.headers.get('vary') ?? '').toMatch(/Accept-Language/i);
        const fiText = await fi.text();
        expect(fiText).toContain('<html lang="fi">');
        expect(fiText).toContain('Kiihdytä tekoälysi.');

        const en = await fetch(`${url}/?lang=en`, { headers: { Accept: 'text/html', 'Accept-Language': 'fi-FI' } });
        expect(en.status).toBe(200);
        const enText = await en.text();
        expect(enText).toContain('<html lang="en">');
        expect(enText).toContain('Accelerate your AI.');
    });

    it('carries the node head metadata and keeps its own title and description', async () => {
        const url = await serve({ ...base, frontPage: 'start' });
        for (const [lang, title] of [['en', 'AIMEAT · Accelerate your AI'], ['fi', 'AIMEAT · Kiihdytä tekoälysi']] as const) {
            const res = await fetch(`${url}/?lang=${lang}`, { headers: { Accept: 'text/html' } });
            const html = await res.text();
            const head = html.slice(0, html.indexOf('</head>'));
            expect(head).toContain('<link rel="canonical" href="https://node.test/">');
            expect(head).toContain(`<title>${title}</title>`);
            expect(head).toContain(`<meta property="og:title" content="${title}">`);
            expect(head).toMatch(/<meta property="og:description" content="[^"]{50,}">/);
            expect(head).toContain('<meta property="og:url" content="https://node.test/">');
            expect(head.match(/<title>/g)?.length).toBe(1);
            expect(head.match(/<meta name="description"/g)?.length).toBe(1);
            const blocks = [...head.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)]
                .map(m => JSON.parse(m[1]!) as { '@type': string; name?: string });
            expect(blocks.map(b => b['@type']).sort()).toEqual(['Organization', 'SoftwareApplication', 'WebPage']);
            expect(blocks.find(b => b['@type'] === 'WebPage')?.name).toBe(title);
        }
    });

    it('leaves the classic front page alone when the switch is classic', async () => {
        const url = await serve({ ...base, frontPage: 'classic' });
        const res = await fetch(`${url}/`, { headers: { Accept: 'text/html', 'Accept-Language': 'fi' } });
        const text = await res.text();
        expect(text).not.toContain('front-start.css');
        expect(text).not.toContain('Kiihdytä tekoälysi.');
    });

    it('answers JSON for a JSON request whatever the switch says', async () => {
        const url = await serve({ ...base, frontPage: 'start' });
        const res = await fetch(`${url}/`, { headers: { Accept: 'application/json' } });
        expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
        const text = await res.text();
        expect(text).not.toContain('front-start.css');
    });
});
