/**
 * @file test/e2e-secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares and secret requests over REST (src/routes/vault/secret-shares.ts, services in
 *   src/services/secret-shares/): a request filled by a named depositor or by the link's token, a share
 *   picked up by a named person, an organism's member, a code holder or an agent the maker allowed, the
 *   protections (sealed refuses an agent the content and lets it copy into the owner's vault), the
 *   retentions (once, count, until, keep), revoke, the pickup code's lockout, the device keys of
 *   end-to-end shares, the validation refusals, and the MCP list tool against the REST list.
 *
 *   What it holds: secrets:share is outside the wildcard, so an agent with `*` alone is refused; a
 *   stranger gets 404 on every route of a share that does not name them; GET /v1/secrets never carries
 *   a value; a share whose pickups or time ran out answers 410.
 *
 *   The code lockout counts wrong codes per share AND per address (pickup.ts verifyShareCode, 10 in 15
 *   minutes), and every call here comes from loopback. So the lockout test runs last, and it uses the
 *   second loopback address when the node answers on both, so that the count it asserts is the share's.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secret-shares
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { generateKeyPairSync } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, json, sleep } from './helpers/purpose-kit.js';

const h = harness('Secret shares and secret requests');
const STAMP = Date.now().toString(36);

const alice = await registerOwner(BASE, `ssalice${STAMP}`);
const bob = await registerOwner(BASE, `ssbob${STAMP}`);
const carol = await registerOwner(BASE, `sscarol${STAMP}`);
const sharer = await makeAgent(BASE, alice, ['secrets:share'], `ssagent${STAMP}`);
const wildcard = await makeAgent(BASE, alice, ['*'], `sswild${STAMP}`);

const post = (token: string | null, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    json(path, { method: 'POST', headers: { ...(token ? auth(token) : {}), ...headers }, body: JSON.stringify(body) });
const get = (token: string | null, path: string, headers: Record<string, string> = {}) =>
    json(path, { headers: { ...(token ? auth(token) : {}), ...headers } });
const del = (token: string, path: string) => json(path, { method: 'DELETE', headers: auth(token) });
const err = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body)}`.slice(0, 400);
const S = '/v1/secret-shares';

/**
 * One pickup-with-code call with no retry: json() waits a 429 out, and the lockout is what is tested.
 * `base` picks the loopback address the call comes from, because the node counts wrong codes per address.
 */
async function codeCall(base: string, id: string, body: Record<string, unknown>, token?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${S}/${id}/pickup-with-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? auth(token) : {}) },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

/** The node's two loopback addresses, when it answers on both; the first is always reachable. */
const port = new URL(BASE).port;
async function answers(base: string): Promise<boolean> {
    try { return (await fetch(`${base}${S}/shr_aaaaaaaaaaaaaaaaaaaa/card`, { signal: AbortSignal.timeout(3000) })).status === 404; }
    catch { return false; }
}
const HOST_A = (await answers(`http://127.0.0.1:${port}`)) ? `http://127.0.0.1:${port}` : BASE;
const HOST_B = (await answers(`http://[::1]:${port}`)) ? `http://[::1]:${port}` : HOST_A;
/** Wrong codes this suite sent from HOST_A before the lockout test; the lockout test subtracts them when it shares the address. */
let wrongFromA = 0;

// ── 1 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('1. request flow: alice asks bob; bob fills it once; a stranger sees nothing; alice\'s agent puts it into her vault but never sees it', async () => {
    const VALUE = `holvi-value-${STAMP}-1`;
    const c = await post(alice.token, S, {
        kind: 'request', name: `SS_TOKEN_${STAMP}`, note: 'for the speech service', depositors: [bob.name],
        recipients: { people: [alice.name], agents: true }, protection: 'sealed', retention: 'once',
    });
    assert(c.status === 201 && typeof c.body.data?.deposit_token === 'string', `create request ${err(c)}`);
    const id = c.body.data.share.id as string;
    const token = c.body.data.deposit_token as string;
    assert(c.body.data.share.status === 'waiting' && c.body.data.share.kind === 'request', `request view ${JSON.stringify(c.body.data.share)}`);

    const card = await get(null, `${S}/${id}/card`);
    assert(card.status === 200 && card.body.data.name === `SS_TOKEN_${STAMP}` && card.body.data.note === undefined, `public card ${err(card)}`);
    const noTok = await get(null, `${S}/${id}/deposit-card`);
    assert(noTok.status === 404, `deposit card without the token ${err(noTok)}`);
    const badTok = await get(null, `${S}/${id}/deposit-card`, { 'x-deposit-token': 'nope' });
    assert(badTok.status === 404, `deposit card with a wrong token ${err(badTok)}`);
    const withTok = await get(null, `${S}/${id}/deposit-card`, { 'x-deposit-token': token });
    assert(withTok.status === 200 && withTok.body.data.note === 'for the speech service', `deposit card with the token ${err(withTok)}`);

    const dep = await post(bob.token, `${S}/${id}/deposit`, { content: VALUE });
    assert(dep.status === 200 && dep.body.data.share.status === 'ready', `bob deposits ${err(dep)}`);
    const again = await post(bob.token, `${S}/${id}/deposit`, { content: 'second' });
    assert(again.status === 409 && again.body.error?.code === 'NOT_WAITING', `bob deposits again ${err(again)}`);

    const cGet = await get(carol.token, `${S}/${id}`);
    assert(cGet.status === 404, `carol reads it ${err(cGet)}`);
    const cDep = await post(carol.token, `${S}/${id}/deposit`, { content: 'x' });
    assert(cDep.status === 404, `carol deposits ${err(cDep)}`);
    const cPick = await post(carol.token, `${S}/${id}/pickup`, { to: 'reveal' });
    assert(cPick.status === 404, `carol picks up ${err(cPick)}`);

    const wild = await post(wildcard.token, `${S}/${id}/pickup`, { to: 'vault' });
    assert(wild.status === 403 && wild.body.error?.code === 'SCOPE_DENIED', `the agent with only * picks up ${err(wild)}`);
    const wildList = await get(wildcard.token, S);
    assert(wildList.status === 403, `the agent with only * lists ${err(wildList)}`);

    const sealed = await post(sharer.token, `${S}/${id}/pickup`, { to: 'reveal' });
    assert(sealed.status === 403 && sealed.body.error?.code === 'SEALED', `agent reveals a sealed share ${err(sealed)}`);
    assert(!JSON.stringify(sealed.body).includes(VALUE), 'the SEALED refusal carries the value');

    const vaultName = `SS_VAULT_${STAMP}`;
    const toVault = await post(sharer.token, `${S}/${id}/pickup`, { to: 'vault', name: vaultName });
    assert(toVault.status === 200 && toVault.body.data.vault?.name === vaultName, `agent picks up into the vault ${err(toVault)}`);
    assert(!JSON.stringify(toVault.body).includes(VALUE) && toVault.body.data.content === undefined, 'the vault pickup gave the agent the value');

    const vault = await get(alice.token, '/v1/secrets');
    assert(vault.status === 200 && (vault.body.data.secrets ?? []).some((s: any) => s.name === vaultName), `alice's vault ${err(vault)}`);
    assert(!JSON.stringify(vault.body).includes(VALUE), 'GET /v1/secrets shows a value');

    const second = await post(alice.token, `${S}/${id}/pickup`, { to: 'reveal' });
    assert(second.status === 410, `second pickup of a once share ${err(second)}`);

    const one = await get(alice.token, `${S}/${id}`);
    const kinds = (one.body.data?.events ?? []).map((e: any) => e.kind);
    assert(one.status === 200 && one.body.data.status === 'ended', `alice reads it ${err(one)}`);
    for (const k of ['requested', 'deposited', 'picked_up', 'ended']) assert(kinds.includes(k), `events lack ${k}: ${kinds.join(',')}`);
    assert(!JSON.stringify(one.body).includes(VALUE), 'the share view carries the value');
});

// ── 2 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('2. a request is filled with the link\'s token and no session; a wrong token is 404', async () => {
    const c = await post(alice.token, S, { kind: 'request', name: `SS_LINK_${STAMP}`, recipients: { people: [alice.name] } });
    assert(c.status === 201, `create request ${err(c)}`);
    const id = c.body.data.share.id as string;
    const wrong = await post(null, `${S}/${id}/deposit-with-token`, { token: 'not-the-token', content: 'x' });
    assert(wrong.status === 404, `wrong token ${err(wrong)}`);
    const none = await post(null, `${S}/${id}/deposit-with-token`, { content: 'x' });
    assert(none.status === 404, `no token ${err(none)}`);
    const ok = await post(null, `${S}/${id}/deposit-with-token`, { token: c.body.data.deposit_token, content: `holvi-link-${STAMP}` });
    assert(ok.status === 200 && ok.body.data.share.status === 'ready', `deposit with the token ${err(ok)}`);
    const one = await get(alice.token, `${S}/${id}`);
    assert(one.body.data.deposited_by === 'link', `deposited_by ${JSON.stringify(one.body.data?.deposited_by)}`);
    const got = await post(alice.token, `${S}/${id}/pickup`, { to: 'reveal' });
    assert(got.status === 200 && got.body.data.content?.text === `holvi-link-${STAMP}`, `alice reveals ${err(got)}`);
});

// ── 3 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('3. a code share: open, two pickups; no code 404, a wrong code 403, the right code in lower case with spaces 200', async () => {
    const VALUE = 'A=1\nB=2';
    const c = await post(alice.token, S, {
        name: `SS_CONFIG_${STAMP}`, format: 'pairs', content: VALUE, recipients: { code: true }, protection: 'open', retention: 'count', max_pickups: 2,
    });
    assert(c.status === 201 && typeof c.body.data.code === 'string', `create ${err(c)}`);
    const id = c.body.data.share.id as string;
    const code = c.body.data.code as string;
    assert(!JSON.stringify(c.body.data.share).includes(code), 'the share view carries the code');
    const noCode = await codeCall(HOST_A, id, {});
    assert(noCode.status === 404, `no code ${err(noCode)}`);
    const wrong = await codeCall(HOST_A, id, { code: 'KARHU-0000-SUMU-VALO' === code ? 'KUHA-0001-SUMU-VALO' : 'KARHU-0000-SUMU-VALO' });
    wrongFromA++;
    assert(wrong.status === 403 && wrong.body.error?.code === 'WRONG_CODE', `wrong code ${err(wrong)}`);
    const right = await codeCall(HOST_A, id, { code: `  ${code.toLowerCase().replaceAll('-', ' ')} ` });
    assert(right.status === 200 && right.body.data.content?.text === VALUE && right.body.data.content.format === 'pairs', `right code ${err(right)}`);
    const second = await codeCall(HOST_A, id, { code });
    assert(second.status === 200, `second pickup ${err(second)}`);
    const third = await codeCall(HOST_A, id, { code });
    assert(third.status === 410, `third pickup past the count ${err(third)}`);
});

// ── 4 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('4. code_login: the right code without a session is 401 SIGN_IN_REQUIRED; with carol\'s session it opens', async () => {
    const VALUE = `holvi-login-${STAMP}`;
    const c = await post(alice.token, S, { name: `SS_LOGIN_${STAMP}`, content: VALUE, recipients: { code: true, code_login: true }, protection: 'open', retention: 'keep' });
    assert(c.status === 201 && c.body.data.share.recipients.code_login === true, `create ${err(c)}`);
    const id = c.body.data.share.id as string;
    const anon = await codeCall(HOST_A, id, { code: c.body.data.code });
    assert(anon.status === 401 && anon.body.error?.code === 'SIGN_IN_REQUIRED', `no session ${err(anon)}`);
    const signed = await codeCall(HOST_A, id, { code: c.body.data.code }, carol.token);
    assert(signed.status === 200 && signed.body.data.content?.text === VALUE, `carol with the code ${err(signed)}`);
});

// ── 5 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('5. revoke: bob cannot (403 NOT_MAKER); alice revokes after bob picked up; then 410, and the share says who revoked it', async () => {
    const c = await post(alice.token, S, { name: `SS_WIFI_${STAMP}`, content: 'kaura', recipients: { people: [bob.name] }, retention: 'keep' });
    assert(c.status === 201 && c.body.data.share.protection === 'sealed', `create ${err(c)}`);
    const id = c.body.data.share.id as string;
    const byBob = await post(bob.token, `${S}/${id}/revoke`);
    assert(byBob.status === 403 && byBob.body.error?.code === 'NOT_MAKER', `bob revokes ${err(byBob)}`);
    const byCarol = await post(carol.token, `${S}/${id}/revoke`);
    assert(byCarol.status === 404, `carol revokes ${err(byCarol)}`);
    const picked = await post(bob.token, `${S}/${id}/pickup`, {});
    assert(picked.status === 200 && picked.body.data.content?.text === 'kaura', `bob picks up in person ${err(picked)}`);
    const rev = await post(alice.token, `${S}/${id}/revoke`);
    assert(rev.status === 200 && rev.body.data.status === 'revoked', `alice revokes ${err(rev)}`);
    const after = await post(bob.token, `${S}/${id}/pickup`, {});
    assert(after.status === 410, `pickup after revoke ${err(after)}`);
    const one = await get(alice.token, `${S}/${id}`);
    assert(one.status === 200 && one.body.data.status === 'revoked' && one.body.data.revoked_by === alice.ghii, `get after revoke ${JSON.stringify({ status: one.body.data?.status, revoked_by: one.body.data?.revoked_by, alice: alice.ghii })}`);
    assert((one.body.data.events ?? []).some((e: any) => e.kind === 'revoked'), 'no revoked event');
});

// ── 6 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('6. retention until: a time in the past is 400; a share whose time passed answers 410', async () => {
    const past = await post(alice.token, S, { name: `SS_PAST_${STAMP}`, content: 'x', recipients: { people: [bob.name] }, retention: 'until', expires_at: new Date(Date.now() - 60_000).toISOString() });
    assert(past.status === 400 && past.body.error?.code === 'INVALID_EXPIRES_AT', `past time ${err(past)}`);
    const c = await post(alice.token, S, { name: `SS_SOON_${STAMP}`, content: 'soon', recipients: { people: [bob.name] }, retention: 'until', expires_at: new Date(Date.now() + 2000).toISOString() });
    assert(c.status === 201 && typeof c.body.data.share.expires_at === 'string', `create ${err(c)}`);
    await sleep(2500);
    const late = await post(bob.token, `${S}/${c.body.data.share.id}/pickup`, {});
    assert(late.status === 410, `pickup after the time ${err(late)}`);
});

// ── 7 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('7. organism: a member picks up, a stranger is 404, and a maker outside the organism is 403 NOT_A_MEMBER', async () => {
    const o = await post(alice.token, '/v1/organisms', { name: `Vault Circle ${STAMP}`, type: 'team', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism ${err(o)}`);
    const orgId = o.body.data.organism.id as string;
    const m = await post(alice.token, `/v1/organisms/${orgId}/members`, { ghii: bob.name });
    assert(m.status === 201, `add bob ${err(m)}`);
    const c = await post(alice.token, S, { name: `SS_TEAM_${STAMP}`, content: 'team-secret', recipients: { organism: true }, organism: orgId, retention: 'keep' });
    assert(c.status === 201 && c.body.data.share.organism === orgId, `create ${err(c)}`);
    const id = c.body.data.share.id as string;
    const byCarol = await post(carol.token, `${S}/${id}/pickup`, {});
    assert(byCarol.status === 404, `carol picks up ${err(byCarol)}`);
    const byBob = await post(bob.token, `${S}/${id}/pickup`, {});
    assert(byBob.status === 200 && byBob.body.data.content?.text === 'team-secret', `bob picks up ${err(byBob)}`);
    const list = await get(bob.token, S);
    assert(list.status === 200 && (list.body.data.for_me ?? []).some((s: any) => s.id === id), `bob's list ${err(list)}`);
    const outsider = await post(carol.token, S, { name: `SS_OUT_${STAMP}`, content: 'x', recipients: { organism: true }, organism: orgId });
    assert(outsider.status === 403 && outsider.body.error?.code === 'NOT_A_MEMBER', `carol makes an organism share ${err(outsider)}`);
});

// ── 8 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('8. device keys: an agent cannot register one (403 IN_PERSON_ONLY); alice in person registers, lists and removes it', async () => {
    // A real P-256 public key: the node refuses a point that is not on the curve.
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { x, y } = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const jwk = { kty: 'EC', crv: 'P-256', x, y };
    const offCurve = await post(alice.token, '/v1/vault/device-keys', { public_key: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) } });
    assert(offCurve.status === 400 && offCurve.body.error?.code === 'INVALID_PUBLIC_KEY', `a point off the curve ${err(offCurve)}`);
    const byAgent = await post(sharer.token, '/v1/vault/device-keys', { public_key: jwk });
    assert(byAgent.status === 403 && byAgent.body.error?.code === 'IN_PERSON_ONLY', `agent registers ${err(byAgent)}`);
    const reg = await post(alice.token, '/v1/vault/device-keys', { public_key: jwk, label: 'Laptop' });
    assert(reg.status === 201 && typeof reg.body.data.key_id === 'string', `alice registers ${err(reg)}`);
    const keyId = reg.body.data.key_id as string;
    const list = await get(alice.token, '/v1/vault/device-keys');
    assert(list.status === 200 && list.body.data.some((k: any) => k.key_id === keyId && k.label === 'Laptop'), `list ${err(list)}`);
    const of = await get(bob.token, `/v1/vault/device-keys/of/${alice.name}`);
    assert(of.status === 200 && of.body.data.keys.some((k: any) => k.key_id === keyId), `alice's keys as bob sees them ${err(of)}`);
    const agentDel = await del(sharer.token, `/v1/vault/device-keys/${keyId}`);
    assert(agentDel.status === 403 && agentDel.body.error?.code === 'IN_PERSON_ONLY', `agent removes ${err(agentDel)}`);
    const rm = await del(alice.token, `/v1/vault/device-keys/${keyId}`);
    assert(rm.status === 200 && rm.body.data.removed === true, `alice removes ${err(rm)}`);
    const empty = await get(alice.token, '/v1/vault/device-keys');
    assert(empty.status === 200 && !empty.body.data.some((k: any) => k.key_id === keyId), `list after remove ${err(empty)}`);
});

// ── 9 ────────────────────────────────────────────────────────────────────────────────────────────
await h.test('9. validation: no recipients, an unknown person, e2e with agents, and a file into the vault are refused', async () => {
    const none = await post(alice.token, S, { name: 'X', content: 'y' });
    assert(none.status === 400 && none.body.error?.code === 'NO_RECIPIENTS', `no recipients ${err(none)}`);
    const ghost = await post(alice.token, S, { name: 'X', content: 'y', recipients: { people: [`ghost${STAMP}`] } });
    assert(ghost.status === 400 && ghost.body.error?.code === 'UNKNOWN_PERSON', `unknown person ${err(ghost)}`);
    const e2e = await post(alice.token, S, { name: 'X', protection: 'e2e', recipients: { people: [bob.name], agents: true } });
    assert(e2e.status === 400 && e2e.body.error?.code === 'E2E_NAMED_ONLY', `e2e with agents ${err(e2e)}`);
    const file = await post(alice.token, S, {
        name: `SS_FILE_${STAMP}`, format: 'file', content_base64: Buffer.from('-----BEGIN KEY-----\nabc\n').toString('base64'),
        file_name: 'service.pem', recipients: { people: [alice.name] }, retention: 'keep',
    });
    assert(file.status === 201 && file.body.data.share.format === 'file', `create a file share ${err(file)}`);
    const toVault = await post(alice.token, `${S}/${file.body.data.share.id}/pickup`, { to: 'vault' });
    assert(toVault.status === 400 && toVault.body.error?.code === 'TOO_LARGE_FOR_VAULT', `file into the vault ${err(toVault)}`);
});

// ── 10 ───────────────────────────────────────────────────────────────────────────────────────────
await h.test('10. MCP parity: aimeat_secret_share_list answers what GET /v1/secret-shares answers, and refuses the agent with only *', async () => {
    const session = await openSession(BASE, sharer.token, 'e2e-secret-shares');
    assert((await toolNames(session)).includes('aimeat_secret_share_list'), 'aimeat_secret_share_list is not offered to an agent with secrets:share');
    const rest = await get(sharer.token, S);
    assert(rest.status === 200, `REST list ${err(rest)}`);
    const r = await callTool(session, 'aimeat_secret_share_list', {});
    assert(!r.isError, `the tool refused: ${r.text.slice(0, 300)}`);
    const restIds = (rest.body.data.made ?? []).map((s: any) => s.id as string);
    assert(restIds.length > 0, 'the REST list has nothing to compare');
    const missing = restIds.filter((sid: string) => !r.text.includes(sid));
    assert(missing.length === 0, `the tool's list lacks ${missing.join(', ')}`);
    const denied = await callTool(await openSession(BASE, wildcard.token, 'e2e-secret-shares-wild'), 'aimeat_secret_share_list', {});
    assert(denied.isError, `the agent with only * listed shares over MCP: ${denied.text.slice(0, 200)}`);
});

await h.test('10b. MCP: create a request, bob\'s agent deposits, alice\'s agent reads, picks up into the vault, is refused a sealed reveal, and revokes', async () => {
    const VALUE = `holvi-mcp-${STAMP}`;
    const aliceAi = await openSession(BASE, sharer.token, 'e2e-secret-shares-alice');
    const bobAi = await openSession(BASE, (await makeAgent(BASE, bob, ['secrets:share'], `ssbobai${STAMP}`)).token, 'e2e-secret-shares-bob');

    const req = await callTool(aliceAi, 'aimeat_secret_share_create', {
        kind: 'request', name: `SS_MCP_${STAMP}`, depositors: [bob.name],
        recipients: { people: [alice.name], agents: true }, protection: 'sealed',
    });
    assert(!req.isError && req.data?.share?.kind === 'request' && req.data.share.status === 'waiting' && typeof req.data.deposit_token === 'string', `create a request: ${req.text.slice(0, 300)}`);
    const id = req.data.share.id as string;
    assert(req.data.share.created_by === sharer.gaii && req.data.share.maker === alice.ghii, `maker and creator: ${JSON.stringify({ maker: req.data.share.maker, created_by: req.data.share.created_by })}`);

    const dep = await callTool(bobAi, 'aimeat_secret_share_deposit', { id, content: VALUE });
    assert(!dep.isError && dep.data?.share?.status === 'ready' && dep.data.share.id === id, `bob's agent deposits: ${dep.text.slice(0, 300)}`);
    assert(!dep.text.includes(VALUE), 'the deposit answer carries the value');
    const twice = await callTool(bobAi, 'aimeat_secret_share_deposit', { id, content: 'again' });
    assert(twice.isError && twice.text.startsWith('NOT_WAITING'), `bob's agent deposits again: ${twice.text.slice(0, 200)}`);

    const one = await callTool(aliceAi, 'aimeat_secret_share_get', { id });
    const kinds = (one.data?.events ?? []).map((e: any) => e.kind);
    assert(!one.isError && one.data?.status === 'ready' && one.data.you?.manage === true && kinds.includes('requested') && kinds.includes('deposited'), `alice's agent reads it: ${one.text.slice(0, 300)}`);
    assert(!one.text.includes(VALUE), 'the get answer carries the value');
    const byCarol = await callTool(await openSession(BASE, (await makeAgent(BASE, carol, ['secrets:share'], `sscarolai${STAMP}`)).token, 'e2e-secret-shares-carol'), 'aimeat_secret_share_get', { id });
    assert(byCarol.isError && byCarol.text.startsWith('NOT_FOUND'), `carol's agent reads it: ${byCarol.text.slice(0, 200)}`);

    const vaultName = `SS_MCP_VAULT_${STAMP}`;
    const toVault = await callTool(aliceAi, 'aimeat_secret_share_pickup', { id, to: 'vault', name: vaultName });
    assert(!toVault.isError && toVault.data?.vault?.name === vaultName && toVault.data.content === undefined, `pickup into the vault: ${toVault.text.slice(0, 300)}`);
    assert(!toVault.text.includes(VALUE), 'the vault pickup gave the agent the value');
    const vault = await get(alice.token, '/v1/secrets');
    assert((vault.body.data?.secrets ?? []).some((s: any) => s.name === vaultName) && !JSON.stringify(vault.body).includes(VALUE), `alice's vault after the MCP pickup ${err(vault)}`);

    const sealed = await callTool(aliceAi, 'aimeat_secret_share_create', {
        name: `SS_MCP_SEALED_${STAMP}`, content: `${VALUE}-sealed`, recipients: { people: [alice.name], agents: true }, protection: 'sealed', retention: 'keep',
    });
    assert(!sealed.isError && sealed.data?.share?.status === 'ready' && sealed.data.share.protection === 'sealed', `create a sealed share: ${sealed.text.slice(0, 300)}`);
    const reveal = await callTool(aliceAi, 'aimeat_secret_share_pickup', { id: sealed.data.share.id, to: 'reveal' });
    assert(reveal.isError && reveal.text.startsWith('SEALED') && !reveal.text.includes(`${VALUE}-sealed`), `the agent reveals a sealed share: ${reveal.text.slice(0, 200)}`);

    const third = await callTool(aliceAi, 'aimeat_secret_share_create', { name: `SS_MCP_REVOKE_${STAMP}`, content: 'to-withdraw', recipients: { people: [bob.name] }, retention: 'keep' });
    assert(!third.isError && third.data?.share?.status === 'ready', `create a third share: ${third.text.slice(0, 300)}`);
    const byBob = await callTool(bobAi, 'aimeat_secret_share_revoke', { id: third.data.share.id });
    assert(byBob.isError && byBob.text.startsWith('NOT_MAKER'), `bob's agent revokes alice's share: ${byBob.text.slice(0, 200)}`);
    const rev = await callTool(aliceAi, 'aimeat_secret_share_revoke', { id: third.data.share.id });
    assert(!rev.isError && rev.data?.status === 'revoked' && rev.data.revoked_by === sharer.gaii, `alice's agent revokes: ${rev.text.slice(0, 300)}`);
    const after = await post(bob.token, `${S}/${third.data.share.id}/pickup`, {});
    assert(after.status === 410, `bob picks up after the MCP revoke ${err(after)}`);
});

// ── 3b, last: the lockout counts per address too, so nothing that sends a code may run after it ──────
await h.test('3b. ten wrong codes on one share lock it: the next try is 429 TOO_MANY_TRIES, the right code included', async () => {
    const c = await post(alice.token, S, { name: `SS_LOCK_${STAMP}`, content: 'locked', recipients: { code: true }, protection: 'open', retention: 'keep' });
    assert(c.status === 201, `create ${err(c)}`);
    const id = c.body.data.share.id as string;
    const code = c.body.data.code as string;
    const wrongCode = code.startsWith('KUHA-') ? 'AHVEN-0000-KUHA-KUHA' : 'KUHA-0000-AHVEN-AHVEN';
    // HOST_B is a second loopback address when the node answers on both; otherwise HOST_A, which
    // already carries this suite's earlier wrong codes, and its own limit then arrives first.
    const allowed = HOST_B === HOST_A ? 10 - wrongFromA : 10;
    for (let i = 1; i <= allowed; i++) {
        const w = await codeCall(HOST_B, id, { code: wrongCode });
        assert(w.status === 403 && w.body.error?.code === 'WRONG_CODE', `wrong code #${i} ${err(w)}`);
    }
    const locked = await codeCall(HOST_B, id, { code });
    assert(locked.status === 429 && locked.body.error?.code === 'TOO_MANY_TRIES', `the right code after ${allowed} wrong ones ${err(locked)}`);
    // With two addresses: HOST_A, under its own limit, is refused on this share too (the share's count),
    // and still opens another share (so the 429 was not HOST_A's count). With one address both are 429.
    const twoAddresses = HOST_B !== HOST_A;
    if (!twoAddresses) console.log('    (one loopback address only: the lockout arrived through the address count)');
    const elsewhere = await codeCall(HOST_A, id, { code });
    assert(elsewhere.status === 429, `the locked share from ${HOST_A} ${err(elsewhere)}`);
    const other = await post(alice.token, S, { name: `SS_FREE_${STAMP}`, content: 'free', recipients: { code: true }, protection: 'open' });
    assert(other.status === 201, `create another share ${err(other)}`);
    const free = await codeCall(HOST_A, other.body.data.share.id, { code: other.body.data.code });
    const expected = twoAddresses ? 200 : 429;
    assert(free.status === expected, `another share from ${HOST_A}: expected ${expected}, got ${err(free)}`);
});

// ── 11 ───────────────────────────────────────────────────────────────────────────────────────────
await h.test('11. every signed-in route refuses an agent without secrets:share (403), and a second owner cannot revoke (403)', async () => {
    const made = await post(alice.token, S, { name: `SS_DENY_${STAMP}`, content: 'deny', recipients: { people: [bob.name] }, protection: 'open', retention: 'keep' });
    assert(made.status === 201, `create ${err(made)}`);
    const id = made.body.data.share.id;
    const w = auth(wildcard.token);
    const list = await json('/v1/secret-shares', { headers: w });
    assert(list.status === 403, `GET list ${err(list)}`);
    const one = await json(`/v1/secret-shares/${id}`, { headers: w });
    assert(one.status === 403, `GET one ${err(one)}`);
    const create = await json('/v1/secret-shares', { method: 'POST', headers: w, body: JSON.stringify({ name: 'X', content: 'y', recipients: { people: [bob.name] } }) });
    assert(create.status === 403, `POST create ${err(create)}`);
    const deposit = await json(`/v1/secret-shares/${id}/deposit`, { method: 'POST', headers: w, body: JSON.stringify({ content: 'y' }) });
    assert(deposit.status === 403, `POST deposit ${err(deposit)}`);
    const pickup = await json(`/v1/secret-shares/${id}/pickup`, { method: 'POST', headers: w, body: JSON.stringify({ to: 'reveal' }) });
    assert(pickup.status === 403, `POST pickup ${err(pickup)}`);
    const revoke = await json(`/v1/secret-shares/${id}/revoke`, { method: 'POST', headers: w, body: '{}' });
    assert(revoke.status === 403, `POST revoke by the agent ${err(revoke)}`);
    const byBob = await json(`/v1/secret-shares/${id}/revoke`, { method: 'POST', headers: auth(bob.token), body: '{}' });
    assert(byBob.status === 403 && byBob.body.error?.code === 'NOT_MAKER', `POST revoke by bob ${err(byBob)}`);
    const keyAdd = await json('/v1/vault/device-keys', { method: 'POST', headers: w, body: JSON.stringify({ public_key: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) } }) });
    assert(keyAdd.status === 403, `POST device key ${err(keyAdd)}`);
    const keyDel = await json('/v1/vault/device-keys/abc', { method: 'DELETE', headers: w });
    assert(keyDel.status === 403, `DELETE device key ${err(keyDel)}`);
    const keysOf = await json(`/v1/vault/device-keys/of/${bob.name}`, { headers: w });
    assert(keysOf.status === 403, `GET device keys of ${err(keysOf)}`);
    const ownKeys = await json('/v1/vault/device-keys', { headers: w });
    assert(ownKeys.status === 403, `GET own device keys ${err(ownKeys)}`);
});

h.finish();
