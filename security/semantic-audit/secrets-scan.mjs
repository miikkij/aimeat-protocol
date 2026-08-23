/**
 * @file secrets-scan.mjs
 * @description Secret scanning section of the audit report, via gitleaks over the full git history.
 * The binary is resolved from PATH or downloaded once (pinned version) into secaudit/.tools/, which
 * is gitignored. Matches are always redacted so a leaked value never lands in the report itself.
 * A committed baseline (gitleaks-baseline.json next to this file) suppresses findings a human has
 * reviewed and accepted; anything outside it is a NEW finding and turns the report red.
 * @version-history
 *  - 1.0.0 (2026-08-23): first version — pinned download, redacted history scan, baseline support.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GITLEAKS_VERSION = '8.30.1';
const BASELINE = resolve(HERE, 'gitleaks-baseline.json');

function platformAsset() {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = os === 'windows' ? 'zip' : 'tar.gz';
  return `gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.${ext}`;
}

/** PATH first, then the pinned copy under secaudit/.tools/ (downloaded on first use). */
async function resolveGitleaks(outDir) {
  const which = process.platform === 'win32' ? 'where gitleaks 2>NUL' : 'command -v gitleaks 2>/dev/null';
  try {
    const hit = execSync(which, { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (hit && existsSync(hit)) return hit;
  } catch { /* not on PATH */ }
  const toolsDir = join(outDir, '.tools');
  const bin = join(toolsDir, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  if (existsSync(bin)) return bin;
  const asset = platformAsset();
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}`;
  process.stderr.write(`   Ladataan gitleaks v${GITLEAKS_VERSION} (kerran, kohteeseen secaudit/.tools)…\n`);
  mkdirSync(toolsDir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gitleaks-lataus epäonnistui: HTTP ${res.status}`);
  const archive = join(toolsDir, asset);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  // Windows: the bundled bsdtar (System32) reads zip; a GNU tar on PATH reads neither zip nor a
  // `c:` drive prefix. Elsewhere the system tar handles the tar.gz. Relative path + cwd on purpose.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', asset], { cwd: toolsDir });
  rmSync(archive, { force: true });
  if (!existsSync(bin)) throw new Error('gitleaks-binääriä ei löytynyt paketista.');
  return bin;
}

/**
 * Scan the repository's full git history. Returns { ok, count, findings } where findings carry no
 * secret material (redacted). On any tooling failure returns { ok: false, error } so the report can
 * say the scan did not run instead of silently claiming a clean history.
 */
export async function runSecretsScan(repoRoot, outDir) {
  let bin;
  try { bin = await resolveGitleaks(outDir); } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  const reportPath = join(outDir, 'gitleaks.json');
  rmSync(reportPath, { force: true });
  const args = ['git', '--redact', '--no-banner', '--exit-code', '2',
    '--report-format', 'json', '--report-path', reportPath];
  if (existsSync(BASELINE)) args.push('--baseline-path', BASELINE);
  args.push(repoRoot);
  let exitCode = 0;
  try {
    execFileSync(bin, args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    exitCode = err.status ?? 1;
    if (exitCode !== 2) return { ok: false, error: `gitleaks kaatui (exit ${exitCode}): ${String(err.stderr || '').slice(-300)}` };
  }
  let findings = [];
  if (existsSync(reportPath)) {
    try { findings = JSON.parse(readFileSync(reportPath, 'utf8')) || []; } catch { findings = []; }
  }
  return {
    ok: true,
    version: GITLEAKS_VERSION,
    baselined: existsSync(BASELINE),
    count: findings.length,
    findings: findings.slice(0, 50).map(f => ({
      rule: f.RuleID,
      file: f.File,
      line: f.StartLine,
      commit: (f.Commit || '').slice(0, 8),
    })),
  };
}
