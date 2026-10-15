/**
 * @file test/unit/onto-scheme-owl.test.ts
 * @description A concept scheme built by the served aimeat-onto library passes the node's own
 *   annotation rule (feature-list audit #70). concept() writes `owl:deprecated` for a retired
 *   concept, `owl` is not one of the node's default prefixes, and scheme() did not declare it, so
 *   the node refused every scheme holding a deprecated concept. The shipped bundle
 *   (src/static/sdk-libs/dist/aimeat-onto.js) is run in a VM, so what is tested is the file served.
 * @usage pnpm exec vitest run test/unit/onto-scheme-owl.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #70).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { annotationErrors } from '../../src/utils/onto-context.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/static/sdk-libs/dist/aimeat-onto.js'), 'utf8');

function loadOnto(): Record<string, any> {
  const window: Record<string, any> = { __AIMEAT_SDK_CFG__: { nodeId: 'n', baseUrl: 'https://node.example' }, AIMEAT: {} };
  window.window = window;
  const sandbox: Record<string, any> = {
    window,
    document: { querySelector: () => null },
    location: { protocol: 'https:', origin: 'https://node.example' },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    console,
    setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return window.AIMEAT.onto;
}

describe('aimeat-onto: a scheme with a deprecated concept is one the node accepts', () => {
  it('scheme() declares owl, so owl:deprecated in a concept raises no annotation error', () => {
    const onto = loadOnto();
    const doc = onto.scheme({
      id: 'hobbies',
      label: 'Hobbies',
      concepts: [
        onto.concept({ id: 'birdwatching', label: 'Birdwatching' }),
        onto.concept({ id: 'twitching', label: 'Twitching', deprecated: true, replacedBy: 'birdwatching' }),
      ],
    });
    // Round-trip through JSON: that is how the record reaches the node.
    const stored = JSON.parse(JSON.stringify(doc));
    expect(stored.concepts[1]['owl:deprecated']).toBe(true);
    expect(stored['@context'].owl).toBe('http://www.w3.org/2002/07/owl#');
    expect(annotationErrors(stored)).toEqual([]);
  });
});
