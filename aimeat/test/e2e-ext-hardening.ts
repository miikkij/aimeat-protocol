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

/** Install an extension with a hand-written manifest, for the cases the helper above cannot express. */
async function installManifest(token: string, manifest: Record<string, unknown>, scripts: Record<string, string>) {
  return json('/v1/extensions', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ manifest: JSON.stringify(manifest), scripts }),
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

  // ── 3b. The name IS the address ────────────────────────────────────────────────────────────
  await test('an extension name cannot forge another extension\'s instance namespace', async () => {
    // An `ext:` namespace is NOT owner-scoped, and that is deliberate: an app reads
    // getPublic('ext:{name}', key) without knowing who installed it. What keeps two extensions apart
    // is that names are unique node-wide. An instance-scoped extension stores under
    // `ext:{name}.{instanceId}`, and the instanceId half is validated on create with a pattern that
    // admits no dot, so it cannot forge the separator. The name half was checked only for being a
    // non-empty string, so `victim.probe` addressed exactly where the `probe` instance of `victim`
    // keeps its data — and the duplicate-name check does not notice, because the two names differ.
    //
    // What that is worth is NOT public reading: getPublic already crosses this boundary by design,
    // and ctx.memory.set writes public unless asked otherwise. It is the two things getPublic cannot
    // do — read a PRIVATE value, and WRITE — which this test therefore checks.
    const base = `victim${Date.now()}`;

    const victim = await installManifest(ownerA.token, {
      metadata: { name: base, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
      actions: [
        { id: 'put', method: 'POST', path: '/put', script: 'put' },
        { id: 'read', method: 'POST', path: '/read', script: 'read' },
      ],
      instances: { supported: true, config_per_instance: { properties: {} } },
      limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, {
      put: 'export default async function(ctx){ await ctx.memory.set("tenant-secret", { value: "owner A only" }, { visibility: "private" }); return { written: true }; }',
      read: 'export default async function(ctx){ return { held: await ctx.memory.get("tenant-secret") }; }',
    });
    assert(victim.status === 201, `victim install ${victim.status}: ${JSON.stringify(victim.body?.error)}`);

    const act = await json(`/v1/extensions/${base}/activate`, { method: 'POST', headers: auth(ownerA.token), body: '{}' });
    assert(act.status === 200, `victim activate ${act.status}: ${JSON.stringify(act.body?.error)}`);

    const inst = await json(`/v1/extensions/${base}/instances`, {
      method: 'POST', headers: auth(ownerA.token),
      body: JSON.stringify({ id: 'probe', config: {} }),
    });
    assert(inst.status === 201 || inst.status === 200, `instance create ${inst.status}: ${JSON.stringify(inst.body?.error)}`);

    const wrote = await json(`/v1/ext/${base}/probe/put`, { method: 'POST', headers: auth(ownerA.token), body: '{}' });
    assert(wrote.status === 200, `victim write ${wrote.status}: ${JSON.stringify(wrote.body?.error)}`);

    // Owner B now asks for the name that IS that instance's address. Their script does the two
    // things a public read cannot: get() ignores visibility, and set() overwrites.
    const forged = await installManifest(ownerB.token, {
      metadata: { name: `${base}.probe`, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
      actions: [{ id: 'raid', method: 'POST', path: '/raid', script: 'raid' }],
      limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, {
      raid: 'export default async function(ctx){ const stolen = await ctx.memory.get("tenant-secret");'
        + ' await ctx.memory.set("tenant-secret", { value: "overwritten by owner B" });'
        + ' const viaPublic = await ctx.memory.getPublic("ext:' + base + '.probe", "tenant-secret");'
        + ' return { stolen, viaPublic }; }',
    });

    if (forged.status === 201) {
      await json(`/v1/extensions/${base}.probe/activate`, { method: 'POST', headers: auth(ownerB.token), body: '{}' });
      const raid = await json(`/v1/ext/${base}.probe/raid`, { method: 'POST', headers: auth(ownerB.token), body: '{}' });
      const out = raid.body?.data?.result ?? raid.body?.data ?? {};
      const after = await json(`/v1/ext/${base}/probe/read`, { method: 'POST', headers: auth(ownerA.token), body: '{}' });
      const held = (after.body?.data?.result ?? after.body?.data ?? {}).held;
      assert(false, 'a dotted extension name installed (201). '
        + `Private read: ${JSON.stringify(out.stolen)} (getPublic on the same key returned ${JSON.stringify(out.viaPublic)}, `
        + 'so this is beyond what the public road gives). '
        + `Owner A's instance now holds ${JSON.stringify(held)}.`);
    }
    assert(forged.status === 400,
      `an extension name carrying the instance separator must be refused, got ${forged.status}`);
  });

  // ── 3c. The other door into the same room ──────────────────────────────────────────────────
  await test('a package migration cannot register an extension past the manifest gates', async () => {
    // services/component-registrar.ts had its own manifest→ExtensionRecord builder, so a component
    // registered through the package flow skipped everything routes/extensions/manifest.ts checks.
    // That was not only package content: apply-migration takes `content` from the request body under
    // `custom` and `replace`, gated on owning the INSTANCE and nothing about what is inside. So the
    // emailPolicy gate above, and the name gate below it, were both reachable around.
    const pkgs = await json('/v1/packages');
    assert(pkgs.status === 200, `list packages ${pkgs.status}`);
    const withExt = (pkgs.body.data.packages ?? []).find((p: Record<string, unknown>) =>
      ((p.components ?? []) as Array<{ type?: string }>).some(c => c.type === 'extension'));
    assert(!!withExt, 'this test needs a published package carrying an extension component (the node seeds two at boot)');

    const inst = await json(`/v1/packages/${encodeURIComponent(withExt.packageGroupId)}/install`, {
      method: 'POST', headers: auth(ownerA.token),
      body: JSON.stringify({ label: `hardening ${Date.now()}` }),
    });
    assert(inst.status === 201, `install package ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const instanceId = inst.body.data.id as string;
    const extComp = (withExt.components as Array<{ id: string; type: string }>).find(c => c.type === 'extension')!;

    const forgedManifest = JSON.stringify({
      manifest: [
        'metadata:',
        '  name: migrated-raider',
        '  version: 1.0.0',
        '  description: registered through the migration door',
        '  author: e2e',
        'config:',
        '  emailPolicy: unrestricted',
        'actions:',
        '  - id: send',
        '    method: POST',
        '    path: /send',
        '    script: send',
      ].join('\n'),
      scripts: { send: 'export default async function(ctx){ return { sent: await ctx.email("stranger@example.com", "hi", "hi") }; }' },
    });

    const applied = await json(`/v1/instances/${instanceId}/apply-migration`, {
      method: 'POST', headers: auth(ownerA.token),
      body: JSON.stringify({
        targetVersion: withExt.version,
        components: [{ componentId: extComp.id, action: 'custom', content: forgedManifest }],
      }),
    });
    assert(applied.status === 200, `migration ${applied.status}: ${JSON.stringify(applied.body?.error)}`);

    // The manifest itself is well formed, so it applies. What must not survive is the config key:
    // the same strip the front door does, on this road too.
    const registered = (inst.body.data.installedComponents ?? [])
      .find((c: { componentId: string }) => c.componentId === extComp.id) as { registeredAs?: string } | undefined;
    assert(!!registered?.registeredAs, 'the install should report the registered name of the extension component');
    const after = await json(`/v1/extensions/${registered!.registeredAs}`, { headers: auth(ownerA.token) });
    assert(after.status === 200, `read back ${after.status}`);
    const cfg = (after.body.data.extension.config ?? {}) as Record<string, unknown>;
    assert(cfg.emailPolicy === undefined,
      `the migration door wrote emailPolicy=${JSON.stringify(cfg.emailPolicy)} — the package flow is a second install path with none of the gates`);

    // And content the front door would refuse outright is refused here too, rather than registered
    // by a lenient second parser. The old component has to survive that refusal: this road deletes
    // before it registers, so a rejection after the delete would leave nothing behind.
    const junk = await json(`/v1/instances/${instanceId}/apply-migration`, {
      method: 'POST', headers: auth(ownerA.token),
      body: JSON.stringify({
        targetVersion: withExt.version,
        components: [{ componentId: extComp.id, action: 'custom', content: 'function helper(){}' }],
      }),
    });
    assert(junk.status === 400,
      `content that is not a manifest must be refused, got ${junk.status}: ${JSON.stringify(junk.body?.data ?? junk.body?.error)}`);
    const survived = await json(`/v1/extensions/${registered!.registeredAs}`, { headers: auth(ownerA.token) });
    assert(survived.status === 200,
      `the refused migration deleted the existing component (read back ${survived.status})`);
  });

  // ── 3d. Gating somebody else's app ─────────────────────────────────────────────────────────
  await test('an extension cannot declare that it gates another owner\'s app', async () => {
    // `config: { app: owner/file.html }` names the app whose membership this extension enforces, and
    // the node reads that roster on the extension's behalf: the caller's role on every invoke, and
    // the carry plan on the paywall. Naming somebody else's app turns a private roster into a
    // per-call oracle, and puts the caller on that owner's carry plan.
    const mine = await install(ownerA.token, `appgateok${Date.now()}`, { app: { default: `${ownerA.name}/dashboard.html` } });
    assert(mine.status === 201, `gating my own app must still install, got ${mine.status}: ${JSON.stringify(mine.body?.error)}`);

    const theirs = await install(ownerA.token, `appgatebad${Date.now()}`, { app: { default: `${ownerB.name}/dashboard.html` } });
    assert(theirs.status === 400,
      `naming another owner's app must be refused, got ${theirs.status}: ${JSON.stringify(theirs.body?.data ?? theirs.body?.error)}`);
  });

  // ── 3e. A price nobody meant to type ───────────────────────────────────────────────────────
  await test('a manifest price and toll are bounded by the node\'s ceilings', async () => {
    const priced = await installManifest(ownerA.token, {
      metadata: { name: `pricecap${Date.now()}`, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
      actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo', commercial: { payMorsels: 100_000_000 } }],
      limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, { echo: ECHO });
    assert(priced.status === 400,
      `a price of 100 million morsels must be refused, got ${priced.status}: ${JSON.stringify(priced.body?.data)}`);

    // A toll BURNS the caller's morsels and returns nothing, so it answers to the burn ceiling
    // (extensionMaxDebitPerCall, 100 by default) rather than the price one.
    const tolled = await installManifest(ownerA.token, {
      metadata: { name: `tollcap${Date.now()}`, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
      actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo', tollMorsels: 5_000 }],
      limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, { echo: ECHO });
    assert(tolled.status === 400,
      `a 5000-morsel burn per call must be refused, got ${tolled.status}: ${JSON.stringify(tolled.body?.data)}`);

    // And an ordinary price still installs, so the ceiling is a bound and not a ban.
    const ok = await installManifest(ownerA.token, {
      metadata: { name: `priceok${Date.now()}`, version: '1.0.0', description: 'hardening e2e', author: 'e2e' },
      actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo', commercial: { payMorsels: 5 }, tollMorsels: 2 }],
      limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, { echo: ECHO });
    assert(ok.status === 201, `an ordinary price must still install, got ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
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
