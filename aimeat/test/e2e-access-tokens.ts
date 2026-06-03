// E2E: owner-created Personal Access Tokens for agents.
// Verifies plan 2026-06-03-agent-access-tokens (Phase 2: management CRUD + exchange).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=access-tokens

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Call { status: number; data: any }
async function api(path: string, opts: { method?: string; body?: any; bearer?: string } = {}): Promise<Call> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = 'Bearer ' + opts.bearer;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'POST', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}
function jwtRoles(jwt: string): string[] {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).roles || []; }
  catch { return []; }
}
async function registerAndLogin(username: string, password: string): Promise<string> {
  const reg = await api('/v1/ghii', { body: { username, display_name: username, password } });
  assert(reg.status === 201 && reg.data?.ok, `register ${username} failed: ${reg.status} ${reg.data?.error?.message}`);
  const login = await api('/v1/ghii/login', { body: { username, password } });
  assert(login.status === 200 && login.data?.ok, `login ${username} failed: ${login.status}`);
  return login.data.data.token;
}

// A browser-like request (Mozilla UA) that captures the aimeat_rt Set-Cookie and can resend it.
async function browserCall(path: string, opts: { method?: string; bearer?: string; cookie?: string; csrf?: boolean; body?: any } = {}): Promise<{ status: number; data: any; setRt: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (opts.bearer) headers.Authorization = 'Bearer ' + opts.bearer;
  if (opts.cookie) headers.Cookie = 'aimeat_rt=' + encodeURIComponent(opts.cookie);
  if (opts.csrf) headers['X-AIMEAT-Refresh'] = '1';
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  let setRt: string | null = null;
  const h: any = res.headers;
  const cookies: string[] = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean) as string[];
  for (const c of cookies) { const m = /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(c); if (m) setRt = decodeURIComponent(m[1]); }
  return { status: res.status, data, setRt };
}

async function main() {
  const stamp = Date.now();
  const userA = `pata${stamp}`;   // first owner → operator (self-heal on login)
  const userB = `patb${stamp}`;   // second owner → non-operator
  const pw = 'AccessT0ken#Pw';

  let jwtA = '', jwtB = '';

  console.log('\nPhase 0 — Owners');
  await test('register + login owner A (operator) and owner B (non-operator)', async () => {
    jwtA = await registerAndLogin(userA, pw); // logs in first → promoted to operator
    jwtB = await registerAndLogin(userB, pw);
  });

  console.log('\nPhase 1 — Scoped token + scope enforcement');
  let scopedToken = '';
  await test('owner B creates a scoped token (memory:read only)', async () => {
    const r = await api('/v1/access/tokens', {
      bearer: jwtB,
      body: { label: 'reader', scopes: ['memory:read'] },
    });
    assert(r.status === 201 && r.data?.ok, `create failed: ${r.status} ${r.data?.error?.message}`);
    assert(typeof r.data.data.token === 'string' && r.data.data.token.startsWith('aimeat_pat_'), 'should return a raw token once');
    assert(r.data.data.gaii.startsWith('apptester-'), 'scoped token should get a dedicated test GAII');
    scopedToken = r.data.data.token;
  });

  let scopedJwt = '';
  await test('exchange the scoped token → agent JWT with only its scopes', async () => {
    const r = await api('/v1/auth/token/exchange', { bearer: scopedToken });
    assert(r.status === 200 && r.data?.ok, `exchange failed: ${r.status} ${r.data?.error?.message}`);
    scopedJwt = r.data.data.access_token;
    const roles = jwtRoles(scopedJwt);
    assert(roles.includes('agent') && !roles.includes('owner'), `scoped JWT must be agent-only, got ${roles}`);
  });

  await test('scoped JWT can read (memory:read) but NOT write (memory:write denied)', async () => {
    const read = await api('/v1/memory', { method: 'GET', bearer: scopedJwt });
    assert(read.status === 200, `memory read should work, got ${read.status}`);
    const write = await api('/v1/memory', { bearer: scopedJwt, body: { key: 'x', value: { a: 1 }, visibility: 'private' } });
    assert(write.status === 403, `memory write should be denied (403), got ${write.status}`);
  });

  console.log('\nPhase 1b — direct PAT-as-Bearer (header auth, no exchange)');
  await test('the raw token used DIRECTLY as a Bearer header is recognized', async () => {
    // No exchange step — the middleware recognizes the token from the header.
    const read = await api('/v1/memory', { method: 'GET', bearer: scopedToken });
    assert(read.status === 200, `direct PAT read should work, got ${read.status}`);
    const write = await api('/v1/memory', { bearer: scopedToken, body: { key: 'y', value: { a: 2 }, visibility: 'private' } });
    assert(write.status === 403, `direct PAT write should be denied (scope enforced), got ${write.status}`);
  });

  console.log('\nPhase 2 — Full owner token');
  await test('owner token exchanges to an owner session that bypasses scopes', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'as-me', grant_owner: true } });
    assert(c.status === 201 && c.data?.ok, `create owner token failed: ${c.status}`);
    const ownerToken = c.data.data.token;
    const x = await api('/v1/auth/token/exchange', { bearer: ownerToken });
    assert(x.status === 200, `exchange failed: ${x.status}`);
    const roles = jwtRoles(x.data.data.access_token);
    assert(roles.includes('owner'), `owner token JWT must have owner role, got ${roles}`);
    // Owner bypasses scopes → memory write works via the exchanged JWT...
    const write = await api('/v1/memory', { bearer: x.data.data.access_token, body: { key: 'owner-test', value: { ok: true }, visibility: 'private' } });
    assert(write.status === 200 || write.status === 201, `owner memory write should work, got ${write.status}`);
    // ...and equally via the raw owner token used DIRECTLY as a Bearer header.
    const directWrite = await api('/v1/memory', { bearer: ownerToken, body: { key: 'owner-direct', value: { ok: true }, visibility: 'private' } });
    assert(directWrite.status === 200 || directWrite.status === 201, `direct owner token write should work, got ${directWrite.status}`);
  });

  console.log('\nPhase 3 — Operator gating');
  await test('non-operator owner CANNOT create an operator token (403)', async () => {
    const r = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'op', grant_operator: true } });
    assert(r.status === 403, `expected 403 for non-operator, got ${r.status}`);
  });
  await test('operator owner CAN create an operator token → JWT has operator', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtA, body: { label: 'op', grant_operator: true } });
    assert(c.status === 201 && c.data?.ok, `operator create failed: ${c.status} ${c.data?.error?.message}`);
    const x = await api('/v1/auth/token/exchange', { bearer: c.data.data.token });
    assert(x.status === 200, `exchange failed: ${x.status}`);
    const roles = jwtRoles(x.data.data.access_token);
    assert(roles.includes('owner') && roles.includes('operator'), `operator token JWT must have operator, got ${roles}`);
  });

  console.log('\nPhase 4 — List, revoke, expiry, auth');
  await test('list shows the owner tokens and never the raw token', async () => {
    const r = await api('/v1/access/tokens', { method: 'GET', bearer: jwtB });
    assert(r.status === 200 && r.data?.ok, `list failed: ${r.status}`);
    assert(r.data.data.tokens.length >= 2, 'owner B should have at least 2 tokens');
    assert(r.data.data.tokens.every((t: any) => !('token' in t)), 'list must not leak the raw token');
  });

  await test('revoking a token makes its exchange fail (401)', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'temp', scopes: ['memory:read'] } });
    const id = c.data.data.id, tok = c.data.data.token;
    const del = await api(`/v1/access/tokens/${id}`, { method: 'DELETE', bearer: jwtB });
    assert(del.status === 200 && del.data?.ok, `revoke failed: ${del.status}`);
    const x = await api('/v1/auth/token/exchange', { bearer: tok });
    assert(x.status === 401, `exchange after revoke should be 401, got ${x.status}`);
    // ...and the revoked token is rejected when used directly as a header too.
    const direct = await api('/v1/memory', { method: 'GET', bearer: tok });
    assert(direct.status === 401, `revoked token used directly should be 401, got ${direct.status}`);
  });

  await test('expired token is rejected at exchange', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'short', scopes: ['memory:read'], expires_in: 1 } });
    assert(c.status === 201, `create failed: ${c.status}`);
    await sleep(1200);
    const x = await api('/v1/auth/token/exchange', { bearer: c.data.data.token });
    assert(x.status === 401, `expired token exchange should be 401, got ${x.status}`);
    // Used directly as a header, an expired token is rejected too.
    const direct = await api('/v1/memory', { method: 'GET', bearer: c.data.data.token });
    assert(direct.status === 401, `expired token used directly should be 401, got ${direct.status}`);
  });

  await test('management requires owner auth; exchange rejects garbage tokens', async () => {
    const noauth = await api('/v1/access/tokens', { body: { label: 'x', scopes: ['memory:read'] } });
    assert(noauth.status === 401 || noauth.status === 403, `create without auth should be 401/403, got ${noauth.status}`);
    const bad = await api('/v1/auth/token/exchange', { bearer: 'aimeat_pat_not_a_real_token' });
    assert(bad.status === 401, `garbage exchange should be 401, got ${bad.status}`);
  });

  console.log('\nPhase 5 — Browser session cookie (owner token)');
  await test('owner token on a browser request sets aimeat_rt = the token; refreshes; revoke kills it', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'browser', grant_owner: true } });
    const ownerPat = c.data.data.token;
    // A browser request carrying the owner token gets the httpOnly cookie set to the token.
    const r = await browserCall('/v1/memory', { method: 'GET', bearer: ownerPat });
    assert(r.status === 200, `browser GET should work, got ${r.status}`);
    assert(r.setRt === ownerPat, 'should set the aimeat_rt cookie to the token');
    // The app boot then refreshes from that cookie into an owner token.
    const refresh = await browserCall('/v1/auth/refresh', { method: 'POST', cookie: ownerPat, csrf: true });
    assert(refresh.status === 200 && refresh.data?.ok, `cookie refresh should work, got ${refresh.status}`);
    assert(jwtRoles(refresh.data.data.token).includes('owner'), 'cookie refresh should yield an owner token');
    // Revoke → the cookie stops working immediately.
    const list = await api('/v1/access/tokens', { method: 'GET', bearer: jwtB });
    const id = list.data.data.tokens.find((t: any) => t.label === 'browser').id;
    await api(`/v1/access/tokens/${id}`, { method: 'DELETE', bearer: jwtB });
    const after = await browserCall('/v1/auth/refresh', { method: 'POST', cookie: ownerPat, csrf: true });
    assert(after.status === 401, `revoked PAT cookie refresh should be 401, got ${after.status}`);
  });

  await test('a scoped token on a browser request does NOT set a session cookie', async () => {
    const c = await api('/v1/access/tokens', { bearer: jwtB, body: { label: 'scoped-browser', scopes: ['memory:read'] } });
    const r = await browserCall('/v1/memory', { method: 'GET', bearer: c.data.data.token });
    assert(r.status === 200, `scoped browser GET should work, got ${r.status}`);
    assert(!r.setRt, 'scoped token must NOT set a browser session cookie');
  });

  console.log('\n─────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed === 0) console.log('✅ All tests passed!');
  process.exit(failed > 0 ? 1 : 0);
}

main();
