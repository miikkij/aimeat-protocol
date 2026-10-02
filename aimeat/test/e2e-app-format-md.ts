/**
 * @file e2e-app-format-md.ts
 * @description E2E for an app that answers ?format=md itself (services/app-format-md.ts): the app
 *   declares <meta name="aimeat-format-md" content="/v1/ext/<extension>/<action>">, the publish checks
 *   the extension is the owner's own and has the action, and GET ?format=md returns the action's
 *   markdown with the node's affordances footer.
 *
 *   Happy path: an owner installs an extension whose action returns markdown, publishes an app that
 *   names it, and an anonymous ?format=md gets that markdown; the app's manifest carries the setting.
 *
 *   Failure modes covered:
 *     - another owner cannot name the first owner's extension (422 APP_FORMAT_MD_INVALID);
 *     - an action the extension does not have is refused (422);
 *     - an action that throws falls back to the converted page (200, the page text);
 *     - the extension's own route still refuses an anonymous caller (401): only the node runs it.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-format-md
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function owner(tag: string) {
    const name = `fmd${tag}${stamp}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Format Md', password: 'FormatMd12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.data.token as string };
}

const EXT = `fmd-${stamp}`;
const manifest = `
extension: "1.0"
metadata:
  name: "${EXT}"
  version: "1.0.0"
  description: "Answers ?format=md for a test app"
  author: "test"
actions:
  - id: render
    method: POST
    path: "/v1/ext/${EXT}/render"
    script: "actions/render.js"
  - id: broken
    method: POST
    path: "/v1/ext/${EXT}/broken"
    script: "actions/broken.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
`;
const scripts = {
    'actions/render.js': `export default async function(ctx, input) {
    return { markdown: '# Live from the app\\n\\nAsked for ' + input.format + ' of ' + input.app + '.' };
  }`,
    'actions/broken.js': `export default async function() { throw new Error('nothing to say'); }`,
};
// The header comment mentions the tag without a content attribute, as a real app's version history
// does; the parser must take the real tag below it, not the mention.
const page = (meta: string) => `<!DOCTYPE html>\n<!-- v2: answers ?format=md with <meta name="aimeat-format-md"> -->\n<html><head><title>Format md</title>${meta}</head><body><p>The page body text.</p></body></html>`;
const meta = (content: string) => `<meta name="aimeat-format-md" content="${content}">`;

async function publish(token: string, filename: string, html: string) {
    return json('/v1/apps', auth(token, { method: 'POST', body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), mimeType: 'text/html', name: filename, description: 'Format md test app' }) }));
}

console.log('\n=== App ?format=md E2E ===\n');
await owner('o');   // a neutral first owner: the first one on a fresh database becomes the operator
const a = await owner('a');
const b = await owner('b');
const inst = await json('/v1/extensions', auth(a.token, { method: 'POST', body: JSON.stringify({ manifest, scripts }) }));
assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
const act = await json(`/v1/extensions/${EXT}/activate`, auth(a.token, { method: 'POST', body: '{}' }));
assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error)}`);

await test('1. an app that names its owner\'s extension action publishes, and its manifest says so', async () => {
    const r = await publish(a.token, 'live-md.html', page(meta(`/v1/ext/${EXT}/render`)));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = await json('/v1/apps?own=true&limit=200', auth(a.token));
    const row = (list.body.data?.apps ?? []).find((x: any) => x.filename === 'live-md.html');
    assert(row?.manifest?.formatMd?.extension === EXT && row.manifest.formatMd.action === 'render', `manifest: ${JSON.stringify(row?.manifest?.formatMd ?? list.body.error ?? null)}`);
});

await test('2. an anonymous ?format=md gets the action\'s markdown with the affordances footer', async () => {
    const res = await fetch(`${BASE}/v1/apps/${a.name}/live-md.html?format=md`);
    const text = await res.text();
    assert(res.status === 200, `status ${res.status}`);
    assert(text.includes('# Live from the app') && text.includes(`of ${a.name}/live-md.html`), `the app answered: ${text.slice(0, 200)}`);
    assert(text.includes('## Agent affordances') && !text.includes('The page body text.'), 'with the footer, and not the converted page');
});

await test('3. FAILURE: another owner cannot name the first owner\'s extension', async () => {
    const r = await publish(b.token, 'borrowed-md.html', page(meta(`/v1/ext/${EXT}/render`)));
    assert(r.status === 422 && r.body.error?.code === 'APP_FORMAT_MD_INVALID', `${r.status} ${JSON.stringify(r.body.error)}`);
    assert(/another owner/.test(r.body.error.message), `says why: ${r.body.error.message}`);
});

await test('4. FAILURE: an action the extension does not have is refused', async () => {
    const r = await publish(a.token, 'noaction-md.html', page(meta(`/v1/ext/${EXT}/nope`)));
    assert(r.status === 422 && r.body.error?.code === 'APP_FORMAT_MD_INVALID' && /has no action "nope"/.test(r.body.error.message), `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('5. FAILURE: an action that throws falls back to the converted page', async () => {
    const r = await publish(a.token, 'broken-md.html', page(meta(`/v1/ext/${EXT}/broken`)));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const res = await fetch(`${BASE}/v1/apps/${a.name}/broken-md.html?format=md`);
    const text = await res.text();
    assert(res.status === 200 && text.includes('The page body text.'), `fallback: ${res.status} ${text.slice(0, 200)}`);
});

await test('6. FAILURE: the extension\'s own route still refuses an anonymous caller; only the node runs it for ?format=md', async () => {
    const r = await json(`/v1/ext/${EXT}/render`, { method: 'POST', body: '{}' });
    assert(r.status === 401, `anonymous extension call: ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
