/**
 * @file extension-vm-fetch-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Execute the real VM bridge against the context's guarded fetch capability.
 * @version-history 1.0.0 2026-09-27 Delegation, refusal and host deadline contract.
 */
import { describe, expect, it, vi } from 'vitest';
import { executeExtensionAction, type ExtensionCtx } from '../../src/services/extension-runtime.js';

const script = 'export default async function(ctx, input) { return await ctx.fetch(input.url, input.opts); }';
function context(fetch: ExtensionCtx['fetch']): ExtensionCtx {
  return {
    memory: { get: async () => null, getPublic: async () => null, getVersioned: async () => null,
      set: async () => ({ ok: true, version: 1 }), search: async () => [], delete: async () => false },
    wallet: {}, consent: {}, trust: {}, config: {}, fetch,
    caller: { gaii: 'agent#owner@node', owner: 'owner', roles: ['agent'] },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}
const limits = { memoryMb: 8, timeoutMs: 5000, maxApiCalls: 2 };
describe('actual VM fetch bridge', () => {
  it('delegates arguments and the actual response to guarded ctx.fetch with a host signal', async () => {
    const response = { status: 202, ok: true, text: 'guarded result', headers: { 'x-guard': 'yes' } };
    const guarded = vi.fn<ExtensionCtx['fetch']>().mockResolvedValue(response);
    const input = { url: 'https://example.invalid/resource', opts: { method: 'POST', body: 'payload',
      headers: { Authorization: '{{secret:API_KEY}}' } } };
    expect(await executeExtensionAction(script, context(guarded), input, limits)).toEqual(response);
    expect(guarded).toHaveBeenCalledTimes(1);
    const [url, opts, host] = guarded.mock.calls[0];
    expect(url).toBe(input.url);
    expect(opts).toEqual(input.opts);
    expect(host?.signal).toBeInstanceOf(AbortSignal);
  });

  it('cannot succeed when the context refuses the outbound request', async () => {
    const guarded = vi.fn<ExtensionCtx['fetch']>().mockRejectedValue(new Error('SCOPE_REFUSED_BY_CONTEXT'));
    await expect(executeExtensionAction(script, context(guarded),
      { url: 'https://example.invalid/blocked' }, limits)).rejects.toThrow('SCOPE_REFUSED_BY_CONTEXT');
    expect(guarded).toHaveBeenCalledTimes(1);
  });
});
