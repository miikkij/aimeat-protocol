/**
 * @file test/e2e-app-access-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Asking for access to an app opened to one organism's members, from the refusal the open
 *   route gave: GET and POST /v1/apps/:owner/:filename/access-request, the join request it files, the
 *   decision (POST /v1/organisms/:id/join-requests/:requestId/review), the organism's switch
 *   (`access_requests`), and the same over MCP (aimeat_access_request, aimeat_organism_join_requests,
 *   aimeat_organism_join_request_review).
 *
 *   What it holds: the requester is never told the organism (no id, no name, in any answer or
 *   notice a declined person gets); one open request per person; a declined person waits 30 days; the
 *   switch off refuses and offers nothing; only an owner or admin reads or decides the requests; a
 *   request ends when the person is added another way; and an invite_only organism takes requests.
 *   The designed use itself (ask, approve, the app opens) is test/e2e-purpose-access-request.ts.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-access-request
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness('Asking for access to an app opened to an organism');
const STAMP = Date.now().toString(36);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const owner = await registerOwner(BASE, `arqown${STAMP}`);      // owns the organism and the app
const member = await registerOwner(BASE, `arqmem${STAMP}`);     // a plain member, never an approver
const asker = await registerOwner(BASE, `arqask${STAMP}`);      // asks and is approved
const declined = await registerOwner(BASE, `arqdec${STAMP}`);   // asks and is declined
const added = await registerOwner(BASE, `arqadd${STAMP}`);      // asks, then is added by hand
const late = await registerOwner(BASE, `arqlate${STAMP}`);      // meets the switch off

const ORG_NAME = `Closed Circle ${STAMP}`;
const FILE = `arq-${STAMP}.html`;
const APP_NAME = `Ratings ${STAMP}`;
let orgId = '';

const appRoute = `/v1/apps/${owner.name}/${FILE}`;
const openApp = (token: string) => json(`${appRoute}/open`, { method: 'POST', headers: auth(token), body: '{}' });
const state = (token: string) => json(`${appRoute}/access-request`, { headers: auth(token) });
const ask = (token: string, message?: string) => json(`${appRoute}/access-request`, { method: 'POST', headers: auth(token), body: JSON.stringify(message === undefined ? {} : { message }) });
const requests = (token: string, status?: string) => json(`/v1/organisms/${orgId}/join-requests${status ? `?status=${status}` : ''}`, { headers: auth(token) });
const review = (token: string, id: string, decision: string) => json(`/v1/organisms/${orgId}/join-requests/${id}/review`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision }) });
const notices = async (token: string): Promise<any[]> => (await json('/v1/notifications', { headers: auth(token) })).body?.data?.notifications ?? [];
/** No answer or notice a person outside the organism reads may carry its id or its name. */
const namesNoOrganism = (value: unknown) => { const s = JSON.stringify(value ?? ''); return !s.includes(orgId) && !s.includes(ORG_NAME); };
const requestOf = async (who: string, status?: string) => ((await requests(owner.token, status)).body?.data?.join_requests ?? []).find((r: any) => r.ghii === who);

await h.test('setup: an invite_only private organism with one member, and an app opened to its members', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: ORG_NAME, type: 'team', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `organism ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const m = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ ghii: member.name }) });
    assert(m.status === 201, `add member ${m.status} ${JSON.stringify(m.body?.error)}`);
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: FILE, content: b64('<!DOCTYPE html><html><body><h1>RATINGS</h1></body></html>'), name: APP_NAME, description: 'd', category: 'utility', tags: [] }) });
    assert(pub.status === 201, `publish ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const set = await json(`/v1/apps/${FILE}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ open_to: `organism:${orgId}` }) });
    assert(set.status === 200 && set.body.data.open_to === `organism:${orgId}`, `open_to ${set.status} ${JSON.stringify(set.body)}`);
});

await h.test('1. the app refuses an outsider, and the state says a request can be made, naming no organism', async () => {
    const o = await openApp(asker.token);
    assert(o.status === 403 && o.body.error?.code === 'ACCESS_DENIED', `open ${o.status} ${JSON.stringify(o.body.error)}`);
    const s = await state(asker.token);
    assert(s.status === 200 && s.body.data.requestable === true && s.body.data.state === 'none' && s.body.data.retry_days === 30, `state ${s.status} ${JSON.stringify(s.body.data)}`);
    assert(namesNoOrganism(s.body), `the state names the organism: ${JSON.stringify(s.body)}`);
});

await h.test('2. the outsider asks: 202 pending, the answer names no organism and no request id', async () => {
    const a = await ask(asker.token, 'I rate my own team this week');
    assert(a.status === 202 && a.body.data.status === 'pending' && typeof a.body.data.asked_at === 'string', `ask ${a.status} ${JSON.stringify(a.body)}`);
    assert(namesNoOrganism(a.body) && a.body.data.id === undefined && a.body.data.join_request === undefined, `the answer says too much: ${JSON.stringify(a.body.data)}`);
    const s = await state(asker.token);
    assert(s.body.data.state === 'pending' && s.body.data.requestable === false, `state after asking: ${JSON.stringify(s.body.data)}`);
});

await h.test('3. a second request while one waits is refused (409 ALREADY_PENDING), and files nothing', async () => {
    const a = await ask(asker.token);
    assert(a.status === 409 && a.body.error?.code === 'ALREADY_PENDING', `second ask ${a.status} ${JSON.stringify(a.body.error)}`);
    const all = (await requests(owner.token)).body.data.join_requests.filter((r: any) => r.ghii === asker.name);
    assert(all.length === 1, `expected one open request, got ${all.length}`);
});

let askerRequest = '';
await h.test('4. the owner is told, with Approve and Reject, the app and the organism named; the list carries `via`', async () => {
    const n = (await notices(owner.token)).find(x => x.type === 'organism_access_request');
    assert(!!n, 'no organism_access_request notice for the owner');
    assert(n.title.includes(asker.name) && n.title.includes(APP_NAME), `title: ${n.title}`);
    assert(n.body.includes(ORG_NAME) && n.body.includes('I rate my own team'), `body: ${n.body}`);
    assert(n.i18n?.key === 'access_request_message' && n.i18n.vars.label === APP_NAME && n.i18n.vars.organism === ORG_NAME, `i18n: ${JSON.stringify(n.i18n)}`);
    assert((n.actions ?? []).map((a: any) => a.id).join(',') === 'approve,reject', `actions: ${JSON.stringify(n.actions)}`);
    const r = await requestOf(asker.name);
    assert(r?.status === 'pending' && r.via?.kind === 'app' && r.via.ref === `${owner.name}/${FILE}` && r.via.label === APP_NAME, `request: ${JSON.stringify(r)}`);
    askerRequest = r.id;
});

await h.test('5. a plain member neither reads nor decides the requests (403), and the requester cannot decide their own', async () => {
    const list = await requests(member.token);
    assert(list.status === 403, `member list ${list.status}`);
    const byMember = await review(member.token, askerRequest, 'approved');
    assert(byMember.status === 403 && byMember.body.error?.code === 'ACCESS_DENIED', `member review ${byMember.status} ${JSON.stringify(byMember.body.error)}`);
    const bySelf = await review(asker.token, askerRequest, 'approved');
    assert(bySelf.status === 403 || bySelf.status === 404, `self review ${bySelf.status}`);
    assert((await openApp(asker.token)).status === 403, 'the app opened without a decision');
});

await h.test('6. the owner approves: the person is a member, the app opens, they are told, and the notice lost its buttons', async () => {
    const r = await review(owner.token, askerRequest, 'approved');
    assert(r.status === 200 && r.body.data.decision === 'approved', `review ${r.status} ${JSON.stringify(r.body.error)}`);
    const o = await openApp(asker.token);
    assert(o.status === 200 && typeof o.body.data.url === 'string', `open after approval ${o.status} ${JSON.stringify(o.body.error)}`);
    const told = (await notices(asker.token)).find(x => x.type === 'organism_access_approved');
    assert(!!told && told.title.includes(APP_NAME) && told.link.includes('/v1/app-open?app='), `approval notice: ${JSON.stringify(told)}`);
    const n = (await notices(owner.token)).find(x => x.type === 'organism_access_request' && x.title.includes(asker.name));
    assert((n.actions ?? []).length === 0 && n.answered?.outcome === 'allowed', `owner notice after deciding: ${JSON.stringify({ actions: n.actions, answered: n.answered })}`);
    const again = await review(owner.token, askerRequest, 'rejected');
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_REVIEWED', `second decision ${again.status}`);
});

await h.test('7. for a member the state is `open`, and asking is refused (409 ALREADY_OPEN)', async () => {
    const s = await state(asker.token);
    assert(s.body.data.state === 'open' && s.body.data.requestable === false, `state: ${JSON.stringify(s.body.data)}`);
    const a = await ask(asker.token);
    assert(a.status === 409 && a.body.error?.code === 'ALREADY_OPEN', `ask ${a.status} ${JSON.stringify(a.body.error)}`);
    const own = await ask(owner.token);
    assert(own.status === 409 && own.body.error?.code === 'ALREADY_OPEN', `owner ask ${own.status}`);
});

await h.test('8. a declined person is told without the organism\'s name, stays outside, and waits 30 days', async () => {
    assert((await ask(declined.token)).status === 202, 'ask');
    const r = await requestOf(declined.name);
    const d = await review(owner.token, r.id, 'rejected');
    assert(d.status === 200 && d.body.data.decision === 'rejected', `reject ${d.status}`);
    const told = (await notices(declined.token)).find(x => x.type === 'organism_access_declined');
    assert(!!told && told.title.includes(APP_NAME) && namesNoOrganism(told), `decline notice: ${JSON.stringify(told)}`);
    assert((await openApp(declined.token)).status === 403, 'a declined person opened the app');
    const s = await state(declined.token);
    assert(s.body.data.state === 'declined' && s.body.data.requestable === false, `state: ${JSON.stringify(s.body.data)}`);
    const days = (new Date(s.body.data.ask_again_at).getTime() - Date.now()) / 86_400_000;
    assert(days > 29.9 && days < 30.1, `ask_again_at is ${days} days away`);
    const a = await ask(declined.token);
    assert(a.status === 409 && a.body.error?.code === 'ASKED_RECENTLY' && a.body.error.details?.ask_again_at === s.body.data.ask_again_at, `ask again ${a.status} ${JSON.stringify(a.body.error)}`);
    assert(namesNoOrganism(a.body) && namesNoOrganism(s.body), 'a declined person was told the organism');
});

await h.test('9. a request ends when the person is added by hand: it leaves the list and its notice loses the buttons', async () => {
    assert((await ask(added.token, 'add me')).status === 202, 'ask');
    assert(!!(await requestOf(added.name)), 'the request is not listed');
    const m = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ ghii: added.name }) });
    assert(m.status === 201, `direct add ${m.status} ${JSON.stringify(m.body?.error)}`);
    assert(!(await requestOf(added.name)), 'the request still waits after the person became a member');
    const closed = await requestOf(added.name, 'approved');
    assert(closed?.reviewedBy === owner.name, `closed request: ${JSON.stringify(closed)}`);
    const n = (await notices(owner.token)).find(x => x.type === 'organism_access_request' && x.title.includes(added.name));
    assert((n.actions ?? []).length === 0 && !!n.answered, `notice after the direct add: ${JSON.stringify({ actions: n.actions, answered: n.answered })}`);
    assert((await openApp(added.token)).status === 200, 'the added person cannot open the app');
});

await h.test('10. the switch: an unknown value is refused, `off` offers nothing and refuses (403 REQUESTS_OFF), `on` takes requests again', async () => {
    const bad = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ access_requests: 'maybe' }) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `bad value ${bad.status}`);
    const byMember = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(member.token), body: JSON.stringify({ access_requests: 'off' }) });
    assert(byMember.status === 403, `a plain member changed the switch: ${byMember.status}`);
    const off = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ access_requests: 'off' }) });
    assert(off.status === 200 && off.body.data.organism.accessRequests === 'off', `off ${off.status} ${JSON.stringify(off.body?.data?.organism?.accessRequests)}`);
    const s = await state(late.token);
    assert(s.body.data.requestable === false && s.body.data.state === 'none' && namesNoOrganism(s.body), `state with the switch off: ${JSON.stringify(s.body.data)}`);
    const a = await ask(late.token);
    assert(a.status === 403 && a.body.error?.code === 'REQUESTS_OFF' && namesNoOrganism(a.body), `ask with the switch off ${a.status} ${JSON.stringify(a.body.error)}`);
    assert(!(await requestOf(late.name)), 'a request was filed with the switch off');
    const on = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ access_requests: 'on' }) });
    assert(on.status === 200 && on.body.data.organism.accessRequests === 'on', `on ${on.status}`);
    assert((await state(late.token)).body.data.requestable === true, 'not requestable after the switch came back on');
});

await h.test('11. an app that is not opened by membership takes no request; a missing app is 404; no session is 401', async () => {
    const other = `arq-open-${STAMP}.html`;
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: other, content: b64('<!DOCTYPE html><html><body>OPEN</body></html>'), name: 'Open one', description: 'd', category: 'utility', tags: [] }) });
    assert(pub.status === 201, `publish ${pub.status}`);
    // The app opens for every signed-in account here, so the answer is ALREADY_OPEN, never a request.
    const a = await json(`/v1/apps/${owner.name}/${other}/access-request`, { method: 'POST', headers: auth(late.token), body: '{}' });
    assert(a.status === 409 && a.body.error?.code === 'ALREADY_OPEN', `open app ask ${a.status} ${JSON.stringify(a.body.error)}`);
    const missing = await json(`/v1/apps/${owner.name}/no-such-${STAMP}.html/access-request`, { method: 'POST', headers: auth(late.token), body: '{}' });
    assert(missing.status === 404, `missing app ${missing.status}`);
    const anon = await json(`${appRoute}/access-request`, { method: 'POST', body: '{}' });
    assert(anon.status === 401, `no session ${anon.status}`);
    const anonState = await json(`/v1/apps/${owner.name}/${FILE}/access-request`);
    assert(anonState.status === 401, `the state without a session ${anonState.status}`);
    const long = await ask(late.token, 'x'.repeat(1001));
    assert(long.status === 400 && long.body.error?.code === 'VALIDATION_ERROR', `long message ${long.status} ${JSON.stringify(long.body.error?.code)}`);
});

await h.test('12. over MCP: the outsider\'s agent checks and asks, the owner\'s agent lists and approves, a member\'s agent is refused', async () => {
    const lateAgent = await openSession(BASE, (await makeAgent(BASE, late, ['social:write'])).token);
    const app = { kind: 'app', ref: `${owner.name}/${FILE}` };
    const check = await callTool(lateAgent, 'aimeat_access_request', { ...app, check: true });
    assert(!check.isError && check.data?.requestable === true && check.data.state === 'none', `check: ${check.text}`);
    const asked = await callTool(lateAgent, 'aimeat_access_request', { ...app, message: 'asked by my AI' });
    assert(!asked.isError && asked.data?.status === 'pending' && namesNoOrganism(asked.text), `ask: ${asked.text}`);
    const twice = await callTool(lateAgent, 'aimeat_access_request', app);
    assert(twice.isError && twice.text.startsWith('ALREADY_PENDING: '), `second ask: ${twice.text}`);
    const none = await callTool(lateAgent, 'aimeat_access_request', { kind: 'app', ref: `${owner.name}/no-such-${STAMP}.html` });
    assert(none.isError && none.text.startsWith('NOT_FOUND: '), `a missing app: ${none.text}`);
    // An agent without the permission to ask reads no state either: the read asks the same word.
    const reader = await openSession(BASE, (await makeAgent(BASE, late, ['organism:read'])).token);
    const noWord = await callTool(reader, 'aimeat_access_request', { ...app, check: true });
    assert(noWord.isError && noWord.text.startsWith('SCOPE_DENIED: '), `an agent without social:write: ${noWord.text}`);

    const memberAgent = await openSession(BASE, (await makeAgent(BASE, member, ['organism:read', 'organism:invite'])).token);
    const memberList = await callTool(memberAgent, 'aimeat_organism_join_requests', { organism_id: orgId });
    assert(memberList.isError && memberList.text.startsWith('ACCESS_DENIED: '), `member agent list: ${memberList.text}`);

    const ownerAgent = await openSession(BASE, (await makeAgent(BASE, owner, ['organism:read', 'organism:invite'])).token);
    const list = await callTool(ownerAgent, 'aimeat_organism_join_requests', { organism_id: orgId });
    const mine = (list.data?.join_requests ?? []).find((r: any) => r.ghii === late.name);
    assert(!list.isError && mine?.via?.label === APP_NAME && mine.message === 'asked by my AI', `owner agent list: ${list.text}`);
    const memberReview = await callTool(memberAgent, 'aimeat_organism_join_request_review', { organism_id: orgId, request_id: mine.id, decision: 'approved' });
    assert(memberReview.isError && memberReview.text.startsWith('ACCESS_DENIED: '), `a member's agent decided a request: ${memberReview.text}`);
    const decided = await callTool(ownerAgent, 'aimeat_organism_join_request_review', { organism_id: orgId, request_id: mine.id, decision: 'approved' });
    assert(!decided.isError && decided.data?.decision === 'approved' && decided.data.member === late.name, `owner agent review: ${decided.text}`);
    assert((await openApp(late.token)).status === 200, 'the app does not open after the agent approved');
});

await h.test('13. joining by the organism\'s id keeps one open request per person too (approval_required)', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: `Ask First ${STAMP}`, type: 'team', join_policy: 'approval_required', visibility: 'listed' }) });
    assert(o.status === 201, `organism ${o.status}`);
    const id = o.body.data.organism.id;
    const first = await json(`/v1/organisms/${id}/join`, { method: 'POST', headers: auth(declined.token), body: '{}' });
    assert(first.status === 202, `join ${first.status} ${JSON.stringify(first.body.error)}`);
    const second = await json(`/v1/organisms/${id}/join`, { method: 'POST', headers: auth(declined.token), body: '{}' });
    assert(second.status === 409 && second.body.error?.code === 'ALREADY_PENDING', `second join ${second.status} ${JSON.stringify(second.body.error)}`);
    const waiting = await json('/v1/organisms/waiting', { headers: auth(owner.token) });
    const item = (waiting.body.data.items ?? []).find((i: any) => i.kind === 'join' && i.orgId === id);
    assert(item?.n === 1, `waiting list: ${JSON.stringify(item)}`);
});

h.finish();
