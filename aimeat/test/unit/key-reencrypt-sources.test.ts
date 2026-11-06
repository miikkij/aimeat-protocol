/**
 * @file test/unit/key-reencrypt-sources.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The re-encrypt job's list of places (services/key-reencrypt/sources.ts) is held to the
 *   code: every file under src/ that seals a value with the data key (calls encrypt() or
 *   encryptBound() of services/encryption.ts) is named in SEALED_BY, with the job's source that
 *   reseals what it stores or the reason it has none, and every source named there exists. A new
 *   place that stores a sealed value and is not added to the job would otherwise keep its value under
 *   the old key, and the job would report the old key removable while that value still needs it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/key-reencrypt-sources.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REENCRYPT_SOURCES, SEALED_BY } from '../../src/services/key-reencrypt/sources.js';

const ROOT = join(__dirname, '..', '..');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Files that import the data key's seal functions and call one of them. */
function sealingFiles(): string[] {
  const out: string[] = [];
  for (const file of filesUnder(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel === 'src/services/encryption.ts' || rel.startsWith('src/services/key-reencrypt/')) continue;
    const text = readFileSync(file, 'utf8');
    const imports = /import\s*\{([^}]*)\}\s*from\s*'[./]*(?:services\/)?encryption\.js'/.exec(text);
    if (!imports) continue;
    const names = imports[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
    if (!names.includes('encrypt') && !names.includes('encryptBound')) continue;
    if (/\b(?:encrypt|encryptBound)\(/.test(text.replace(/import[\s\S]*?;/g, ''))) out.push(rel);
  }
  return out.sort();
}

describe('the re-encrypt job knows every place a value is sealed with the data key', () => {
  it('every sealing file is named in SEALED_BY', () => {
    const missing = sealingFiles().filter(f => !(f in SEALED_BY));
    expect(missing, `files that seal with the data key and are not in services/key-reencrypt/sources.ts SEALED_BY: add the source that reseals what they store, or the reason they store nothing`).toEqual([]);
  });

  it('every file in SEALED_BY still seals, and every source it names exists', () => {
    const sealing = new Set(sealingFiles());
    const ids = new Set(REENCRYPT_SOURCES.map(s => s.id));
    for (const [file, sources] of Object.entries(SEALED_BY)) {
      expect(sealing.has(file), `${file} is in SEALED_BY but no longer seals with the data key: remove its entry`).toBe(true);
      if (sources.startsWith('none:')) continue;
      for (const id of sources.split(',').map(s => s.trim())) expect(ids.has(id), `${file} names the source "${id}", which sources.ts does not have`).toBe(true);
    }
  });
});
