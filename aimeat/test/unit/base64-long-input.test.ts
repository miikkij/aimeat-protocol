/**
 * @file test/unit/base64-long-input.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Base64 text of 4 MiB characters or more is read, not answered with a 500. Every inline
 *   file door checked its base64 with one regular expression over the whole string
 *   (`/^[A-Za-z0-9+/_-]+={0,2}$/` and its kin). V8 may run such a pattern keeping one backtrack entry
 *   per character, and then throws RangeError "Maximum call stack size exceeded" at 4,194,304
 *   characters: on aimeat.io an inline POST /v1/storage of a 3.2 MB file answered 500 INTERNAL_ERROR,
 *   while the same bytes as a raw body stored fine. `--no-regexp-optimization` makes V8 run every
 *   pattern that way, so the children here fail the way the production node did, on any machine.
 *   The four doors: decodeStrictBase64 (POST /v1/storage, POST /v1/memory/files, POST /v1/apps), a
 *   secret share's file, a skill file sent as base64, and a data URL in an AI call's files.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-aimeat-storage-upload-l-hett-tiedoston-yhdell-put-pyynn-ll-j).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { decodeStrictBase64, isBase64Text } from '../../src/utils/base64.js';

const src = (p: string) => JSON.stringify(pathToFileURL(resolve(__dirname, '../../src', p)).href);

/** 5 MiB characters of base64, over the 4 MiB line where the regular expressions threw. */
const LONG = `require('node:crypto').randomBytes(3932160).toString('base64')`;

/** Run `body` in a child node that keeps a backtrack entry per character; its stdout, or the error. */
function child(body: string): { ok: boolean; out: string } {
  const code = `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
    const long = ${LONG};
    try { ${body} } catch (e) { process.stdout.write('THREW ' + e.name + ': ' + e.message); process.exit(3); }`;
  const r = spawnSync(process.execPath, ['--no-regexp-optimization', '--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: resolve(__dirname, '../..'), timeout: 60_000, encoding: 'utf8', killSignal: 'SIGKILL' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 2000) };
}

describe('base64 text over 4 MiB characters', () => {
  it('is decoded by decodeStrictBase64 (the inline file uploads)', () => {
    const r = child(`const { decodeStrictBase64 } = await import(${src('utils/base64.ts')});
      const b = decodeStrictBase64(long); process.stdout.write(String(b && b.length));`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('3932160');
  }, 90_000);

  it('is taken as a secret share file', () => {
    const r = child(`const { normalizeContent } = await import(${src('services/secret-shares/rules.ts')});
      const c = normalizeContent({ format: 'file', content_base64: long, file_name: 'a.bin' }, 26214400);
      process.stdout.write(String(c.ok));`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('true');
  }, 90_000);

  it('is taken as a skill file sent as base64', () => {
    const r = child(`const { readSkillFileInput } = await import(${src('services/skill/files.ts')});
      const b = readSkillFileInput('a.bin', { content: long, encoding: 'base64' }); process.stdout.write(String(b.length));`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('3932160');
  }, 90_000);

  it('is taken as a data URL in an AI call', () => {
    const r = child(`const { readCallFiles } = await import(${src('services/ai/call-files.ts')});
      const f = await readCallFiles({}, {}, 'alice@node', [{ data_url: 'data:application/pdf;base64,' + long }]);
      process.stdout.write(String(f[0].data.length));`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toBe('3932160');
  }, 90_000);
});

describe('what counts as base64 text', () => {
  it('keeps the rules the regular expressions had', () => {
    expect(isBase64Text('QUJD')).toBe(true);
    expect(isBase64Text('QUI=')).toBe(true);
    expect(isBase64Text('QQ==')).toBe(true);
    expect(isBase64Text('a-_b')).toBe(true);
    expect(isBase64Text('a-_b', { urlSafe: false })).toBe(false);
    expect(isBase64Text('')).toBe(false);
    expect(isBase64Text('==')).toBe(false);
    expect(isBase64Text('Q===')).toBe(false);
    expect(isBase64Text('QU=J')).toBe(false);
    expect(isBase64Text('QU=J', { padding: 'anywhere' })).toBe(true);
    expect(isBase64Text('<html>')).toBe(false);
    expect(isBase64Text('QUJD\n')).toBe(false);
  });

  it('decodes with whitespace and refuses what is not base64', () => {
    expect(decodeStrictBase64('QUJD\nREVG')!.toString()).toBe('ABCDEF');
    expect(decodeStrictBase64('  ')).toBeNull();
    expect(decodeStrictBase64('<p>hi</p>')).toBeNull();
    expect(decodeStrictBase64(42 as unknown as string)).toBeNull();
  });
});
