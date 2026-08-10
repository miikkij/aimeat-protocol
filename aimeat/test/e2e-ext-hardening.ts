/**
 * @file test/e2e-ext-hardening.ts
 * @description E2E for the extension gates added by the August 2026 security audit, step 4. Each
 *   test names the thing that used to be possible:
 *     1. A manifest declared `emailPolicy: 'unrestricted'` and got it. The capability that reads it
 *        has always called that operator-granted, and nothing checked: installing needs an owner,
 *        not an operator, so on a node with more than one account anyone could send mail to any
 *        address under the node's own SMTP identity.
 *     2. A manifest declared `__schedules` or `__secretKeys` directly. Those are the node's own keys
 *        inside `ext.config`, written from validated manifest sections; declaring them by hand walks
 *        past that validation, and a `__secretKeys` naming a field that is not secret points the
 *        decrypt step at plaintext.
 *     3. A manifest submitted a value already wearing the `{ encrypted: … }` wrapper. Only this node
 *        mints those, and `encryptSecretFields` passes an already-encrypted value through, so an
 *        outside ciphertext would be stored verbatim and decrypted with the node key on the way into
 *        the sandbox.
 *     4. A second owner read another owner's action `scriptContent`. The PATCH on that exact
 *        resource has always checked `installedBy`; the GET checked only the `ext:write` scope,
 *        which an owner session bypasses.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ext-hardening
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 4: H-4, H-18 and the email escape).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `eh${label}${Date.now()}`;
  const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Hardening', password: 'Hardening1234' }) });
  let reg = await reg0();
  for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Extension Hardening E2E (August 2026 audit, step 4) ===\n');

const ECHO = 'export default async function(ctx, input){ return { ok: true }; }';

/** Install an extension whose manifest config is exactly `cfg`. */
async function install(token: string, name: string, cfg: Record<string, unknown>) {
  return json('/v1/extensions', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      manifest: JSON.stringify({
        metadata: { name, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
        actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo' }],
        config: cfg,
        limits: { timeout_ms: 5000, max_api_calls: 1 },
      }),
      scripts: { echo: ECHO },
    }),
  });
}

/** The stored config as the node reports it back. Secrets are masked here; everything else is verbatim. */
async function storedConfig(name: string, token: string): Promise<Record<string, unknown>> {
  const got = await json(`/v1/extensions/${name}`, { headers: auth(token) });
  assert(got.status === 200, `GET extension ${got.status}`);
  return (got.body.data.extension.config ?? {}) as Record<string, unknown>;
}

/** Roles carried by a token, read from the JWT payload. Not verified — this is a test asserting
 *  its own premise, not a security decision. */
function rolesOf(token: string): string[] {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return Array.isArray(payload.roles) ? payload.roles : [];
}

let ownerA: Awaited<ReturnType<typeof setupOwner>>;
let ownerB: Awaited<ReturnType<typeof setupOwner>>;

async function run() {
  // routes/auth.ts self-heals a node with no operator by promoting whoever authenticates first.
  // On a freshly started test node that is whoever this suite creates first, and an operator IS
  // allowed to set emailPolicy — so without this the email test would pass for the wrong reason.
  // The seed owner absorbs the promotion; on a full CI run an operator already exists and this
  // costs one registration.
  await setupOwner('seed');

  ownerA = await setupOwner('a');
  ownerB = await setupOwner('b');
  assert(!rolesOf(ownerA.token).includes('operator'),
    'the installer in this suite must NOT be an operator, or the emailPolicy test proves nothing');

  // ── 1. The email escape ────────────────────────────────────────────────────────────────────
  await test('a non-operator manifest cannot grant itself unrestricted email', async () => {
    const name = `hardmail${Date.now()}`;
    const res = await install(ownerA.token, name, { emailPolicy: { default: 'unrestricted' }, greeting: { default: 'hi' } });
    assert(res.status === 201, `install ${res.status}: ${JSON.stringify(res.body?.error)}`);
    const cfg = await storedConfig(name, ownerA.token);
    assert(cfg.emailPolicy === undefined,
      `emailPolicy survived the install as ${JSON.stringify(cfg.emailPolicy)} — the SMTP identity is open to any installer`);
    assert(cfg.greeting === 'hi', 'the installer\'s own config keys must survive untouched');
  });

  await test('the install warns about what it dropped instead of failing silently', async () => {
    const name = `hardwarn${Date.now()}`;
    const res = await install(ownerA.token, name, { emailPolicy: { default: 'unrestricted' } });
    assert(res.status === 201, `install ${res.status}`);
    const warnings: string[] = res.body.data.warnings ?? [];
    assert(warnings.some(w => w.includes('emailPolicy')),
      `expected a warning naming emailPolicy, got ${JSON.stringify(warnings)}`);
  });

  // ── 2. The node's own config keys ──────────────────────────────────────────────────────────
  await test('a manifest cannot declare __schedules or __secretKeys by hand', async () => {
    const name = `hardunder${Date.now()}`;
    const res = await install(ownerA.token, name, {
      __schedules: [{ id: 'sneak', cron: '* * * * *', action: 'ping' }],
      __secretKeys: ['greeting'],
      greeting: { default: 'hi' },
    });
    assert(res.status === 201, `install ${res.status}: ${JSON.stringify(res.body?.error)}`);
    const cfg = await storedConfig(name, ownerA.token);
    assert(cfg.__schedules === undefined, '__schedules was accepted from the manifest');
    // __secretKeys is stripped from every API response, so prove it by behaviour: `greeting` is not
    // a secret, and a falsely declared __secretKeys would have masked it.
    assert(cfg.greeting === 'hi',
      `greeting reads as ${JSON.stringify(cfg.greeting)} — a manifest-declared __secretKeys is being honoured`);
  });

  await test('a real schedules: section still produces __schedules', async () => {
    // The guard above removes __-prefixed keys from the manifest's `config:` block. The node then
    // writes __schedules itself from the manifest's own `schedules:` section, which is the only
    // legitimate producer. 27 extensions in production depend on that, so prove the strip did not
    // take the real one with the forged one.
    const name = `hardsched${Date.now()}`;
    const res = await json('/v1/extensions', {
      method: 'POST', headers: auth(ownerA.token),
      body: JSON.stringify({
        manifest: JSON.stringify({
          metadata: { name, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
          actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo' }],
          schedules: [{ id: 'ping-scheduled', cron: '0 2 * * *', action: 'ping', input: {}, description: 'Scheduled: ping', instance_scope: false }],
          config: { greeting: { default: 'hi' } },
          limits: { timeout_ms: 5000, max_api_calls: 1 },
        }),
        scripts: { echo: ECHO },
      }),
    });
    assert(res.status === 201, `install ${res.status}: ${JSON.stringify(res.body?.error)}`);
    const cfg = await storedConfig(name, ownerA.token);
    const scheds = cfg.__schedules as Array<Record<string, unknown>> | undefined;
    assert(Array.isArray(scheds) && scheds.length === 1,
      `the node must still write __schedules from the manifest's schedules: section, got ${JSON.stringify(cfg.__schedules)}`);
    assert(scheds[0].id === 'ping-scheduled', `wrong schedule stored: ${JSON.stringify(scheds[0])}`);
  });

  // ── 3. A submitted ciphertext ──────────────────────────────────────────────────────────────
  await test('a manifest cannot submit a value that is already encrypted', async () => {
    const name = `hardenc${Date.now()}`;
    const res = await install(ownerA.token, name, {
      stolen: { encrypted: 'aaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbb:cccccccccccc' },
      greeting: { default: 'hi' },
    });
    assert(res.status === 201, `install ${res.status}: ${JSON.stringify(res.body?.error)}`);
    const cfg = await storedConfig(name, ownerA.token);
    assert(cfg.stolen === undefined,
      `a client-supplied ciphertext was stored as ${JSON.stringify(cfg.stolen)} — the node would decrypt it into the sandbox`);
    assert(cfg.greeting === 'hi', 'the installer\'s own config keys must survive untouched');
  });

  // ── 4. Reading somebody else's source ──────────────────────────────────────────────────────
  await test('a second owner cannot read another owner\'s action source', async () => {
    const name = `hardsrc${Date.now()}`;
    const res = await install(ownerA.token, name, { greeting: { default: 'hi' } });
    assert(res.status === 201, `install ${res.status}: ${JSON.stringify(res.body?.error)}`);

    const mine = await json(`/v1/extensions/${name}/actions/ping`, { headers: auth(ownerA.token) });
    assert(mine.status === 200, `the installer must still read their own source, got ${mine.status}`);
    assert(typeof mine.body.data.action.scriptContent === 'string', 'own source should come back');

    const theirs = await json(`/v1/extensions/${name}/actions/ping`, { headers: auth(ownerB.token) });
    assert(theirs.status === 403,
      `a stranger got ${theirs.status} on someone else's source; body ${JSON.stringify(theirs.body?.data ?? theirs.body?.error)}`);
  });

  await test('reading an action source still needs authentication at all', async () => {
    const name = `hardanon${Date.now()}`;
    const res = await install(ownerA.token, name, {});
    assert(res.status === 201, `install ${res.status}`);
    const anon = await json(`/v1/extensions/${name}/actions/ping`);
    assert(anon.status === 401, `expected 401 without a token, got ${anon.status}`);
  });

  console.log(`\nExtension Hardening E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  if (failed > 0) process.exit(1);
}

void run();
