/**
 * @file desktop-parent.mjs
 * @description Desktop-only preload: parent-owned shutdown pipe and bound-port attestation.
 *   No network control endpoint is added. The parent's private stdin pipe asks the existing
 *   server SIGTERM handler to drain on every OS, including Windows. EOF does the same if the
 *   desktop disappears. The stderr control record proves this child bound the announced port.
 * @version-history 2026-11-09: initial Desktop lifecycle adapter; server sources stay unchanged.
 */
import { Server } from 'node:net';

const token = process.env.AIMEAT_DESKTOP_PARENT_TOKEN;
if (!/^[a-f0-9]{64}$/.test(token || '') || process.stdin.isTTY) {
  throw new Error('The Desktop lifecycle adapter requires its parent pipe.');
}
// Subprocesses launched by the server do not inherit a usable control token.
delete process.env.AIMEAT_DESKTOP_PARENT_TOKEN;

const originalListen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    if (address && typeof address === 'object') {
      process.stderr.write('AIMEAT_DESKTOP_CONTROL:' + JSON.stringify({
        token, type: 'listening', port: address.port,
      }) + '\n');
    }
  });
  return Reflect.apply(originalListen, this, args);
};

let requested = false;
let dispatched = false;
function dispatchStop() {
  if (dispatched) return;
  // The node registers its handler after startup. A close during startup must still drain
  // once that handler exists. The Rust parent bounds the wait and can force termination.
  if (process.listenerCount('SIGTERM') > 0) {
    dispatched = true;
    process.emit('SIGTERM', 'SIGTERM');
    return;
  }
  setTimeout(dispatchStop, 25);
}
function requestStop() {
  if (requested) return;
  requested = true;
  dispatchStop();
}

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  pending += chunk;
  // Only a fixed command is accepted; bound malformed input before it can accumulate.
  if (pending.length > 1024) { pending = ''; return; }
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    const command = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    if (command === 'aimeat-desktop:stop') requestStop();
  }
});
process.stdin.on('end', requestStop);
process.stdin.on('error', requestStop);
process.stdin.resume();
