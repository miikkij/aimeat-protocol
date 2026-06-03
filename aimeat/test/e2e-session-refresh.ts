// E2E: owner session refresh tokens (httpOnly cookie, rotation, reuse-detection).
// Verifies plan 2026-06-03-owner-session-refresh-tokens.
// Server runs with AIMEAT_REFRESH_GRACE_MS=1500 (set by run-e2e-ci.ts) so the
// prev-token-after-grace reuse path is testable without a 60s wait.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=session-refresh

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Extract the aimeat_rt cookie value from a response's Set-Cookie header(s). */
function extractRt(res: Response): string | null {
    const h: any = res.headers;
    const cookies: string[] = typeof h.getSetCookie === 'function'
        ? h.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean) as string[];
    for (const c of cookies) {
        const m = /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(c);
        if (m) return decodeURIComponent(m[1]);
    }
    return null;
}

interface Call { status: number; data: any; rt: string | null }

async function call(path: string, opts: { method?: string; body?: any; cookie?: string; jwt?: string; csrf?: boolean } = {}): Promise<Call> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.cookie !== undefined) headers['Cookie'] = `aimeat_rt=${encodeURIComponent(opts.cookie)}`;
    if (opts.jwt) headers['Authorization'] = `Bearer ${opts.jwt}`;
    if (opts.csrf) headers['X-AIMEAT-Refresh'] = '1';
    const res = await fetch(`${BASE}${path}`, {
        method: opts.method ?? 'POST',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data, rt: extractRt(res) };
}

async function login(username: string, password: string): Promise<{ token: string; sessionId: string; rt: string; expiresIn: number }> {
    const r = await call('/v1/ghii/login', { body: { username, password } });
    assert(r.status === 200 && r.data?.ok, `login failed: ${r.status} ${r.data?.error?.message}`);
    assert(typeof r.data.data.token === 'string', 'login should return a token');
    assert(typeof r.data.data.session_id === 'string', 'login should return session_id');
    assert(!!r.rt, 'login should set the aimeat_rt cookie');
    return { token: r.data.data.token, sessionId: r.data.data.session_id, rt: r.rt!, expiresIn: r.data.data.expires_in };
}

async function main() {
    const username = `rt${Date.now()}`;
    const password = 'RefreshT0ken#Pw';

    console.log('\nPhase 0 — Setup');
    await test('register owner with password', async () => {
        const r = await call('/v1/ghii', { body: { username, display_name: 'Refresh Tester', password } });
        assert(r.status === 201 && r.data?.ok, `register failed: ${r.status} ${r.data?.error?.message}`);
    });

    console.log('\nPhase 1 — Login establishes a cookie session');
    let s = { token: '', sessionId: '', rt: '', expiresIn: 0 };
    await test('login sets aimeat_rt cookie + short access token', async () => {
        s = await login(username, password);
        assert(s.expiresIn > 0 && s.expiresIn <= 3600, `expires_in should be short, got ${s.expiresIn}`);
    });

    await test('access token works and session appears with device label', async () => {
        const r = await call('/v1/auth/sessions', { method: 'GET', jwt: s.token });
        assert(r.status === 200 && r.data?.ok, `sessions list failed: ${r.status}`);
        const mine = r.data.data.sessions.find((x: any) => x.session_id === s.sessionId);
        assert(!!mine, 'our session should be listed');
        assert(mine.current === true, 'our session should be marked current');
        assert(typeof mine.device_label === 'string' && mine.device_label.length > 0, 'session should have a device_label');
    });

    console.log('\nPhase 2 — Refresh rotation');
    await test('refresh rotates the cookie and issues a working token', async () => {
        const r = await call('/v1/auth/refresh', { cookie: s.rt, csrf: true });
        assert(r.status === 200 && r.data?.ok, `refresh failed: ${r.status} ${r.data?.error?.message}`);
        assert(typeof r.data.data.token === 'string', 'refresh should return a token');
        assert(!!r.rt && r.rt !== s.rt, 'refresh should set a NEW (rotated) cookie');
        // New token works
        const v = await call('/v1/auth/sessions', { method: 'GET', jwt: r.data.data.token });
        assert(v.status === 200 && v.data?.ok, 'refreshed access token should work');
        s.token = r.data.data.token;
        s.rt = r.rt!;
    });

    await test('refresh without X-AIMEAT-Refresh header is rejected (CSRF guard)', async () => {
        const r = await call('/v1/auth/refresh', { cookie: s.rt, csrf: false });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.data?.error?.code === 'CSRF_REQUIRED', `expected CSRF_REQUIRED, got ${r.data?.error?.code}`);
    });

    console.log('\nPhase 3 — Concurrency grace + reuse detection');
    await test('previous token within grace window still works (no false theft)', async () => {
        const fresh = await login(username, password);
        const rotated = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        assert(rotated.status === 200, `rotate failed: ${rotated.status}`);
        // Immediately present the PREVIOUS token (within the 1.5s grace) — should succeed.
        const prev = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        assert(prev.status === 200 && prev.data?.ok, `prev-within-grace should succeed, got ${prev.status} ${prev.data?.error?.code}`);
    });

    await test('previous token after grace triggers reuse-detection and revokes the family', async () => {
        const fresh = await login(username, password);
        const rotated = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        assert(rotated.status === 200 && !!rotated.rt, 'rotate should succeed');
        const currentRt = rotated.rt!;
        await sleep(1800); // exceed the 1.5s test grace
        // Replay the now-stale PREVIOUS token → reuse detected → session revoked.
        const reuse = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        assert(reuse.status === 401, `reuse replay should be 401, got ${reuse.status}`);
        assert(reuse.data?.error?.code === 'SESSION_REVOKED', `expected SESSION_REVOKED, got ${reuse.data?.error?.code}`);
        // The whole family is dead: even the current token no longer refreshes.
        const after = await call('/v1/auth/refresh', { cookie: currentRt, csrf: true });
        assert(after.status === 401, `current token should be dead after reuse-revoke, got ${after.status}`);
    });

    await test('two-generations-old token is rejected', async () => {
        const fresh = await login(username, password);
        const r1 = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        await call('/v1/auth/refresh', { cookie: r1.rt!, csrf: true }); // rotate again
        // fresh.rt is now 2 generations old — neither current nor prev.
        const stale = await call('/v1/auth/refresh', { cookie: fresh.rt, csrf: true });
        assert(stale.status === 401, `2-gen-old token should be 401, got ${stale.status}`);
    });

    console.log('\nPhase 4 — Cross-device independence (the original bug)');
    await test('logging in on device B does NOT break device A refresh', async () => {
        const a = await login(username, password); // device A
        const b = await login(username, password); // device B (second login)
        // A refreshes fine despite B's later login.
        const a1 = await call('/v1/auth/refresh', { cookie: a.rt, csrf: true });
        assert(a1.status === 200, `device A refresh should work, got ${a1.status}`);
        // B refreshes fine too.
        const b1 = await call('/v1/auth/refresh', { cookie: b.rt, csrf: true });
        assert(b1.status === 200, `device B refresh should work, got ${b1.status}`);
        // A keeps refreshing — fully independent sessions.
        const a2 = await call('/v1/auth/refresh', { cookie: a1.rt!, csrf: true });
        assert(a2.status === 200, `device A second refresh should work, got ${a2.status}`);
    });

    console.log('\nPhase 5 — Logout & session management');
    await test('logout (revoke) kills the session and clears the cookie', async () => {
        const l = await login(username, password);
        const rev = await call('/v1/auth/revoke', { cookie: l.rt, jwt: l.token });
        assert(rev.status === 200 && rev.data?.ok, `revoke failed: ${rev.status}`);
        assert(rev.rt === '' || rev.rt === null, 'revoke should clear the cookie');
        const after = await call('/v1/auth/refresh', { cookie: l.rt, csrf: true });
        assert(after.status === 401, `refresh after logout should be 401, got ${after.status}`);
    });

    await test('DELETE /v1/auth/sessions/:id revokes a session', async () => {
        const l = await login(username, password);
        const del = await call(`/v1/auth/sessions/${l.sessionId}`, { method: 'DELETE', jwt: l.token, cookie: l.rt });
        assert(del.status === 200 && del.data?.ok, `delete session failed: ${del.status}`);
        const after = await call('/v1/auth/refresh', { cookie: l.rt, csrf: true });
        assert(after.status === 401, `refresh after session delete should be 401, got ${after.status}`);
    });

    console.log('\nPhase 6 — Legacy Bearer refresh still works');
    await test('refresh with Bearer and no cookie falls back to legacy path', async () => {
        const l = await login(username, password);
        const r = await call('/v1/auth/refresh', { jwt: l.token }); // no cookie, no csrf
        assert(r.status === 200 && r.data?.ok, `legacy bearer refresh should work, got ${r.status} ${r.data?.error?.message}`);
        assert(typeof r.data.data.token === 'string', 'legacy refresh should return a token');
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
