/**
 * @file desktop-parent.test.mjs
 * @description Exercises the Desktop-owned parent pipe against real Node child processes.
 * @version-history 2026-11-09: graceful stop, parent disappearance and listener attestation.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

const preload = new URL('../runtime/desktop-parent.mjs', import.meta.url).href;
const nonce = 'a'.repeat(64);

async function child(t, { delayedHandler = false } = {}) {
  const program = `
    const http = require('node:http');
    const server = http.createServer((_req, res) => res.end('ready'));
    server.listen(0, '127.0.0.1', () => console.log('started'));
    const install = () => process.on('SIGTERM', () => {
      setTimeout(() => server.close(() => { console.log('flushed'); process.exit(0); }), 30);
    });
    ${delayedHandler ? 'setTimeout(install, 150);' : 'install();'}
  `;
  const p = spawn(process.execPath, ['--import', preload, '-e', program], {
    env: { ...process.env, AIMEAT_DESKTOP_PARENT_TOKEN: nonce },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = ''; let error = '';
  p.stdout.on('data', b => { output += b; });
  p.stderr.on('data', b => { error += b; });
  const exited = once(p, 'exit');
  t.after(() => { if (p.exitCode === null) p.kill(); });
  const until = Date.now() + 3000;
  while (!output.includes('started') && p.exitCode === null && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(output, /started/, error);
  return { p, exited, output: () => output, error: () => error };
}

test('the parent stop runs the existing signal handler and lets writes finish', { timeout: 6000 }, async t => {
  const c = await child(t);
  c.p.stdin.write('aimeat-desktop:stop\n');
  const [code] = await c.exited;
  assert.equal(code, 0);
  assert.match(c.output(), /flushed/);
});

test('closing the parent pipe drains even if the node is still installing its handler', { timeout: 6000 }, async t => {
  const c = await child(t, { delayedHandler: true });
  c.p.stdin.end();
  const [code] = await c.exited;
  assert.equal(code, 0);
  assert.match(c.output(), /flushed/);
});

test('listener proof names the child bound port and unknown commands do not stop it', { timeout: 6000 }, async t => {
  const c = await child(t);
  const proof = c.error().split('\n').find(line => line.startsWith('AIMEAT_DESKTOP_CONTROL:'));
  assert.ok(proof, c.error());
  const event = JSON.parse(proof.slice('AIMEAT_DESKTOP_CONTROL:'.length));
  assert.equal(event.token, nonce);
  assert.equal(event.type, 'listening');
  assert.ok(event.port > 0);
  c.p.stdin.write('untrusted-command\n');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(c.p.exitCode, null);
  c.p.stdin.end();
  await c.exited;
});
