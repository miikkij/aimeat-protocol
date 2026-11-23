/**
 * @file test/e2e-file-open-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A link to a stored file, opened in a new tab on an open node. The web app keeps the
 *   session in localStorage, so a new tab carries no credential, and GET /v1/pub answered a signed-in
 *   person 404 for every file that is not public (seen on an organisation node 2026-11-23). A page
 *   navigation with no credential now goes to /v1/file-open, which reads the file with the session
 *   (middleware/file-open-redirect.ts). Test 1 was red before the change (404). The same on a node set
 *   to signed-in content access is in e2e-content-access-browser.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-file-open-link
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

/** What a browser sends for a page load and a new tab. */
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const CONTENT = `file link note ${Date.now()}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const tag = Date.now() % 100000;

/** A request as a browser tab sends it: no Authorization header, no redirect followed. */
function tab(path: string, accept = PAGE_ACCEPT, token?: string) {
    return fetch(`${BASE}${path}`, { redirect: 'manual', headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

console.log('\n=== A file link opened in a new tab ===\n');

const alice = await registerOwner(BASE, `fopenalice${tag}`);
const bob = await registerOwner(BASE, `fopenbob${tag}`);
let aliceGhii = '';

async function upload(key: string, visibility: string): Promise<string> {
    const up = await json('/v1/storage', { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ key, data: b64(CONTENT), mime_type: 'text/plain', visibility }) });
    assert(up.status === 201 && typeof up.body.data?.owner_gaii === 'string', `upload ${key}: ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`);
    aliceGhii = up.body.data.owner_gaii;
    return `/v1/pub/${encodeURIComponent(aliceGhii)}/${encodeURIComponent(key)}`;
}

const membersFile = await upload('notes/members-note.txt', 'members');
const ownerFile = await upload('notes/owner-note.txt', 'owner');
const publicFile = await upload('notes/public-note.txt', 'public');

await test('1. A new tab on a members file goes to the file page, which reads the file with the session', async () => {
    const res = await tab(membersFile);
    assert(res.status === 302, `the new tab got ${res.status}, not the file page`);
    assert(res.headers.get('location') === `/v1/file-open?path=${encodeURIComponent(membersFile)}`, `location: ${res.headers.get('location')}`);
    assert(res.headers.get('cache-control') === 'no-store', `cacheable redirect: ${res.headers.get('cache-control')}`);
    const page = await tab(`/v1/file-open?path=${encodeURIComponent(membersFile)}`);
    const pageBody = await page.text();
    assert(page.status === 200 && (page.headers.get('content-type') ?? '').includes('text/html'), `the file page: ${page.status}`);
    assert(!pageBody.includes(CONTENT), 'the shell carried the file');
    // What the page asks: the same address with the session for the handle, then the presigned address.
    const handle = await json(`${membersFile}?mode=handle`, { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(handle.status === 200 && typeof handle.body.data?.download_url === 'string', `the handle with the session: ${handle.status}`);
    const bytes = await tab(new URL(handle.body.data.download_url).pathname);
    assert(bytes.status === 200 && await bytes.text() === CONTENT, `the presigned address: ${bytes.status}`);
});

await test('2. FAILURE: an image, a fetch, an API call and the handle keep the 404; a missing file redirects alike', async () => {
    for (const accept of ['image/avif,image/webp,image/png,*/*;q=0.8', '*/*', 'application/json']) {
        const res = await tab(membersFile, accept);
        assert(res.status === 404, `Accept ${accept}: ${res.status}`);
    }
    const handle = await tab(`${membersFile}?mode=handle`);
    assert(handle.status === 404, `the handle without a session: ${handle.status}`);
    // A stranger learns nothing more than from the 404: a file that does not exist redirects the same way.
    const missing = `/v1/pub/${encodeURIComponent(aliceGhii)}/no-such-file-${tag}`;
    const gone = await tab(missing);
    assert(gone.status === 302 && gone.headers.get('location') === `/v1/file-open?path=${encodeURIComponent(missing)}`, `a missing file: ${gone.status}`);
});

await test('3. A tab with a credential and a public file are served as before', async () => {
    const signedIn = await tab(membersFile, PAGE_ACCEPT, bob.token);
    assert(signedIn.status === 200 && await signedIn.text() === CONTENT, `a request with a credential: ${signedIn.status}`);
    const pub = await tab(publicFile);
    assert(pub.status === 200 && await pub.text() === CONTENT, `a public file in a new tab: ${pub.status}`);
});

await test('4. FAILURE: the page carries the session, never past the route: another account gets no handle for an owner-only file', async () => {
    const res = await json(`${ownerFile}?mode=handle`, { headers: { Authorization: `Bearer ${bob.token}` } });
    if (res.status === 403) expectRefusal(res, 403);
    else expectRefusal(res, 404, 'NOT_FOUND');
    const own = await json(`${ownerFile}?mode=handle`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(own.status === 200, `the owner was refused their own file: ${own.status}`);
});

finish();
