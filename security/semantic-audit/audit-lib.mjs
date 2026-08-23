/**
 * @file audit-lib.mjs
 * @description Shared helpers for the semantic security audit: the ast-grep scan invocation, the
 * finding fingerprint (stable across line drift), the triage store (committed acknowledgments), and
 * the resolver for a headless `claude` binary. Used by generate-report.mjs and ai-triage.mjs.
 * @version-history
 *  - 1.0.0 (2026-08-23): extracted from generate-report.mjs; fingerprint + store + claude resolver added.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const STORE_PATH = resolve(HERE, 'triage-store.json');

export const norm = s => (s || '').replace(/\\/g, '/');

/** Run the ast-grep rule set against a path (relative to repo root); returns parsed findings. */
export const astScan = (path) => JSON.parse(execSync(
  `npx -y -p @ast-grep/cli@0.45.1 ast-grep scan -c security/semantic-audit/sgconfig.yml ${path} --json=compact`,
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
) || '[]');

/**
 * A fingerprint that survives line-number drift: rule id + file + the matched text with whitespace
 * collapsed. Editing the matched code itself invalidates the acknowledgment, which is the point —
 * a changed site must be looked at again.
 */
export function fingerprintOf(finding) {
  const text = String(finding.text || '').replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(`${finding.ruleId}|${norm(finding.file)}|${text}`)
    .digest('hex')
    .slice(0, 16);
}

/** The committed triage store: acknowledged findings + open invariant-review findings. */
export function loadStore() {
  if (!existsSync(STORE_PATH)) {
    return { version: 1, lastInvariantReviewCommit: null, entries: [], invariantFindings: [] };
  }
  const s = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  s.entries ??= [];
  s.invariantFindings ??= [];
  return s;
}

export function saveStore(store) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n');
}

/**
 * Locate a `claude` binary for headless (-p) runs: AIMEAT_CLAUDE_BIN, then PATH, then the newest
 * Claude Code editor extension (VS Code / Insiders / Cursor) which bundles a native binary.
 */
export function resolveClaudeBin() {
  if (process.env.AIMEAT_CLAUDE_BIN && existsSync(process.env.AIMEAT_CLAUDE_BIN)) {
    return process.env.AIMEAT_CLAUDE_BIN;
  }
  const which = process.platform === 'win32' ? 'where claude 2>NUL' : 'command -v claude 2>/dev/null';
  try {
    const hit = execSync(which, { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (hit && existsSync(hit)) return hit;
  } catch { /* not on PATH */ }
  const exts = ['.vscode', '.vscode-insiders', '.cursor']
    .map(d => join(homedir(), d, 'extensions'))
    .filter(existsSync)
    .flatMap(dir => readdirSync(dir)
      .filter(n => n.startsWith('anthropic.claude-code-'))
      .map(n => join(dir, n, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')))
    .filter(existsSync)
    .sort();
  if (exts.length) return exts[exts.length - 1];
  return null;
}
