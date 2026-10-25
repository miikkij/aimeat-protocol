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
 *     - the extension's own route still refuses an anonymous caller (401): only the node runs it;
 *     - a publisher-right developer of another account cannot add the declaration or change the
 *       extension or action it names (403), on the inline and the draft route (secaudit r54).
 *   Kept working beside that refusal: the owner in person, the owner's own agent, the developer
 *   republishing the live declaration or removing it, a full-right developer, an existing app.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-format-md
 * @version-history
 *   v1.2.1 — 2026-10-25 — Case 3 names the first owner's extension in full, and a bare name from another
 *     account names nothing of the first owner's (owner namespaces wish, secaudit2026oct22).
 *   v1.2.0 — 2026-10-25 — Cases 17 and 18: ?lang= reaches the action as input.lang, cached per language;
 *     a value that is not a language tag is dropped.
 *   v1.1.1 — 2026-10-22 — Case 8b: the developer of another account is refused with a 403
 *     (check:denial-coverage).
 *   v1.1.0 — 2026-10-22 — Cases 7 to 16: a delegated developer and the ?format=md declaration (secaudit 2026-10, r54).
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());
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
async function owner(tag: string) {
    const name = `fmd${tag}${stamp}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Format Md', password: 'FormatMd12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const tok = await ownerSignIn(BASE, name, 'FormatMd12345');
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
    return { markdown: '# Live from the app\\n\\nAsked for ' + input.format + ' of ' + input.app + '.' + (input.lang ? ' Language: ' + input.lang + '.' : ' No language.') };
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
    // Named with its owner, as another account names it (services/component-address.ts).
    const r = await publish(b.token, 'borrowed-md.html', page(meta(`/v1/ext/${encodeURIComponent(`${a.name}/${EXT}`)}/render`)));
    assert(r.status === 422 && r.body.error?.code === 'APP_FORMAT_MD_INVALID', `${r.status} ${JSON.stringify(r.body.error)}`);
    assert(/another owner/.test(r.body.error.message), `says why: ${r.body.error.message}`);
    // A bare name in another account's app names that account's own, which it does not have.
    const bare = await publish(b.token, 'borrowed-bare-md.html', page(meta(`/v1/ext/${EXT}/render`)));
    assert(bare.status === 422 && /not installed/.test(bare.body.error?.message ?? ''), `bare: ${bare.status} ${JSON.stringify(bare.body.error)}`);
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

// ── A developer of another account (secaudit 2026-10, r54) ──────────────────────────────────────
// The node runs the declared action in the OWNER's name for every reader, so which action that is
// stays the owner's choice: a publisher-right developer may keep or remove the live declaration, and
// only the full right may add one or change what it names.
const DAPP = 'deleg-md.html';
const EXT2 = `fmd2-${stamp}`;
const manifest2 = manifest.replaceAll(EXT, EXT2).replace(/  - id: broken[\s\S]*?script: "actions\/broken.js"\n/, '');
async function publishFor(token: string, ownerName: string, filename: string, html: string) {
    return json('/v1/apps', auth(token, { method: 'POST', body: JSON.stringify({ owner: ownerName, filename, content: Buffer.from(html).toString('base64'), mimeType: 'text/html', name: filename, description: 'Format md test app', roadmap: 'Format md delegate test version.' }) }));
}
async function formatMdOf(filename: string) {
    const list = await json('/v1/apps?own=true&limit=200', auth(a.token));
    const row = (list.body.data?.apps ?? []).find((x: any) => x.filename === filename);
    return { formatMd: row?.manifest?.formatMd ?? null, version: row?.versionNumber ?? row?.version_number ?? row?.version ?? null };
}
async function mdText(filename: string) {
    const res = await fetch(`${BASE}/v1/apps/${a.name}/${filename}?format=md`);
    return { status: res.status, text: await res.text() };
}
const grant = (level: string) => json(`/v1/apps/${a.name}/${DAPP}/dev-grants/${b.name}`, auth(a.token, { method: 'PUT', body: JSON.stringify({ level }) }));
const isDelegateRefusal = (r: { status: number; body: any }) => r.status === 403 && r.body.error?.code === 'FORBIDDEN'
    && /full development right/.test(r.body.error?.message ?? '') && r.body.error.message.includes(a.name);

const inst2 = await json('/v1/extensions', auth(a.token, { method: 'POST', body: JSON.stringify({ manifest: manifest2, scripts: { 'actions/render.js': scripts['actions/render.js'] } }) }));
assert(inst2.status === 201, `install 2 ${inst2.status}: ${JSON.stringify(inst2.body.error)}`);
const act2 = await json(`/v1/extensions/${EXT2}/activate`, auth(a.token, { method: 'POST', body: '{}' }));
assert(act2.status === 200, `activate 2 ${act2.status}: ${JSON.stringify(act2.body.error)}`);
const first = await publish(a.token, DAPP, page(''));
assert(first.status === 201 || first.status === 200, `publish ${DAPP} ${first.status}: ${JSON.stringify(first.body.error)}`);
const granted = await grant('publisher');
assert(granted.status === 200, `grant publisher ${granted.status}: ${JSON.stringify(granted.body.error)}`);

await test('7. FAILURE: a publisher-right developer of another account cannot add the declaration; the app and its ?format=md stay as they were', async () => {
    const before = await formatMdOf(DAPP);
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT}/render`)));
    assert(isDelegateRefusal(r), `${r.status} ${JSON.stringify(r.body.error)}`);
    assert(/leave the aimeat-format-md line out/.test(r.body.error.message), `names what to do: ${r.body.error.message}`);
    const after = await formatMdOf(DAPP);
    assert(after.formatMd === null && after.version === before.version, `manifest unchanged: ${JSON.stringify(after)}`);
    const md = await mdText(DAPP);
    assert(md.status === 200 && md.text.includes('The page body text.') && !md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('8. FAILURE: the same refusal through the draft route (save the draft, then publish it)', async () => {
    const saved = await json(`/v1/apps/${a.name}/${DAPP}/draft`, auth(b.token, { method: 'PUT', body: JSON.stringify({ content: Buffer.from(page(meta(`/v1/ext/${EXT}/render`))).toString('base64'), mime_type: 'text/html' }) }));
    assert(saved.status === 200 || saved.status === 201, `draft save ${saved.status}: ${JSON.stringify(saved.body.error)}`);
    const r = await json(`/v1/apps/${a.name}/${DAPP}/publish-draft`, auth(b.token, { method: 'POST', body: JSON.stringify({ roadmap: 'Format md delegate draft.' }) }));
    assert(isDelegateRefusal(r), `${r.status} ${JSON.stringify(r.body.error)}`);
    assert((await formatMdOf(DAPP)).formatMd === null, 'manifest unchanged');
    await json(`/v1/apps/${a.name}/${DAPP}/draft`, auth(a.token, { method: 'DELETE' }));
});

await test('8b. FAILURE: the refusal of the developer of another account is a 403, and the app keeps no declaration', async () => {
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT}/render`)));
    assert(r.status === 403, `the developer of another account: ${r.status} ${JSON.stringify(r.body.error)}`);
    assert((await formatMdOf(DAPP)).formatMd === null, 'manifest unchanged');
});

await test('9. the owner in person adds the declaration to the shared app, and ?format=md serves the action', async () => {
    const r = await publishFor(a.token, a.name, DAPP, page(meta(`/v1/ext/${EXT}/render`)));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const fm = (await formatMdOf(DAPP)).formatMd;
    assert(fm?.extension === EXT && fm.action === 'render', `manifest: ${JSON.stringify(fm)}`);
    const md = await mdText(DAPP);
    assert(md.text.includes('# Live from the app') && md.text.includes(`of ${a.name}/${DAPP}`), `served: ${md.text.slice(0, 200)}`);
});

await test('10. the publisher-right developer republishes with the same declaration, and ?format=md still serves the owner\'s action', async () => {
    const before = await formatMdOf(DAPP);
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT}/render`)).replace('The page body text.', 'The page body text, v2.'));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const after = await formatMdOf(DAPP);
    assert(after.formatMd?.extension === EXT && after.formatMd.action === 'render' && after.version !== before.version, `manifest: ${JSON.stringify(after)}`);
    const md = await mdText(DAPP);
    assert(md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('11. FAILURE: the publisher-right developer cannot change the declared action', async () => {
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT}/broken`)));
    assert(isDelegateRefusal(r), `${r.status} ${JSON.stringify(r.body.error)}`);
    assert(r.body.error.message.includes(`/v1/ext/${EXT}/render`), `names the live declaration to keep: ${r.body.error.message}`);
    const fm = (await formatMdOf(DAPP)).formatMd;
    assert(fm?.extension === EXT && fm.action === 'render', `manifest unchanged: ${JSON.stringify(fm)}`);
});

await test('12. FAILURE: the publisher-right developer cannot change the declared extension', async () => {
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT2}/render`)));
    assert(isDelegateRefusal(r), `${r.status} ${JSON.stringify(r.body.error)}`);
    const fm = (await formatMdOf(DAPP)).formatMd;
    assert(fm?.extension === EXT && fm.action === 'render', `manifest unchanged: ${JSON.stringify(fm)}`);
});

await test('13. the publisher-right developer may remove the declaration, and ?format=md falls back to the page', async () => {
    const r = await publishFor(b.token, a.name, DAPP, page(''));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert((await formatMdOf(DAPP)).formatMd === null, 'the declaration is gone');
    const md = await mdText(DAPP);
    assert(md.text.includes('The page body text.') && !md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('14. a full-right developer may add the declaration, and ?format=md serves the owner\'s action', async () => {
    const g = await grant('full');
    assert(g.status === 200, `grant full ${g.status}: ${JSON.stringify(g.body.error)}`);
    const r = await publishFor(b.token, a.name, DAPP, page(meta(`/v1/ext/${EXT2}/render`)));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const fm = (await formatMdOf(DAPP)).formatMd;
    assert(fm?.extension === EXT2 && fm.action === 'render', `manifest: ${JSON.stringify(fm)}`);
    const md = await mdText(DAPP);
    assert(md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('15. the owner\'s own agent adds the declaration for the owner, unchanged by the delegate rule', async () => {
    const pub = await publish(a.token, 'agent-md.html', page(''));
    assert(pub.status === 201 || pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const name = `fmdag${stamp}`;
    const reg = await json('/v1/agents', auth(a.token, { method: 'POST', body: JSON.stringify({ name, owner: a.name, scopes: ['app:write'] }) }));
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }) });
    assert(tok.status === 200, `agent token ${tok.status}: ${JSON.stringify(tok.body.error)}`);
    const r = await publish(tok.body.data.token, 'agent-md.html', page(meta(`/v1/ext/${EXT}/render`)));
    assert(r.status === 201 || r.status === 200, `agent publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    const fm = (await formatMdOf('agent-md.html')).formatMd;
    assert(fm?.extension === EXT && fm.action === 'render', `manifest: ${JSON.stringify(fm)}`);
    const md = await mdText('agent-md.html');
    assert(md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('16. an app published before any of this still answers ?format=md', async () => {
    const md = await mdText('live-md.html');
    assert(md.status === 200 && md.text.includes('# Live from the app'), `served: ${md.text.slice(0, 200)}`);
});

await test('17. ?lang= reaches the action as input.lang, on the apex route and per language, and no lang gives none', async () => {
    const es = await (await fetch(`${BASE}/v1/apps/${a.name}/live-md.html?format=md&lang=es`)).text();
    assert(es.includes('Language: es.'), `es: ${es.slice(0, 200)}`);
    const ptBr = await (await fetch(`${BASE}/v1/apps/${a.name}/live-md.html?format=md&lang=PT-BR`)).text();
    assert(ptBr.includes('Language: pt-BR.'), `pt-BR, primary subtag lowercased: ${ptBr.slice(0, 200)}`);
    // The answer for one language is cached on its own: asking without lang after es is not served es.
    const none = await (await fetch(`${BASE}/v1/apps/${a.name}/live-md.html?format=md`)).text();
    assert(none.includes('No language.'), `no lang: ${none.slice(0, 200)}`);
});

await test('18. FAILURE: a ?lang= that is not a language tag is dropped, and the page still answers', async () => {
    for (const bad of ['../../etc', 'en-US-x-private-long', '<script>', 'e', 'english']) {
        const res = await fetch(`${BASE}/v1/apps/${a.name}/live-md.html?format=md&lang=${encodeURIComponent(bad)}`);
        const text = await res.text();
        assert(res.status === 200 && text.includes('No language.'), `lang=${bad}: ${res.status} ${text.slice(0, 160)}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
