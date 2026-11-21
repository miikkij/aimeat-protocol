/**
 * @file sdk-cache-account-change.test.ts
 * @description aimeat-ai and aimeat-agents drop their caches when the signed-in account changes
 *   (appdev pitfall ai/invalidate-caller-catalogues-and-keep-ai-caller-stable). capabilities() kept a
 *   minute and models() an hour, agents.list() half a minute, per page: after a sign-out and a
 *   sign-in as another account the page showed the first account's AI and agents.
 *
 *   FIRST FAIL: before the change the second read after a 'login' event came from the cache.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let reads: string[];
const handlers: Record<string, Array<() => void>> = {};
const fire = (ev: string) => (handlers[ev] || []).forEach(h => h());

beforeAll(async () => {
  restore = installGlobals({});
  const session = {
    jwt: 'test', owner: 'alice', ghii: 'alice@node-1',
    fetch: async (path: string) => {
      reads.push(path);
      if (path.startsWith('/v1/ai/capabilities')) return { ok: true, data: { capabilities: { text: { on: true } } } };
      if (path.startsWith('/v1/agents')) return { ok: true, data: { agents: [] } };
      return { ok: false, error: { code: 'NOT_FOUND', message: path } };
    },
  };
  (window as any).AIMEAT = { auth: { getSession: () => session, on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); } } };
  await import('../../src/static/sdk-libs/ai/index.js');
  await import('../../src/static/sdk-libs/agents/index.js');
});
afterAll(() => restore());
beforeEach(() => { reads = []; });

describe('caches follow the account', () => {
  it('reads the AI capabilities again after a login event', async () => {
    const ai = (window as any).AIMEAT.ai;
    await ai.capabilities();
    await ai.capabilities();
    expect(reads.filter(p => p.startsWith('/v1/ai/capabilities'))).toHaveLength(1);
    fire('login');
    await ai.capabilities();
    expect(reads.filter(p => p.startsWith('/v1/ai/capabilities'))).toHaveLength(2);
  });

  it('reads the agent list again after a logout event', async () => {
    const agents = (window as any).AIMEAT.agents;
    await agents.list();
    await agents.list();
    const n = reads.filter(p => p.startsWith('/v1/agents')).length;
    expect(n).toBe(1);
    fire('logout');
    await agents.list();
    expect(reads.filter(p => p.startsWith('/v1/agents')).length).toBe(2);
  });

  it('a completion that never came back names AIMEAT.ai.job (curated long-ai-calls-timeout)', async () => {
    const ai = (window as any).AIMEAT.ai;
    const s = (window as any).AIMEAT.auth.getSession();
    const was = s.fetch;
    s.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await ai.complete({ app_id: 'x', prompt: 'long essay' }).catch((e: any) => e);
    s.fetch = was;
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Failed to fetch');
    expect(err.jobHint).toMatch(/AIMEAT\.ai\.job\.start/);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a refusal the node answered carries no job hint', async () => {
    const ai = (window as any).AIMEAT.ai;
    const err = await ai.complete({ app_id: 'x', prompt: 'hi' }).catch((e: any) => e);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.jobHint).toBeUndefined();
  });

  it('keeps the cache when no account event fires', async () => {
    const ai = (window as any).AIMEAT.ai;
    await ai.capabilities({ app_id: 'x' });
    await ai.capabilities({ app_id: 'x' });
    expect(reads.filter(p => p.includes('app_id=x'))).toHaveLength(1);
  });
});
