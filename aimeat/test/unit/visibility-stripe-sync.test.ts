/**
 * @file test/unit/visibility-stripe-sync.test.ts
 * @description The push of an owner's catalog into their own Stripe (services/visibility/
 *   merchant-feed-settings.ts syncStripeCatalog), against a stand-in for Stripe: the calls in the
 *   documented order (create the import, PUT the CSV to the upload address, read the status), the
 *   owner's own key and the pinned version header on every Stripe call, and Stripe's own words kept
 *   when it refuses.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
let answer: (url: string, method: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });

vi.mock('../../src/utils/url-validator.js', () => ({
  safeFetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: String(init.body ?? '') });
    const a = answer(url, init.method ?? 'GET');
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  },
}));
vi.mock('../../src/commerce/app-tool-catalog.js', () => ({ listPricedAppTools: async () => [] }));

const { syncStripeCatalog, setFeedSettings, STRIPE_CATALOG_VERSION } = await import('../../src/services/visibility/merchant-feed-settings.js');

const OWNER = 'shop@node-1';
function fakeStorage(withKey: boolean) {
  const mem = new Map<string, { value: unknown; version: number; createdAt: string; key: string; ownerGaii: string }>();
  const put = (ownerGaii: string, key: string, value: unknown) => mem.set(`${ownerGaii}|${key}`, { value, version: 1, createdAt: '', key, ownerGaii });
  if (withKey) put(OWNER, 'commerce.psp', { secretKey: 'sk_test_owner' });
  put('vendor#shop@node-1', 'agents.vendor.offers', { offers: [
    { id: 'audit', title: 'Audit', ask: 'An audit.', priceMoney: { amount: 19_990_000, currency: 'USD' }, visibility: 'public' },
  ] });
  return {
    getMemory: async (o: string, k: string) => mem.get(`${o}|${k}`) ?? null,
    setMemory: async (r: { ownerGaii: string; key: string; value: unknown }) => { put(r.ownerGaii, r.key, r.value); return r; },
    listAllMemory: async ({ prefix }: { prefix: string }) => ({ items: [...mem.values()].filter((r) => r.key.startsWith(prefix)) }),
    getOwner: async () => ({ name: 'shop', displayName: 'Shop' }),
  };
}
const config = { baseUrl: 'https://place.example', encryptionKey: null, totpSecretEncryptionKey: null } as never;

beforeEach(() => { calls.length = 0; });

describe('syncStripeCatalog', () => {
  it('creates the import, uploads the CSV to the address Stripe gave, with the owner\'s key and the pinned version', async () => {
    const storage = fakeStorage(true) as never;
    await setFeedSettings(storage, OWNER, { enabled: true });
    answer = (url, method) => url.endsWith('/v2/commerce/product_catalog/imports') && method === 'POST'
      ? { status: 200, body: { id: 'pcimprt_1', status: 'awaiting_upload', status_details: { awaiting_upload: { upload_url: { url: 'https://upload.stripe.example/f1', expires_at: 'x' } } } } }
      : { status: 200, body: '' };
    const state = await syncStripeCatalog(storage, config, OWNER);
    expect(state).toMatchObject({ id: 'pcimprt_1', status: 'processing' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', 'https://api.stripe.com/v2/commerce/product_catalog/imports'],
      ['PUT', 'https://upload.stripe.example/f1'],
    ]);
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk_test_owner');
    expect(calls[0]!.headers['Stripe-Version']).toBe(STRIPE_CATALOG_VERSION);
    expect(JSON.parse(calls[0]!.body)).toEqual({ feed_type: 'product', mode: 'replace', metadata: { file_name: 'aimeat-catalog.csv' } });
    expect(calls[1]!.headers['Content-Type']).toBe('text/csv');
    expect(calls[1]!.headers.Authorization).toBeUndefined();
    expect(calls[1]!.body).toContain(',in_stock,19.99 USD,Shop,');
  });

  it('reads the status again with check_only, and keeps the row errors Stripe gave', async () => {
    const storage = fakeStorage(true) as never;
    await setFeedSettings(storage, OWNER, { enabled: true });
    answer = (url, method) => method === 'POST'
      ? { status: 200, body: { id: 'pcimprt_2', status: 'awaiting_upload', status_details: { awaiting_upload: { upload_url: { url: 'https://u.example/2' } } } } }
      : url.includes('pcimprt_2')
        ? { status: 200, body: { id: 'pcimprt_2', status: 'succeeded_with_errors', status_details: { succeeded_with_errors: { success_count: 0, error_count: 1, samples: [{ field: 'brand', error_message: 'too long' }] } } } }
        : { status: 200, body: '' };
    await syncStripeCatalog(storage, config, OWNER);
    const state = await syncStripeCatalog(storage, config, OWNER, { checkOnly: true });
    expect(state).toMatchObject({ status: 'succeeded_with_errors', successCount: 0, errorCount: 1, message: 'brand: too long' });
  });

  it('refuses without a selling key, with the feed off, and passes Stripe\'s own refusal on', async () => {
    const noKey = fakeStorage(false) as never;
    await setFeedSettings(noKey, OWNER, { enabled: true });
    await expect(syncStripeCatalog(noKey, config, OWNER)).rejects.toMatchObject({ code: 'PSP_NOT_CONFIGURED' });
    const off = fakeStorage(true) as never;
    await expect(syncStripeCatalog(off, config, OWNER)).rejects.toMatchObject({ code: 'FEED_OFF' });
    const refused = fakeStorage(true) as never;
    await setFeedSettings(refused, OWNER, { enabled: true });
    answer = () => ({ status: 403, body: { error: { message: 'This key lacks the Product Catalog Imports permission.' } } });
    await expect(syncStripeCatalog(refused, config, OWNER)).rejects.toMatchObject({ code: 'STRIPE_REFUSED', statusCode: 403, message: 'This key lacks the Product Catalog Imports permission.' });
  });
});
