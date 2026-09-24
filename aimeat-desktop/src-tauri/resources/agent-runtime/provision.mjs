/**
 * @file provision.mjs
 * @description First-run provisioning for the desktop LOCAL AGENT runtime (workstream A,
 *   D1 = first-run download — nothing Python is baked into the installer). Run by the
 *   bundled node.exe, exactly like resources/server/agent-bridge.mjs: it emits newline-
 *   delimited JSON on stdout that the Rust side relays to the webview as events. It
 *   orchestrates EXTERNAL tools (git, uv, ollama) to stand up the `crewaimeat` fleet on a
 *   local Ollama model — it never bundles them; missing tools are reported, not fatal.
 * @structure emits {type:"progress",step,status,message} lines + a final {type:"result",ok,...}
 * @usage node provision.mjs [--install-uv] [--pull-model] [--skip-sync]
 *   env: AIMEAT_AGENT_WORKDIR, AIMEAT_AGENT_MODEL=gemma4:latest, AIMEAT_CREWAIMEAT_REPO,
 *        AIMEAT_PROVIDERS_DEFAULT (path to llm_providers.default.json), AIMEAT_OLLAMA_URL
 * @version-history
 *   v1.1.0 — 2026-09-24 — --install-uv installs a fixed uv release whose zip is checked against the
 *     sha256 written here before anything in it runs, instead of running uv's install script.
 *   v1.0.0 — 2026-06-17 — Initial: git/uv/ollama provisioning of the crewaimeat fleet (owner spec).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const ARGS = new Set(process.argv.slice(2));
const ENV = process.env;
const REPO = ENV.AIMEAT_CREWAIMEAT_REPO || 'https://github.com/miikkij/crewaimeat';
// gemma4:latest — CrewAI agents require tool/function calling. gemma4 supports it (verified:
// returns proper tool_calls via the Ollama OpenAI-compat endpoint); gemma3 does NOT (HTTP 400
// "does not support tools"). So the agent model must be gemma4 (or another tool-capable model),
// NOT gemma3. Override with AIMEAT_AGENT_MODEL.
const MODEL = ENV.AIMEAT_AGENT_MODEL || 'gemma4:latest';
const OLLAMA_URL = ENV.AIMEAT_OLLAMA_URL || 'http://localhost:11434';
const WORKDIR = ENV.AIMEAT_AGENT_WORKDIR || join(homedir(), '.aimeat', 'agent-runtime');
const REPO_DIR = join(WORKDIR, 'crewaimeat');
const PROVIDERS_DEFAULT = ENV.AIMEAT_PROVIDERS_DEFAULT || join(process.cwd(), 'llm_providers.default.json');
// uv at a fixed release: the Windows x64 zip of astral-sh/uv 0.12.18, and the sha256 that release
// publishes for it (uv-x86_64-pc-windows-msvc.zip.sha256). A bump changes all three together.
const UV_VERSION = '0.12.18';
const UV_ZIP = 'uv-x86_64-pc-windows-msvc.zip';
const UV_ZIP_SHA256 = 'cae6a3bc25239f83dffb467a4b180508d9da23986c04639ebfa44e43e6a84bff';

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function progress(step, status, message, detail) {
  emit({ type: 'progress', step, status, ...(message ? { message } : {}), ...(detail ? { detail } : {}) });
}

// Run a command, capturing output. Resolves {code,out,err} and never rejects (callers branch on code).
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out: '', err: String(e && e.message || e) });
      return;
    }
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: -1, out, err: err || String(e.message) }));
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

async function have(cmd, versionArg = '--version') {
  const r = await run(cmd, [versionArg]);
  return r.code === 0 ? (r.out || r.err).trim().split('\n')[0] : null;
}

// Install the pinned uv: download the zip, refuse it unless its sha256 is UV_ZIP_SHA256, unpack it
// with Windows' own tar, and copy the three programs where uv's installer puts them
// (UV_INSTALL_DIR, else XDG_BIN_HOME, else ~/.local/bin). This run finds uv at once; later
// processes find it on the user PATH, which the verified uv updates itself (`uv tool update-shell`)
// as the installer does. Returns null, or what went wrong.
async function installUv() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return `No pinned uv for ${process.platform}-${process.arch}; install it from https://docs.astral.sh/uv/.`;
  }
  const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_ZIP}`);
  if (!res.ok) return `uv download failed (HTTP ${res.status}).`;
  const zip = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(zip).digest('hex');
  if (sha !== UV_ZIP_SHA256) return `uv download refused: its sha256 ${sha} is not the pinned ${UV_ZIP_SHA256}.`;
  const tmp = mkdtempSync(join(tmpdir(), 'aimeat-uv-'));
  try {
    writeFileSync(join(tmp, UV_ZIP), zip);
    // Windows' own tar reads a zip; a tar from a Git shell earlier on PATH may not.
    const tar = join(ENV.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const x = await run(tar, ['-xf', join(tmp, UV_ZIP), '-C', tmp]);
    if (x.code !== 0) return (x.err || 'uv unzip failed').trim();
    const dir = ENV.UV_INSTALL_DIR || ENV.XDG_BIN_HOME || join(homedir(), '.local', 'bin');
    mkdirSync(dir, { recursive: true });
    for (const exe of ['uv.exe', 'uvx.exe', 'uvw.exe']) copyFileSync(join(tmp, exe), join(dir, exe));
    if (!(ENV.PATH || '').split(delimiter).includes(dir)) ENV.PATH = `${dir}${delimiter}${ENV.PATH || ''}`;
    const onPath = await run(join(dir, 'uv.exe'), ['tool', 'update-shell'], { env: { ...ENV, UV_TOOL_BIN_DIR: dir } });
    if (onPath.code !== 0) progress('install-uv', 'running', `uv is installed; adding ${dir} to your PATH failed: ${(onPath.err || '').trim()}`);
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  progress('start', 'running', 'Provisioning local agent runtime…', { workdir: WORKDIR, model: MODEL });
  mkdirSync(WORKDIR, { recursive: true });
  const summary = {};

  // 1) git — required to fetch the fleet.
  const git = await have('git');
  progress('check-git', git ? 'ok' : 'missing', git || 'git not found — install Git for Windows (https://git-scm.com).');
  summary.git = !!git;

  // 2) uv — preferred Python/venv manager (the crewaimeat repo runs `uv run`).
  let uv = await have('uv');
  if (!uv && ARGS.has('--install-uv')) {
    progress('install-uv', 'running', `Installing uv ${UV_VERSION}…`);
    // A fixed uv release, checked by its sha256 before it runs. Network + execution — only when explicitly asked.
    // A failed install is reported and provisioning goes on, as it did with the install script.
    const failure = await installUv().catch((e) => `uv install failed: ${String(e && e.message || e)}`);
    uv = await have('uv');
    progress('install-uv', uv ? 'ok' : 'error', uv || failure || 'uv install failed');
  }
  progress('check-uv', uv ? 'ok' : 'missing', uv || 'uv not found — install from https://astral.sh/uv (or re-run with --install-uv).');
  summary.uv = !!uv;

  // 3) Clone or update the crewaimeat fleet. Any EXISTING dir (a git repo, OR a non-git leftover
  //    that may be LOCKED so it can't be deleted) is repaired/updated IN PLACE: init (no-op if
  //    already a repo) + fetch + force-checkout a TRACKING `main`. This avoids `git clone` (which
  //    refuses a non-empty dir) AND a detached FETCH_HEAD (which then breaks `git pull` with "not
  //    currently on a branch"). It leaves the gitignored .venv/logs/llm_providers.json untouched.
  if (git) {
    if (existsSync(REPO_DIR)) {
      progress('fetch-fleet', 'running', 'Updating crewaimeat…');
      await run('git', ['-C', REPO_DIR, 'init', '-q']);
      const add = await run('git', ['-C', REPO_DIR, 'remote', 'add', 'origin', REPO]);
      if (add.code !== 0) await run('git', ['-C', REPO_DIR, 'remote', 'set-url', 'origin', REPO]);
      const f = await run('git', ['-C', REPO_DIR, 'fetch', '--depth', '1', 'origin', 'main']);
      const co = f.code === 0 ? await run('git', ['-C', REPO_DIR, 'checkout', '-f', '-B', 'main', 'origin/main']) : f;
      const ok = f.code === 0 && co.code === 0;
      progress('fetch-fleet', ok ? 'ok' : 'error', ok ? 'Updated.' : (co.err || f.err || 'git fetch/checkout failed').trim());
      summary.fleet = ok;
    } else {
      progress('fetch-fleet', 'running', `Cloning ${REPO}…`);
      const r = await run('git', ['clone', '--depth', '1', REPO, REPO_DIR]);
      progress('fetch-fleet', r.code === 0 ? 'ok' : 'error', r.code === 0 ? 'Cloned.' : (r.err || 'git clone failed').trim());
      summary.fleet = r.code === 0;
    }
  } else {
    progress('fetch-fleet', 'skipped', 'Skipped — git is required.');
    summary.fleet = false;
  }

  // Whether the crewaimeat SOURCE is present (this run's fetch may have hiccuped, but a prior run
  // could have left a valid checkout). Deps + provider config proceed whenever the source exists —
  // NOT only when this run's fetch succeeded — so a missing llm_providers.json can't strand the
  // crew on the OpenRouter fallback ("OPENROUTER_API_KEY missing") when it should use local Gemma.
  const hasSource = existsSync(join(REPO_DIR, 'pyproject.toml'));

  // 4) Install the Python env (uv sync, with the fleet TUI extra).
  if (uv && hasSource && !ARGS.has('--skip-sync')) {
    // A half-finished provision can leave a CORRUPT .venv (e.g. no pyvenv.cfg) that uv sync won't
    // repair — `uv run` then fails with "No pyvenv.cfg file". If the venv is invalid, remove it so
    // uv sync rebuilds it cleanly. (Best-effort: if it's still locked, uv sync tries anyway.)
    const venv = join(REPO_DIR, '.venv');
    if (existsSync(venv) && !existsSync(join(venv, 'pyvenv.cfg'))) {
      progress('install-deps', 'running', 'Removing a corrupt .venv before sync…');
      try { rmSync(venv, { recursive: true, force: true }); } catch { /* locked — uv sync will still try */ }
    }
    progress('install-deps', 'running', 'Installing crewaimeat + aimeat-crewai + crewai (uv sync)…');
    let r = await run('uv', ['sync', '--extra', 'tui'], { cwd: REPO_DIR });
    if (r.code !== 0) r = await run('uv', ['sync'], { cwd: REPO_DIR }); // retry without the optional extra
    progress('install-deps', r.code === 0 ? 'ok' : 'error', r.code === 0 ? 'Dependencies installed.' : (r.err || 'uv sync failed').trim().slice(-400));
    summary.deps = r.code === 0;
    // uv can report success yet leave the venv without pyvenv.cfg if a stale crew locked it mid-sync
    // → runtime "No pyvenv.cfg file". If the venv is invalid, rebuild it once.
    if (summary.deps && existsSync(venv) && !existsSync(join(venv, 'pyvenv.cfg'))) {
      progress('install-deps', 'running', 'Rebuilding an incomplete .venv…');
      try { rmSync(venv, { recursive: true, force: true }); } catch { /* locked */ }
      const r2 = await run('uv', ['sync', '--extra', 'tui'], { cwd: REPO_DIR });
      summary.deps = r2.code === 0 && existsSync(join(venv, 'pyvenv.cfg'));
      progress('install-deps', summary.deps ? 'ok' : 'error', summary.deps ? '.venv rebuilt.' : 'Could not build a valid .venv (a process may be locking it).');
    }
  } else {
    progress('install-deps', 'skipped', 'Skipped — needs uv + the cloned fleet.');
    summary.deps = false;
  }

  // 5) Drop the local-Gemma provider config (keep any existing one the user customised).
  const providersTarget = join(REPO_DIR, 'llm_providers.json');
  if (hasSource) {
    if (existsSync(providersTarget)) {
      progress('providers', 'ok', 'Kept existing llm_providers.json.');
    } else if (existsSync(PROVIDERS_DEFAULT)) {
      try { copyFileSync(PROVIDERS_DEFAULT, providersTarget); progress('providers', 'ok', 'Wrote local-model llm_providers.json.'); }
      catch (e) { progress('providers', 'error', String(e.message)); }
    } else {
      progress('providers', 'missing', `Default provider config not found at ${PROVIDERS_DEFAULT}.`);
    }
  }

  // 6) Ollama + the model — local, keyless inference.
  const ollama = await have('ollama');
  progress('check-ollama', ollama ? 'ok' : 'missing', ollama || 'Ollama not found — install from https://ollama.com, then pull the model.');
  summary.ollama = !!ollama;
  if (ollama && ARGS.has('--pull-model')) {
    progress('pull-model', 'running', `Pulling ${MODEL} (this can take a while)…`);
    const r = await run('ollama', ['pull', MODEL]);
    progress('pull-model', r.code === 0 ? 'ok' : 'error', r.code === 0 ? `${MODEL} ready.` : (r.err || 'ollama pull failed').trim().slice(-300));
    summary.model = r.code === 0;
  }

  const ok = !!(summary.git && summary.uv && summary.fleet && summary.deps && summary.ollama);
  emit({ type: 'result', ok, summary, repoDir: REPO_DIR, ollamaUrl: OLLAMA_URL, model: MODEL });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { emit({ type: 'result', ok: false, error: String(e && e.stack || e) }); process.exit(1); });
