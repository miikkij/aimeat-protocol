/**
 * @file test/e2e-company-page-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bytes a company's address serves (`company/<id>/index.html` in the owner's files)
 *   change only for a caller that may change the company's page, whichever upload route it takes
 *   (secaudit2026oct31w2 round 11, storage-file-write:company-front-page-key-unfenced-below-company-write).
 *
 *   The hole: an app the owner granted only file access (storage:write) replaced or removed the company's
 *   front page through POST /v1/storage, the chunked upload, the presigned upload, POST /v1/memory/files
 *   or DELETE /v1/storage, although the company page route asks company:write.
 *
 *   Designed use, which must keep working: the owner in person writes any file of theirs, an app holding
 *   company:write writes the page through the generic routes too, an app with storage:write stores every
 *   other key, and an app refused here gets the owner's one-press answer: the owner allows it, and the
 *   app's next write lands.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=company-page-key
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import { BASE, harness, assert, auth, json, appGrantToken } from './helpers/purpose-kit.js';
import { registerOwner } from './helpers/owner-login.js';
import { hostRequest } from './helpers/host-request.js';

const CO_HOST = process.env.AIMEAT_CO_HOST ?? 'co.localhost';
const PORT = new URL(BASE).port || '80';
const h = harness('E2E: the company page key needs company:write on every upload route');

const stamp = Date.now().toString(36).slice(-6);
const owner = await registerOwner(BASE, `cpk${stamp}`);
const appHtml = '<!doctype html><html><head><meta charset="utf-8"><title>files app</title></head><body>files</body></html>';
const filesApp = await appGrantToken({ name: owner.name, token: owner.token }, `cpkfiles${stamp}.html`, 'storage:read storage:write', appHtml);
const pageApp = await appGrantToken({ name: owner.name, token: owner.token }, `cpkpage${stamp}.html`, 'storage:read storage:write company:write', appHtml);

const PAGE = (word: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${word}</title></head><body><h1>${word}</h1></body></html>`;
const b64 = (s: string) => Buffer.from(s).toString('base64');

const reg = await json('/v1/companies', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: `Sivuavain Oy ${stamp}` }) });
assert(reg.status === 201, `company: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
const companyId: string = reg.body.data.company.id;
const slug: string = reg.body.data.company.slug;
const pageKey = `company/${companyId}/index.html`;
const pub = await json(`/v1/companies/${companyId}/portfolio`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ html: PAGE('THE OWNERS PAGE') }) });
assert(pub.status === 200, `company page: ${pub.status} ${JSON.stringify(pub.body?.error)}`);

async function served(): Promise<string> {
    const res = await hostRequest(BASE, '/', `${slug}.${CO_HOST}:${PORT}`, { headers: { 'x-co-origin': '1', 'x-subdomain': slug } });
    return `${res.status} ${res.body}`;
}
const storeAs = (token: string, key: string, html: string) =>
    json('/v1/storage', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, data: b64(html), mime_type: 'text/html', visibility: 'owner' }) });

let askId = '';

await h.test('attack: an app with only file access cannot replace the company page through POST /v1/storage', async () => {
    const w = await storeAs(filesApp, pageKey, PAGE('NOT THE OWNERS PAGE'));
    assert(w.status === 403, `POST /v1/storage: ${w.status} ${JSON.stringify(w.body?.error ?? w.body?.data)}`);
    assert(String(w.body?.error?.message).includes(`PUT /v1/companies/${companyId}/portfolio`), `the refusal names the company page route: ${w.body?.error?.message}`);
    const now = await served();
    assert(now.includes('THE OWNERS PAGE') && !now.includes('NOT THE OWNERS'), `the address serves: ${now.slice(0, 120)}`);
});

await h.test('attack: nor through POST /v1/memory/files, the presigned upload or the chunked upload', async () => {
    const mf = await json('/v1/memory/files', { method: 'POST', headers: auth(filesApp), body: JSON.stringify({ key: pageKey, content: b64(PAGE('NOT THE OWNERS PAGE')), mime_type: 'text/html', visibility: 'owner' }) });
    assert(mf.status === 403, `POST /v1/memory/files: ${mf.status} ${JSON.stringify(mf.body?.error)}`);
    const mfp = await json('/v1/memory/files', { method: 'POST', headers: auth(filesApp), body: JSON.stringify({ key: pageKey, mode: 'presigned', mime_type: 'text/html', visibility: 'owner' }) });
    assert(mfp.status === 403, `POST /v1/memory/files presigned: ${mfp.status} ${JSON.stringify(mfp.body?.error)}`);
    const pre = await json('/v1/storage', { method: 'POST', headers: auth(filesApp), body: JSON.stringify({ key: pageKey, mode: 'presigned', mime_type: 'text/html', visibility: 'owner' }) });
    assert(pre.status === 403, `POST /v1/storage presigned: ${pre.status} ${JSON.stringify(pre.body?.error)}`);
    const init = await json('/v1/storage/upload/init', { method: 'POST', headers: auth(filesApp), body: JSON.stringify({ key: pageKey, chunk_size: 1024, total_chunks: 1, mime_type: 'text/html', visibility: 'owner' }) });
    assert(init.status === 403, `chunked init: ${init.status} ${JSON.stringify(init.body?.error)}`);
    assert((await served()).includes('THE OWNERS PAGE'), 'the address still serves the owner\'s page');
});

await h.test('attack: nor remove it through DELETE /v1/storage', async () => {
    const d = await json(`/v1/storage/${pageKey}`, { method: 'DELETE', headers: auth(filesApp) });
    assert(d.status === 403, `DELETE /v1/storage: ${d.status} ${JSON.stringify(d.body?.error ?? d.body?.data)}`);
    assert((await served()).includes('THE OWNERS PAGE'), 'the address still serves the owner\'s page');
});

await h.test('the owner is asked once, with one press, whether the app may change the company page', async () => {
    const list = await json('/v1/publish-requests', { headers: auth(owner.token) });
    const asked = ((list.body?.data?.requests ?? list.body?.data?.items ?? []) as any[]).filter(r => r.kind === 'company-page-write' && r.state === 'awaiting_owner');
    assert(asked.length === 1, `waiting questions: ${JSON.stringify(asked.map(r => [r.id, r.kind, r.state]))}`);
    askId = asked[0].id;
    const again = await storeAs(filesApp, pageKey, PAGE('NOT THE OWNERS PAGE'));
    // The app sees its question as pending: every further try names the same waiting request.
    assert(again.status === 403 && String(again.body?.error?.message).includes(askId), `a second try names the waiting question: ${again.body?.error?.message}`);
    const after = await json('/v1/publish-requests', { headers: auth(owner.token) });
    const still = ((after.body?.data?.requests ?? after.body?.data?.items ?? []) as any[]).filter(r => r.kind === 'company-page-write' && r.state === 'awaiting_owner');
    assert(still.length === 1 && still[0].id === askId, `still one question: ${JSON.stringify(still.map(r => r.id))}`);
});

await h.test('designed use: the owner in person writes the page through POST /v1/storage as before', async () => {
    const w = await storeAs(owner.token, pageKey, PAGE('OWNER BY FILE'));
    assert(w.status === 201, `owner write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    assert((await served()).includes('OWNER BY FILE'), 'the address serves the owner\'s file write');
});

await h.test('designed use: an app holding company:write writes the page through the generic route', async () => {
    const w = await storeAs(pageApp, pageKey, PAGE('PAGE APP WROTE'));
    assert(w.status === 201, `company:write app: ${w.status} ${JSON.stringify(w.body?.error)}`);
    assert((await served()).includes('PAGE APP WROTE'), 'the address serves the page app\'s write');
});

await h.test('designed use: an app with only file access stores every other key as before', async () => {
    const w = await storeAs(filesApp, `notes/${stamp}.html`, PAGE('a note'));
    assert(w.status === 201, `other key: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const near = await storeAs(filesApp, `company/${companyId}/logo.html`, PAGE('beside the page'));
    assert(near.status === 201, `a key beside the page: ${near.status} ${JSON.stringify(near.body?.error)}`);
    const del = await json(`/v1/storage/notes/${stamp}.html`, { method: 'DELETE', headers: auth(filesApp) });
    assert(del.status === 200, `delete of its own other key: ${del.status} ${JSON.stringify(del.body?.error)}`);
});

await h.test('designed use: the owner allows it with one press, and the app\'s next write lands', async () => {
    const r = await json(`/v1/publish-requests/${askId}/decision`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(r.status === 200 && r.body.data.request.state === 'approved', `decision: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.request?.state)}`);
    const w = await storeAs(filesApp, pageKey, PAGE('ALLOWED FILES APP'));
    assert(w.status === 201, `write after the press: ${w.status} ${JSON.stringify(w.body?.error)}`);
    assert((await served()).includes('ALLOWED FILES APP'), 'the address serves the allowed write');
});

h.finish();
