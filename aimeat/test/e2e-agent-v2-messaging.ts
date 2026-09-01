/**
 * @file test/e2e-agent-v2-messaging.ts
 * @description Agent v2 V4: a turn between two principals of one account, and the delivery target
 *   that reaches one which is not connected.
 *
 *   HALF THIS SUITE IS ABOUT THE FIVE MESSAGE KINDS THAT ALREADY EXISTED. The whole programme's
 *   rule is that nothing existing changes, and the only way to hold that is to assert it: the
 *   agent↔owner dashboard thread, the federated direct message and the notification are exercised
 *   here after the new path has been used, and answer exactly what they answered before.
 *
 *   THE WEBHOOK IS A REAL SERVER. The delivery target is the one thing in V4 that reaches outward,
 *   so the test starts an HTTP listener on loopback, registers it, sends a turn and reads what
 *   actually arrived — the envelope, the echoed token, the Authorization header. A mock would prove
 *   the intent and not the delivery, and the interesting question here is what leaves the node.
 *
 *   THE REFUSALS: a principal on another account cannot be addressed, an agent cannot register a
 *   delivery target for a sibling, cannot delete one, cannot claim an id it does not hold, and the
 *   stored credentials never come back out of any read.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-messaging
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the feature.
 */
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `v4${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV4Pass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV4Pass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}` };
}

async function addAgent(owner: string, ownerToken: string, name: string, scopes: string[] = ['*']) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

/** One POST this node made, as it arrived. */
interface Received { headers: Record<string, string | undefined>; body: any }

/** A real listener on loopback: the delivery target, so the test reads what actually left. */
function startWebhook(): Promise<{ url: string; received: Received[]; stop: () => Promise<void>; server: Server }> {
    const received: Received[] = [];
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c as Buffer));
            req.on('end', () => {
                let body: any = null;
                try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { body = null; }
                received.push({ headers: req.headers as Record<string, string | undefined>, body });
                res.writeHead(204).end();
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}/hook`,
                received,
                server,
                stop: () => new Promise<void>(done => server.close(() => done())),
            });
        });
    });
}

/** Deliveries are fired without being awaited, so a read has to give them a moment. */
async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return cond();
}

async function run(): Promise<void> {
    console.log('\n🧪 Agent v2 V4 — the turn, and the target that reaches an absent principal\n');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };

    const editor = await addAgent(a.owner, a.ownerToken, 'editor');
    const worker = await addAgent(a.owner, a.ownerToken, 'worker');
    const stranger = await addAgent(b.owner, b.ownerToken, 'stranger');
    const authEditor = { Authorization: `Bearer ${editor.token}` };
    const authWorker = { Authorization: `Bearer ${worker.token}` };

    let contextId = '';
    let firstMessageId = '';

    // ── 1. The turn ───────────────────────────────────────────────────────────

    await test('one turn carries text, a file pointer and a structured payload together', async () => {
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({
                to: worker.gaii,
                parts: [
                    { kind: 'text', text: 'Here is the draft and the numbers behind it.' },
                    { kind: 'file', file: { uri: 'https://example.test/draft.md', name: 'draft.md', mimeType: 'text/markdown' } },
                    { kind: 'data', data: { rows: 3, total: 42 } },
                ],
            }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const m = r.body.data.message;
        assert(m.parts.length === 3, `all three parts should survive, got ${m.parts.length}`);
        assert(m.role === 'user', `an omitted role reads as user, got ${m.role}`);
        assert(m.from === editor.gaii, `the sender is resolved from the credential, got ${m.from}`);
        assert(m.to === worker.gaii, 'and the recipient is what was asked for');
        // A first turn with no context names itself, so a caller need not invent one before it
        // knows the send will be accepted at all.
        assert(m.contextId === m.messageId, `a first turn should name itself, got ${m.contextId}`);
        contextId = m.contextId;
        firstMessageId = m.messageId;
    });

    await test('the recipient reads it back, and a second turn joins the same exchange', async () => {
        const reply = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ to: editor.gaii, role: 'agent', contextId, parts: [{ kind: 'text', text: 'Got it.' }] }),
        });
        assert(reply.status === 201, `expected 201, got ${reply.status}`);
        assert(reply.body.data.message.contextId === contextId, 'the reply stays in the exchange');

        const r = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(contextId)}`, { headers: authWorker });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const list = r.body.data.messages as any[];
        assert(list.length === 2, `two turns in the exchange, got ${list.length}`);
        assert(list[0].messageId === firstMessageId, 'oldest first, so a reader appends');
        assert(list[1].role === 'agent', 'and the answer is marked as an answer');
    });

    await test('since is the catch-up read: everything that arrived after a moment', async () => {
        const mark = new Date().toISOString();
        await new Promise(r => setTimeout(r, 1100));
        await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: worker.gaii, contextId, parts: [{ kind: 'text', text: 'One more.' }] }),
        });
        const r = await json(`/v1/agents/v2/messages?since=${encodeURIComponent(mark)}&to=${encodeURIComponent(worker.gaii)}`, { headers: authWorker });
        const list = r.body.data.messages as any[];
        assert(list.length === 1, `only what came after the mark, got ${list.length}`);
        assert(list[0].parts[0].text === 'One more.', 'and it is the right one');
    });

    await test('the owner can address their own agent, and their agent can address them', async () => {
        const down = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authA,
            body: JSON.stringify({ to: editor.gaii, parts: [{ kind: 'text', text: 'From the account holder.' }] }),
        });
        assert(down.status === 201, `owner→agent ${down.status}: ${JSON.stringify(down.body?.error)}`);
        assert(down.body.data.message.from === a.ghii, `an owner session resolves to the GHII, got ${down.body.data.message.from}`);

        const up = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: a.ghii, role: 'agent', parts: [{ kind: 'text', text: 'To the account holder.' }] }),
        });
        assert(up.status === 201, `agent→owner ${up.status}: ${JSON.stringify(up.body?.error)}`);
    });

    // ── 2. What it refuses ────────────────────────────────────────────────────

    await test('a principal on another account cannot be addressed, and is not confirmed to exist', async () => {
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: stranger.gaii, parts: [{ kind: 'text', text: 'hello' }] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        // 403 rather than 404 on purpose: answering "no such thing" for another account's principal
        // and "no such thing" for a name nobody holds tells them apart, one guess at a time.
        const ghost = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: `nobody#${b.owner}@${NODE_ID}`, parts: [{ kind: 'text', text: 'hello' }] }),
        });
        assert(ghost.status === 403, `a name on another account is the same answer, got ${ghost.status}`);
    });

    await test('a turn addressed to an agent nobody created is refused, not accepted', async () => {
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: `ghost#${a.owner}@${NODE_ID}`, parts: [{ kind: 'text', text: 'hello' }] }),
        });
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    await test('a malformed turn comes back with EVERY defect, not the first', async () => {
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({
                to: worker.gaii, role: 'shouting',
                parts: [{ kind: 'text' }, { kind: 'file', file: { name: 'x' } }, { kind: 'nonsense' }],
            }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        const fields = (r.body.error.details.defects as any[]).map(d => d.field);
        assert(fields.includes('role'), `the role should be named, got ${JSON.stringify(fields)}`);
        assert(fields.includes('parts[0].text'), 'the missing text should be named');
        assert(fields.includes('parts[1].file.uri'), 'the missing uri should be named');
        assert(fields.includes('parts[2].kind'), 'and the unknown kind');
    });

    await test('another account cannot read this one\'s turns', async () => {
        const r = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(contextId)}`, { headers: authB });
        assert(r.status === 200, `the listing itself is fine, got ${r.status}`);
        assert((r.body.data.messages as any[]).length === 0, 'it just has nothing of ours in it');
        const one = await json(`/v1/agents/v2/messages/${encodeURIComponent(firstMessageId)}`, { headers: authB });
        assert(one.status === 404, `and a turn by id is not readable either, got ${one.status}`);
    });

    // ── 3. The delivery target, against a real listener ───────────────────────

    const hook = await startWebhook();
    let configId = '';

    await test('a delivery target is registered, and the credentials never come back out', async () => {
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authWorker,
            body: JSON.stringify({
                url: hook.url,
                token: 'echo-me-back',
                authentication: { schemes: ['Bearer'], credentials: 'the-secret' },
            }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const c = r.body.data.push_config;
        configId = c.id;
        assert(c.principal === worker.gaii, 'registered for the caller by default');
        assert(c.token === 'echo-me-back', 'the token comes back, because it is the receiver\'s own string');
        assert(c.authentication.schemes[0] === 'Bearer', 'and the schemes, so a person can see what is set');
        const flat = JSON.stringify(r.body);
        assert(!flat.includes('the-secret'), 'but the credentials are nowhere in the answer');

        const list = await json('/v1/agents/v2/push-config', { headers: authWorker });
        assert(!JSON.stringify(list.body).includes('the-secret'), 'nor in the listing');
    });

    await test('a turn for an absent principal is POSTed to its target, with the token and the header', async () => {
        const before = hook.received.length;
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: worker.gaii, contextId, parts: [{ kind: 'text', text: 'Delivered out.' }] }),
        });
        assert(r.status === 201, `send ${r.status}`);
        const arrived = await waitFor(() => hook.received.length > before);
        assert(arrived, 'the node should have POSTed to the registered target');

        const got = hook.received[hook.received.length - 1];
        assert(got.body?.spec === 'aimeat.message/v1', `the envelope names itself, got ${got.body?.spec}`);
        assert(got.body?.message?.parts?.[0]?.text === 'Delivered out.', 'and carries the turn');
        assert(got.body?.token === 'echo-me-back', 'the receiver\'s own string is echoed back to it');
        assert(got.headers.authorization === 'Bearer the-secret',
            `the stored secret leaves only here, got ${got.headers.authorization}`);
    });

    await test('the target records that it was reached', async () => {
        const ok = await waitFor(async () => true, 0) && await (async () => {
            const r = await json('/v1/agents/v2/push-config', { headers: authWorker });
            const c = (r.body.data.push_configs as any[]).find(x => x.id === configId);
            return !!c?.last_success_at && c.fail_count === 0;
        })();
        assert(ok, 'a success should be on the record, with the failure count clear');
    });

    await test('replacing a target keeps its id and clears the credentials that were not sent again', async () => {
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authWorker,
            body: JSON.stringify({ id: configId, url: hook.url, token: 'second-token' }),
        });
        assert(r.status === 200, `a replace is 200, not 201, got ${r.status}`);
        assert(r.body.data.push_config.id === configId, 'and keeps the id');
        assert(r.body.data.push_config.authentication === null, 'the schemes are gone with the secret');

        const before = hook.received.length;
        await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: worker.gaii, contextId, parts: [{ kind: 'text', text: 'After the replace.' }] }),
        });
        assert(await waitFor(() => hook.received.length > before), 'it still delivers');
        const got = hook.received[hook.received.length - 1];
        assert(got.headers.authorization === undefined,
            `and sends no Authorization now, got ${got.headers.authorization}`);
        assert(got.body?.token === 'second-token', 'with the new token');
    });

    await test('an agent cannot register a delivery target for a sibling', async () => {
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authEditor,
            body: JSON.stringify({ url: hook.url, principal: worker.gaii }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('the account holder can, which is how an agent that is not running yet gets one', async () => {
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authA,
            body: JSON.stringify({ url: hook.url, principal: editor.gaii }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.push_config.principal === editor.gaii, 'and it belongs to the agent that was named');
    });

    await test('an agent sees only its own targets; the account holder sees the account\'s', async () => {
        const mine = await json('/v1/agents/v2/push-config', { headers: authWorker });
        const ids = (mine.body.data.push_configs as any[]).map(c => c.principal);
        assert(ids.every(p => p === worker.gaii), `an agent sees its own, got ${JSON.stringify(ids)}`);

        // Naming somebody else is not refused, it is simply not a question this door answers for an
        // agent: it gets its own back.
        const asked = await json(`/v1/agents/v2/push-config?principal=${encodeURIComponent(editor.gaii)}`, { headers: authWorker });
        assert((asked.body.data.push_configs as any[]).every(c => c.principal === worker.gaii),
            'asking for a sibling\'s targets returns its own, not theirs');

        const all = await json('/v1/agents/v2/push-config', { headers: authA });
        const principals = new Set((all.body.data.push_configs as any[]).map(c => c.principal));
        assert(principals.has(worker.gaii) && principals.has(editor.gaii),
            `the account holder sees both, got ${JSON.stringify([...principals])}`);
    });

    await test('an id that is not already this account\'s is refused, not turned into a new target', async () => {
        // The store upserts on the id alone. Accepting an unknown one would let a caller overwrite
        // another account's delivery target — a cross-owner write dressed as a configuration change.
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authWorker,
            body: JSON.stringify({ id: 'a4d2b0e6-0000-4000-8000-000000000000', url: hook.url }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
    });

    await test('another account cannot overwrite a target by naming its id', async () => {
        const r = await json('/v1/agents/v2/push-config', {
            method: 'PUT', headers: authB,
            body: JSON.stringify({ id: configId, url: 'https://attacker.example.test/hook' }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        const still = await json('/v1/agents/v2/push-config', { headers: authWorker });
        const c = (still.body.data.push_configs as any[]).find(x => x.id === configId);
        assert(c?.url === hook.url, `and the target is untouched, got ${c?.url}`);
    });

    await test('an agent cannot delete a sibling\'s target, and can delete its own', async () => {
        const nope = await json(`/v1/agents/v2/push-config/${encodeURIComponent(configId)}`, { method: 'DELETE', headers: authEditor });
        assert(nope.status === 403, `expected 403, got ${nope.status}`);
        const yes = await json(`/v1/agents/v2/push-config/${encodeURIComponent(configId)}`, { method: 'DELETE', headers: authWorker });
        assert(yes.status === 200, `expected 200, got ${yes.status}`);
        const after = await json('/v1/agents/v2/push-config', { headers: authWorker });
        assert(!(after.body.data.push_configs as any[]).some(c => c.id === configId), 'and it is gone');
    });

    await test('with no target registered the turn is still stored and still readable', async () => {
        const before = hook.received.length;
        const r = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: worker.gaii, contextId, parts: [{ kind: 'text', text: 'Nobody listening.' }] }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}`);
        await new Promise(res => setTimeout(res, 500));
        assert(hook.received.length === before, 'and nothing was POSTed anywhere');
        const read = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(contextId)}&limit=200`, { headers: authWorker });
        assert((read.body.data.messages as any[]).some(m => m.parts[0]?.text === 'Nobody listening.'),
            'the turn is there to be caught up on');
    });

    await hook.stop();

    // ── 4. The five that already existed, unchanged ───────────────────────────

    await test('the agent↔owner dashboard thread answers exactly what it answered before', async () => {
        const send = await json(`/v1/agents/${editor.name}/messages`, {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ content: 'A dashboard message.', direction: 'outbound' }),
        });
        assert(send.status === 200 || send.status === 201, `dashboard send ${send.status}: ${JSON.stringify(send.body?.error)}`);
        const inbox = await json(`/v1/agents/${editor.name}/messages`, { headers: authA });
        assert(inbox.status === 200, `dashboard read ${inbox.status}`);
        const items = (inbox.body.data.messages ?? inbox.body.data) as any[];
        assert(Array.isArray(items) && items.some(m => m.content === 'A dashboard message.'),
            'the message is in the thread it has always been in');
        // And the v2 turns are NOT in it. Two message kinds, two stores, no leakage between them.
        assert(!items.some(m => m.content === 'Nobody listening.'),
            'and no v2 turn has leaked into it');
    });

    await test('a federated direct message still goes to a person, and reads back where it always did', async () => {
        const dm = await json('/v1/messages', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ to: a.ghii, body: 'A direct message.' }),
        });
        assert(dm.status === 200 || dm.status === 201, `dm ${dm.status}: ${JSON.stringify(dm.body?.error)}`);
        const inbox = await json('/v1/messages/inbox', { headers: authA });
        assert(inbox.status === 200, `dm inbox ${inbox.status}`);
        const flat = JSON.stringify(inbox.body);
        assert(flat.includes('A direct message.'), 'the DM is in the DM inbox');
        assert(!flat.includes('Nobody listening.'), 'and no v2 turn is');
    });

    await test('a notification still reaches the owner, and the bell shows only notifications', async () => {
        const n = await json('/v1/notifications', {
            method: 'POST', headers: authEditor,
            body: JSON.stringify({ title: 'A notification.', body: 'Still the same channel.' }),
        });
        assert(n.status === 200 || n.status === 201, `notify ${n.status}: ${JSON.stringify(n.body?.error)}`);
        const bell = await json('/v1/notifications', { headers: authA });
        assert(bell.status === 200, `bell ${bell.status}`);
        const flat = JSON.stringify(bell.body);
        assert(flat.includes('A notification.'), 'the notification is on the bell');
        assert(!flat.includes('Delivered out.'), 'and no v2 turn is');
    });

    await test('the agent listing and its credential reading are untouched by any of this', async () => {
        const r = await json('/v1/agents?include=credentials', { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const list = r.body.data.agents as any[];
        assert(list.some(x => x.name === 'editor') && list.some(x => x.name === 'worker'), 'both agents are listed');
        assert(list.every(x => x.credential && typeof x.credential.state === 'string'),
            'and every one still reads its credential state');
    });

}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
