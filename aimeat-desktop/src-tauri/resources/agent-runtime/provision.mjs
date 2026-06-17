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

  // 3) Clone or update the crewaimeat fleet.
  if (git) {
    if (existsSync(join(REPO_DIR, '.git'))) {
      progress('fetch-fleet', 'running', 'Updating crewaimeat…');
      const r = await run('git', ['-C', REPO_DIR, 'pull', '--ff-only']);
      progress('fetch-fleet', r.code === 0 ? 'ok' : 'error', r.code === 0 ? 'Updated.' : (r.err || 'git pull failed').trim());
      summary.fleet = r.code === 0;
    } else {
      // The dir may exist but not be a git repo (e.g. a leftover .venv from a half-finished
      // provision). `git clone` REFUSES a non-empty destination ("already exists and is not an
      // empty directory"), so the clone silently fails and crewaimeat is never fetched →
      // "No module named 'crewaimeat'". Wipe the dir first for a clean clone. Verified against
      // a broken install whose crewaimeat/ held only a stale .venv/.
      if (existsSync(REPO_DIR)) {
        progress('fetch-fleet', 'running', 'Cleaning a stale crewaimeat dir before clone…');
        try { rmSync(REPO_DIR, { recursive: true, force: true }); } catch (e) { progress('fetch-fleet', 'error', `Could not clean ${REPO_DIR}: ${e.message}`); }
      }
      progress('fetch-fleet', 'running', `Cloning ${REPO}…`);
      const r = await run('git', ['clone', '--depth', '1', REPO, REPO_DIR]);
      progress('fetch-fleet', r.code === 0 ? 'ok' : 'error', r.code === 0 ? 'Cloned.' : (r.err || 'git clone failed').trim());
      summary.fleet = r.code === 0;
    }
  } else {
    progress('fetch-fleet', 'skipped', 'Skipped — git is required.');
    summary.fleet = false;
  }

  // 4) Install the Python env (uv sync, with the fleet TUI extra).
  if (uv && summary.fleet && !ARGS.has('--skip-sync')) {
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
  if (summary.fleet) {
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
