/**
 * @file test/e2e-purpose-owner-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: the owner's agents and apps act for the owner. The owner's agent reads the
 *   owner's records shared with the owner's own principals and with the node's members, over REST and
 *   over MCP; it reads the owner's members-level data package, never less than another account's
 *   agent reads; a private package asks it for a permission word the refusal names, and with the word
 *   it reads. The owner's app reads and writes the owner's data it declared. AIMEAT-PURPOSE.md use 3,
 *   invariant 20.
 *
 *   WHY IT EXISTS. The October 2026 audit's second wave made the owner's agents read the owner's
 *   packages less than a stranger's agent could, with every suite green, because no suite asserted
 *   the owner's own reach. Each test here names the use and fails when the use is gone.
 *
 *   FAIL FIRST, 2026-10-21, both backends: with services/datapackage/audience.ts datapackageReadable
 *   refusing a principal of the owner without storage:read on every audience (the first wave's
 *   shape), test 3 is red; restored byte for byte.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-owner-reach
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, appGrantToken, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness("Purpose: the owner's agents and apps act for the owner");
const STAMP = Date.now().toString(36);

const owner = await registerOwner(BASE, `purposeown${STAMP}`);
const other = await registerOwner(BASE, `purposeoth${STAMP}`);
// The owner's chat AI with the plain read word, and a second agent the owner gave storage:read.
const chat = await makeAgent(BASE, owner, ['memory:read', 'memory:write']);
const reader = await makeAgent(BASE, owner, ['memory:read', 'storage:read']);
const otherAgent = await makeAgent(BASE, other, ['memory:read']);

const OWNER_NOTE = `purpose.${STAMP}.owner-note`;
const MEMBERS_NOTE = `purpose.${STAMP}.members-note`;
const PRIVATE_NOTE = `purpose.${STAMP}.private-note`;
const MEMBERS_PKG = `purpose-members-${STAMP}`;
const PRIVATE_PKG = `purpose-private-${STAMP}`;

const write = (token: string, key: string, value: unknown, visibility: string) =>
    json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, value, visibility }) });
const publish = (name: string, visibility: string) => json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name, changes: 'purpose e2e', visibility, resources: [{ name: 'orders', rows: [{ id: 1, item: 'tea' }, { id: 2, item: 'cake' }] }] }),
});
const readPackage = (token: string, name: string) => json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${name}`, { headers: auth(token) });
const readRows = (token: string, name: string) => json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${name}/rows/orders`, { headers: auth(token) });

await h.test('1. Setup: the owner keeps a note for their own AIs, one for the node\'s members and one private; and publishes two packages', async () => {
    for (const [key, vis] of [[OWNER_NOTE, 'owner'], [MEMBERS_NOTE, 'members'], [PRIVATE_NOTE, 'private']] as const) {
        const w = await write(owner.token, key, { said: vis }, vis);
        assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }
    for (const [name, vis] of [[MEMBERS_PKG, 'members'], [PRIVATE_PKG, 'private']] as const) {
        const p = await publish(name, vis);
        assert(p.status === 201, `publish ${name}: ${p.status} ${JSON.stringify(p.body?.error)}`);
    }
});

await h.test("2. The owner's agent reads the owner's records kept for the owner's AIs and for members (REST and MCP)", async () => {
    for (const key of [OWNER_NOTE, MEMBERS_NOTE]) {
        const r = await json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true`, { headers: auth(chat.token) });
        assert(r.status === 200 && r.body.data?.value?.said, `REST read of ${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
    const session = await openSession(BASE, chat.token, 'purpose-chat');
    const m = await callTool(session, 'aimeat_memory_read', { key: OWNER_NOTE, owner_scope: true });
    assert(!m.isError && m.text.includes('"owner"'), `MCP read: ${m.text.slice(0, 300)}`);
});

await h.test("3. The owner's agent reads the owner's members-level data package, and never less than another account's agent", async () => {
    const theirs = await readPackage(otherAgent.token, MEMBERS_PKG);
    assert(theirs.status === 200, `control: another account's agent reads a members package: ${theirs.status}`);
    const mine = await readPackage(chat.token, MEMBERS_PKG);
    assert(mine.status === 200 && mine.body.data.descriptor.resources[0].rowCount === 2, `the owner's agent: ${mine.status} ${JSON.stringify(mine.body?.error)}`);
    const rows = await readRows(chat.token, MEMBERS_PKG);
    assert(rows.status === 200 && rows.body.data.rows.length === 2, `the rows: ${rows.status} ${JSON.stringify(rows.body?.error)}`);
});

await h.test('4. A private package asks the agent for a word, and the refusal names it so the owner can tick it', async () => {
    const r = await readPackage(chat.token, PRIVATE_PKG);
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED' && /storage:read/.test(r.body.error.message ?? ''),
        `the refusal names the word: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const stranger = await readPackage(otherAgent.token, PRIVATE_PKG);
    assert(stranger.status === 404, `another account's agent learns nothing: ${stranger.status}`);
});

await h.test("5. With the word the owner gave, the owner's agent reads the owner's private package; the owner in person always does", async () => {
    const r = await readRows(reader.token, PRIVATE_PKG);
    assert(r.status === 200 && r.body.data.rows.length === 2, `with storage:read: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const self = await readRows(owner.token, PRIVATE_PKG);
    assert(self.status === 200, `the owner in person: ${self.status}`);
});

await h.test("6. The owner's app reads the owner's private note and writes into the owner's data, as it declared", async () => {
    const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read memory:write"></head><body>notes</body></html>';
    const app = await appGrantToken(owner, `purpose-notes-${STAMP}.html`, 'memory:read memory:write', html);
    const r = await json(`/v1/memory/${encodeURIComponent(PRIVATE_NOTE)}`, { headers: auth(app) });
    assert(r.status === 200 && r.body.data.value.said === 'private', `the app reads the owner's note: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const saved = `purpose.${STAMP}.from-app`;
    const w = await write(app, saved, { by: 'app' }, 'private');
    assert(w.status === 201, `the app writes: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const back = await json(`/v1/memory/${encodeURIComponent(saved)}`, { headers: auth(owner.token) });
    assert(back.status === 200 && back.body.data.value.by === 'app', `the write is the owner's own: ${back.status}`);
});

h.finish();
