/**
 * @file audit-lib.mjs
 * @description Shared helpers for the semantic security audit: the ast-grep scan invocation, the
 * finding fingerprint (bound to the reviewed source context), the triage store, and
 * the resolver for a headless `claude` binary. Used by generate-report.mjs and ai-triage.mjs.
 * @version-history
 *  - 2026-09-08: implement the A1-A6 audit reliability and sampling corrections.
 *  - 1.0.0 (2026-08-23): extracted from generate-report.mjs; fingerprint + store + claude resolver added.
 */
import { execSync } from 'node:child_process';
import { contextDigest, contextFingerprint } from './finding-context.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

let scanContext;
/** A3: approvals apply only to the reviewed source/policy snapshot and the exact occurrence. */
export function fingerprintOf(finding) {
  scanContext ??= contextDigest(ROOT);
  return contextFingerprint(finding, scanContext);
}

/**
 * WHERE THE PROSE OF AN UNFIXED FINDING LIVES, AND WHY IT IS NOT HERE.
 *
 * This repository is PUBLIC. An acknowledgement says "this code is fine, because…", and publishing
 * it costs nothing: it points at no hole. A finding the triage could NOT acknowledge is the
 * opposite — one sentence naming an unfixed weakness and how to reach it — and on 2026-09-13 a run
 * of this pass committed 23 of those, two of them live on aimeat.io, straight to a public remote.
 * Git history does not take that back.
 *
 * So the two halves are split by where they are written. Acknowledgements stay in the tracked
 * store, because they are the memory that keeps the gate honest and every session needs them. The
 * prose of anything unacknowledged is written to secaudit/, which is gitignored, and the tracked
 * store keeps only the pointer: the fingerprint, the file, the verdict. That is enough for the gate
 * to know a finding is open and for the report to count it, and not enough to be a recipe.
 */
const OPEN_DETAIL_PATH = resolve(ROOT, 'secaudit', 'open-findings.json');
const DETAIL_ELSEWHERE = 'Kirjattu secaudit/open-findings.json -tiedostoon, joka on gitignored: '
  + 'korjaamattoman havainnon sanamuoto ei mene julkiseen repoon.';

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

/**
 * Write the store, with every unacknowledged finding's prose diverted to the gitignored file.
 * The caller passes the whole store as it built it; nothing upstream has to remember the rule.
 */
export function saveStore(store) {
  const detail = { writtenAt: new Date().toISOString(), entries: [], invariantFindings: [] };
  const tracked = JSON.parse(JSON.stringify(store));

  for (const e of tracked.entries ?? []) {
    if (e.verdict === 'legit' || !e.reason) continue;
    detail.entries.push({ fingerprint: e.fingerprint, file: e.file, line: e.line, reason: e.reason });
    e.reason = DETAIL_ELSEWHERE;
  }
  for (const f of tracked.invariantFindings ?? []) {
    if (f.status !== 'open' || !f.note) continue;
    detail.invariantFindings.push({ id: f.id, invariant: f.invariant, file: f.file, note: f.note });
    f.note = DETAIL_ELSEWHERE;
  }

  if (detail.entries.length || detail.invariantFindings.length) {
    mkdirSync(dirname(OPEN_DETAIL_PATH), { recursive: true });
    writeFileSync(OPEN_DETAIL_PATH, JSON.stringify(detail, null, 2) + '\n');
  }
  writeFileSync(STORE_PATH, JSON.stringify(tracked, null, 2) + '\n');
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
