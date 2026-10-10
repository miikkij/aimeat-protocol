/**
 * @file test/e2e-theme-fonts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the font manager (docs/internal/fontmanager/PLAN.md): the operator adds a face
 *   to the running node, and the themes and the Design Book can use it at once.
 *
 *   The happy path: a family is registered, a real woff2 is uploaded through PUT /v1/upload/:token,
 *   the face appears in the inventory and in aimeat_theme_list, a style of a theme accepts it,
 *   fonts.css names it, the file route serves it, and the Design Book bench accepts a look that
 *   starts with it. The failure modes: a file that is not woff2 is refused, a non-operator is refused
 *   on every write route, removal is refused while a style names the face, and a family without
 *   licence data is "unknown" and appears in the compliance report.
 *
 *   The ones that matter most (Jouni, 2026-10-03): an added face is always marked as added, never as
 *   base setup; missing licence data is marked "unknown" and is seen at an audit; owners do not add
 *   theme fonts, and their own fonts in storage show to the operator as an inventory only.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=theme-fonts
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial suite (font manager).
 *   v1.0.1 — 2026-10-10 — The base-face count is read from THEME_FACES (nightly sweep red since IBM
 *     Plex Sans and Mono made it 25), and every base face must have its licence trail.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_FACES } from '../src/services/themes/tokens.js';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

// A real woff2 that is already in the repository (SIL OFL 1.1): uploaded under a family name of the
// test's own, so no new binary is checked in.
const here = dirname(fileURLToPath(import.meta.url));
const WOFF2 = readFileSync(join(here, '..', 'public', 'lib', 'fonts', 'vt323-latin.woff2'));

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
    const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

/** An MCP session on /v1/mcp for one agent of `owner`, holding `scopes`. */
async function mcpSessionFor(ownerToken: string, owner: string, agentName: string, scopes: string[]) {
    const agent = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner, capabilities: ['themes'], model: 'gpt-4o', scopes }),
    });
    assert(agent.status === 201, `agent: ${agent.status} ${JSON.stringify(agent.body.error ?? '')}`);
    const gaii = agent.body.data.agent.gaii as string;
    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Font manager E2E', redirect_uris: [] }) });
    assert(client.status === 201, `mcp register: ${client.status}`);
    const ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii,
        signature: await signMsg(agent.body.data.private_key, gaii + NODE_ID + ts), timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }),
    });
    assert(tok.status === 200, `mcp token: ${tok.status}`);
    const token = tok.body.access_token as string;
    let session = '';
    const rpc = async (method: string, params: Record<string, unknown> = {}, id = 1) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) session = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream')) return await res.json() as any;
        const messages = (await res.text()).split('\n\n').map((evt) => {
            const data = evt.trim().split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
            try { return data ? JSON.parse(data) : null; } catch { return null; }
        }).filter(Boolean);
        return messages.find((m: any) => m.id === id) ?? messages[0] ?? {};
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Font manager E2E', version: '1.0.0' } });
    let next = 10;
    return {
        /** One tool call: the text of its answer and whether it is an error. */
        call: async (name: string, args: Record<string, unknown>) => {
            const r = await rpc('tools/call', { name, arguments: args }, next++);
            const text = String(r?.result?.content?.[0]?.text ?? JSON.stringify(r));
            return { isError: r?.result?.isError === true, text };
        },
    };
}

/** PUT the bytes to a presigned upload address. */
async function upload(url: string, bytes: Buffer) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'font/woff2' }, body: bytes });
    const body = await res.json().catch(() => ({})) as any;
    return { status: res.status, body };
}

// ─── State ───
let opToken = '';
let memberToken = '';
const stamp = Date.now();
const opName = `testfontop${stamp}`;
const memberName = `testfontuser${stamp}`;
const FAMILY = 'Harbour Mono';
const SLUG = 'harbour-mono';
let themeId = '';
let styleId = '';

const as = (token: string, opts: RequestInit = {}): RequestInit => ({
    ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` },
});
const op = (opts: RequestInit = {}) => as(opToken, opts);
const member = (opts: RequestInit = {}) => as(memberToken, opts);
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const del = () => ({ method: 'DELETE' });
const FAMILY_BODY = {
    family: FAMILY, kind: 'monospace', files: [{ weight: '400', style: 'normal' }],
    licence: 'OFL-1.1', copyright: '© Peter Hull (the VT323 file, renamed for the test)', source: 'https://fonts.google.com/specimen/VT323',
};

console.log('\n=== AIMEAT Font manager E2E Test ===\n');
console.log('Setup');

await test('Register operator owner (first owner is auto-operator)', async () => {
    opToken = await registerOwner(opName);
    assert(opToken.length > 0, 'got operator token');
});

await test('Register an ordinary member', async () => {
    memberToken = await registerOwner(memberName);
    assert(memberToken.length > 0, 'got member token');
});

console.log('\nThe base faces');

// The count is read from THEME_FACES, so a face added to the code needs no edit here.
const BASE_FACE_COUNT = Object.keys(THEME_FACES).length;

await test('GET /v1/themes/fonts — public: every base face, each with its licence trail, no owners\' files', async () => {
    const { status, body } = await json('/v1/themes/fonts');
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
    const base = body.data.base as any[];
    assert(base.length === BASE_FACE_COUNT, `${BASE_FACE_COUNT} base faces, got ${base.length}`);
    assert(base.every((f) => f.licenceStatus === 'stated'), `every base face has its licence trail: ${base.filter((f) => f.licenceStatus !== 'stated').map((f) => f.family).join(', ')}`);
    const fjalla = base.find((f) => f.family === 'Fjalla One');
    assert(!!fjalla && fjalla.origin === 'base', 'Fjalla One is base setup');
    assert(fjalla.licence === 'OFL-1.1' && fjalla.licenceStatus === 'stated', `licence ${fjalla.licence} ${fjalla.licenceStatus}`);
    assert(/Sorkin/.test(fjalla.copyright) && /fonts\.google\.com/.test(fjalla.source), `trail ${fjalla.copyright} ${fjalla.source}`);
    assert(fjalla.weights.includes('400'), `weights ${fjalla.weights}`);
    assert(Array.isArray(body.data.added) && body.data.added.length === 0, 'nothing added yet');
    assert(body.data.owners === undefined, 'a visitor does not see the owners\' storage');
});

console.log('\nOnly the operator adds a face');

await test('A visitor → 401, an ordinary owner → 403 on PUT and DELETE', async () => {
    const anon = await json(`/v1/themes/fonts/${SLUG}`, put(FAMILY_BODY));
    assert(anon.status === 401, `anonymous PUT: ${anon.status}`);
    const mine = await json(`/v1/themes/fonts/${SLUG}`, member(put(FAMILY_BODY)));
    assert(mine.status === 403, `member PUT: ${mine.status}`);
    const gone = await json(`/v1/themes/fonts/${SLUG}`, member(del()));
    assert(gone.status === 403, `member DELETE: ${gone.status}`);
});

await test('A name a base face has → 409 FAMILY_TAKEN; a family with no file → 422', async () => {
    const taken = await json('/v1/themes/fonts/fjalla-one', op(put({ ...FAMILY_BODY, family: 'fjalla one' })));
    assert(taken.status === 409 && taken.body.error?.code === 'FAMILY_TAKEN', `taken: ${taken.status} ${taken.body.error?.code}`);
    const empty = await json(`/v1/themes/fonts/${SLUG}`, op(put({ ...FAMILY_BODY, files: [] })));
    assert(empty.status === 422 && empty.body.error?.code === 'INVALID_FONT', `empty: ${empty.status} ${empty.body.error?.code}`);
});

let uploadUrl = '';
await test('PUT /v1/themes/fonts/:family — the operator registers a family; one upload address per file', async () => {
    const { status, body } = await json(`/v1/themes/fonts/${SLUG}`, op(put(FAMILY_BODY)));
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    const f = body.data.font;
    assert(f.family === FAMILY && f.origin === 'added' && f.licenceStatus === 'stated', JSON.stringify(f));
    assert(f.servable === false, 'not servable before a file has arrived');
    assert(body.data.uploads.length === 1 && /\/v1\/upload\//.test(body.data.uploads[0].upload_url), JSON.stringify(body.data.uploads));
    uploadUrl = body.data.uploads[0].upload_url;
});

await test('A file that is not woff2 is refused, and the family still serves nothing', async () => {
    const r = await upload(uploadUrl, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    assert(r.status === 422 && r.body.error === 'NOT_WOFF2', `not woff2: ${r.status} ${JSON.stringify(r.body)}`);
    const { body } = await json('/v1/themes/fonts');
    const f = body.data.added.find((x: any) => x.family === FAMILY);
    assert(f && f.servable === false, 'still nothing served');
});

await test('The real woff2 is accepted through PUT /v1/upload/:token', async () => {
    const again = await json(`/v1/themes/fonts/${SLUG}`, op(put(FAMILY_BODY)));
    assert(again.status === 200, `re-register: ${again.status}`);
    const r = await upload(again.body.data.uploads[0].upload_url, WOFF2);
    assert(r.status === 200 && r.body.ok === true, `upload: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.bytes === WOFF2.length, `bytes ${r.body.bytes}`);
    assert(r.body.sha256 === createHash('sha256').update(WOFF2).digest('hex'), 'the digest of the bytes');
});

console.log('\nThe face, once it is served');

let fileUrl = '';
await test('fonts.css names the family, and the file route serves the bytes as font/woff2', async () => {
    const css = await fetch(`${BASE}/v1/themes/fonts.css`);
    const text = await css.text();
    assert(css.status === 200 && /text\/css/.test(css.headers.get('content-type') ?? ''), `fonts.css ${css.status}`);
    assert(text.includes(`font-family: '${FAMILY}'`) && text.includes('font-display: swap'), text.slice(0, 400));
    const m = text.match(/url\('([^']+)'\) format\('woff2'\)/);
    assert(!!m, 'a src url');
    fileUrl = m![1];
    const file = await fetch(`${BASE}${fileUrl}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert(file.status === 200 && file.headers.get('content-type') === 'font/woff2', `file ${file.status} ${file.headers.get('content-type')}`);
    assert(file.headers.get('access-control-allow-origin') === '*', 'an app on its own origin may load it');
    assert(bytes.equals(WOFF2), 'the same bytes');
});

await test('The inventory marks it as added, with who added it, and the shell links fonts.css', async () => {
    const { body } = await json('/v1/themes/fonts');
    const f = body.data.added.find((x: any) => x.family === FAMILY);
    assert(f.origin === 'added' && f.servable === true && /testfontop/.test(f.addedBy), JSON.stringify(f));
    assert(f.stack.startsWith(`'${FAMILY}'`) && /monospace/.test(f.stack), `stack ${f.stack}`);
    assert(!body.data.base.some((x: any) => x.family === FAMILY), 'never listed as base setup');
    const shell = await fetch(`${BASE}/v1/home`).then((r) => r.text());
    assert(/<link rel="stylesheet" href="\/v1\/themes\/fonts\.css\?v=[0-9a-f]+">/.test(shell), 'the shell links the sheet, versioned');
});

await test('aimeat_theme_list carries the face in `fonts`, the operator\'s view for the operator\'s agent', async () => {
    const opAgent = await mcpSessionFor(opToken, opName, 'fontopagent', ['memory:read', 'site:theme-write']);
    const r = await opAgent.call('aimeat_theme_list', {});
    assert(!r.isError, r.text.slice(0, 300));
    const list = JSON.parse(r.text);
    assert(list.fonts.added.some((x: any) => x.family === FAMILY), 'the added face');
    assert(list.vocabulary.faces.includes(FAMILY), 'a face a style may choose');
    assert(list.fonts.owners !== undefined, 'the operator sees the owners\' storage inventory');
});

await test('aimeat_theme_style_save accepts the face; the theme sheet sets it', async () => {
    const made = await json('/v1/themes', op(post({ name: 'Harbour Fonts', basedOn: 'aimeat' })));
    assert(made.status === 201, `theme ${made.status}`);
    themeId = made.body.data.theme.id;
    styleId = made.body.data.theme.defaultStyle;
    const opAgent = await mcpSessionFor(opToken, opName, 'fontopagent2', ['memory:read', 'site:theme-write']);
    const r = await opAgent.call('aimeat_theme_style_save', { theme: themeId, style: styleId, faces: { mono: FAMILY } });
    assert(!r.isError, r.text.slice(0, 300));
    const sheet = await fetch(`${BASE}/v1/themes/${themeId}/theme.css`).then((x) => x.text());
    assert(sheet.includes(`--font-mono: '${FAMILY}'`), 'the sheet sets the face');
    const { body } = await json('/v1/themes/fonts');
    const f = body.data.added.find((x: any) => x.family === FAMILY);
    assert(f.usedBy.some((u: any) => u.theme === themeId && u.style === styleId && u.slots.includes('mono')), JSON.stringify(f.usedBy));
});

await test('The Design Book bench accepts a look that starts with the face', async () => {
    const r = await json('/v1/designbook', op(post({ part: {
        id: `look-harbour-mono-${stamp}`, kind: 'look', title: 'Harbour mono', summary: 'A look set in the face the operator added.',
        body: { tokens: { '--ak-font': `'${FAMILY}', monospace` } },
    } })));
    assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body.error)}`);
    const refused = await json('/v1/designbook', op(post({ part: {
        id: `look-nobody-${stamp}`, kind: 'look', title: 'Nobody serves it', summary: 'A face this node does not serve.',
        body: { tokens: { '--ak-font': "'No Such Face', monospace" } },
    } })));
    assert(refused.status === 422 && /does not serve/.test(refused.body.error?.message ?? ''), `unserved: ${refused.status} ${refused.body.error?.message}`);
});

console.log('\nRemoval');

await test('Removal is refused while a style names the face, with the theme and style named', async () => {
    const r = await json(`/v1/themes/fonts/${SLUG}`, op(del()));
    assert(r.status === 409 && r.body.error?.code === 'FONT_IN_USE', `in use: ${r.status} ${r.body.error?.code}`);
    assert(r.body.error.message.includes('Harbour Fonts'), r.body.error.message);
    const opAgent = await mcpSessionFor(opToken, opName, 'fontopagent3', ['memory:read', 'site:theme-write']);
    const t = await opAgent.call('aimeat_theme_font_save', { family: FAMILY, remove: true });
    assert(t.isError && t.text.startsWith('FONT_IN_USE'), t.text);
});

await test('A base face cannot be removed → 409 BASE_FACE', async () => {
    const r = await json('/v1/themes/fonts/fjalla-one', op(del()));
    assert(r.status === 409 && r.body.error?.code === 'BASE_FACE', `base: ${r.status} ${r.body.error?.code}`);
});

await test('Once no style names it, the operator removes it, and its file stops being served', async () => {
    await json(`/v1/themes/${themeId}/styles/${styleId}`, op(put({ faces: { mono: 'JetBrains Mono' } })));
    const r = await json(`/v1/themes/fonts/${SLUG}`, op(del()));
    assert(r.status === 200 && r.body.data.removed === true, `remove ${r.status} ${JSON.stringify(r.body.error)}`);
    const file = await fetch(`${BASE}${fileUrl}`);
    assert(file.status === 404, `file after removal: ${file.status}`);
    const css = await fetch(`${BASE}/v1/themes/fonts.css`).then((x) => x.text());
    assert(!css.includes(FAMILY), 'fonts.css no longer names it');
    const style = await json(`/v1/themes/${themeId}/styles/${styleId}`, op(put({ faces: { mono: FAMILY } })));
    assert(style.status === 422, `a style naming a removed face: ${style.status}`);
});

console.log('\nLicences, the audit and the owners\' fonts');

await test('Over MCP the operator\'s agent adds a family with no licence data: "unknown", and the compliance report says so', async () => {
    const opAgent = await mcpSessionFor(opToken, opName, 'fontopagent4', ['memory:read', 'site:theme-write']);
    const r = await opAgent.call('aimeat_theme_font_save', { family: 'Quiet Grotesk', files: [{ weight: '400' }] });
    assert(!r.isError, r.text.slice(0, 300));
    const saved = JSON.parse(r.text);
    assert(saved.font.licenceStatus === 'unknown' && saved.font.origin === 'added', JSON.stringify(saved.font));
    assert(/claude|agent|fontopagent4/.test(saved.font.addedBy), `addedBy is the agent: ${saved.font.addedBy}`);
    const up = await upload(saved.uploads[0].upload_url, WOFF2);
    assert(up.status === 200, `upload ${up.status}`);
    const report = await json('/v1/admin/compliance/report', op());
    assert(report.status === 200, `report ${report.status}`);
    const gap = report.body.data.gaps.find((g: any) => g.kind === 'font-licence-unknown');
    assert(!!gap && gap.evidence.family === 'Quiet Grotesk', JSON.stringify(report.body.data.gaps));
});

await test('An ordinary owner\'s agent with site:theme-write is still refused', async () => {
    const memberAgent = await mcpSessionFor(memberToken, memberName, 'fontmemberagent', ['memory:read', 'site:theme-write']);
    const r = await memberAgent.call('aimeat_theme_font_save', { family: 'Not Mine', files: [{ weight: '400' }] });
    assert(r.isError && r.text.startsWith('ACCESS_DENIED'), `member agent: ${r.text.slice(0, 200)}`);
});

await test('An owner\'s own font in storage is in the operator\'s inventory only', async () => {
    const up = await json('/v1/storage', member(post({ key: `fonts/my-face-${stamp}.woff2`, data: WOFF2.toString('base64'), mime_type: 'font/woff2', visibility: 'public' })));
    assert(up.body.ok === true, `owner upload: ${JSON.stringify(up.body)}`);
    const theirs = await json('/v1/themes/fonts', op());
    const row = (theirs.body.data.owners?.files ?? []).find((f: any) => f.key === `fonts/my-face-${stamp}.woff2`);
    assert(!!row && row.owner.startsWith(memberName) && row.size === WOFF2.length, JSON.stringify(theirs.body.data.owners).slice(0, 300));
    assert(typeof theirs.body.data.owners.total === 'number', 'the total beside the list');
    const mine = await json('/v1/themes/fonts', member());
    assert(mine.body.data.owners === undefined, 'an owner does not see the inventory');
    assert(!mine.body.data.added.some((x: any) => x.family.includes('my-face')), 'an owner\'s file never becomes a theme face');
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
