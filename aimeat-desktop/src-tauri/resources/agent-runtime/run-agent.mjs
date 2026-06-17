/**
 * @file run-agent.mjs
 * @description Supervisor for ONE local crewaimeat agent (workstream A / C). Run by the bundled
 *   node.exe (same contract as agent-bridge.mjs / provision.mjs): it spawns the crew via
 *   `uv run python -m <module>` in the provisioned crewaimeat dir, restarts it on crash with
 *   capped backoff, and emits newline-delimited JSON status/log lines on stdout for the Rust
 *   side to relay to the desktop GUI. The Rust side stops the agent by killing this process.
 * @structure emits {type:"status",state,...} and {type:"log"|"stderr",text}; reads stdin "stop".
 * @usage node run-agent.mjs
 *   env: AIMEAT_AGENT_WORKDIR, AIMEAT_CREW_MODULE (e.g. crewaimeat.research_crew),
 *        AIMEAT_AGENT_NAME, AIMEAT_NODE_URL=http://localhost:40050, AIMEAT_OLLAMA_URL
 * @version-history
 *   v1.0.0 — 2026-06-17 — Initial: uv-run daemon supervisor with backoff + JSON status (owner spec).
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
let backoff = BACKOFF_MIN;
let stopping = false;
let child = null;

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function status(state, message, detail) {
  emit({ type: 'status', agent: AGENT, state, ...(message ? { message } : {}), ...(detail ? { detail } : {}) });
}

function start() {
  if (stopping) return;
  status('starting', `Launching ${MODULE} via uv…`);
  child = spawn('uv', ['run', 'python', '-m', MODULE], {
    cwd: REPO_DIR,
    shell: false,
    windowsHide: true,
    env: { ...ENV, AIMEAT_NODE_URL: NODE_URL, AIMEAT_OLLAMA_URL: OLLAMA_URL, OLLAMA_URL },
  });

  child.on('spawn', () => { backoff = BACKOFF_MIN; status('running', `${AGENT} is running.`); });

  const relay = (stream, kind) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line.trim()) emit({ type: kind, text: line });
      }
    });
  };
  relay(child.stdout, 'log');
  relay(child.stderr, 'stderr');

  child.on('error', (e) => {
    status('crashed', `Failed to launch (is uv installed?): ${e.message}`);
    scheduleRestart();
  });
  child.on('close', (code) => {
    child = null;
    if (stopping) { status('stopped', 'Stopped.'); return; }
    status('crashed', `Exited with code ${code}. Restarting…`, { code });
    scheduleRestart();
  });
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
