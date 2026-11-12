/**
 * @file test/e2e-purpose-access-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: a person an app refuses asks for access on the node, and the people who decide
 *   who is a member answer where they answer everything else. The app is opened to the members of an
 *   invite-only organism. An outsider asks from the app's refusal; the owner approves with the button
 *   the notification carries, and the app opens for the outsider. A second outsider's request is read
 *   and approved by the owner's own AI over MCP, and the app opens for them too.
 *
 *   WHY IT EXISTS. Before this capability a refused person sent a screenshot of the refusal to the
 *   owner by another channel, and the owner added them by hand. The refusals around the capability
 *   are test/e2e-app-access-request.ts; each test here names the use and fails when the use is gone.
 *
 *   FAIL FIRST, 2026-11-12, both backends: with services/organism-join-requests/requests.ts requestAccess
 *   refusing an invite_only organism (the rule POST /v1/organisms/:id/join has, which an access
 *   request must not have), tests 1 and 2 are red; restored byte for byte.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-access-request
 * @version-history
 *   v1.0.0 -- 2026-11-12 -- Initial.
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness('Purpose: a refused person asks for access, and the owner answers from the notification');
const STAMP = Date.now().toString(36);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const owner = await registerOwner(BASE, `purarqown${STAMP}`);
const first = await registerOwner(BASE, `purarqone${STAMP}`);
const second = await registerOwner(BASE, `purarqtwo${STAMP}`);
const FILE = `purpose-arq-${STAMP}.html`;
const APP = `Team board ${STAMP}`;
const appRoute = `/v1/apps/${owner.name}/${FILE}`;
const open = (token: string) => json(`${appRoute}/open`, { method: 'POST', headers: auth(token), body: '{}' });

const org = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: `Purpose team ${STAMP}`, type: 'team', join_policy: 'invite_only', visibility: 'private' }) });
assert(org.status === 201, `organism ${org.status} ${JSON.stringify(org.body?.error)}`);
const orgId = org.body.data.organism.id as string;
const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename: FILE, content: b64('<!DOCTYPE html><html><body><h1>BOARD</h1></body></html>'), name: APP, description: 'd', category: 'utility', tags: [] }) });
assert(pub.status === 201, `publish ${pub.status} ${JSON.stringify(pub.body?.error)}`);
const set = await json(`/v1/apps/${FILE}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ open_to: `organism:${orgId}` }) });
assert(set.status === 200, `open_to ${set.status} ${JSON.stringify(set.body?.error)}`);

await h.test('1. A person the app refuses asks for access, the owner approves with the notification\'s own button, and the app opens', async () => {
    assert((await open(first.token)).status === 403, 'the app opened for an outsider before anything was asked');
    const asked = await json(`${appRoute}/access-request`, { method: 'POST', headers: auth(first.token), body: JSON.stringify({ message: 'I joined the team' }) });
    assert(asked.status === 202 && asked.body.data.status === 'pending', `ask ${asked.status} ${JSON.stringify(asked.body?.error)}`);
    const notices = (await json('/v1/notifications', { headers: auth(owner.token) })).body.data.notifications as any[];
    const notice = notices.find(n => n.type === 'organism_access_request' && n.title.includes(first.name));
    assert(!!notice && notice.title.includes(APP), `the owner's notice: ${JSON.stringify(notice)}`);
    const approve = (notice.actions as any[]).find(a => a.id === 'approve');
    assert(approve?.kind === 'api' && approve.method === 'POST', `the Approve button: ${JSON.stringify(approve)}`);
    // What the bell does when the owner presses Approve: the button's own call, with the owner's session.
    const pressed = await json(approve.endpoint, { method: 'POST', headers: auth(owner.token), body: JSON.stringify(approve.body) });
    assert(pressed.status === 200 && pressed.body.data.decision === 'approved', `approve ${pressed.status} ${JSON.stringify(pressed.body?.error)}`);
    const opened = await open(first.token);
    assert(opened.status === 200 && typeof opened.body.data.url === 'string', `the app does not open after the approval: ${opened.status} ${JSON.stringify(opened.body?.error)}`);
    const told = ((await json('/v1/notifications', { headers: auth(first.token) })).body.data.notifications as any[]).find(n => n.type === 'organism_access_approved');
    assert(!!told && told.title.includes(APP), `the requester was not told: ${JSON.stringify(told)}`);
});

await h.test('2. The owner\'s own AI reads a second request and approves it over MCP, and the app opens for that person', async () => {
    const asked = await json(`${appRoute}/access-request`, { method: 'POST', headers: auth(second.token), body: '{}' });
    assert(asked.status === 202, `ask ${asked.status} ${JSON.stringify(asked.body?.error)}`);
    const ai = await openSession(BASE, (await makeAgent(BASE, owner, ['organism:read', 'organism:invite'])).token);
    const list = await callTool(ai, 'aimeat_organism_join_requests', { organism_id: orgId });
    const request = (list.data?.join_requests ?? []).find((r: any) => r.ghii === second.name);
    assert(!list.isError && request?.via?.label === APP, `the AI's list: ${list.text}`);
    const decided = await callTool(ai, 'aimeat_organism_join_request_review', { organism_id: orgId, request_id: request.id, decision: 'approved' });
    assert(!decided.isError && decided.data?.decision === 'approved', `the AI's decision: ${decided.text}`);
    assert((await open(second.token)).status === 200, 'the app does not open after the AI approved');
});

h.finish();
