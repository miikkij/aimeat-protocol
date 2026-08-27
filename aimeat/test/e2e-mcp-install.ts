/**
 * @file e2e-mcp-install.ts
 * @description E2E for the short way into an MCP connection: GET /v1/connect/mcp.json, and the
 *   install shortcuts the tool table advertises on top of it.
 *
 *   WHAT THIS SUITE IS REALLY GUARDING is a file a person saves and never reads. A wrong top-level
 *   key or a missing transport does not error: the client loads the file, ignores it, and the
 *   person concludes the product is broken. So each client's shape is asserted by name.
 *
 *   The route answers with the FILE rather than the standard envelope, which is deliberate and is
 *   asserted here, because an envelope is exactly the kind of thing a later cleanup would "fix".
 *
 *   Failure modes covered:
 *     - an unknown client id is refused, not quietly served some default client's file;
 *     - a server name from the query is reduced to [a-z0-9-] before it reaches JSON or a URL;
 *     - nothing token-shaped appears in a file this node serves to anyone who asks;
 *     - every `install.file` URL the tool table publishes actually resolves, so the buttons on the
 *       home, on Hello MCP and on every agent's page cannot all be dead at once;
 *     - the answer does not depend on who asked. A public route cannot refuse anybody, so that is
 *       the fence it has instead: the day this starts reflecting the caller, a door that takes no
 *       auth is handing one person's account to the next person who asks for a config file.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=mcp-install
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

console.log('\n=== MCP install E2E (the config file and the one-click links) ===\n');

await test('Each client gets its own shape, with this node\'s address and no credential', async () => {
    const shapes: Record<string, { key: string; filename: string; type?: string }> = {
        'claude-code': { key: 'mcpServers', filename: '.mcp.json', type: 'http' },
        vscode: { key: 'servers', filename: 'mcp.json', type: 'http' },
        cursor: { key: 'mcpServers', filename: 'mcp.json' },
    };
    for (const [client, want] of Object.entries(shapes)) {
        const res = await fetch(`${BASE}/v1/connect/mcp.json?client=${client}`);
        assert(res.status === 200, `${client}: ${res.status}`);
        assert((res.headers.get('content-disposition') ?? '').includes(`filename="${want.filename}"`),
            `${client} must download as ${want.filename}, got ${res.headers.get('content-disposition')}`);

        const cfg = await res.json() as any;
        // The FILE, not the envelope: a client reads these bytes and knows nothing about `data`.
        assert(cfg.data === undefined && !!cfg[want.key],
            `${client} must be the raw file keyed on ${want.key}, got ${JSON.stringify(cfg)}`);

        const entry = cfg[want.key].aimeat;
        assert(entry?.url === `${BASE}/v1/mcp`, `${client} must carry THIS node's address, got ${entry?.url}`);
        assert(entry.type === want.type, `${client} transport: expected ${want.type}, got ${entry.type}`);

        // Public on purpose, and only safe while it stays empty: this node signs people in over
        // OAuth, so anything token-shaped here would be handed to whoever asked for the file.
        assert(!/token|secret|bearer|authorization/i.test(JSON.stringify(cfg)),
            `${client} must carry no credential: ${JSON.stringify(cfg)}`);
    }
});

await test('A server name from the query is reduced before it reaches the file', async () => {
    // An agent called `My Agent! "x"/../y` must not be able to put a quote or a path segment inside
    // a file a person then saves and a client then parses.
    const raw = 'My Agent! "x"/../y';
    const res = await fetch(`${BASE}/v1/connect/mcp.json?client=vscode&name=${encodeURIComponent(raw)}`);
    assert(res.status === 200, `named request ${res.status}`);
    const names = Object.keys(((await res.json()) as any).servers);
    assert(names.length === 1 && /^[a-z0-9-]+$/.test(names[0]),
        `the server name must be reduced to [a-z0-9-], got ${JSON.stringify(names)}`);
});

await test('An unknown client is refused, not served some default', async () => {
    const bad = await json('/v1/connect/mcp.json?client=notepad');
    assert(bad.status === 400, `unknown client ${bad.status}`);
    assert(bad.body.error?.code === 'INVALID_CLIENT',
        `expected INVALID_CLIENT, got ${JSON.stringify(bad.body.error)}`);

    const none = await json('/v1/connect/mcp.json');
    assert(none.status === 400, `missing client ${none.status}`);
});

await test('The file needs no sign-in, because there is nothing in it to protect', async () => {
    const res = await fetch(`${BASE}/v1/connect/mcp.json?client=claude-code`);
    assert(res.status === 200, `unauthenticated status ${res.status}`);
});

await test('The door tells a second principal nothing about the first', async () => {
    // A public route cannot refuse anybody, so the fence it DOES have is a different one: the
    // answer must not depend on who asked. If it ever started reflecting the caller — their owner
    // name as the server name, their agents, their connections — then a route that takes no auth
    // would be leaking one person's account to the next person who asked for a config file.
    //
    // Three callers, one of them nobody: byte-identical, and neither owner's name anywhere in it.
    const alice = `mcia${stamp}`;
    const bob = `mcib${stamp}`;
    const tokenA = await registerOwner(alice);
    const tokenB = await registerOwner(bob);

    const bodyFor = async (headers: Record<string, string>) => {
        const res = await fetch(`${BASE}/v1/connect/mcp.json?client=vscode`, { headers });
        assert(res.status === 200, `status ${res.status}`);
        return res.text();
    };
    const anon = await bodyFor({});
    const asAlice = await bodyFor({ Authorization: `Bearer ${tokenA}` });
    const asBob = await bodyFor({ Authorization: `Bearer ${tokenB}` });

    assert(anon === asAlice && anon === asBob,
        `the file must not depend on who asked:\n  anon: ${anon}\n  alice: ${asAlice}\n  bob: ${asBob}`);
    assert(!anon.includes(alice) && !anon.includes(bob),
        `no caller's name may appear in the file: ${anon}`);

    // And the one field a caller CAN steer is the server name, which is theirs to choose and
    // reaches nothing but the key inside the file they are downloading for themselves.
    const named = await fetch(`${BASE}/v1/connect/mcp.json?client=vscode&name=${bob}`,
        { headers: { Authorization: `Bearer ${tokenA}` } });
    const cfg = await named.json() as any;
    assert(Object.keys(cfg.servers)[0] === bob.toLowerCase(),
        `the name is the caller's to pick, got ${JSON.stringify(Object.keys(cfg.servers))}`);
    assert(JSON.stringify(cfg) === JSON.stringify(JSON.parse(anon.replace(/"aimeat"/, `"${bob.toLowerCase()}"`))),
        `naming the server must change the name and nothing else: ${JSON.stringify(cfg)}`);
});

await test('Every install shortcut the tool table advertises actually resolves', async () => {
    // The table and the route are two halves of one promise. A `file.url` that 404s is a dead
    // button on the home, on Hello MCP and on every agent's page at the same time.
    const { status, body } = await json('/v1/ai-tools');
    assert(status === 200, `ai-tools ${status}`);
    const withInstall = (body.data.tools ?? []).filter((t: any) => t.mcp?.install);
    assert(withInstall.length >= 3, `expected the three clients with a short way in, got ${withInstall.length}`);

    for (const tool of withInstall) {
        const file = tool.mcp.install.file;
        if (file) {
            const res = await fetch(file.url);
            assert(res.status === 200, `${tool.id} file url ${res.status}: ${file.url}`);
            assert(typeof file.where === 'string' && file.where.length > 10,
                `${tool.id} must say where the saved file goes`);
        }
        const link = tool.mcp.install.link;
        if (link) {
            assert(/^(https:|cursor:)/.test(link.href),
                `${tool.id} link must be https or a client scheme, got ${link.href}`);
            // The two clients encode the same object two different ways, so the check decodes
            // rather than substring-matching: VS Code takes URL-encoded JSON, Cursor takes base64.
            // Asserting on the raw href passed for one and failed for the other while both worked.
            const raw = new URL(link.href).searchParams.get('config') ?? '';
            const decoded = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
            const cfg = JSON.parse(decoded);
            assert(cfg.url === `${BASE}/v1/mcp`,
                `${tool.id} link must carry THIS node's address, got ${cfg.url}`);
        }
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
