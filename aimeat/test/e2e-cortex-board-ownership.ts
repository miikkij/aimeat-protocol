/**
 * @file test/e2e-cortex-board-ownership.ts
 * @description E2E for the board a cortex activation makes (secaudit2026oct22,
 *   cortex-activation-adopts-foreign-board-id).
 *
 *   WHAT THIS PROVES. A board-template component makes the board `cortex-<cortex>-<component>`. Two
 *   cortexes can derive the same id (`a-b` + `c` and `a` + `b-c`), and activation took an existing
 *   board of that id as its own and recorded it, so deactivating the second cortex deleted the first
 *   owner's board and its posts. Activation now answers 409 when the board of that id belongs to
 *   another account, and deactivation deletes only the boards the installing account holds.
 *
 *   AND WHAT STAYS. The owner's own deactivate, re-activate, redeploy and uninstall of the cortex
 *   that made the board.
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-cortex-board-ownership
 * @version-history
 *   2026-10-25 — The colliding board id is derived through the account names (cortex-<installer>-<name>-<component>), and the second owner names the first owner's cortex by its full name, as names live in the owner's namespace (secaudit2026oct22).
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22).
 */
import { registerOwner } from './helpers/owner-login.js';

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const sfx = Math.random().toString(36).slice(2, 7);
const firstName = `cbo${sfx}`;
const secondName = `cbo${sfx}-kit`;
let first = '';
let second = '';

// A cortex is stored as `<installer>/<name>` and its board id is `cortex-<installer>-<name>-<component>`
// (the slash becomes a hyphen, services/component-address.ts idStemOf). The two cortexes derive one
// board id through the account names: `cortex-` + `cbo<sfx>` + `-` + `kit-board` + `-general`, and
// `cortex-` + `cbo<sfx>-kit` + `-` + `board` + `-general`.
const firstCortex = 'kit-board';
const secondCortex = 'board';
const firstFull = `${firstName}/${firstCortex}`;
const boardId = `cortex-${firstName}-${firstCortex}-general`;

function manifest(name: string, component: string, version: string, title: string): string {
    return `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: community
  description: "Board ownership fixture"
  author: e2e
spec:
  version: "${version}"
  components:
    - type: board-template
      name: ${component}
      title: "${title}"
      description: "Board ownership fixture board"
      visibility: public
      seed_posts:
        - title: "Seed"
          body: "A seeded post"
`;
}

async function boardOf(token: string): Promise<any | undefined> {
    const { body } = await json('/v1/boards', { headers: auth(token) });
    return (body.data?.boards ?? []).find((b: any) => b.id === boardId);
}

async function install(token: string, name: string, component: string, version = '1.0.0', title = 'Fixture') {
    return json('/v1/cortex', { method: 'POST', headers: auth(token), body: JSON.stringify({ manifest: manifest(name, component, version, title) }) });
}

console.log('\n=== Cortex board ownership ===\n');

await test('Setup: two owners', async () => {
    first = (await registerOwner(BASE, firstName)).token;
    second = (await registerOwner(BASE, secondName)).token;
    assert(!!first && !!second, 'both owners have a token');
});

await test('The first owner installs and activates a cortex that makes the board', async () => {
    const inst = await install(first, firstCortex, 'general');
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/cortex/${firstCortex}/activate`, { method: 'POST', headers: auth(first) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error)}`);
    assert(await boardOf(first), `board ${boardId} exists`);
});

console.log('Refusal');

await test('Another owner may not deactivate the first owner\'s cortex: 403, and the board stays', async () => {
    const off = await json(`/v1/cortex/${encodeURIComponent(firstFull)}/deactivate`, { method: 'POST', headers: auth(second) });
    assert(off.status === 403, `expected 403, got ${off.status} ${off.body.error?.code}`);
    assert(await boardOf(first), 'the first owner\'s board stays');
});

await test('Another owner\'s cortex that derives the same board id is refused with 409, and the board stays', async () => {
    const inst = await install(second, secondCortex, 'general');
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
    assert(inst.body.data?.name === `${secondName}/${secondCortex}`, `the second install lands in its own namespace: ${inst.body.data?.name}`);
    const act = await json(`/v1/cortex/${secondCortex}/activate`, { method: 'POST', headers: auth(second) });
    if (act.status === 200) {
        await json(`/v1/cortex/${secondCortex}/deactivate`, { method: 'POST', headers: auth(second) });
        throw new Error(`expected 409, got 200; after the second owner's deactivate the first owner's board is ${await boardOf(first) ? 'still there' : 'gone'}`);
    }
    assert(act.status === 409, `expected 409, got ${act.status} ${act.body.error?.code}`);
    assert(act.body.error?.code === 'BOARD_ID_TAKEN', `code: ${act.body.error?.code}`);
    assert(await boardOf(first), 'the first owner\'s board stays');
    const posts = await json(`/v1/boards/${boardId}/posts`, { headers: auth(first) });
    assert((posts.body.data?.total ?? posts.body.data?.posts?.length ?? 0) >= 1, `posts stay: ${JSON.stringify(posts.body.data)}`);
});

await test('The refused cortex stays inactive and its uninstall leaves the board', async () => {
    const del = await json(`/v1/cortex/${secondCortex}`, { method: 'DELETE', headers: auth(second) });
    assert(del.status === 200, `uninstall ${del.status}: ${JSON.stringify(del.body.error)}`);
    assert(await boardOf(first), 'the first owner\'s board stays');
});

console.log('Designed use');

await test('The owner deactivates and re-activates their cortex: the board goes and comes back', async () => {
    const off = await json(`/v1/cortex/${firstCortex}/deactivate`, { method: 'POST', headers: auth(first) });
    assert(off.status === 200, `deactivate ${off.status}: ${JSON.stringify(off.body.error)}`);
    assert(!(await boardOf(first)), 'the board is gone after deactivation');
    const on = await json(`/v1/cortex/${firstCortex}/activate`, { method: 'POST', headers: auth(first) });
    assert(on.status === 200, `activate ${on.status}: ${JSON.stringify(on.body.error)}`);
    assert(await boardOf(first), 'the board is back');
});

await test('The owner redeploys the active cortex: the board is made from the new manifest', async () => {
    const up = await json(`/v1/cortex/${firstCortex}`, {
        method: 'PUT', headers: auth(first), body: JSON.stringify({ manifest: manifest(firstCortex, 'general', '1.0.1', 'Fixture v2') }),
    });
    assert(up.status === 200 || up.status === 201, `redeploy ${up.status}: ${JSON.stringify(up.body.error)}`);
    const board = await boardOf(first);
    assert(board?.name === 'Fixture v2', `board after redeploy: ${JSON.stringify(board)}`);
});

await test('The owner uninstalls the cortex: the board goes', async () => {
    const del = await json(`/v1/cortex/${firstCortex}`, { method: 'DELETE', headers: auth(first) });
    assert(del.status === 200, `uninstall ${del.status}: ${JSON.stringify(del.body.error)}`);
    assert(!(await boardOf(first)), 'the board is gone after uninstall');
});

await test('Cleanup', async () => {
    for (const [name, token] of [[firstName, first], [secondName, second]]) {
        await json(`/v1/owners/${name}`, { method: 'DELETE', headers: auth(token) });
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
