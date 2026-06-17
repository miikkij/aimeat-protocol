/**
 * @file run-agent.mjs
 * @description Full supervisor + orchestrator for ONE local crewaimeat agent. Run by the bundled
 *   node.exe. Given an owner JWT, it brings the agent fully online with NO manual device-auth
 *   approval (local installs auto-approve; manual device-auth is only for remote/operator nodes):
 *     1. ensure the agent token — if absent, run the device-auth + AUTO-APPROVE chain (owner JWT)
 *        and store the token + per-agent config in the ISOLATED $AIMEAT_HOME (so the desktop never
 *        collides with the user's global ~/.aimeat fleet).
 *     2. start the crewaimeat loopback serve daemon (idempotent ensure_serve) in $AIMEAT_HOME.
 *     3. run the crew (`uv run python -m <module>`), which attaches to serve and polls tasks.
 *   Emits newline-delimited JSON status/log on stdout for the Rust side to relay to the GUI.
 *
 *   MODEL: crews REQUIRE tool-calling. gemma3 does NOT support tools (HTTP 400) — the agent must
 *   use a tool-capable model (qwen2.5:7b). provision.mjs writes that into llm_providers.json.
 * @structure emits {type:"status",state,...} and {type:"log"|"stderr",text}; reads stdin "stop".
 * @usage node run-agent.mjs
 *   env: AIMEAT_HOME (isolated connector home), AIMEAT_AGENT_WORKDIR, AIMEAT_CREW_MODULE,
 *        AIMEAT_AGENT_NAME (must match the crew's AGENT_NAME, e.g. research-crew),
 *        AIMEAT_AGENT_OWNER, AIMEAT_OWNER_TOKEN (owner JWT for auto-approve),
 *        AIMEAT_NODE_URL=http://localhost:40050, AIMEAT_OLLAMA_URL
 * @version-history
 *   v1.0.0 — 2026-06-17 — Initial uv-run daemon supervisor with backoff + JSON status.
 *   v1.1.0 — 2026-06-17 — Halt the crash-loop with an honest "needs-setup" status.
 *   v2.0.0 — 2026-06-17 — Full orchestrator: isolated AIMEAT_HOME, device-auth auto-approve chain,
 *     token+config placement, ensure_serve, then run the crew. Proven E2E on the real machine.
 *   v2.1.0 — 2026-06-17 — Start serve via aimeat_crewai's HOME-SCOPED ensure_serve directly (not
 *     crewaimeat's scripts/ensure_serve.py, whose serve_guard reaps every serve daemon machine-wide).
 *     The desktop agent now only ever touches its own app-data home — never other homes' daemons.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ENV = process.env;
const WORKDIR = ENV.AIMEAT_AGENT_WORKDIR || join(homedir(), '.aimeat', 'agent-runtime');
const REPO_DIR = join(WORKDIR, 'crewaimeat');
// Isolated connector home — keeps the desktop agent out of the user's global ~/.aimeat fleet
// (which would collide on a shared agent name). Defaults to <workdir>/.aimeat.
const AIMEAT_HOME = ENV.AIMEAT_HOME || join(WORKDIR, '.aimeat');
const MODULE = ENV.AIMEAT_CREW_MODULE || 'crewaimeat.research_crew';
const AGENT = ENV.AIMEAT_AGENT_NAME || 'research-crew';
const OWNER = ENV.AIMEAT_AGENT_OWNER || '';
const OWNER_TOKEN = ENV.AIMEAT_OWNER_TOKEN || '';
const NODE_URL = (ENV.AIMEAT_NODE_URL || 'http://localhost:40050').replace(/\/+$/, '');
const OLLAMA_URL = ENV.AIMEAT_OLLAMA_URL || 'http://localhost:11434';

const BACKOFF_MIN = 2000, BACKOFF_MAX = 60000;
const FAST_CRASH_MS = 15000, MAX_FAST_CRASHES = 2;
let backoff = BACKOFF_MIN, fastCrashes = 0, sawSetupError = false, spawnAt = 0;
let stopping = false, child = null;

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function status(state, message, detail) {
  emit({ type: 'status', agent: AGENT, state, ...(message ? { message } : {}), ...(detail ? { detail } : {}) });
}
function log(text) { emit({ type: 'log', text }); }

// Env passed to every uv/crew/serve child: isolated home + node + ollama.
function childEnv() {
  return { ...ENV, AIMEAT_HOME, AIMEAT_NODE_URL: NODE_URL, AIMEAT_OLLAMA_URL: OLLAMA_URL, OLLAMA_URL };
}

async function api(method, path, body, token) {
  const r = await fetch(NODE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await r.json(); } catch { data = { _status: r.status }; }
  return { status: r.status, data };
}

const tokenPath = () => join(AIMEAT_HOME, 'tokens', `${AGENT}@${OWNER}.token`);

// Step 1 — ensure the agent has a stored token in the isolated home. Auto-approve with the owner JWT
// (no manual device-auth) the first time; reuse it afterwards.
async function ensureAgentToken() {
  if (existsSync(tokenPath())) { log('Agent token present — reusing.'); return true; }
  if (!OWNER || !OWNER_TOKEN) {
    halt('Sign in with your owner account first — the agent needs your approval to connect to this node.');
    return false;
  }
  status('connecting', 'Registering your agent on the node (auto-approved)…');
  const da = await api('POST', '/v1/agents/device-authorize', { agent_name: AGENT, owner: OWNER, mode: 'task-runner' });
  const deviceCode = da.data?.data?.device_code, userCode = da.data?.data?.user_code;
  if (!deviceCode) { halt('Could not start agent registration: ' + JSON.stringify(da.data?.error || da.data).slice(0, 200)); return false; }
  const ver = await api('POST', '/v1/agents/verify', { user_code: userCode, action: 'approve', owner_token: OWNER_TOKEN });
  if (ver.data?.ok !== true) { halt('Auto-approval failed: ' + JSON.stringify(ver.data?.error || ver.data).slice(0, 200)); return false; }
  const tok = await api('POST', '/v1/agents/device-token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  // device-token returns a RAW OAuth token response (not the success() envelope): token is top-level.
  const agentToken = tok.data?.access_token || tok.data?.token || tok.data?.data?.access_token;
  if (!agentToken) { halt('Could not retrieve the agent token: ' + JSON.stringify(tok.data?.error || tok.data).slice(0, 200)); return false; }
  mkdirSync(join(AIMEAT_HOME, 'tokens'), { recursive: true });
  mkdirSync(join(AIMEAT_HOME, 'agents', AGENT), { recursive: true });
  writeFileSync(tokenPath(), agentToken, { mode: 0o600 });
  writeFileSync(join(AIMEAT_HOME, 'agents', AGENT, 'config.yaml'),
    `agent: ${AGENT}\nowner: ${OWNER}\nnode_url: ${NODE_URL}\nprimary: false\nmode: task-runner\n`);
  log(`Agent ${AGENT} registered + approved. Token stored.`);
  return true;
}

// Step 2 — start the loopback serve daemon for OUR home only (idempotent, detached from the crew).
// IMPORTANT: call aimeat_crewai's HOME-SCOPED `ensure_serve` directly — NOT crewaimeat's
// `scripts/ensure_serve.py`, which runs `serve_guard.ensure_single_serve()` whose dedup pass kills
// EVERY `aimeat connect serve` process machine-wide (it would reap the user's crewfive fleet daemon
// and any other home's daemon → a reconnect storm). The package's ensure_serve reads/writes only
// $AIMEAT_HOME/serve.json and pins AIMEAT_HOME on the spawned daemon; it never touches other homes.
// INVARIANT: starting the desktop agent must only ever affect its own app-data home.
const ENSURE_SERVE_PY =
  'from aimeat_crewai import ensure_serve; d = ensure_serve(auto_start=True); '
  + 'import json, sys; sys.stdout.write(json.dumps({"port": d.get("port"), "pid": d.get("pid")}))';

async function ensureServe() {
  const serveJson = join(AIMEAT_HOME, 'serve.json');
  if (existsSync(serveJson)) {
    try {
      const j = JSON.parse(readFileSync(serveJson, 'utf-8'));
      if (j?.port) { log('Serve daemon already live (port ' + j.port + ').'); return true; }
    } catch { /* fall through and (re)start */ }
  }
  status('serving', 'Starting the local serve daemon (this home only)…');
  await new Promise((resolve) => {
    const p = spawn('uv', ['run', 'python', '-c', ENSURE_SERVE_PY], {
      cwd: REPO_DIR, shell: false, windowsHide: true, env: childEnv(),
    });
    p.stdout.on('data', (d) => String(d).split('\n').forEach((l) => l.trim() && log(l.trim())));
    p.stderr.on('data', (d) => String(d).split('\n').forEach((l) => l.trim() && emit({ type: 'stderr', text: l.trim() })));
    p.on('close', () => resolve());
    p.on('error', (e) => { log('ensure_serve error: ' + e.message); resolve(); });
  });
  return existsSync(serveJson);
}

const SETUP_ERROR = /No live serve daemon|AimeatServeError|Multiple owners have an agent|device.?flow approval|not (yet )?connected|does not support tools/i;

function startCrew() {
  if (stopping) return;
  sawSetupError = false;
  spawnAt = Date.now();
  status('starting', `Launching ${MODULE} via uv…`);
  child = spawn('uv', ['run', 'python', '-m', MODULE], { cwd: REPO_DIR, shell: false, windowsHide: true, env: childEnv() });
  child.on('spawn', () => status('running', `${AGENT} is running.`));
  const relay = (stream, kind) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        if (SETUP_ERROR.test(line)) sawSetupError = true;
        emit({ type: kind, text: line });
      }
    });
  };
  relay(child.stdout, 'log');
  relay(child.stderr, 'stderr');
  child.on('error', (e) => halt(`Failed to launch the crew (is uv installed?): ${e.message}`));
  child.on('close', (code) => {
    child = null;
    if (stopping) { status('stopped', 'Stopped.'); return; }
    const ranMs = Date.now() - spawnAt;
    if (ranMs < FAST_CRASH_MS) fastCrashes += 1; else fastCrashes = 0;
    if (sawSetupError) { halt('The agent hit a setup error (see messages above). Stopped to avoid an error loop.'); return; }
    if (fastCrashes >= MAX_FAST_CRASHES) { halt(`The agent crashed ${fastCrashes} times right after starting (exit ${code}). Stopped to avoid an error loop.`); return; }
    status('crashed', `Exited with code ${code}. Restarting…`, { code });
    scheduleRestart();
  });
}

function halt(message) { stopping = true; status('needs-setup', message); setTimeout(() => process.exit(1), 400); }
function scheduleRestart() {
  if (stopping) return;
  const wait = backoff; backoff = Math.min(backoff * 2, BACKOFF_MAX);
  status('restarting', `Restarting in ${Math.round(wait / 1000)}s…`, { waitMs: wait });
  setTimeout(startCrew, wait);
}
function stop() {
  stopping = true;
  status('stopping', 'Stopping agent…');
  if (child) { try { child.kill(); } catch { /* gone */ } }
  setTimeout(() => process.exit(0), 1500);
}

process.stdin.on('data', (d) => { if (String(d).trim() === 'stop') stop(); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

// Orchestrate: token → serve → crew.
(async () => {
  try {
    if (!(await ensureAgentToken())) return;     // halt() already emitted on failure
    if (stopping) return;
    await ensureServe();
    if (stopping) return;
    startCrew();
  } catch (e) {
    halt('Agent startup failed: ' + (e?.message || String(e)));
  }
})();
