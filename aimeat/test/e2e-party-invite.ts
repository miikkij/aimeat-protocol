/**
 * @file e2e-party-invite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the one-time share link (WP9b; canvas boards Jako and Vastaanottaja,
 *   services/parties/invite.ts). The suite runs its own node with mail on, pointed at a fake SMTP
 *   server in this process, because the link reaches the recipient by mail and the runner's node sends
 *   none.
 *   - The owner shares with a person and an e-mail in one call: the mail arrives in the language asked
 *     for, names who shared what until when, and carries the link.
 *   - The code is never a read credential: as `?key=`, as a Basic password and as a Bearer value the
 *     reads refuse it.
 *   - Preview changes nothing; redeem refuses without the terms before anything is written; redeem
 *     with them answers a NEW key, the connection file and a party token; the key the owner saw stops
 *     working, the new one reads over Basic and OData, the token reads /v1/parties/me.
 *   - Refusals: a used code (410 INVITE_USED), an expired code (410 INVITE_EXPIRED), a revoked share
 *     (410 SHARE_ENDED), another owner's name on the code (404), a link replaced by a newer one (404),
 *     another owner and an agent without party:manage sending a link (404, 403), no address (400).
 *   - aimeat_party "share" with email and "send_link" over MCP.
 *   - The automatic engine reads of the Power-BI-Excel board: DuckDB reads the CSV and the Frictionless
 *     descriptor's relative path with a bearer secret, pandas reads the rows a page at a time and an
 *     earlier version (through `uv run`; counted as SKIPPED when uv is not on this machine).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=party-invite
 * @version-history
 *   v1.1.0 — 2026-11-01 — The preview carries the licence's deed, the attribution and the words per
 *     language; the connection file's password is the key; a used link's recipient changes the key with
 *     the key itself (WP10e A2, A3, B4, B12).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b). Every case fails on the code before it: the routes did not exist.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { startFakeSmtp, type FakeSmtp } from './helpers/fake-smtp.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const PORT = Number(process.env.E2E_PARTY_INVITE_PORT ?? 28566);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const stamp = Date.now() % 1_000_000;

let passed = 0, failed = 0, skipped = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; basic?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined;
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let node: ChildProcess | null = null;
let smtp: FakeSmtp | null = null;
let A = { name: '', token: '' }, B = { name: '', token: '' };
let nodeId = '';
const PKG = `inv${stamp}`;
let v1 = '', v2 = '';
const mattiMail = `matti${stamp}@example.test`;

async function startNode(): Promise<void> {
    smtp = await startFakeSmtp({ port: SMTP_PORT });
    const db = await ownNodeDb(String(PORT));
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args, '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env, ...db.env,
            AIMEAT_PORT: String(PORT), AIMEAT_BASE_URL: BASE, AIMEAT_ADMIN_PASSWORD: 'party-invite-admin-pw',
            AIMEAT_ANONYMOUS: 'false',
            AIMEAT_SMTP_HOST: '127.0.0.1', AIMEAT_SMTP_PORT: String(SMTP_PORT), AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false', AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*', AIMEAT_PARTY_READS_PER_MINUTE: '10000',
            AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
            AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(node, BASE, { label: 'the party invite node' });
}

async function stopAll(): Promise<void> {
    if (node) { const dying = node; node = null; dying.kill(); await Promise.race([once(dying, 'exit'), new Promise(r => setTimeout(r, 15_000))]); }
    if (smtp) { await smtp.close(); smtp = null; }
}

/** The code in the newest mail to `to`. */
async function codeIn(to: string): Promise<{ code: string; subject: string; text: string }> {
    const mail = await smtp!.waitForMail(to, /\/v1\/shared-data\?invite=/, 20_000);
    const m = /\/v1\/shared-data\?invite=([A-Za-z0-9_.%~-]+)/.exec(mail.text);
    const code = decodeURIComponent(m?.[1] ?? '');
    assert(code.includes('.') && code.length > 40, `no code in the mail: ${mail.text.slice(0, 300)}`);
    return { code, subject: mail.subject ?? '', text: mail.text };
}
const rows = (n: number, label: string) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `${label}-${i + 1}`, amount: i + 1 }));
const publish = (name: string, n: number, label: string) => call('/v1/datapackages', {
    token: A.token, body: { name, title: 'Kuntien budjettisignaalit', changes: label, visibility: 'private', resources: [{ name: 'items', rows: rows(n, label) }],
        provenance: { license: 'CC-BY-4.0', attribution: 'Source: Kunta', i18n: { en: { title: 'Municipal budget signals', attribution: 'Source: the municipality' } } } },
});
const share = (body: Body, token = A.token) => call('/v1/parties/share', { token, body: { package: PKG, purpose: 'Raportointi', days: 30, ...body } });

async function run(): Promise<void> {
    await startNode();
    console.log('\n=== AIMEAT one-time share link E2E ===\n');

    await test('Setup: owners A and B, and A\'s private package with two versions', async () => {
        await registerOwner(BASE, `ivop${stamp}`);
        const a = await registerOwner(BASE, `iva${stamp}`); A = { name: a.name, token: a.token };
        const b = await registerOwner(BASE, `ivb${stamp}`); B = { name: b.name, token: b.token };
        nodeId = a.ghii.split('@')[1]!;
        const p1 = await publish(PKG, 1200, 'first');
        assert(p1.status === 201, `v1: ${show(p1)}`);
        v1 = p1.body.data.content_hash;
        const p2 = await publish(PKG, 1201, 'second');
        assert(p2.status === 201, `v2: ${show(p2)}`);
        v2 = p2.body.data.content_hash;
    });

    let code = '', ownerKey = '', shareId = '', newKey = '', partyToken = '';

    await test('Share with an e-mail: the mail is in Finnish, names who shared what until when, and carries the link', async () => {
        const r = await share({ name: 'matti', kind: 'person', display_name: 'Matti Virtanen', email: mattiMail, locale: 'fi' });
        assert(r.status === 201 && r.body.data.link?.sent === true && r.body.data.link.link.includes('/v1/shared-data?invite='), `share: ${show(r)}`);
        ownerKey = r.body.data.connection.key;
        shareId = r.body.data.share.id;
        assert(ownerKey && r.body.data.link.share === shareId, 'the owner saw a key, and the link opens this share');
        const mail = await codeIn(mattiMail);
        code = mail.code;
        assert(mail.subject.includes('jakoi sinulle') && mail.text.includes('Kuntien budjettisignaalit') && mail.text.includes('Raportointi'), `the mail: ${mail.subject} / ${mail.text.slice(0, 400)}`);
        assert(r.body.data.link.link.endsWith(encodeURIComponent(code)), 'the owner\'s link is the mailed link');
        const party = await call('/v1/parties/matti', { token: A.token });
        assert(party.body.data.party.contact === mattiMail && party.body.data.party.share_links?.[0]?.used_at === null && !JSON.stringify(party.body).includes('"hash"'), `the party lists the link without its hash: ${show(party)}`);
    });

    await test('The code is never a read credential: as ?key=, as a Basic password, as a Bearer value', async () => {
        const csv = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?format=csv&key=${encodeURIComponent(code)}`);
        assert(csv.status === 401, `?key=: ${show(csv)}`);
        const basic = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${code}` });
        assert(basic.status === 401, `Basic: ${show(basic)}`);
        // A bearer value that is no session reads as no credential: the private package is not there.
        const bearer = await call(`/v1/datapackages/${A.name}/${PKG}`, { token: code });
        assert([401, 404].includes(bearer.status) && !bearer.body?.data, `Bearer: ${show(bearer)}`);
        const prefixed = await call('/v1/parties/me', { token: `aimeat_party_${code}` });
        assert(prefixed.status === 401, `as a party token: ${show(prefixed)}`);
    });

    await test('Preview answers who shared what and changes nothing; redeem without the terms is refused before any write', async () => {
        const p = await call('/v1/parties/invites/preview', { body: { code } });
        assert(p.status === 200 && p.body.data.owner === A.name && p.body.data.package.title === 'Kuntien budjettisignaalit'
            && p.body.data.share.purpose === 'Raportointi' && p.body.data.terms && p.body.data.party.display_name === 'Matti Virtanen', `preview: ${show(p)}`);
        assert(!('key' in p.body.data), 'no key in the preview');
        // WP10e A2, A3: the licence's deed, who to credit and the words per language reach the recipient page.
        assert(p.body.data.package.licence === 'CC-BY-4.0' && p.body.data.package.licence_url === 'https://creativecommons.org/licenses/by/4.0/'
            && p.body.data.package.attribution === 'Source: Kunta' && p.body.data.package.i18n?.en?.title === 'Municipal budget signals', `licence and words: ${JSON.stringify(p.body.data.package)}`);
        const no = await call('/v1/parties/invites/redeem', { body: { code } });
        assert(no.status === 400 && codeOf(no) === 'TERMS_NOT_ACCEPTED', `without terms: ${show(no)}`);
        assert((await call('/v1/parties/invites/preview', { body: { code } })).status === 200, 'the link still works');
        assert((await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${ownerKey}` })).status !== 401, 'the owner\'s key still exists before the redemption');
    });

    await test('Redeem: a new key, the connection file and a party token; the owner\'s key stops working', async () => {
        const r = await call('/v1/parties/invites/redeem', { body: { code, accept_terms: true } });
        assert(r.status === 200 && r.body.data.key && r.body.data.key !== ownerKey && r.body.data.access_token?.startsWith('aimeat_party_')
            && r.body.data.connection?.key === r.body.data.key && r.body.data.terms_accepted, `redeem: ${show(r)}`);
        // WP10e B4: the file's sign-in carries the key itself, not English words in its place.
        const auth = r.body.data.connection.authentication;
        assert(auth?.basic?.password === r.body.data.key && auth?.token_request?.client_secret === r.body.data.key, `the file's password: ${JSON.stringify(auth)}`);
        assert((r.body.data.retired_key_ids as string[]).length === 1, `the owner's key is retired: ${JSON.stringify(r.body.data.retired_key_ids)}`);
        newKey = r.body.data.key;
        partyToken = r.body.data.access_token;
        const old = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${ownerKey}` });
        assert(old.status === 401, `the owner's key: ${show(old)}`);
        const odata = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${newKey}` });
        assert(odata.status === 200, `the new key over OData: ${show(odata)}`);
        const page = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?limit=5`, { basic: `${A.name}/matti:${newKey}` });
        assert(page.status === 200 && page.body.data.rows.length === 5, `the new key reads rows: ${show(page)}`);
        const me = await call('/v1/parties/me', { token: partyToken });
        assert(me.status === 200 && (me.body.data.shares as Body[]).some(s => s.id === shareId && s.terms_accepted_at), `the token reads me: ${show(me)}`);
    });

    // WP10e B12: after the link is used, the recipient page changes the key with the key itself, as
    // shared-data-rotate.js does: a token from the user and the key, then the rotation with it.
    await test('A used link still lets the recipient change the key with the user and the key; a wrong key is refused', async () => {
        const wrong = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/matti`, client_secret: 'not-the-key-at-all' } });
        assert(wrong.status === 401, `a wrong key: ${show(wrong)}`);
        const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/matti`, client_secret: newKey } });
        const access = tok.body.access_token ?? tok.body.data?.access_token;
        assert(tok.status === 200 && access, `token from the key: ${show(tok)}`);
        const rot = await call('/v1/parties/me/keys/rotate', { token: access, body: {} });
        assert(rot.status === 200 && rot.body.data.key && rot.body.data.key !== newKey, `rotate: ${show(rot)}`);
        const old = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${newKey}` });
        assert(old.status === 401, `the old key after the change: ${show(old)}`);
        newKey = rot.body.data.key;
        const fresh = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${newKey}` });
        assert(fresh.status === 200, `the new key: ${show(fresh)}`);
        const t2 = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/matti`, client_secret: newKey } });
        partyToken = t2.body.access_token ?? t2.body.data?.access_token ?? partyToken;
    });

    await test('A used code is refused: 410 INVITE_USED on the preview and on a second redemption', async () => {
        const p = await call('/v1/parties/invites/preview', { body: { code } });
        assert(p.status === 410 && codeOf(p) === 'INVITE_USED', `preview: ${show(p)}`);
        const r = await call('/v1/parties/invites/redeem', { body: { code, accept_terms: true } });
        assert(r.status === 410 && codeOf(r) === 'INVITE_USED', `again: ${show(r)}`);
    });

    await test('Another owner\'s name on the code, and a code nobody holds, answer 404 INVITE_NOT_FOUND', async () => {
        const secret = code.slice(code.lastIndexOf('.') + 1);
        for (const c of [`${B.name}.${secret}`, `${A.name}.${'x'.repeat(43)}`, 'not-a-code']) {
            const r = await call('/v1/parties/invites/preview', { body: { code: c } });
            assert(r.status === 404 && codeOf(r) === 'INVITE_NOT_FOUND', `${c.slice(0, 20)}: ${show(r)}`);
        }
    });

    await test('Send again: a new link for the share replaces an unused earlier one, and the newest works', async () => {
        const s = await share({ name: 'liisa', kind: 'person', email: `liisa${stamp}@example.test` });
        assert(s.status === 201 && s.body.data.link.sent, `share: ${show(s)}`);
        const first = (await codeIn(`liisa${stamp}@example.test`)).code;
        smtp!.clear();
        const again = await call('/v1/parties/liisa/invite', { token: A.token, body: { share: s.body.data.share.id } });
        assert(again.status === 201 && again.body.data.sent === true && again.body.data.to === `liisa${stamp}@example.test`, `send again to the contact: ${show(again)}`);
        const second = (await codeIn(`liisa${stamp}@example.test`)).code;
        assert(first !== second, 'a new code');
        assert((await call('/v1/parties/invites/preview', { body: { code: first } })).status === 404, 'the earlier link stopped working');
        assert((await call('/v1/parties/invites/preview', { body: { code: second } })).status === 200, 'the newest works');
    });

    await test('A revoked share ends its link: 410 SHARE_ENDED', async () => {
        const s = await share({ name: 'revoked', kind: 'person', email: `rev${stamp}@example.test` });
        assert(s.status === 201, `share: ${show(s)}`);
        const c = (await codeIn(`rev${stamp}@example.test`)).code;
        const del = await call(`/v1/consent/${s.body.data.share.id}`, { token: A.token, method: 'DELETE' });
        assert([200, 204].includes(del.status), `revoke: ${show(del)}`);
        for (const path of ['/v1/parties/invites/preview', '/v1/parties/invites/redeem']) {
            const r = await call(path, { body: { code: c, accept_terms: true } });
            assert(r.status === 410 && codeOf(r) === 'SHARE_ENDED', `${path}: ${show(r)}`);
        }
    });

    await test('An expired link is refused: 410 INVITE_EXPIRED (the link ends with its share)', async () => {
        const s = await share({ name: 'brief', kind: 'program', email: `brief${stamp}@example.test`, days: undefined, expires: new Date(Date.now() + 4000).toISOString() });
        assert(s.status === 201 && Date.parse(s.body.data.link.expires_at) <= Date.parse(s.body.data.share.expires), `share: ${show(s)}`);
        const c = (await codeIn(`brief${stamp}@example.test`)).code;
        await sleep(5000);
        const r = await call('/v1/parties/invites/redeem', { body: { code: c } });
        assert(r.status === 410 && codeOf(r) === 'INVITE_EXPIRED', `expired: ${show(r)}`);
    });

    await test('Who may send a link: another owner gets 404, an agent without party:manage 403, no address 400', async () => {
        const byB = await call('/v1/parties/matti/invite', { method: 'POST', token: B.token, body: { share: shareId, email: `b${stamp}@example.test` } });
        assert(byB.status === 404, `B for A's party: ${show(byB)}`);
        assert((await call('/v1/parties', { token: B.token, body: { name: 'matti', kind: 'person' } })).status === 201, 'B has a matti of its own');
        const bOwn = await call('/v1/parties/matti/invite', { token: B.token, body: { share: shareId, email: `b${stamp}@example.test` } });
        assert(bOwn.status === 404, `B names A's share on B's party: ${show(bOwn)}`);
        const consentOnly = await makeAgent(BASE, A, ['consent:manage']);
        const scoped = await call('/v1/parties/matti/invite', { method: 'POST', token: consentOnly.token, body: { share: shareId } });
        assert(scoped.status === 403, `consent:manage alone: ${show(scoped)}`);
        assert((await call('/v1/parties', { token: A.token, body: { name: 'nomail', kind: 'program' } })).status === 201, 'a party without contact');
        const s = await share({ name: 'nomail' });
        assert(s.status === 201, `share: ${show(s)}`);
        const none = await call('/v1/parties/nomail/invite', { token: A.token, body: {} });
        assert(none.status === 400 && codeOf(none) === 'EMAIL_REQUIRED', `no address: ${show(none)}`);
        const bad = await share({ name: 'bad', email: 'not an address' });
        assert(bad.status === 400 && (await call('/v1/parties/bad', { token: A.token })).status === 404, `a bad address is refused before the party is made: ${show(bad)}`);
    });

    await test('aimeat_party: "share" with email and "send_link" over MCP', async () => {
        const ag = await makeAgent(BASE, A, ['party:manage', 'consent:manage']);
        const s = await openSession(BASE, ag.token, 'party-invite-mcp');
        const out = await callTool(s, 'aimeat_party', { action: 'share', name: 'chat', kind: 'person', package: PKG, purpose: 'Power BI', days: 10, email: `chat${stamp}@example.test`, locale: 'es' });
        assert(!out.isError && out.data?.link?.sent === true, `share over MCP: ${out.text.slice(0, 400)}`);
        const mail = await codeIn(`chat${stamp}@example.test`);
        assert(mail.subject.includes('ha compartido contigo'), `Spanish mail: ${mail.subject}`);
        const again = await callTool(s, 'aimeat_party', { action: 'send_link', name: 'chat' });
        assert(!again.isError && again.data?.sent === true && again.data.share === out.data.share.id, `send_link: ${again.text.slice(0, 400)}`);
    });

    await test('The party declines the share with the token the redemption gave', async () => {
        const d = await call(`/v1/parties/me/shares/${shareId}/decline`, { token: partyToken, body: {} });
        assert(d.status === 200 && d.body.data.declined === true, `decline: ${show(d)}`);
        const r = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:${newKey}` });
        assert(r.status === 403, `the next read is refused: ${show(r)}`);
    });

    await test('DuckDB and pandas read as an outside party with a token: CSV, Frictionless, paging and a version', async () => {
        const s = await share({ name: 'engine', kind: 'program' });
        assert(s.status === 201, `share: ${show(s)}`);
        const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/engine`, client_secret: s.body.data.connection.key } });
        assert(tok.status === 200, `token: ${show(tok)}`);
        if (spawnSync('uv', ['--version'], { encoding: 'utf8' }).status !== 0) {
            skipped++;
            console.log('  ⏭ SKIPPED: DuckDB and pandas read the shared package — uv is not on this machine, so the engines cannot run');
            return;
        }
        const script = fileURLToPath(new URL('./fixtures/party-engine-read.py', import.meta.url));
        const r = spawnSync('uv', ['run', '--quiet', '--with', 'duckdb', '--with', 'pandas', 'python', '-I', script,
            BASE, tok.body.access_token, A.name, nodeId, PKG, 'items', v1, v2.replace(/^sha256:/, '')], { encoding: 'utf8', timeout: 300_000, shell: false });
        assert(r.status === 0, `the engines: ${r.stderr?.slice(-800)}`);
        const out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as Body;
        assert(out.duckdb_csv_rows === 1201 && out.duckdb_csv_sum === (1201 * 1202) / 2, `DuckDB CSV: ${r.stdout}`);
        assert(out.frictionless_path === 'data/items.csv' && out.duckdb_frictionless_rows === 1201, `DuckDB Frictionless: ${r.stdout}`);
        assert(out.pandas_pages === 3 && out.pandas_rows === 1201 && out.pandas_unique_ids === 1201, `pandas paging: ${r.stdout}`);
        assert(out.pandas_v1_rows === 1200, `pandas version: ${r.stdout}`);
    });

    console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`);
}

try { await run(); }
catch (err) { failed++; console.error(`  ❌ the suite stopped: ${(err as Error).message}`); }
finally { await stopAll(); }
process.exit(failed > 0 ? 1 : 0);
