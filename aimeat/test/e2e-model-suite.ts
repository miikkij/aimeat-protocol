/**
 * @file e2e-model-suite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model a new E2E suite is copied from (docs/coding-guidelines/testing-requirements.md).
 *   It shows every part a suite needs and nothing else: the shared harness (test/helpers/harness.ts),
 *   the node the runner started (BASE, from E2E_BASE), two owners registered with a password and
 *   signed in with POST /v1/ghii/login, one action and its read-back, the refusals held to their
 *   status (expectRefusal), the cross-owner refusal tried on the other owner's REAL record with the
 *   owner's own read of the same address as the control, the owners deleted at the end, and finish(),
 *   which prints the line the runner reads.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=model-suite
 * @version-history
 *   v1.1.0 - 2026-11-15 - On the shared harness; the cross-owner refusal has its control (the owner
 *     reads the same address), so a path that addresses nothing can no longer pass it (E2E report of
 *     2026-11-15, 5.2, 5.4 and 5.5).
 *   v1.0.0 - 2026-10-11 - Initial: the password-signed-in model for new suites.
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

// Unique names per run, so a rerun on a database the runner did not clear still starts clean.
const stamp = Date.now();
const password = 'ModelSuite123!';
const A = { name: `modela${stamp}`, token: '' };
const B = { name: `modelb${stamp}`, token: '' };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const KEY = 'model.note';

console.log(`\n=== Model suite E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Two owners register with a password and sign in', async () => {
  for (const who of [A, B]) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
    assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: who.name, password }) });
    assert(login.status === 200, `sign-in ${login.status}: ${JSON.stringify(login.body.error)}`);
    who.token = login.body.data?.token;
    assert(typeof who.token === 'string' && who.token.length > 0, 'sign-in returned no token');
  }
});

await test('The owner writes a private record and reads it back', async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: KEY, value: { text: 'mine' }, visibility: 'private' }) });
  assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body.error)}`);
  const r = await json(`/v1/memory/${KEY}`, { headers: auth(A.token) });
  assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body.error)}`);
  assert(r.body.data?.value?.text === 'mine', `read back ${JSON.stringify(r.body.data?.value)}`);
});

await test('Without a token the write is refused', async () => {
  expectRefusal(await json('/v1/memory', { method: 'POST', body: JSON.stringify({ key: KEY, value: { text: 'anyone' } }) }), 401);
});

await test("Another owner cannot read the private record", async () => {
  const path = `/v1/memory/${encodeURIComponent(`${A.name}@${NODE_ID}`)}/${KEY}`;
  // The control first: the address names the record, because its owner reads it there. Without it a
  // path that addresses nothing answers 404 to everybody and the refusal below proves nothing.
  const own = await json(path, { headers: auth(A.token) });
  assert(own.status === 200 && own.body.data?.value?.text === 'mine', `the owner reads the address, got ${own.status}`);
  const r = await json(path, { headers: auth(B.token) });
  assert(r.status === 403 || r.status === 404, `expected 403 or 404, got ${r.status}`);
  assert(JSON.stringify(r.body).includes('mine') === false, 'the private value leaked');
});

await test('Clean up: both owners are deleted', async () => {
  for (const who of [A, B]) {
    const del = await json(`/v1/owners/${who.name}`, { method: 'DELETE', headers: auth(who.token) });
    assert(del.status === 200 || del.status === 204, `delete ${who.name} ${del.status}: ${JSON.stringify(del.body.error)}`);
  }
});

finish();
