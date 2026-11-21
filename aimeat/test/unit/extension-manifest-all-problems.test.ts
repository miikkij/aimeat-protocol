/**
 * @file test/unit/extension-manifest-all-problems.test.ts
 * @description An extension install refusal names every manifest problem at once (curated appdev
 *   pitfall ext-manifest-strict). An author met one missing field per install round-trip; the
 *   identity fields written at the top level instead of under metadata: were refused with a
 *   sentence that did not say where they were.
 *
 *   FIRST FAIL: before the change the refusal named only the first action's first missing field,
 *   and the identity refusal did not name the fields or the top level.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildExtensionRecordFromManifest } from '../../src/services/extension/manifest.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
  nodeId: 'test-node', extensionMaxCodeSizeKb: 512, extensionMaxMemoryMb: 64, extensionTimeoutMs: 30_000,
  extensionMaxApiCalls: 100, extensionMaxDebitPerCall: 100, extensionMaxPayMorsels: 1000,
} as unknown as AimeatConfig;
const SCRIPTS = { 'a.js': 'export default async function () { return {}; }' };
const build = (yaml: string) => buildExtensionRecordFromManifest(yaml, SCRIPTS, config, 'alice', '2026-11-21T00:00:00.000Z');

describe('a refused manifest', () => {
  it('names every action field that is missing, in one refusal', () => {
    const out = build(['metadata:', '  name: probe-ext', '  version: "1.0.0"', '  description: A probe', '  author: alice',
      'actions:', '  - id: one', '    method: POST', '  - id: two', '    path: /two', '    script: a.js'].join('\n'));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_MANIFEST');
    expect(out.message).toMatch(/^Action "one": path must be a non-empty string/);
    expect(out.message).toContain('Action "one": script');
    expect(out.message).toContain('Action "two": method');
    expect(out.message).toContain('and 2 more');
  });

  it('names the identity fields and says they sit at the top level', () => {
    const out = build(['name: probe-ext', 'version: "1.0.0"', 'description: A probe', 'author: alice',
      'actions:', '  - id: one', '    method: POST', '    path: /one', '    script: a.js'].join('\n'));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/^metadata\.name, metadata\.version, metadata\.description, and metadata\.author are required/);
    expect(out.message).toContain('missing: metadata.name, metadata.version, metadata.description, metadata.author');
    expect(out.message).toContain('at the top level of the manifest: move them under metadata:');
  });

  it('keeps the one-problem message as it was', () => {
    const out = build(['metadata:', '  name: probe-ext', '  version: "1.0.0"', '  description: A probe', '  author: alice',
      'actions:', '  - id: one', '    method: POST', '    path: /one'].join('\n'));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe('Action "one": script must be a non-empty string, got missing');
  });
});
