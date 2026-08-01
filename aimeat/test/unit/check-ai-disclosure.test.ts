/**
 * @file test/unit/check-ai-disclosure.test.ts
 * @description Proof that `pnpm check:ai-disclosure` fails when something is dropped (TARGET-058
 *   Phase 8). A gate whose failing case has never been seen is a gate that checks nothing, so each
 *   assertion here is exercised by BREAKING the thing it protects, running the real script, and
 *   restoring — including the one false positive we know the naive version has: the comment in
 *   ai-provenance-marks.ts that names the forbidden vocabulary in order to forbid it.
 * @usage pnpm test -- check-ai-disclosure
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../../scripts/check-ai-disclosure.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'check-ai-disclosure.ts');

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', SCRIPT], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Break a file, run the gate, put it back whatever happens. */
const restores: Array<() => void> = [];
function breakFile(relPath: string, mutate: (src: string) => string): void {
  const full = join(ROOT, relPath);
  const original = readFileSync(full, 'utf8');
  restores.push(() => writeFileSync(full, original, 'utf8'));
  writeFileSync(full, mutate(original), 'utf8');
}
afterEach(() => { while (restores.length) restores.pop()!(); });

describe('the gate passes on the tree as it stands', () => {
  it('exits 0 and reports its known exceptions rather than hiding them', () => {
    const { code, out } = runGate();
    expect(code).toBe(0);
    expect(out).toContain('AI disclosure gates pass');
  });

  it('does NOT fire on the comment in ai-provenance-marks.ts that names the forbidden vocabulary', () => {
    // The exact false positive the phase warned about. The comment says "if you find yourself typing
    // `machine-generated` or `trainedAlgorithmicMedia` in this file..." — a naive grep fails on the
    // documentation of the rule it is enforcing.
    const marks = readFileSync(join(ROOT, 'src/services/ai-provenance-marks.ts'), 'utf8');
    expect(marks).toContain('trainedAlgorithmicMedia');       // the comment really is there
    expect(stripComments(marks)).not.toContain('trainedAlgorithmicMedia');
    expect(runGate().code).toBe(0);
  });

  it('stripComments keeps a URL inside a string and drops a real comment', () => {
    expect(stripComments('const u = "http://x/y"; // trainedAlgorithmicMedia'))
      .toBe('const u = "http://x/y"; ');
    expect(stripComments('/* trainedAlgorithmicMedia */ const a = 1;')).toBe(' const a = 1;');
  });
});

describe('drop a label on purpose and the build fails', () => {
  it('[locales] removing a Finnish aiLabel key', () => {
    breakFile('locales/fi.json', (src) => {
      const j = JSON.parse(src);
      delete j.aiLabel.short;
      return JSON.stringify(j, null, 2);
    });
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('aiLabel.short exists in en.json but not in fi.json');
  });

  it('[locales] a [TODO:fi] placeholder shipped as a disclosure', () => {
    breakFile('locales/fi.json', (src) => {
      const j = JSON.parse(src);
      j.aiLabel.short = '[TODO:fi] AI-generated';
      return JSON.stringify(j, null, 2);
    });
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('[TODO:fi] placeholder');
  });

  it('[build-prompt] removing the disclose() instruction from the app-builder prompt', () => {
    breakFile('src/services/build-app-prompt.ts', (src) => src.replaceAll('AIMEAT.ai.disclose(', 'AIMEAT.ai.SOMETHINGELSE('));
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('no longer contains "AIMEAT.ai.disclose("');
  });

  it('[mcp-provenance] dropping ai_provenance from a required write tool', () => {
    breakFile('src/mcp/core.ts', (src) => src.replace('...aiProvenanceInputs,', '// removed'));
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('no longer declares the ai_provenance input');
  });

  it('[derived-visibility] a provider predicate that stops covering apps', () => {
    breakFile('src/storage/providers/sqlite/methods/ai-provenance.ts', (src) =>
      src.replace(/OR EXISTS \(SELECT 1 FROM apps a[\s\S]*?accessCode IS NULL\)/, ''));
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('does not cover the "apps" container');
  });

  it('[vocabulary] an external vocabulary value typed outside the adapter — in CODE, not a comment', () => {
    breakFile('src/services/ai-provenance-marks.ts', (src) =>
      src.replace("const VISIBLE_LABEL_ID = 'aimeat-ai-label';",
        "const VISIBLE_LABEL_ID = 'aimeat-ai-label';\nconst LEAK = 'trainedAlgorithmicMedia';"));
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('spells the external vocabulary value "trainedAlgorithmicMedia"');
  });

  it('[llm-transport] a raw model call added outside the one transport module', () => {
    breakFile('src/routes/ai.ts', (src) =>
      `${src}\n// a completion nothing meters and nothing stamps\nexport async function sneak(): Promise<Response> {\n  return fetch('https://api.example.com/v1/chat/completions', { method: 'POST' });\n}\n`);
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('calls a model provider endpoint directly');
  });

  it('[llm-transport] a new importer of the raw transport that is not on the list', () => {
    breakFile('src/routes/ai.ts', (src) =>
      `import { complete } from '../services/openrouter.js';\n${src}\nexport const sneak = complete;\n`);
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('calls the raw provider transport instead of the chokepoint');
  });

  it('[one-publish-path] a sixth door writing an app version of its own', () => {
    breakFile('src/routes/apps/read.ts', (src) =>
      `${src}\n// a new door somebody added without reading this file\nexport async function sneak(storage: import('../../storage/interface.js').Storage): Promise<void> {\n  await storage.createApp({} as never);\n}\n`);
    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('writes an app version without going through');
  });
});
