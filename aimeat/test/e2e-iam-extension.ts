/**
 * @file e2e-iam-extension.ts
 * @description E2E for the EVOLVED aimeat-iam extension (P5 slice 2): installs the ACTUAL package
 *   extension (under a unique name) and verifies the level + command evolution is backward-compatible.
 *   Legacy check{permission} is unchanged; admin seeds BBS ordinal levels (admin:0/editor:10/viewer:20)
 *   + an empty command manifest; setCommands + check{command} resolves a command's required capability,
 *   mutation tier, level, and needsConfirmation; a viewer is denied an irreversible '*' command that the
 *   admin role may run. Proves the extension now runs on the shared level/capability model.
 * @version-history
 *   v1.0.0 — 2026-07-02 — Initial: level + command evolution + backward-compat, against the real package.
 *   v1.1.0 — 2026-07-29 — Add a second owner and point it at the admin surface: the in-script
 *            `isOwner` check is the ONLY gate there (the route is requireAuth() only), and batch 01
 *            mutation I2 deleted it with the suite still 7/7 green.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=iam-extension

import { aimeatIamPackage } from '../src/data/aimeat-iam-package.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `iamext${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'IAM Ext', password: 'IamExt1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'IAM Ext', password: 'IamExt1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Connect an agent for `ownerName` via device authorization and return its token + full GAII. */
async function setupAgent(agentName: string, ownerName: string, ownerToken: string, scopes: string[] = ['memory:read', 'memory:write']) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}: ${JSON.stringify(da.body)}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}: ${JSON.stringify(t.body)}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

// The evolved extension, extracted from the real package under a unique name (avoids collisions + re-runnable).
const EXT = `iamx${Date.now()}`;
const extComponent = aimeatIamPackage().components.find(c => c.type === 'extension')!;
const extDef = JSON.parse(extComponent.content) as { manifest: string; scripts: Record<string, string> };
const manifest = extDef.manifest.replace('name: iam', `name: ${EXT}`);
const scripts = extDef.scripts;

console.log('\n=== AIMEAT aimeat-iam Extension Evolution E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let aGaii = '';
const admin = (op: string, extra: Record<string, unknown> = {}) =>
    json(`/v1/ext/${EXT}/admin`, { method: 'POST', headers: authH(A.token), body: JSON.stringify({ op, ...extra }) });
const check = (input: Record<string, unknown>) =>
    json(`/v1/ext/${EXT}/check`, { method: 'POST', headers: authH(A.token), body: JSON.stringify(input) });
const data = (r: { body: any }) => (r.body && r.body.data !== undefined ? r.body.data : r.body);

await test('Setup owner A', async () => { A = await setupOwner('a'); });

await test('Install + activate the evolved iam extension', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: authH(A.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body.error || inst.body)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: authH(A.token), body: '{}' });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error || act.body)}`);
});

/**
 * The package declares a JSON Schema for both actions, and for a long time none of it survived
 * installation: the manifest said `input_schema:` while the parser reads `input:`, so every install
 * advertised check and admin with `{}` and an agent had no way to learn the gate's shape. Nothing
 * failed loudly, because a dropped schema looks exactly like an action that never had one. Assert
 * the schemas ARRIVE, not merely that the install returned 200.
 */
await test('Install carries the declared action schemas through the manifest parse', async () => {
    const det = await json(`/v1/extensions/${EXT}`, { headers: authH(A.token) });
    assert(det.status === 200, `detail ${det.status}`);
    // This route serializes camelCase while the MCP twin serializes snake_case, so read either
    // rather than pinning the test to one surface's spelling.
    type Action = { id: string; inputSchema?: Record<string, unknown>; input_schema?: Record<string, unknown>;
                    outputSchema?: Record<string, unknown>; output_schema?: Record<string, unknown> };
    const actions: Action[] = (det.body.data.extension ?? det.body.data).actions;
    const inOf = (a: Action) => a.inputSchema ?? a.input_schema;
    const outOf = (a: Action) => a.outputSchema ?? a.output_schema;
    for (const id of ['check', 'admin']) {
        const a = actions.find(x => x.id === id);
        assert(!!a, `action ${id} is installed`);
        const inProps = (inOf(a!)?.properties ?? {}) as Record<string, unknown>;
        const outProps = (outOf(a!)?.properties ?? {}) as Record<string, unknown>;
        assert(Object.keys(inProps).length > 0, `${id} input schema survived the parse: ${JSON.stringify(inOf(a!))}`);
        assert(Object.keys(outProps).length > 0, `${id} output schema survived the parse: ${JSON.stringify(outOf(a!))}`);
    }
    const props = inOf(actions.find(x => x.id === 'check')!)!.properties as Record<string, unknown>;
    assert(!!props.permission && !!props.command, `check declares both modes: ${JSON.stringify(props)}`);
});

await test('1. claim + getState seed BBS levels + an empty command manifest', async () => {
    aGaii = data(await admin('claim')).ownerGhii;
    assert(!!aGaii, 'claim returned an ownerGhii');
    const s = data(await admin('getState'));
    assert(JSON.stringify(s.levels) === JSON.stringify({ admin: 0, editor: 10, viewer: 20 }), `levels: ${JSON.stringify(s.levels)}`);
    assert(Array.isArray(s.commands) && s.commands.length === 0, `commands: ${JSON.stringify(s.commands)}`);
});

await test('2. legacy check{permission} is unchanged (backward-compatible)', async () => {
    await admin('assign', { ghii: aGaii, role: 'viewer' });
    const read = data(await check({ permission: 'read' }));
    assert(read.allowed === true && read.role === 'viewer', `read: ${JSON.stringify(read)}`);
    const del = data(await check({ permission: 'delete' }));
    assert(del.allowed === false, `delete: ${JSON.stringify(del)}`);
});

await test('3. setCommands + check{command} resolves capability + tier + level (viewer)', async () => {
    await admin('setCommands', { commands: [
        { id: 'list', description: 'List items', capability: 'read', tier: 'read' },
        { id: 'purge', description: 'Delete everything', capability: '*', tier: 'irreversible' },
    ] });
    const list = data(await check({ command: 'list' }));
    assert(list.allowed === true && list.tier === 'read' && list.needsConfirmation === false && list.level === 20, `list: ${JSON.stringify(list)}`);
    const purge = data(await check({ command: 'purge' }));
    assert(purge.allowed === false && purge.tier === 'irreversible', `purge(viewer): ${JSON.stringify(purge)}`);
});

await test('4. the admin role runs the irreversible command with needsConfirmation + level 0', async () => {
    await admin('assign', { ghii: aGaii, role: 'admin' });
    const purge = data(await check({ command: 'purge' }));
    assert(purge.allowed === true && purge.needsConfirmation === true && purge.level === 0, `purge(admin): ${JSON.stringify(purge)}`);
});

await test('5. an unknown command is denied with an error', async () => {
    const u = data(await check({ command: 'nope' }));
    assert(u.allowed === false && /unknown/.test(u.error || ''), `unknown: ${JSON.stringify(u)}`);
});

await test('6. a DIFFERENT authenticated owner CANNOT drive the admin surface', async () => {
    // /v1/ext/:name/:actionId is requireAuth() only, so the in-script `isOwner` check is the ONLY
    // gate on setConfig/setRoles/setLevels/setCommands/assign. Any authenticated caller who gets
    // past it owns the app's whole permission model.
    B = await setupOwner('b');
    const bGhii = `${B.name}@${NODE_ID}`;
    const asB = (op: string, extra: Record<string, unknown> = {}) =>
        json(`/v1/ext/${EXT}/admin`, { method: 'POST', headers: authH(B.token), body: JSON.stringify({ op, ...extra }) });

    const st = data(await asB('getState'));
    assert(st.isOwner === false, `B must not be the extension owner: ${JSON.stringify(st.isOwner)}`);
    assert(st.ownerGhii === aGaii, `the extension owner must still be A: ${JSON.stringify(st.ownerGhii)}`);

    const ops: [string, Record<string, unknown>][] = [
        ['setConfig', { config: { defaultRole: 'admin' } }],
        ['setRoles', { roles: { admin: ['*'], viewer: ['*'] } }],
        ['setLevels', { levels: { admin: 0, editor: 0, viewer: 0 } }],
        ['setCommands', { commands: [{ id: 'pwn', description: 'pwn', capability: 'read', tier: 'read' }] }],
        ['assign', { ghii: bGhii, role: 'admin' }],
        ['revoke', { ghii: aGaii }],
    ];
    for (const [op, extra] of ops) {
        const r = data(await asB(op, extra));
        assert(r.ok === false && /forbidden/.test(r.error || ''), `${op} by a non-owner must be refused, got ${JSON.stringify(r)}`);
    }

    // The refusals were real: none of what B tried to write landed.
    const after = data(await admin('getState'));
    assert(JSON.stringify(after.levels) === JSON.stringify({ admin: 0, editor: 10, viewer: 20 }), `levels must be untouched: ${JSON.stringify(after.levels)}`);
    assert(after.roles.viewer.length === 1 && after.roles.viewer[0] === 'read', `viewer role must be untouched: ${JSON.stringify(after.roles.viewer)}`);
    assert(after.commands.every((c: any) => c.id !== 'pwn'), `command manifest must be untouched: ${JSON.stringify(after.commands)}`);
    assert(after.assignments[bGhii] === undefined, `B must not have assigned itself a role: ${JSON.stringify(after.assignments)}`);
    assert(after.assignments[aGaii] === 'admin', `A's own assignment must survive B's revoke: ${JSON.stringify(after.assignments)}`);
});

/**
 * The reason three of the six iam-family extensions on this node exist: a role used to be keyed to
 * the ACTING identity, so an approved member who worked through an agent matched no row and fell to
 * the default role. In a members-only app that is the guest tier, and nothing reports it: from the
 * agent's side the app simply does not offer those tools.
 */
await test('7. a member\'s AGENT inherits the member\'s role (owner-keyed by default)', async () => {
    const agent = await setupAgent('helper', A.name, A.token);
    assert(agent.gaii.includes('#'), `an agent gaii carries '#': ${agent.gaii}`);
    assert(agent.gaii !== aGaii, `the agent identity differs from the human's: ${agent.gaii}`);

    const asAgent = (input: Record<string, unknown>) =>
        json(`/v1/ext/${EXT}/check`, { method: 'POST', headers: authH(agent.token), body: JSON.stringify(input) });

    // A holds 'admin' from test 4, assigned under A's own GHII. The agent has NO row of its own.
    const r = data(await asAgent({ permission: 'read' }));
    assert(r.allowed === true, `the agent must inherit its human's access: ${JSON.stringify(r)}`);
    assert(r.role === 'admin', `the agent resolves to the human's role: ${JSON.stringify(r)}`);
    assert(r.via === 'owner', `and it must resolve VIA THE OWNER, not by an agent row: ${JSON.stringify(r)}`);

    // The irreversible command still asks for confirmation when an agent is the caller.
    const purge = data(await asAgent({ command: 'purge' }));
    assert(purge.allowed === true && purge.needsConfirmation === true, `purge via agent: ${JSON.stringify(purge)}`);

    // One revoke on the PERSON takes the right from every agent they have.
    await admin('revoke', { ghii: aGaii });
    const after = data(await asAgent({ permission: 'read' }));
    assert(after.role === 'viewer' && after.via === 'none',
        `revoking the person must drop their agents to the default role: ${JSON.stringify(after)}`);
    await admin('assign', { ghii: aGaii, role: 'admin' });
});

/**
 * Comparing the caller's gaii against config.ownerGhii refused the OWNER'S OWN agent, so an owner
 * could not manage members from an AI chat at all. Administration is gated by capability instead:
 * the agent inherits '*' from its human and gets in, while a stranger's agent does not.
 */
await test('8. the owner administers through their own agent, a stranger\'s agent does not', async () => {
    const mine = await setupAgent('admin-hand', A.name, A.token);
    const theirs = await setupAgent('intruder', B.name, B.token);
    const adminAs = (token: string, op: string, extra: Record<string, unknown> = {}) =>
        json(`/v1/ext/${EXT}/admin`, { method: 'POST', headers: authH(token), body: JSON.stringify({ op, ...extra }) });

    const ok = data(await adminAs(mine.token, 'getState'));
    assert(ok.isOwner === true, `the owner's own agent must administer: ${JSON.stringify(ok.isOwner)}`);
    assert(Object.keys(ok.assignments || {}).length > 0, `and it must see the roster: ${JSON.stringify(ok.assignments)}`);

    const no = data(await adminAs(theirs.token, 'getState'));
    assert(no.isOwner === false, `another owner's agent must NOT administer: ${JSON.stringify(no.isOwner)}`);
    assert(Object.keys(no.assignments || {}).length === 0, `and must not see the roster: ${JSON.stringify(no.assignments)}`);

    const w = data(await adminAs(theirs.token, 'assign', { ghii: `${B.name}@${NODE_ID}`, role: 'admin' }));
    assert(w.ok === false && /forbidden/.test(w.error || ''), `a stranger's agent must not write: ${JSON.stringify(w)}`);
});

/** An ext: namespace is world-readable by default, so a roster written the plain way is served to
 *  anyone who asks for the key. The roster and config must be private; the capability vocabulary
 *  is product configuration and stays public. */
await test('9. the roster is NOT readable without a token, the capability vocabulary still is', async () => {
    const anon = (key: string) => json(`/v1/memory/ext:${EXT}/${key}`);

    for (const key of ['iam.assignments', 'iam.config']) {
        const r = await anon(key);
        assert(r.status !== 200, `${key} must not be world-readable, got ${r.status}: ${JSON.stringify(r.body.data)}`);
    }
    const roles = await anon('iam.roles');
    assert(roles.status === 200, `iam.roles stays public (no personal data): ${roles.status}`);
});


/**
 * The third value of the keying axis. `owner` and `both` were proven in production; `gaii` never was,
 * and an axis with an untested arm is an axis with an untested arm however confident the other two
 * make you. It exists for the case where an agent must NOT inherit its human's access — a shared
 * machine account, a narrow bot — so the thing to prove is precisely that inheritance stops.
 */
await test('10. subject=gaii: an agent is enrolled on its OWN, and inherits nothing', async () => {
    const agent = await setupAgent('solo', A.name, A.token);
    // A holds admin from earlier. Under `owner` (and `both`) that reaches the agent; under `gaii` it must not.
    const asAgent = (input: Record<string, unknown>) =>
        json(`/v1/ext/${EXT}/check`, { method: 'POST', headers: authH(agent.token), body: JSON.stringify(input) });

    const inherited = data(await asAgent({ permission: 'read' }));
    assert(inherited.allowed === true && inherited.via === 'owner',
        `before the switch the agent inherits, which is what makes the switch meaningful: ${JSON.stringify(inherited)}`);

    const sw = data(await admin('setSubject', { subject: 'gaii' }));
    assert(sw.subject === 'gaii', `switched: ${JSON.stringify(sw)}`);

    const alone = data(await asAgent({ permission: 'read' }));
    assert(alone.subject === 'gaii', `the answer says which axis decided it: ${JSON.stringify(alone)}`);
    assert(alone.via === 'none',
        `under gaii an agent must NOT resolve through its human: ${JSON.stringify(alone)}`);
    assert(alone.role === 'viewer',
        `it falls to the default role instead: ${JSON.stringify(alone)}`);

    // The human is unaffected: their own row is still theirs.
    const human = data(await check({ permission: 'read' }));
    assert(human.allowed === true && human.role === 'admin',
        `the person keeps what they hold: ${JSON.stringify(human)}`);

    // Enrolling the agent explicitly is how it gets in under this axis.
    await admin('assign', { ghii: agent.gaii, role: 'editor' });
    const enrolled = data(await asAgent({ permission: 'create' }));
    assert(enrolled.allowed === true && enrolled.role === 'editor' && enrolled.via === 'agent',
        `an explicitly enrolled agent holds its OWN role: ${JSON.stringify(enrolled)}`);

    // Put the axis back so later runs and any other assertion see the default.
    await admin('setSubject', { subject: 'owner' });
    const restored = data(await asAgent({ permission: 'read' }));
    assert(restored.via === 'owner', `switching back restores inheritance: ${JSON.stringify(restored)}`);
});

console.log(`\naimeat-iam Extension Evolution E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
