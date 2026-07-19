/**
 * @file e2e-appdev-proofs.ts
 * @description E2E for self-reported acceleration proofs (AppDev KB Phase 8):
 *   aimeat_appdev_proof_attach on a community library pack (owner-only, append-only,
 *   duplicate rejected, surfaces on /v1/library-packs index + detail with
 *   self_reported: true + proven_models, never upgrading the preview status) and on an
 *   app-template proposal (proofs array + count in list; proofs survive a re-propose).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=appdev-proofs).
 * @version-history v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 8).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const messages: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { messages.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return messages;
}

class McpSession {
    token = '';
    sessionId = '';
    private nextId = 1;

    async rpc(method: string, params: Record<string, any> = {}) {
        const id = this.nextId++;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                ...(this.sessionId ? { 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        let body: any;
        if (ct.includes('text/event-stream')) {
            const messages = parseSSE(await res.text());
            body = messages.find(m => m.id === id) ?? messages[0] ?? {};
        } else {
            body = await res.json() as any;
        }
        return { status: res.status, body };
    }

    async call(name: string, args: Record<string, any>) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        return body;
    }
}

async function setupOwnerAgentSession(ownerName: string, agentName: string): Promise<{ session: McpSession; ownerToken: string }> {
    const { status: gs, body: gb } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: ownerName, password: 'ProofKb1!' }),
    });
    assert(gs === 201, `ghii ${gs}`);
    const ts1 = new Date().toISOString();
    const { body: tb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts1, signature: await signMsg(gb.data.private_key, ownerName + NODE_ID + ts1) }),
    });
    const ownerToken = tb.data.token;
    const { status: as, body: ab } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['appdev'] }),
    });
    assert(as === 201, `agent ${as}`);
    const { body: reg } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `${ownerName} proof client`, redirect_uris: [] }),
    });
    const ts2 = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: ab.data.agent.gaii,
        signature: await signMsg(ab.data.private_key, ab.data.agent.gaii + NODE_ID + ts2), timestamp: ts2,
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret }),
    });
    const session = new McpSession();
    session.token = tok.access_token;
    await session.rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'AppDev Proofs E2E', version: '1.0.0' },
    });
    return { session, ownerToken };
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

console.log('\n=== AIMEAT AppDev Proofs E2E Test ===\n');

const stamp = Date.now().toString().slice(-7);
const ownerA = `pfrowna${stamp}`;
const ownerB = `pfrownb${stamp}`;
const extName = `${ownerA}-proofs-lib`;
let A: McpSession;
let B: McpSession;
let tokenA = '';

await test('Setup: owners + agents; A publishes a public community cortex lib', async () => {
    ({ session: A, ownerToken: tokenA } = await setupOwnerAgentSession(ownerA, 'pfragenta'));
    ({ session: B } = await setupOwnerAgentSession(ownerB, 'pfragentb'));
    const manifest = [
        'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${extName}`,
        `  namespace: ${ownerA}`, '  description: "Proof-carrying community lib"', '  author: e2e',
        '  visibility: public', '  tags: [ui]',
        'spec:', '  version: "1.0.0"', '  license: MIT', '  components:',
        '    - type: prompt', '      name: doc', '      content: |', '        API: AIMEAT.prooflib.go()',
        '    - type: lib', `      name: ${extName}`, `      filename: ${extName}.js`,
        '      exports: [go]', '      api_surface: |', '        AIMEAT.prooflib.go()',
    ].join('\n');
    const { status: inst } = await json('/v1/cortex', {
        method: 'POST', headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ manifest, libs: { [`${extName}.js`]: '(function(A){A.prooflib={go:function(){}};})(window.AIMEAT=window.AIMEAT||{});' } }),
    });
    assert(inst === 201, `cortex install ${inst}`);
    const { status: act } = await json(`/v1/cortex/${extName}/activate`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
    assert(act === 200 || act === 201, `activate ${act}`);
});

await test('proof attach on the community pack (owner) succeeds', async () => {
    const body = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'library_pack', subject_id: extName,
        model: 'Claude-Haiku-4.5', verdict: 'pass',
        evidence: 'https://example.com/run-1', test_set: 'aeb-mini-1', tokens: 12000,
    });
    assert(!body.result?.isError, `attach failed: ${JSON.stringify(body).slice(0, 250)}`);
    const out = JSON.parse(body.result.content[0].text);
    assert(out.attached === true && out.proofs_total === 1 && out.self_reported === true, JSON.stringify(out));
});

await test('duplicate proof (same model+test_set+date) rejected; a second model appends', async () => {
    const dup = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'library_pack', subject_id: extName,
        model: 'claude-haiku-4.5', verdict: 'pass', evidence: 'https://example.com/run-1b', test_set: 'aeb-mini-1',
    });
    assert(dup.result?.isError === true, 'duplicate accepted');
    const second = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'library_pack', subject_id: extName,
        model: 'kimi-k2.6', verdict: 'fail', evidence: 'https://example.com/run-2', test_set: 'aeb-mini-1',
    });
    assert(JSON.parse(second.result.content[0].text).proofs_total === 2, 'second model not appended');
});

await test('non-owner attach rejected', async () => {
    const body = await B.call('aimeat_appdev_proof_attach', {
        subject_type: 'library_pack', subject_id: extName,
        model: 'claude-haiku-4.5', verdict: 'pass', evidence: 'https://example.com/spoof',
    });
    assert(body.result?.isError === true, 'non-owner attach accepted');
});

await test('/v1/library-packs surfaces proofs on the community entry (status stays preview)', async () => {
    const { body } = await json(`/v1/library-packs?scope=community`);
    const entry = (body.data?.packs ?? []).find((p: any) => p.id === extName);
    assert(!!entry, 'community entry missing');
    assert(entry.status === 'preview', 'self-reported proofs must NOT upgrade the vetting status');
    assert(Array.isArray(entry.proofs) && entry.proofs.length === 2, `proofs missing: ${JSON.stringify(entry.proofs)}`);
    assert(entry.self_reported === true, 'self_reported flag missing');
    assert(entry.proven_models.length === 1 && entry.proven_models[0] === 'claude-haiku-4.5', `proven_models wrong: ${JSON.stringify(entry.proven_models)}`);
    assert(entry.proofs.every((p: any) => p.selfReported === true), 'per-proof selfReported flag missing');

    const { body: det } = await json(`/v1/library-packs/${extName}`);
    assert(Array.isArray(det.data?.pack?.proofs) && det.data.pack.proofs.length === 2, 'detail proofs missing');
});

await test('template proposal proofs: attach + survive a re-propose', async () => {
    const { status } = await json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
            filename: 'proof-demo.html',
            content: b64('<!doctype html><meta name="aimeat-app" content="proof-demo.html"><h1>x</h1>'),
            name: 'Proof Demo', description: 'template proof source', category: 'utility',
        }),
    });
    assert(status === 201, `app publish ${status}`);
    const prop = await A.call('aimeat_app_template_propose', {
        id: 'proof-template', title: 'Proof-carrying template', description: 'demonstrates proof attach',
        derived_from: { owner: ownerA, filename: 'proof-demo.html' }, tier: 'T1',
        reuse_notes: 'The pattern generalizes to any single-view app with a header.',
        model: 'claude-haiku-4.5',
    });
    assert(!prop.result?.isError, `propose failed: ${JSON.stringify(prop).slice(0, 200)}`);

    const attach = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'app_template', subject_id: 'proof-template',
        model: 'claude-haiku-4.5', verdict: 'pass', evidence: 'memory://aeb/run-3',
    });
    assert(!attach.result?.isError, `template attach failed: ${JSON.stringify(attach).slice(0, 200)}`);

    const list = await A.call('aimeat_app_template_list', {});
    const entry = JSON.parse(list.result.content[0].text).templates.find((t: any) => t.id === 'proof-template');
    assert(entry.proofs === 1, `proof count wrong: ${entry.proofs}`);

    // Proofs attach to the proposal id — a re-propose (better wording) keeps them.
    await A.call('aimeat_app_template_propose', {
        id: 'proof-template', title: 'Proof-carrying template v2', description: 'better wording',
        derived_from: { owner: ownerA, filename: 'proof-demo.html' }, tier: 'T1',
        reuse_notes: 'The improved pattern generalizes to any single-view app.',
        model: 'claude-haiku-4.5',
    });
    const get = await A.call('aimeat_app_template_get', { id: 'proof-template' });
    const g = JSON.parse(get.result.content[0].text);
    assert(Array.isArray(g.proofs) && g.proofs.length === 1, 'proofs lost on re-propose');
});

await test('unknown subjects error cleanly', async () => {
    const pack = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'library_pack', subject_id: 'no-such-pack-xyz',
        model: 'claude-haiku-4.5', verdict: 'pass', evidence: 'x://y',
    });
    assert(pack.result?.isError === true, 'unknown pack accepted');
    const tpl = await A.call('aimeat_appdev_proof_attach', {
        subject_type: 'app_template', subject_id: 'no-such-template',
        model: 'claude-haiku-4.5', verdict: 'pass', evidence: 'x://y',
    });
    assert(tpl.result?.isError === true, 'unknown template accepted');
});

console.log('\n' + '─'.repeat(40));
console.log(`AppDev proofs E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All appdev-proof tests passed!\n');
