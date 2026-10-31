/**
 * @file test/unit/file-store-browser-access.test.ts
 * @description The browser check of a file store (services/file-store/browser-access.ts) against a local
 *   HTTP server that answers the CORS preflight as a store with a rule for every origin, for the node's
 *   own origin only, for none, or not at all would. It proves the four answers, that the app origin is
 *   asked from a made-up subdomain and reported as the wildcard, that an Azure preflight names the
 *   header Azure needs, that a SAS-connected Azure store cannot sign while a key-connected one can, and
 *   that a person's store reaches a private address only when the operator listed it.
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (the CORS guidance when a store is connected; Jouni, 2026-10-31).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import type { AzureSpec, S3Spec } from '../../src/storage/blob/blob-types.js';

vi.mock('../../src/services/push.js', () => ({}));

const { checkBrowserAccess, browserAccessView, corsRuleFor } = await import('../../src/services/file-store/browser-access.js');

const NODE = 'http://node.test';
type Mode = 'all' | 'own' | 'none' | 'drop';
let mode: Mode = 'all';
const seen: { origin?: string; method?: string; headers?: string }[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const origin = String(req.headers.origin || '');
    const method = String(req.headers['access-control-request-method'] || '');
    seen.push({ origin, method, headers: String(req.headers['access-control-request-headers'] || '') });
    if (mode === 'drop') { req.socket.destroy(); return; }
    const admit = req.method === 'OPTIONS' && (mode === 'all' || (mode === 'own' && origin === NODE));
    if (!admit) { res.writeHead(403); res.end('CORS not enabled or no matching rule found for this request.'); return; }
    res.writeHead(200, { 'access-control-allow-origin': origin, 'access-control-allow-methods': method });
    res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const config = (privateOrigins: string[] = []) => ({
  baseUrl: NODE, appOriginEnabled: true, appHost: 'apps.node.test', fileStoreOwnerPrivateOrigins: privateOrigins,
}) as unknown as AimeatConfig;
const s3 = (): S3Spec => ({ kind: 's3', endpoint: base, region: 'us-east-1', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' });
const azure = (cred: { accountKey?: string; sasToken?: string }): AzureSpec => ({ kind: 'azure', accountName: 'acc', container: 'c', endpoint: `${base}/acc`, ...cred });

describe('whether a browser may send to a store', () => {
  it('is allowed when the rule admits the node and its apps, asking from a made-up app subdomain', async () => {
    mode = 'all';
    seen.length = 0;
    const a = await checkBrowserAccess(config(), s3(), 'p/', 'trusted');
    expect(a.cors).toBe('allowed');
    expect(a.signs).toBe(true);
    expect(a.origins).toEqual([{ origin: NODE, ok: true }, { origin: 'http://*.apps.node.test', ok: true }]);
    expect(seen.map(s => s.origin)).toContain('http://aimeat-cors-check.apps.node.test');
    expect(new Set(seen.map(s => s.method))).toEqual(new Set(['PUT', 'GET']));
    const view = browserAccessView(a, 's3');
    expect(view.ready).toBe(true);
    expect(view.rule).toBeNull();
  });

  it('is partial when the rule names only the node, and names the apps as not covered', async () => {
    mode = 'own';
    const a = await checkBrowserAccess(config(), s3(), 'p/', 'trusted');
    expect(a.cors).toBe('partial');
    expect(a.origins.find(o => !o.ok)?.origin).toBe('http://*.apps.node.test');
    expect(a.message).toContain('http://*.apps.node.test');
  });

  it('is missing when there is no rule, and the view gives the rule to add with the S3 JSON', async () => {
    mode = 'none';
    const a = await checkBrowserAccess(config(), s3(), 'p/', 'trusted');
    expect(a.cors).toBe('missing');
    const view = browserAccessView(a, 's3');
    expect(view.ready).toBe(false);
    expect(view.rule?.allowed_origins).toEqual(['*']);
    expect(JSON.parse(view.rule!.json!)[0].AllowedMethods).toContain('PUT');
  });

  it('is unknown when the store does not answer', async () => {
    mode = 'drop';
    const a = await checkBrowserAccess(config(), s3(), 'p/', 'trusted');
    expect(a.cors).toBe('unknown');
  });

  it('asks Azure for x-ms-blob-type, and signs with an account key but not with a SAS', async () => {
    mode = 'all';
    seen.length = 0;
    const withKey = await checkBrowserAccess(config(), azure({ accountKey: 'a2V5' }), 'p/', 'trusted');
    expect(withKey.cors).toBe('allowed');
    expect(withKey.signs).toBe(true);
    expect(seen.find(s => s.method === 'PUT')?.headers).toContain('x-ms-blob-type');
    const withSas = await checkBrowserAccess(config(), azure({ sasToken: 'sv=1&sig=x' }), 'p/', 'trusted');
    expect(withSas.cors).toBe('allowed');
    expect(withSas.signs).toBe(false);
    const view = browserAccessView(withSas, 'azure');
    expect(view.ready).toBe(false);
    expect(view.rule).toBeNull();
    expect(withSas.message).toContain('account key');
  });

  it('reaches a person\'s store on a private address only when the operator listed that origin', async () => {
    mode = 'all';
    expect((await checkBrowserAccess(config(), s3(), 'p/', 'guarded')).cors).toBe('unknown');
    expect((await checkBrowserAccess(config([base]), s3(), 'p/', 'guarded')).cors).toBe('allowed');
  });

  it('says where the rule goes for each kind, before any check ran', () => {
    expect(corsRuleFor('azure').where).toContain('Resource sharing (CORS)');
    expect(corsRuleFor('azure').json).toBeUndefined();
    const never = browserAccessView(undefined, 'azure');
    expect(never.cors).toBe('not_checked');
    expect(never.rule?.allowed_methods).toContain('PUT');
  });
});
