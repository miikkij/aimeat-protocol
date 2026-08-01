/**
 * @file test/unit/check-js-syntax.test.ts
 * @description Proof that the syntax checker checks something (TARGET-058 Phase 8 step 0b).
 *
 *   A gate is only worth what its failing case proves. Phase 6 reported "SYNTAX OK" for files
 *   nobody had parsed, so the point of these tests is not that valid code passes — it is that the
 *   sentinels FAIL, that the no-input case is an error rather than a silent pass, and that the
 *   real-world false pass we found is reproduced here so nobody has to rediscover it.
 * @usage pnpm test -- check-js-syntax
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0b.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, selfTest, extractInlineScripts } from '../../scripts/check-js-syntax.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-js-syntax.ts', import.meta.url));

/** Run the CLI and report its exit code + combined output, without throwing on a non-zero exit. */
function runCli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['--experimental-vm-modules', '--import', 'tsx', SCRIPT, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('the sentinels must fail', () => {
  // These two are the exact sources the Phase 6 audit used. If either ever parses, every pass this
  // checker has reported is void — which is why selfTest() runs them on every real invocation too.
  it.each([
    ['unterminated string', "var x = 'a's b'"],
    ['stray parenthesis', 'var x = ( ;'],
    ['reserved word as binding', 'var function = 1;'],
  ])('refuses to parse: %s', (_name, source) => {
    expect(() => parseSource(source, '<sentinel>')).toThrow();
  });

  it('selfTest() passes only because all three threw', () => {
    expect(() => selfTest()).not.toThrow();
  });

  it('accepts valid script source, so the check is not simply always-fail', () => {
    expect(() => parseSource('var x = 1; function f(){ return x; }', '<ok>')).not.toThrow();
  });
});

describe('the false pass we are replacing', () => {
  it('`node --check` with an EMPTY filename exits 0 and prints nothing', () => {
    // The reproduction, kept as a test rather than a claim. `node --check` reads stdin when given
    // no path; empty stdin is valid JavaScript; the shell prints a clean exit. An unset variable in
    // a build script therefore turns the gate into a no-op that looks exactly like a pass.
    let code = 1;
    let out = '';
    try {
      out = execFileSync(process.execPath, ['--check'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '' });
      code = 0;
    } catch (err) { code = (err as { status?: number }).status ?? 1; }
    expect(code).toBe(0);
    expect(out.trim()).toBe('');
  });

  it('`node --check` on a genuinely broken file DOES exit 1 (the parser was never the problem)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-syntax-'));
    try {
      const bad = join(dir, 'bad.js');
      writeFileSync(bad, "var x = 'a's b'\n", 'utf8');
      let code = 0;
      try { execFileSync(process.execPath, ['--check', bad], { stdio: 'ignore' }); } catch (err) {
        code = (err as { status?: number }).status ?? 1;
      }
      expect(code).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('this checker treats no input as an ERROR instead', () => {
    const { code, out } = runCli([]);
    expect(code).toBe(1);
    expect(out).toContain('nothing to check');
  });
});

describe('the CLI over real files', () => {
  it('fails a broken file and passes a good one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-syntax-'));
    try {
      const bad = join(dir, 'bad.js');
      const good = join(dir, 'good.js');
      writeFileSync(bad, 'var x = ( ;\n', 'utf8');
      writeFileSync(good, 'var x = 1;\n', 'utf8');

      const badRun = runCli([bad]);
      expect(badRun.code).toBe(1);
      expect(badRun.out).toContain('failed to parse');

      const goodRun = runCli([good]);
      expect(goodRun.code).toBe(0);
      expect(goodRun.out).toContain('sentinels were confirmed to fail');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('checks the inline <script> bodies of a single-file app, and catches a broken one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-syntax-'));
    try {
      const app = join(dir, 'app.html');
      writeFileSync(app,
        '<!DOCTYPE html><html><body>'
        + '<script type="application/ld+json">{"@type": "not javascript"}</script>'
        + '<script src="/v1/libs/aimeat-ai.js"></script>'
        + '<script>var ok = 1;</script>'
        + '<script>var broken = ( ;</script>'
        + '</body></html>', 'utf8');
      const { code, out } = runCli([app]);
      expect(code).toBe(1);
      // The JSON-LD block and the src= block are skipped; only the two real scripts are parsed.
      expect(out).toContain('<script #4>');
      expect(out).not.toContain('<script #1>');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an HTML file with nothing to parse is an error, not a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-syntax-'));
    try {
      const app = join(dir, 'empty.html');
      writeFileSync(app, '<!DOCTYPE html><html><body><p>no script here</p></body></html>', 'utf8');
      const { code, out } = runCli([app]);
      expect(code).toBe(1);
      expect(out).toContain('no inline <script> blocks');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('extractInlineScripts', () => {
  it('skips src= and non-JavaScript type=, keeps module and plain scripts', () => {
    const found = extractInlineScripts(
      '<script src="a.js"></script>'
      + '<script type="application/ld+json">{}</script>'
      + '<script type="module">export const a = 1;</script>'
      + '<script>var b = 2;</script>');
    expect(found.map(f => f.source)).toEqual(['export const a = 1;', 'var b = 2;']);
  });

  it('reads each block\'s own goal, so a module body is not failed for its import line', () => {
    const found = extractInlineScripts(
      '<script type="module">import x from "y";</script><script>var b = 2;</script>');
    expect(found.map(f => f.goal)).toEqual(['module', 'script']);
  });
});
