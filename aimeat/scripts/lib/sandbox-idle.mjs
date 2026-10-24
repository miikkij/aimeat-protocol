/**
 * @file scripts/lib/sandbox-idle.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stops a sandbox process after a set time with no inbound HTTP request. Preloaded
 *   with `--import` into the sandbox node and its test mailbox (scripts/sandbox.ts), so neither
 *   needs code of its own for it.
 *
 *   WHY. `pnpm sandbox` starts both processes detached, so they outlive the command that started
 *   them, and nothing ever ran `pnpm sandbox --stop`: a Claude Code session ends, its worktree
 *   stays, and its sandbox keeps running. On 2026-10-24 one machine held 13 such nodes and 14 mail
 *   servers, the oldest six days old, about 2.2 GB of memory and a port each. Windows does not end
 *   a detached child with its parent, and a session that crashes runs no hook, so the process has
 *   to decide by itself.
 *
 *   WHAT COUNTS AS USE. Every inbound request and every upgraded connection (the connector
 *   tunnel's WebSocket), from its start until its socket closes, so an open SSE stream from a
 *   browser tab keeps the node up. `GET /v1/spec` does not count: it is the probe another
 *   session's `pnpm sandbox` sends to every port in the sandbox range when it looks for a free one.
 *   The node's own outbound calls (a schedule reading the test mailbox) do not count for the node;
 *   they count for the mailbox, which then idles out after the node has stopped.
 *
 *   HOW IT STOPS. With a SIGTERM listener (the node's handleShutdown in src/index-start.ts) the
 *   process emits SIGTERM to itself and exits after 15 s if the shutdown has not finished; without
 *   one it exits. The data stays; `pnpm sandbox` starts the node again on the same file.
 *
 *   SETTINGS. AIMEAT_SANDBOX_IDLE_HOURS (default 6; 0 never stops) or AIMEAT_SANDBOX_IDLE_MS,
 *   which wins when set and exists for a test that cannot wait hours. The watch is on only where
 *   AIMEAT_SANDBOX_IDLE_WATCH=1, which scripts/sandbox.ts sets for the two processes it starts.
 * @structure idleLimitMs · isProbe · the http.Server emit wrapper · the check timer
 * @usage node --import tsx --import file:///…/scripts/lib/sandbox-idle.mjs src/index.ts start …
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (Jouni, 2026-10-25: orphan sandboxes pile up on the machine).
 */
import http from 'node:http';

/** How long the process may go without a request, in ms; 0 means never stop. */
export function idleLimitMs(env = process.env) {
  const ms = Number(env.AIMEAT_SANDBOX_IDLE_MS);
  if (env.AIMEAT_SANDBOX_IDLE_MS && Number.isFinite(ms) && ms >= 0) return ms;
  const hours = Number(env.AIMEAT_SANDBOX_IDLE_HOURS ?? '6');
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
}

/** A request that says nothing about whether anybody uses this sandbox. */
function isProbe(req) {
  return req.method === 'GET' && (req.url === '/v1/spec' || req.url?.startsWith('/v1/spec?'));
}

// Only in the processes scripts/sandbox.ts starts with the flag: the script imports idleLimitMs
// for its report, and its own process must not be watched.
const limitMs = process.env.AIMEAT_SANDBOX_IDLE_WATCH === '1' ? idleLimitMs() : 0;
if (limitMs > 0) {
  let last = Date.now();
  let open = 0;
  const track = (stream) => {
    last = Date.now();
    open++;
    stream.once('close', () => { open--; last = Date.now(); });
  };
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === 'request' && !isProbe(args[0])) track(args[1]);
    else if (event === 'upgrade') track(args[1]);
    return emit.call(this, event, ...args);
  };
  const timer = setInterval(() => {
    if (open > 0 || Date.now() - last < limitMs) return;
    clearInterval(timer);
    const idleMin = Math.round((Date.now() - last) / 60_000);
    console.log(`[sandbox-idle] no request for ${idleMin} min (limit ${Math.round(limitMs / 60_000)} min); stopping. The data is kept, and \`pnpm sandbox\` starts it again.`);
    if (process.listenerCount('SIGTERM') > 0) {
      process.emit('SIGTERM');
      setTimeout(() => process.exit(0), 15_000);
    } else {
      process.exit(0);
    }
  }, Math.min(60_000, Math.max(1_000, Math.floor(limitMs / 4))));
  // The timer alone never keeps the process up: one that has nothing else to do exits anyway.
  timer.unref();
}
