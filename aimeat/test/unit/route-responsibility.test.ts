/**
 * @file route-responsibility.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Exercise the root and stats routers in production order, with the late routers present.
 * @version-history 1.0.0 2026-09-27 Baseline contract before removing shadowed handlers.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/config.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { bootstrapRouter } from '../../src/routes/bootstrap.js';
import { subdomainServeRouter } from '../../src/routes/subdomains.js';
import { siteRouter } from '../../src/routes/site.js';
import { catalogueRouter } from '../../src/routes/catalogue.js';
import { statsRouter } from '../../src/routes/stats.js';
import { SiteService } from '../../src/services/site.js';
import { StatsCollector } from '../../src/services/stats.js';

async function request(app: express.Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers, redirect: 'manual' });
    return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

it('production mounts subdomains, bootstrap, stats, catalogue and site in that order', () => {
  const source = readFileSync(new URL('../../src/server-bootstrap/routes-loader.ts', import.meta.url), 'utf8');
  const order = ['subdomainServeRouter', 'bootstrapRouter', 'statsRouter', 'catalogueRouter', 'siteRouter']
    .map(name => source.indexOf(`app.use(${name}(`));
  expect(order.every(i => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

describe.each([false, true])('site enabled: %s', siteEnabled => {
  it.each([
    { accept: 'application/json', type: 'application/json' },
    { accept: 'text/plain', type: 'text/plain' },
    { accept: 'text/markdown', type: 'text/markdown' },
    { accept: 'text/html', type: 'text/html' },
    { accept: '*/*', type: 'text/html' },
  ])('the bootstrap owns $accept even with a custom template', async ({ accept, type }) => {
    const storage = new SqliteStorage(':memory:');
    const config = { ...loadConfig().config, siteEnabled, baseUrl: 'http://aimeat.test' };
    const site = new SiteService(config, storage);
    vi.spyOn(site, 'hasCustomTemplate').mockResolvedValue(true);
    vi.spyOn(site, 'getPortalHtml').mockResolvedValue('<html><body><h1>Operator template</h1></body></html>');
    let late = 0;
    const app = express();
    app.use(subdomainServeRouter(config, storage));
    app.use(bootstrapRouter(config, storage, undefined, site));
    app.use((_req, _res, next) => { late++; next(); });
    app.use(siteRouter(config, storage, site));
    try {
      for (const host of ['aimeat.test', 'unmapped.aimeat.test']) {
        const result = await request(app, '/', { accept, host });
        expect(result.status).toBe(200);
        expect(result.type).toContain(type);
        expect(result.text.length).toBeGreaterThan(10);
      }
      expect(late).toBe(0);
    } finally { storage.close(); vi.restoreAllMocks(); }
  });
});

it.each([
  { enabled: false, access: 'public', status: 503 },
  { enabled: true, access: 'operator', status: 403 },
  { enabled: true, access: 'authenticated', status: 401 },
  { enabled: true, access: 'public', status: 200 },
] as const)('stats enabled=$enabled access=$access is handled before catalogue', async ({ enabled, access, status }) => {
  const storage = new SqliteStorage(':memory:');
  const config = { ...loadConfig().config, statsEnabled: enabled, statsAccess: access };
  const app = express();
  let late = 0;
  app.use(statsRouter(config, storage, new StatsCollector()));
  app.use((_req, _res, next) => { late++; next(); });
  app.use(catalogueRouter(config, storage));
  try {
    const response = await request(app, '/v1/stats');
    expect(response.status).toBe(status);
    expect(response.type).toContain('application/json');
    expect(late).toBe(0);
    if (status === 200) expect(JSON.parse(response.text).data).toHaveProperty('memory_writes');
  } finally { storage.close(); }
});

