/**
 * @file admin-push-unsubscribe.test.ts
 * @description The admin Push tab's Unsubscribe removes this browser's device only (feature-list
 *   audit #132). DELETE /v1/push/subscribe without an endpoint removes every device of the account,
 *   and the tab sent none. The service now names the endpoint, and the tab passes it.
 * @usage pnpm exec vitest run test/unit/admin-push-unsubscribe.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #132).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const calls: string[] = [];
vi.mock('/js/api.js', () => ({
  apiGet: vi.fn(), apiGetText: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(),
  apiDelete: vi.fn(async (path: string) => { calls.push(path); return { ok: true }; }),
}));

describe('admin push unsubscribe', () => {
  it('names the device endpoint in the DELETE', async () => {
    const api = await import('../../public/js/services/admin.js');
    await api.unsubscribePush('https://push.example/abc?x=1');
    expect(calls).toEqual([`/v1/push/subscribe?endpoint=${encodeURIComponent('https://push.example/abc?x=1')}`]);
  });

  it('the Push tab passes this browser endpoint and never calls it without one', () => {
    const tab = readFileSync(new URL('../../public/views/admin/push-tab.js', import.meta.url), 'utf8');
    expect(tab).toContain('if (endpoint) await api.unsubscribePush(endpoint);');
    expect(tab).not.toContain('api.unsubscribePush()');
  });
});
