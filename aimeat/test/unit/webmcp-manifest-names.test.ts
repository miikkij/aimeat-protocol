/**
 * @file webmcp-manifest-names.test.ts
 * @description /.well-known/webmcp.json names the node-level tools exactly as the served library
 *   registers them (feature-list audit #190): the manifest said `node_info` and `commerce_feed`
 *   while aimeat-webmcp.js registers `aimeat-node-info` and `aimeat-commerce-feed`, so an agent
 *   reading the manifest asked for tools that did not exist. The library is read as text: it is
 *   browser ESM and the point is the bytes that ship.
 * @usage pnpm exec vitest run test/unit/webmcp-manifest-names.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #190).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWebmcpManifest } from '../../src/routes/agent-conventions.js';
import type { AimeatConfig } from '../../src/config.js';

const lib = readFileSync(new URL('../../src/static/sdk-libs/webmcp/index.js', import.meta.url), 'utf8');

/** The tool names exposeNodeTools() registers, read out of the library source. */
function registeredNodeTools(): string[] {
  const start = lib.indexOf('async exposeNodeTools()');
  expect(start, 'exposeNodeTools not found in the library').toBeGreaterThan(-1);
  const block = lib.slice(start, lib.indexOf('webmcp.register(tools)', start));
  return [...block.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]!).sort();
}

describe('the WebMCP manifest', () => {
  it('names the tools the library registers, and only those', () => {
    const manifest = buildWebmcpManifest({ baseUrl: 'https://node.example', nodeId: 'n' } as AimeatConfig);
    const names = manifest.tools.map(t => t.name).sort();
    expect(names).toEqual(registeredNodeTools());
    expect(names).toEqual(['aimeat-commerce-feed', 'aimeat-node-info']);
  });
});
