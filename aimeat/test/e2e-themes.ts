/**
 * @file test/e2e-themes.ts
 * @description E2E for Themes & Styles (07-themes-and-styles.md): a theme holds styles, its
 *   component CSS and its theme CSS. Covers a copy of the built-in theme, a style changed and a new
 *   one made, component CSS served in the theme's own sheet, CSS that hides a control coming back
 *   as a warning and still saved, CSS that does not parse refused with its line, contrast as a
 *   warning, the built-in theme read only, an ordinary owner refused, versions and restore, what the
 *   page shell carries before its first paint, the component catalogue naming the theme, and a
 *   person's own choice.
 *
 *   The ones that matter most: the operator's CSS is refused ONLY when it does not parse (Jouni,
 *   Q2: "mahdollisimman muokattavaksi"), and nobody but the operator writes a theme.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=themes
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial suite (UI consolidation phase 4).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
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

// ─── State ───
let opToken = '';
let memberToken = '';
const opName = `testthemeop${Date.now()}`;
const memberName = `testthemeuser${Date.now()}`;
let themeId = '';
let dayStyle = '';
let nightStyle = '';

const as = (token: string, opts: RequestInit = {}): RequestInit => ({
    ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` },
});
const op = (opts: RequestInit = {}) => as(opToken, opts);
const member = (opts: RequestInit = {}) => as(memberToken, opts);
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

console.log('\n=== AIMEAT Themes & Styles E2E Test ===\n');
console.log('Setup');

await test('Register operator owner (first owner is auto-operator)', async () => {
    opToken = await registerOwner(opName);
    assert(opToken.length > 0, 'got operator token');
});

await test('Register an ordinary member', async () => {
    memberToken = await registerOwner(memberName);
    assert(memberToken.length > 0, 'got member token');
});

console.log('\nThe built-in theme');

await test('GET /v1/themes — public: the AIMEAT theme with its six styles, the pages it reaches', async () => {
    const { status, body } = await json('/v1/themes');
    assert(status === 200, `status ${status}`);
    const aimeat = body.data.themes.find((t: any) => t.id === 'aimeat');
    assert(!!aimeat, 'the built-in theme is offered');
    assert(aimeat.styles.map((s: any) => s.id).join(',') === 'aimeat,paper,circuit,contrast,mist,voltage', `styles ${aimeat.styles.map((s: any) => s.id)}`);
    assert(aimeat.sheet === null, 'the built-in theme has no sheet of its own');
    assert(body.data.inner.includes('/v1/home') && !body.data.inner.includes('/v1/help'), 'inner pages only');
});

await test('The built-in theme is read only → 409 READ_ONLY', async () => {
    const { status, body } = await json('/v1/themes/aimeat', op(put({ name: 'Mine' })));
    assert(status === 409 && body.error?.code === 'READ_ONLY', `status ${status} ${body.error?.code}`);
});

console.log('\nA theme and its styles');

await test('An ordinary owner cannot make a theme → 403', async () => {
    const { status } = await json('/v1/themes', member(post({ name: 'Nope' })));
    assert(status === 403, `expected 403, got ${status}`);
});

await test('POST /v1/themes — a copy of the AIMEAT theme, its styles under new ids', async () => {
    const { status, body } = await json('/v1/themes', op(post({ name: 'Harbour', basedOn: 'aimeat' })));
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    themeId = body.data.theme.id;
    dayStyle = body.data.theme.defaultStyle;
    assert(body.data.theme.styles.length === 6, 'six styles copied');
    assert(body.data.theme.styles.every((s: any) => !s.builtin && s.id !== 'paper'), 'the copies are the theme\'s own');
});

await test('POST /v1/themes with its own fields — one call; old style ids name the copies', async () => {
    const { status, body } = await json('/v1/themes', op(post({ name: 'Two styles', basedOn: 'aimeat', offeredStyles: ['aimeat', 'paper'], defaultStyle: 'paper' })));
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    const t = body.data.theme;
    assert(t.offeredStyles.length === 2 && t.offeredStyles.every((s: string) => s.startsWith(t.id + '-')), `offered ${t.offeredStyles}`);
    assert(t.defaultStyle === `${t.id}-paper`, `default ${t.defaultStyle}`);
    await json(`/v1/themes/${t.id}`, op(put({ retired: true })));
});

await test('PUT a style — colours in light and dark; contrast lines come back', async () => {
    const { status, body } = await json(`/v1/themes/${themeId}/styles/${dayStyle}`,
        op(put({ name: 'Harbour Day', light: { '--accent': '#0b6e4f' }, dark: { '--accent': '#4fd1a5' } })));
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.style.light['--accent'] === '#0b6e4f', 'light accent kept');
    assert(Array.isArray(body.data.warnings.contrast[dayStyle]), 'contrast lines returned');
});

await test('POST a style under the contrast minimum — saved, with every failing line as a warning', async () => {
    const { status, body } = await json(`/v1/themes/${themeId}/styles`, op(post({ name: 'Harbour Night', onlyMode: 'dark', light: { '--text': '#dddddd' } })));
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    nightStyle = body.data.style.id;
    const failing = body.data.warnings.contrast[nightStyle].filter((r: any) => !r.ok);
    assert(failing.length >= 2, `failing lines ${failing.length}`);
    assert(body.data.style.onlyMode === 'dark', 'one mode kept');
});

await test('A style value that does not parse → 422 INVALID_STYLE', async () => {
    const { status, body } = await json(`/v1/themes/${themeId}/styles/${dayStyle}`, op(put({ light: { '--accent': 'not a colour;}' } })));
    assert(status === 422 && body.error?.code === 'INVALID_STYLE', `status ${status} ${body.error?.code}`);
});

console.log('\nThe operator\'s CSS: warnings, never refusals, except CSS that does not parse');

await test('PUT component CSS for the loud action — served in the theme\'s own sheet', async () => {
    const css = '.poster-slab { background: var(--accent); border-radius: 8px; }';
    const { status, body } = await json(`/v1/themes/${themeId}/components/slab`, op(put({ css })));
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.state.status === 'served', `state ${body.data.state.status}`);
    const sheet = await fetch(`${BASE}/v1/themes/${themeId}/theme.css`).then((r) => r.text());
    assert(sheet.includes(css), 'the rule is in the sheet');
    assert(sheet.includes(`html[data-palette='${dayStyle}']`), 'the style block is in the sheet');
});

await test('CSS that can hide a control — a warning with its line, and it is saved', async () => {
    const { status, body } = await json(`/v1/themes/${themeId}/components/slab`, op(put({ css: '.poster-slab {\n  display: none;\n}' })));
    assert(status === 200, `status ${status}`);
    const w = body.data.state.warnings.find((x: any) => x.code === 'hides');
    assert(!!w && w.line === 2, `warning ${JSON.stringify(body.data.state.warnings)}`);
});

await test('CSS that does not parse → 422 CSS_DOES_NOT_PARSE with the line, and nothing changes', async () => {
    const before = await json(`/v1/themes/${themeId}`);
    const { status, body } = await json(`/v1/themes/${themeId}/components/slab`, op(put({ css: '.poster-slab { color: red;' })));
    assert(status === 422 && body.error?.code === 'CSS_DOES_NOT_PARSE', `status ${status} ${body.error?.code}`);
    const after = await json(`/v1/themes/${themeId}`);
    assert(after.body.data.theme.componentCss.slab === before.body.data.theme.componentCss.slab, 'the saved CSS is untouched');
});

await test('A dry run saves nothing', async () => {
    const { status } = await json(`/v1/themes/${themeId}/components/slab`, op(put({ css: '.poster-slab { color: var(--text); }', dryRun: true })));
    assert(status === 200, `status ${status}`);
    const { body } = await json(`/v1/themes/${themeId}`);
    assert(body.data.theme.componentCss.slab.includes('display: none'), 'the last save stands');
});

await test('Theme CSS may target anything; an ordinary owner cannot write it → 403', async () => {
    const mine = await json(`/v1/themes/${themeId}`, member(put({ css: 'body { color: red; }' })));
    assert(mine.status === 403, `member: ${mine.status}`);
    const { status, body } = await json(`/v1/themes/${themeId}`, op(put({ css: 'button { transition: all 1s; }' })));
    assert(status === 200, `status ${status}`);
    assert(body.data.warnings.css.some((w: any) => w.code === 'motion'), 'motion warned');
});

await test('A component that is not in the catalogue → 404', async () => {
    const { status } = await json(`/v1/themes/${themeId}/components/no-such-part`, op(put({ css: '.x { color: var(--text); }' })));
    assert(status === 404, `status ${status}`);
});

console.log('\nVersions');

await test('Every save keeps the version before; restore puts one back', async () => {
    const { body } = await json(`/v1/themes/${themeId}/versions`, op());
    assert(body.data.versions.length >= 4, `versions ${body.data.versions.length}`);
    const target = body.data.versions.find((v: any) => v.version === 4) ?? body.data.versions[body.data.versions.length - 1];
    const r = await json(`/v1/themes/${themeId}/versions/${target.version}/restore`, op(post({})));
    assert(r.status === 200, `restore ${r.status}: ${JSON.stringify(r.body.error)}`);
    const member403 = await json(`/v1/themes/${themeId}/versions`, member());
    assert(member403.status === 403, `member versions: ${member403.status}`);
});

console.log('\nWho chooses, and what a page carries');

await test('The operator makes the theme available; the page shell carries it before its first paint', async () => {
    const cfg = await json('/v1/admin/config', op(put({ changes: [{ path: 'themes.offered', value: `aimeat,${themeId}` }] })));
    assert(cfg.status === 200, `config ${cfg.status}: ${JSON.stringify(cfg.body.error)}`);
    await json(`/v1/themes/${themeId}`, op(put({ offeredStyles: [dayStyle, nightStyle] })));
    const { body } = await json('/v1/themes');
    const t = body.data.themes.find((x: any) => x.id === themeId);
    assert(!!t, 'offered');
    assert(t.sheet && t.sheet.startsWith(`/v1/themes/${themeId}/theme.css?v=`), `sheet ${t.sheet}`);
    const shell = await fetch(`${BASE}/v1/home`).then((r) => r.text());
    assert(shell.includes('window.__AIMEAT_THEMES=') && shell.includes(`"id":"${themeId}"`), 'the shell carries the snapshot');
});

await test('The component catalogue names the theme that styles the part', async () => {
    const { body } = await json('/v1/ui/components/slab');
    assert(body.data.themes.some((x: any) => x.theme === themeId), JSON.stringify(body.data.themes));
});

await test('A person keeps their own choice; a style the theme does not offer → 422', async () => {
    const ok = await json('/v1/themes/choice', member(put({ theme: themeId, style: nightStyle })));
    assert(ok.status === 200, `choice ${ok.status}: ${JSON.stringify(ok.body.error)}`);
    const read = await json('/v1/themes/choice', member());
    assert(read.body.data.theme === themeId && read.body.data.style === nightStyle, JSON.stringify(read.body.data));
    const bad = await json('/v1/themes/choice', member(put({ theme: 'aimeat', style: nightStyle })));
    assert(bad.status === 422 && bad.body.error?.code === 'NOT_OFFERED', `bad ${bad.status}`);
});

await test('People do not choose → FIXED; leave the node on its defaults', async () => {
    await json('/v1/admin/config', op(put({ changes: [{ path: 'themes.personal_choice', value: false }] })));
    const { status, body } = await json('/v1/themes/choice', member(put({ theme: 'aimeat' })));
    assert(status === 409 && body.error?.code === 'FIXED', `status ${status}`);
    await json('/v1/admin/config', op(put({ changes: [{ path: 'themes.personal_choice', value: true }, { path: 'themes.offered', value: '' }] })));
    const r = await json(`/v1/themes/${themeId}`, op(put({ retired: true })));
    assert(r.body.data.theme.retired === true, 'retired');
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
