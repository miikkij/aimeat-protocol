/**
 * The served library promises eight prefixes resolve without being declared. The node is what
 * decides that, and it refuses an annotation naming any other. If the two lists drift, the library
 * hands an app a prefix the node then rejects — a failure that surfaces as a 400 from a write the
 * app was told was fine, one layer away from the line that caused it.
 *
 * The lib is read as TEXT rather than imported: it is browser ESM with a `window` global, and the
 * point is to check the bytes that ship rather than a copy of them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONTEXT } from '../../src/utils/onto-context.js';

const SRC = join(__dirname, '..', '..', 'src', 'static', 'sdk-libs', 'onto', 'index.js');
const DIST = join(__dirname, '..', '..', 'src', 'static', 'sdk-libs', 'dist', 'aimeat-onto.js');

/** The prefix map out of the lib source, as { prefix: iri }. */
function prefixesFrom(text: string): Record<string, string> {
  const block = /const PREFIXES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(text);
  expect(block, 'PREFIXES = Object.freeze({…}) not found in the lib source').toBeTruthy();
  const out: Record<string, string> = {};
  for (const m of block![1].matchAll(/([A-Za-z][\w-]*)\s*:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

describe('aimeat-onto: the served prefixes are the node\'s prefixes', () => {
  it('the source mirrors DEFAULT_CONTEXT exactly', () => {
    expect(prefixesFrom(readFileSync(SRC, 'utf8'))).toEqual({ ...DEFAULT_CONTEXT });
  });

  it('the committed bundle carries every one of them', () => {
    // check:sdk already proves the bundle matches its sources; this catches the narrower case of a
    // stale bundle being served while the source has been corrected.
    const dist = readFileSync(DIST, 'utf8');
    for (const [prefix, iri] of Object.entries(DEFAULT_CONTEXT)) {
      expect(dist, `bundle is missing ${prefix}`).toContain(`${prefix}: "${iri}"`);
    }
  });
});
