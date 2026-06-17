/**
 * @file run-agent.mjs
 * @description Supervisor for ONE local crewaimeat agent (workstream A / C). Run by the bundled
 *   node.exe (same contract as agent-bridge.mjs / provision.mjs): it spawns the crew via
 *   `uv run python -m <module>` in the provisioned crewaimeat dir and emits newline-delimited
 *   JSON status/log lines on stdout for the Rust side to relay to the desktop GUI.
 *
 *   IMPORTANT (known gap): a crew's run_crew_daemon needs (1) the agent CONNECTED to the node
 *   (`aimeat connect add` + the owner's one-time device-flow approval) and (2) a live loopback
 *   serve daemon (`aimeat connect serve --http`, i.e. crewaimeat's ensure_serve). This build
 *   provisions the Python runtime but does NOT yet auto-connect the agent or start serve, so the
 *   crew exits immediately with "No live serve daemon". Rather than loop that error forever, the
 *   supervisor detects it (or repeated fast crashes) and STOPS with an honest status.
 * @structure emits {type:"status",state,...} and {type:"log"|"stderr",text}; reads stdin "stop".
 * @usage node run-agent.mjs
 *   env: AIMEAT_AGENT_WORKDIR, AIMEAT_CREW_MODULE (e.g. crewaimeat.research_crew),
 *        AIMEAT_AGENT_NAME, AIMEAT_NODE_URL=http://localhost:40050, AIMEAT_OLLAMA_URL
 * @version-history
 *   v1.0.0 — 2026-06-17 — Initial: uv-run daemon supervisor with backoff + JSON status (owner spec).
 *   v1.1.0 — 2026-06-17 — Stop the crash-loop: detect the missing-serve-daemon / not-connected
 *     error (and repeated fast crashes) and halt with an honest "needs-setup" status instead of
 *     restarting forever. The connect + serve orchestration is still TODO.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ENV = process.env;
const WORKDIR = ENV.AIMEAT_AGENT_WORKDIR || join(homedir(), '.aimeat', 'agent-runtime');
const REPO_DIR = join(WORKDIR, 'crewaimeat');
const MODULE = ENV.AIMEAT_CREW_MODULE || 'crewaimeat.research_crew';
const AGENT = ENV.AIMEAT_AGENT_NAME || MODULE.split('.').pop();
const NODE_URL = (ENV.AIMEAT_NODE_URL || 'http://localhost:40050').replace(/\/+$/, '');
const OLLAMA_URL = ENV.AIMEAT_OLLAMA_URL || 'http://localhost:11434';

const BACKOFF_MIN = 2000;
const BACKOFF_MAX = 60000;
const FAST_CRASH_MS = 15000;   // exiting sooner than this = an immediate crash, not real work
const MAX_FAST_CRASHES = 2;     // after this many in a row, stop instead of looping
let backoff = BACKOFF_MIN;
let fastCrashes = 0;
let sawSetupError = false;
let spawnAt = 0;
let stopping = false;
let child = null;

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function status(state, message, detail) {
  emit({ type: 'status', agent: AGENT, state, ...(message ? { message } : {}), ...(detail ? { detail } : {}) });
}

// Lines that mean "the runtime isn't fully set up" (not a transient crash worth retrying).
const SETUP_ERROR = /No live serve daemon|AimeatServeError|aimeat connect serve|device.?flow approval|not (yet )?connected/i;

function start() {
  if (stopping) return;
  sawSetupError = false;
  spawnAt = Date.now();
  status('starting', `Launching ${MODULE} via uv…`);
  child = spawn('uv', ['run', 'python', '-m', MODULE], {
    cwd: REPO_DIR,
    shell: false,
    windowsHide: true,
    env: { ...ENV, AIMEAT_NODE_URL: NODE_URL, AIMEAT_OLLAMA_URL: OLLAMA_URL, OLLAMA_URL },
  });

  child.on('spawn', () => { status('running', `${AGENT} is running.`); });

  const relay = (stream, kind) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      let i;
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

  child.on('error', (e) => {
    status('crashed', `Failed to launch (is uv installed?): ${e.message}`);
    halt('The local agent could not start. Is uv installed and the runtime provisioned?');
  });
  child.on('close', (code) => {
    child = null;
    if (stopping) { status('stopped', 'Stopped.'); return; }
    const ranMs = Date.now() - spawnAt;
    if (ranMs < FAST_CRASH_MS) fastCrashes += 1; else fastCrashes = 0;

    if (sawSetupError) {
      halt('The agent can’t run yet: it is not connected to the node and there is no live serve daemon. '
        + 'This build provisions the runtime (Python/uv/Ollama/Gemma) but does not yet auto-connect the agent '
        + '(aimeat connect add + your one-time approval) or start `aimeat connect serve`. Stopped to avoid an error loop.');
      return;
    }
    if (fastCrashes >= MAX_FAST_CRASHES) {
      halt(`The agent crashed ${fastCrashes} times right after starting (exit ${code}). Stopped to avoid an error loop — see the messages above.`);
      return;
    }
    // Ran for a while, then exited — treat as a genuine transient and restart with backoff.
    status('crashed', `Exited with code ${code}. Restarting…`, { code });
    scheduleRestart();
  });
}

function halt(message) {
  stopping = true; // prevent any further restarts
  status('needs-setup', message);
  setTimeout(() => process.exit(1), 400);
}

function scheduleRestart() {
  if (stopping) return;
  const wait = backoff;
  backoff = Math.min(backoff * 2, BACKOFF_MAX);
  status('restarting', `Restarting in ${Math.round(wait / 1000)}s…`, { waitMs: wait });
  setTimeout(start, wait);
}

function stop() {
  stopping = true;
  status('stopping', 'Stopping agent…');
  if (child) { try { child.kill(); } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 1500);
}

// The Rust side kills this process to stop; also honor an explicit "stop" on stdin and signals.
process.stdin.on('data', (d) => { if (String(d).trim() === 'stop') stop(); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

start();
