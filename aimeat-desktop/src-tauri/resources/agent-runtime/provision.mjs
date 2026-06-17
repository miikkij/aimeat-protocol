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
 *   v1.0.0 — 2026-06-17 — Initial: git/uv/ollama provisioning of the crewaimeat fleet (owner spec).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function progress(step, status, message, detail) {
  emit({ type: 'progress', step, status, ...(message ? { message } : {}), ...(detail ? { detail } : {}) });
}

// Run a command, capturing output. Resolves {code,out,err} and never rejects (callers branch on code).
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
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
    progress('install-uv', 'running', 'Installing uv…');
    // Official uv installer (Windows PowerShell). Network + execution — only when explicitly asked.
    const r = await run('powershell', ['-NoProfile', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex']);
    uv = await have('uv');
    progress('install-uv', uv ? 'ok' : 'error', uv || (r.err || 'uv install failed').trim());
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
