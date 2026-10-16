/**
 * @file test/e2e-mcp-operator-site-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP tools that change what every visitor of this node sees, called over
 *   /v1/mcp by the operator's agent and by an ordinary owner's agent holding the same permission
 *   word: the theme tools (aimeat_theme_get, aimeat_theme_save, aimeat_theme_style_save,
 *   aimeat_theme_component_css_set, aimeat_theme_policy_set), the page layout tools
 *   (aimeat_surface_layout_get, aimeat_surface_layout_set) and the search-engine announcement
 *   (aimeat_seo_announce).
 *
 *   WHY THIS SUITE EXISTS. Each write handler in src/mcp/themes.ts, src/mcp/surface-layout.ts and
 *   src/mcp/seo.ts makes its own operator check, and nothing deeper asks who the caller is:
 *   ThemeService and SurfaceLayoutService take the caller's name for the record only. An ordinary
 *   owner may give an agent site:theme-write or site:layout-write (registration checks the node
 *   ceiling, not the operator role), and the registration filter then offers the tool to that agent.
 *   So the handler line is the whole refusal, and no test called these tools over MCP (QA audit
 *   F11b-01, F16a-02). Every refusal below is asserted with the tool OFFERED (`offered === true`),
 *   so it is the handler that refused and not the registration filter; and every refusal reads the
 *   state back through REST to prove nothing changed.
 *
 *   WHAT IT LEAVES BEHIND. The theme policy goes back to the built-in theme alone, the theme made
 *   here is retired, and the home layout is deleted so the page is the built-in one again.
 * @structure
 *   - Setup: the operator (the first owner registered), an ordinary owner, and their agents
 *   - Themes: get (known, unknown); save, style, component CSS, policy, each refused to the ordinary
 *     owner's agent and done by the operator's agent
 *   - Layout: not offered without the word; refused to the ordinary owner's agent; read and written
 *     by the operator's agent, with replaced_version; restored
 *   - SEO: announce refused to the ordinary owner's agent, not offered to '*', planned by the
 *     operator's agent
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-operator-site-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27: F11b-01, F16a-02).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const STAMP = Date.now().toString(36);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const authed = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);

/** A refusal by the handler: an error, with the tool offered to the session. */
function assertHandlerRefusal(r: { isError: boolean; offered: boolean; text: string }, label: string, pattern?: RegExp): void {
    assert(r.isError, `${label}: expected a refusal, got ${r.text.slice(0, 300)}`);
    assert(r.offered, `${label}: the tool was not offered, so the handler line was never reached: ${r.text.slice(0, 200)}`);
    if (pattern) assert(pattern.test(r.text), `${label}: the refusal does not say why: ${r.text.slice(0, 300)}`);
}

let op: RegisteredOwner;
let member: RegisteredOwner;
let opTheme: McpSession;
let memTheme: McpSession;
let opLayout: McpSession;
let memLayout: McpSession;
let opNoWord: McpSession;
let opAdmin: McpSession;
let memAdmin: McpSession;
let opStar: McpSession;

const THEME_NAME = `MCP Harbour ${STAMP}`;
let themeId = '';
let styleId = '';

console.log('\n=== MCP operator site tools: themes, page layout, SEO ===\n');

await test('Setup: the operator, an ordinary owner, and agents holding the same words', async () => {
    op = await registerOwner(BASE, `mcpsiteop${STAMP}`);
    member = await registerOwner(BASE, `mcpsitemem${STAMP}`);
    assert(op.roles.includes('operator'), `the first owner must be the operator, roles ${short(op.roles)}`);
    assert(!member.roles.includes('operator'), `the second owner must not be, roles ${short(member.roles)}`);
    const session = async (owner: RegisteredOwner, scopes: string[], label: string) =>
        openSession(BASE, (await makeAgent(BASE, owner, scopes)).token, label);
    opTheme = await session(op, ['site:theme-write'], 'op-theme');
    memTheme = await session(member, ['site:theme-write'], 'mem-theme');
    opLayout = await session(op, ['site:layout-write'], 'op-layout');
    memLayout = await session(member, ['site:layout-write'], 'mem-layout');
    opNoWord = await session(op, ['memory:read'], 'op-noword');
    opAdmin = await session(op, ['operator:admin'], 'op-admin');
    memAdmin = await session(member, ['operator:admin'], 'mem-admin');
    opStar = await session(op, ['*'], 'op-star');
});

// ─── Themes ───
console.log('\nThemes');

await test('aimeat_theme_get: the built-in theme with its styles; an unknown id answers NOT_FOUND', async () => {
    const r = await callTool(memTheme, 'aimeat_theme_get', { id: 'aimeat' });
    assert(!r.isError, `get aimeat: ${r.text.slice(0, 300)}`);
    assert(r.data.theme?.id === 'aimeat' && Array.isArray(r.data.theme.styles) && r.data.theme.styles.length > 0,
        `theme: ${short(r.data.theme)}`);
    assert(Array.isArray(r.data.versions), 'versions are listed');
    const miss = await callTool(memTheme, 'aimeat_theme_get', { id: `no-such-${STAMP}` });
    assert(miss.isError && /NOT_FOUND|There is no theme/.test(miss.text), `unknown id: ${miss.text.slice(0, 200)}`);
});

await test("aimeat_theme_save: an ordinary owner's agent holding site:theme-write is refused, and no theme is made", async () => {
    const r = await callTool(memTheme, 'aimeat_theme_save', { name: `${THEME_NAME} member`, basedOn: 'aimeat' });
    assertHandlerRefusal(r, 'member theme_save', /ACCESS_DENIED|runs this installation/);
    const all = await json('/v1/themes/all', authed(op.token));
    assert(all.status === 200, `themes/all: ${all.status}`);
    assert(!all.body.data.themes.some((t: any) => t.name === `${THEME_NAME} member`), 'the refused theme was made anyway');
});

await test("aimeat_theme_save: the operator's agent makes a copy of the built-in theme", async () => {
    const r = await callTool(opTheme, 'aimeat_theme_save', { name: THEME_NAME, basedOn: 'aimeat' });
    assert(!r.isError, `operator theme_save: ${r.text.slice(0, 300)}`);
    themeId = r.data.theme?.id;
    styleId = r.data.theme?.defaultStyle;
    assert(typeof themeId === 'string' && themeId !== 'aimeat', `theme id: ${short(r.data)}`);
    const back = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    assert(back.status === 200 && back.body.data.theme.name === THEME_NAME, `read back: ${back.status} ${short(back.body.data)}`);
});

await test("aimeat_theme_save on an existing theme: refused to the ordinary owner's agent, the CSS unchanged; the operator's agent writes it", async () => {
    const refused = await callTool(memTheme, 'aimeat_theme_save', { id: themeId, css: 'body { color: red; }' });
    assertHandlerRefusal(refused, 'member theme css', /ACCESS_DENIED|runs this installation/);
    const before = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    assert(!String(before.body.data.theme.css ?? '').includes('color: red'), 'the refused CSS landed');

    const css = 'button { transition: none; }';
    const ok = await callTool(opTheme, 'aimeat_theme_save', { id: themeId, css });
    assert(!ok.isError && ok.data.saved === true, `operator css: ${ok.text.slice(0, 300)}`);
    const after = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    assert(after.body.data.theme.css === css, `css read back: ${short(after.body.data.theme.css)}`);
});

await test("aimeat_theme_style_save: refused to the ordinary owner's agent; the operator's agent changes a colour", async () => {
    const refused = await callTool(memTheme, 'aimeat_theme_style_save', { theme: themeId, style: styleId, light: { '--accent': '#123456' } });
    assertHandlerRefusal(refused, 'member style_save', /ACCESS_DENIED|runs this installation/);
    const mid = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    const midStyle = mid.body.data.theme.styles.find((s: any) => s.id === styleId);
    assert(midStyle?.light?.['--accent'] !== '#123456', 'the refused colour landed');

    const ok = await callTool(opTheme, 'aimeat_theme_style_save', { theme: themeId, style: styleId, light: { '--accent': '#123456' } });
    assert(!ok.isError && ok.data.saved === true, `operator style_save: ${ok.text.slice(0, 300)}`);
    const after = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    const style = after.body.data.theme.styles.find((s: any) => s.id === styleId);
    assert(style?.light?.['--accent'] === '#123456', `style read back: ${short(style)}`);
});

await test("aimeat_theme_component_css_set: refused to the ordinary owner's agent; the operator's agent sets the slab's CSS", async () => {
    const css = '.poster-slab { letter-spacing: 0.02em; }';
    const refused = await callTool(memTheme, 'aimeat_theme_component_css_set', { theme: themeId, component: 'slab', css });
    assertHandlerRefusal(refused, 'member component css', /ACCESS_DENIED|runs this installation/);
    const mid = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    assert(!String(mid.body.data.theme.componentCss?.slab ?? '').includes('letter-spacing'), 'the refused component CSS landed');

    const ok = await callTool(opTheme, 'aimeat_theme_component_css_set', { theme: themeId, component: 'slab', css });
    assert(!ok.isError && ok.data.saved === true, `operator component css: ${ok.text.slice(0, 300)}`);
    const after = await json(`/v1/themes/${encodeURIComponent(themeId)}`);
    assert(after.body.data.theme.componentCss?.slab === css, `component css read back: ${short(after.body.data.theme.componentCss)}`);
});

await test("aimeat_theme_policy_set: refused to the ordinary owner's agent, the policy unchanged; the operator's agent offers the theme", async () => {
    const before = (await json('/v1/themes/all', authed(op.token))).body.data.policy;
    const refused = await callTool(memTheme, 'aimeat_theme_policy_set', { offered: ['aimeat', themeId], default: themeId });
    assertHandlerRefusal(refused, 'member policy_set', /ACCESS_DENIED|runs this installation/);
    const mid = (await json('/v1/themes/all', authed(op.token))).body.data.policy;
    assert(JSON.stringify(mid) === JSON.stringify(before), `the refused policy landed: ${short(mid)}`);

    const ok = await callTool(opTheme, 'aimeat_theme_policy_set', { offered: ['aimeat', themeId], default: 'aimeat' });
    assert(!ok.isError && ok.data.saved === true, `operator policy_set: ${ok.text.slice(0, 300)}`);
    const after = (await json('/v1/themes/all', authed(op.token))).body.data.policy;
    assert(after.offered.includes(themeId) && after.default === 'aimeat', `policy read back: ${short(after)}`);
});

await test('Cleanup: the policy offers the built-in theme alone again, and the theme made here is retired', async () => {
    const policy = await callTool(opTheme, 'aimeat_theme_policy_set', { offered: ['aimeat'], default: 'aimeat' });
    assert(!policy.isError, `restore policy: ${policy.text.slice(0, 300)}`);
    const retire = await callTool(opTheme, 'aimeat_theme_save', { id: themeId, retired: true });
    assert(!retire.isError, `retire: ${retire.text.slice(0, 300)}`);
    const after = (await json('/v1/themes/all', authed(op.token))).body.data.policy;
    assert(JSON.stringify(after.offered) === JSON.stringify(['aimeat']) && after.default === 'aimeat', `policy: ${short(after)}`);
});

// ─── Page layout ───
console.log('\nPage layout');

const GOOD_HOME = [
    { id: 'home.nameplate', key: 'home.nameplate' },
    { id: 'home.feed', key: 'home.feed', props: { limit: 4 } },
];

async function homeLayout(): Promise<any> {
    const r = await json('/v1/site/layout/home', authed(op.token));
    assert(r.status === 200, `GET layout/home: ${r.status} ${short(r.body)}`);
    return r.body.data;
}

await test("The operator's agent without site:layout-write is not offered either layout tool", async () => {
    const names = await toolNames(opNoWord);
    assert(!names.includes('aimeat_surface_layout_get') && !names.includes('aimeat_surface_layout_set'),
        'a layout tool was offered without the word');
    const r = await callTool(opNoWord, 'aimeat_surface_layout_get', { surface: 'home' });
    assert(r.isError && !r.offered, `expected not offered, got ${r.text.slice(0, 200)}`);
});

await test("aimeat_surface_layout_get / _set: an ordinary owner's agent holding site:layout-write is refused, and the page is unchanged", async () => {
    const get = await callTool(memLayout, 'aimeat_surface_layout_get', { surface: 'home' });
    assertHandlerRefusal(get, 'member layout_get', /ACCESS_DENIED|arrange its pages/);
    const set = await callTool(memLayout, 'aimeat_surface_layout_set', { surface: 'home', blocks: GOOD_HOME });
    assertHandlerRefusal(set, 'member layout_set', /ACCESS_DENIED|arrange its pages/);
    const home = await homeLayout();
    assert(home.source === 'default', `the refused layout was stored: source ${home.source}`);
});

await test("aimeat_surface_layout_get: the operator's agent reads the built-in home page and the blocks it may use", async () => {
    const r = await callTool(opLayout, 'aimeat_surface_layout_get', { surface: 'home' });
    assert(!r.isError, `operator layout_get: ${r.text.slice(0, 300)}`);
    assert(r.data.surface === 'home' && r.data.source === 'default', `answer: ${short(r.data)}`);
    assert(Array.isArray(r.data.available_blocks) && r.data.available_blocks.some((b: any) => b.id === 'home.feed'),
        'the blocks the page may hold are listed');
    const miss = await callTool(opLayout, 'aimeat_surface_layout_get', { surface: 'nonsense' });
    assert(miss.isError && /SURFACE_NOT_FOUND/.test(miss.text), `unknown surface: ${miss.text.slice(0, 200)}`);
});

await test("aimeat_surface_layout_set: the operator's agent stores a layout, and the second write names the version it replaced", async () => {
    const first = await callTool(opLayout, 'aimeat_surface_layout_set', { surface: 'home', blocks: GOOD_HOME, note: 'e2e first' });
    assert(!first.isError && first.data.blocks_stored === 2, `first set: ${first.text.slice(0, 300)}`);
    const stored = await homeLayout();
    assert(stored.source === 'stored', `source after the write: ${stored.source}`);
    assert(JSON.stringify(stored.layout.blocks.map((b: any) => b.id)) === JSON.stringify(['home.nameplate', 'home.feed']),
        `blocks read back: ${short(stored.layout.blocks)}`);

    const second = await callTool(opLayout, 'aimeat_surface_layout_set', { surface: 'home', blocks: [GOOD_HOME[1]], note: 'e2e second' });
    assert(!second.isError && second.data.blocks_stored === 1, `second set: ${second.text.slice(0, 300)}`);
    assert(second.data.replaced_version !== null && second.data.replaced_version !== undefined,
        `the second write must name what it replaced: ${short(second.data)}`);
    assert(/restore version/.test(second.data.undo), `undo: ${second.data.undo}`);
});

await test('Cleanup: the home layout is deleted, and the page is the built-in one again', async () => {
    const del = await json('/v1/site/layout/home', { method: 'DELETE', headers: { Authorization: `Bearer ${op.token}` } });
    assert(del.status === 200 || del.status === 204, `delete: ${del.status} ${short(del.body)}`);
    const home = await homeLayout();
    assert(home.source === 'default', `source after the delete: ${home.source}`);
});

// ─── SEO ───
console.log('\nSearch engines');

await test("aimeat_seo_announce: refused to an ordinary owner's agent holding operator:admin", async () => {
    const r = await callTool(memAdmin, 'aimeat_seo_announce', { plan: true });
    assertHandlerRefusal(r, 'member seo_announce', /node operator's own agent/);
});

await test("aimeat_seo_announce: the operator's agent holding only '*' is not offered it (operator:admin is outside every wildcard)", async () => {
    const r = await callTool(opStar, 'aimeat_seo_announce', { plan: true });
    assert(r.isError && !r.offered, `expected not offered, got ${r.text.slice(0, 200)}`);
});

await test("aimeat_seo_announce with plan: the operator's agent gets the list of addresses, and nothing is sent", async () => {
    const r = await callTool(opAdmin, 'aimeat_seo_announce', { plan: true, scope: 'pages' });
    assert(!r.isError, `operator plan: ${r.text.slice(0, 300)}`);
    assert(r.data.scope === 'pages' && typeof r.data.url_count === 'number' && Array.isArray(r.data.urls) && Array.isArray(r.data.hosts),
        `plan: ${short(r.data)}`);
    assert(r.data.url_count === r.data.urls.length, 'url_count counts the urls');
    assert(r.data.run === undefined, 'a plan must not carry a run: nothing was sent');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
