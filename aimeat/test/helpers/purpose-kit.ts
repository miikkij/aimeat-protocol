/**
 * @file test/helpers/purpose-kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The few things every purpose suite (test/e2e-purpose-*.ts) does the same way: count
 *   and print its tests, call the node, install and switch on an extension, mint an app grant for a
 *   freshly published app, and stand up a receiver that records what reached it.
 *
 *   A purpose suite proves that a designed use of AIMEAT still works end to end
 *   (.claude/skills/security-audit/AIMEAT-PURPOSE.md). It is short and names the use in each
 *   title; this file keeps the plumbing out of the way of that sentence.
 * @structure Harness (test, assert, finish) · Node calls (json, auth) · installExtension ·
 *   appGrantToken, appGrant · startReceiver
 * @usage
 *   const h = harness('Purpose: extensions are a service');
 *   await h.test('B calls A\'s action and gets the answer', async () => { ... });
 *   h.finish();
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
export const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

/** One suite's counters and its test function. */
export interface Harness {
    test(name: string, fn: () => Promise<void>): Promise<void>;
    /** Print the total and exit with 1 when anything failed. */
    finish(): never;
}

export function harness(title: string): Harness {
    let passed = 0, failed = 0;
    console.log(`\n=== ${title} ===\n`);
    return {
        async test(name, fn) {
            try { await fn(); passed++; console.log(`  ✅ ${name}`); }
            catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
        },
        finish() {
            console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
            process.exit(failed > 0 ? 1 : 0);
        },
    };
}

export function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** One call. The body is parsed JSON when the answer is JSON, else `{ _raw }`. A 429 is waited out. */
export async function json(path: string, opts: RequestInit = {}, base = BASE): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
        const text = await res.text();
        if (res.status === 429 && attempt < 6) { await sleep(Number(res.headers.get('Retry-After') || '1') * 1000 + 300); continue; }
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body, headers: res.headers };
    }
}

/** Install an extension as `token` and switch it on; throws with the refusal when either fails. */
export async function installExtension(token: string, name: string, manifest: string, scripts: Record<string, string>, base = BASE): Promise<void> {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(token), body: JSON.stringify({ manifest, scripts }) }, base);
    assert(inst.status === 201, `install ${name}: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(token) }, base);
    assert(act.status === 200, `activate ${name}: ${act.status} ${JSON.stringify(act.body?.error)}`);
}

/**
 * Publish `html` as an app of `owner` and sign it in through the app-grant flow the browser uses
 * (authorize, the owner's consent, the code exchange with PKCE). Answers the app's own access token.
 */
export async function appGrantToken(owner: { name: string; token: string }, filename: string, scope: string, html: string, base = BASE): Promise<string> {
    return (await appGrant(owner, filename, scope, html, base)).token;
}

/** appGrantToken with the refresh token too, for a test that renews the app's session. */
export async function appGrant(owner: { name: string; token: string }, filename: string, scope: string, html: string, base = BASE): Promise<{ token: string; refresh: string }> {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), name: `Purpose ${filename}`, description: 'purpose e2e', category: 'utility' }),
    }, base);
    assert(pub.status === 201, `publish ${filename}: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const redirect = 'http://localhost:9913/purpose-callback';
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${base}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!m, `consent redirect expected for ${filename}, got ${res.status}`);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }) }, base);
    assert(con.status === 200, `consent ${filename}: ${con.status} ${JSON.stringify(con.body?.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) }, base);
    assert(tok.body?.ok === true, `app token ${filename}: ${JSON.stringify(tok.body?.error)}`);
    return { token: tok.body.data.access_token as string, refresh: tok.body.data.refresh_token as string };
}

/** A receiver on 127.0.0.1 that records the path and the X-Api-Key header of every request. */
export interface Receiver {
    url: string;
    host: string;
    deliveries: Array<{ url: string; key: string | undefined }>;
    arrived(path: string): Array<{ url: string; key: string | undefined }>;
    stop(): Promise<void>;
}

export async function startReceiver(port: number): Promise<Receiver> {
    const deliveries: Receiver['deliveries'] = [];
    const server: Server = createServer((req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
            deliveries.push({ url: req.url ?? '/', key: req.headers['x-api-key'] as string | undefined });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"received":true}');
        });
    });
    await new Promise<void>((resolve, reject) => { server.on('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
    return {
        url: `http://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        deliveries,
        arrived: (path: string) => deliveries.filter(d => d.url === path),
        stop: () => new Promise<void>(resolve => server.close(() => resolve())),
    };
}
