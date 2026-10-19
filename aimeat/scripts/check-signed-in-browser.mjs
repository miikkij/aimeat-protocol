/**
 * @file scripts/check-signed-in-browser.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Walk the SPA of a sandbox node in a real headless browser and list every request the
 *   browser made that the node refused: a 401 or 403, a JSON answer where a page, a picture, a script
 *   or a stream was expected, a request that failed, a console error, and a link whose new tab ends
 *   on JSON.
 *
 *   WHY IT EXISTS. On a node set to signed-in content access (visibility.content_access), the SPA
 *   keeps the session in localStorage, so everything the browser asks for on its own (a new tab, an
 *   <a href>, an <img>, an EventSource, a provider's redirect) and every plain fetch() a view makes
 *   reaches the content access gate without a credential, even for a person who is signed in. On
 *   2026-10-19 a signed-in person on innokas.aimeat.io pressed Open in the app store and got a raw 401;
 *   this walk then found the store, the front page, the help, glossary and transparency pages, the
 *   live stream, the app screenshots and the mail connect refused the same way. No unit or E2E test
 *   can find that class, because each sends the credential the test author thought of.
 *
 *   HOW TO READ IT. Run it twice, with the sandbox in open mode and in signed-in mode, signed in:
 *   whatever the open run does not list and the signed-in run does is a failure of this class. A
 *   signed-out run in signed-in mode must list no page that ends on JSON. Addresses an API caller
 *   types (a file, an export, an avatar) answer 401 to a browser without a session by design.
 * @structure PAGES · sign in through the real dialog · visit each page, collect links, press each
 *   Open button · open each link in a new tab · print the findings grouped
 * @usage
 *   cd aimeat && pnpm sandbox                                  # a node of your own
 *   (set visibility.content_access to signed-in with PUT /v1/admin/config as the sandbox operator)
 *   node scripts/check-signed-in-browser.mjs                   # signed in as the first sandbox owner
 *   node scripts/check-signed-in-browser.mjs --signed-out      # a stranger
 *   node scripts/check-signed-in-browser.mjs --json out.json   # every finding, for a diff of two runs
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (the signed-in browser audit).
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(AIMEAT, 'package.json'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const signedOut = args.includes('--signed-out');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const sb = JSON.parse(readFileSync(resolve(AIMEAT, '.sandbox.json'), 'utf8'));
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : sb.baseUrl;
const owner = sb.owners[0];

/** The installed headless shell, when the playwright-core pin names a build that is not installed. */
function installedShell() {
  const root = `${process.env.LOCALAPPDATA ?? process.env.HOME + '/.cache'}/ms-playwright`;
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const exe of [`${root}/${d}/chrome-headless-shell-win64/chrome-headless-shell.exe`, `${root}/${d}/chrome-linux/headless_shell`]) {
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

/** Every SPA page and view variant (public/spa.html ROUTES and matchRoute), and the store's apps. */
async function pages() {
  const list = [
    '/', '/v1/portal', '/v1/home', '/v1/home?agents=1', '/v1/home?computers=1', '/v1/home?history=1', '/v1/home?new-agent=1',
    '/v1/profile', '/v1/chat', '/v1/fleet', '/v1/members', '/v1/admin', '/v1/admin/ui', '/v1/appcat', '/app-catalog.html', '/v1/app-store',
    '/v1/help', '/v1/aimeat-os', '/v1/classic', '/v1/how-it-works', '/v1/changelog', '/v1/everything', '/v1/glossary', '/v1/business',
    '/v1/transparency', '/v1/connect-your-ai', '/v1/how-an-app-builds', '/v1/portfolio', `/v1/portfolio/${owner.name}`,
    '/v1/publicknowledgeviewer', '/v1/connect', '/v1/spec', '/v1/docs', '/v1/echat',
  ];
  if (sb.agent?.name) list.push(`/v1/home?agent=${encodeURIComponent(sb.agent.name)}`);
  for (const a of sb.apps ?? []) {
    const file = typeof a === 'string' ? a.split('/').pop().split('?')[0] : a.filename;
    if (!file) continue;
    list.push(`/v1/app-open?app=${encodeURIComponent(`${owner.name}/${file}`)}`, `/v1/apps/${owner.name}/${file}?mode=inline`, `/v1/use-with-ai/${owner.name}/${file}`);
  }
  return list;
}

const findings = [];
let where = 'start';
const add = (f) => findings.push({ where, ...f });
const short = (u) => u.startsWith(BASE) ? u.slice(BASE.length) : u;
const EXPECT_NOT_JSON = new Set(['document', 'image', 'media', 'script', 'stylesheet', 'font', 'eventsource']);

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, executablePath: installedShell() }));
const context = await browser.newContext();
context.on('response', (res) => {
  const req = res.request();
  if (!res.url().startsWith(BASE)) return;
  const type = req.resourceType();
  const st = res.status();
  const ct = res.headers()['content-type'] ?? '';
  if (st === 401 || st === 403 || st >= 500) add({ kind: String(st), type, url: short(res.url()) });
  else if (EXPECT_NOT_JSON.has(type) && ct.includes('json')) add({ kind: 'json-where-page', type, status: st, url: short(res.url()) });
});
context.on('requestfailed', (req) => {
  if (!req.url().startsWith(BASE)) return;
  const err = req.failure()?.errorText ?? '';
  if (/ERR_ABORTED/.test(err)) return;   // a navigation away cancels what the page had open
  add({ kind: 'failed', type: req.resourceType(), url: short(req.url()), err });
});
context.on('page', (p) => {
  p.on('pageerror', (e) => add({ kind: 'pageerror', text: String(e).slice(0, 200) }));
});

const settle = async (p, ms = 10000) => { await p.waitForLoadState('networkidle', { timeout: ms }).catch(() => {}); await p.waitForTimeout(300); };
const page = await context.newPage();

if (!signedOut) {
  where = 'sign-in';
  await page.goto(`${BASE}/v1/home`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.evaluate(() => window.AIMEAT?.auth?.showLoginModal?.({}));
  await page.fill('#aimeat-username', owner.name);
  await page.fill('#aimeat-password', owner.password);
  await page.click('#aimeat-go-btn');
  await page.waitForFunction(() => !!window.AIMEAT?.auth?.getSession?.()?.jwt, null, { timeout: 15000 }).catch(() => add({ kind: 'sign-in failed' }));
  await settle(page);
}

const links = new Map();
const OPEN_BUTTON = /^(Avaa|Open|Abrir|Lataa|Download|Descargar|Näytä|View|Ver)\b/i;
for (const path of await pages()) {
  where = path;
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => { add({ kind: 'goto-error', text: String(e).slice(0, 120) }); return null; });
  if (!resp) continue;
  const ct = resp.headers()['content-type'] ?? '';
  if (ct.includes('json') || resp.status() >= 400) add({ kind: 'page-ends-on-json-or-error', status: resp.status(), final: short(page.url()) });
  await settle(page);
  for (const a of await page.$$eval('a[href]', as => as.map(x => ({ href: x.href, text: (x.textContent || '').trim().slice(0, 40) }))).catch(() => [])) {
    const href = a.href.split('#')[0];
    if (href.startsWith(BASE) && !links.has(href)) links.set(href, { from: path, text: a.text });
  }
  const names = [...new Set((await page.$$eval('button', bs => bs.map(b => (b.textContent || '').trim())).catch(() => [])).filter(n => OPEN_BUTTON.test(n)))].slice(0, 6);
  for (const name of names) {
    where = `${path} [press ${name.slice(0, 30)}]`;
    const popupP = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    if (!await page.getByRole('button', { name, exact: true }).first().click({ timeout: 3000 }).then(() => true, () => false)) continue;
    const popup = await popupP;
    const target = popup ?? page;
    await settle(target, 8000);
    const body = await target.evaluate(() => document.contentType + ' ' + (document.body?.innerText || '').slice(0, 160)).catch(() => '');
    if (/json|SIGN_IN_REQUIRED/.test(body)) add({ kind: 'press-ends-on-json', url: short(target.url()), body });
    if (popup) await popup.close();
    else if (!page.url().startsWith(`${BASE}${path.split('?')[0]}`)) await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).then(() => settle(page, 6000), () => {});
  }
}

const SKIP = /logout|sign-out|signout|\/v1\/auth\/|\.json(\?|$)|mcp\.json/i;
for (const [href, info] of links) {
  if (SKIP.test(href)) continue;
  where = `link ${short(href)} (on ${info.from}: ${info.text})`;
  const p = await context.newPage();
  const resp = await p.goto(href, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  const ct = resp?.headers()['content-type'] ?? '';
  if (resp && (resp.status() >= 400 || ct.includes('json'))) add({ kind: 'new-tab-ends-on-json-or-error', status: resp.status() });
  await settle(p, 6000);
  await p.close();
}
await browser.close();

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base: BASE, signedOut, links: links.size, findings }, null, 1));
const groups = new Map();
for (const f of findings) {
  const key = `${f.kind} ${f.type ?? ''} ${(f.url ?? f.final ?? f.text ?? '').split('?')[0]}`.replace(/\s+/g, ' ').trim();
  const g = groups.get(key) ?? { n: 0, where: new Set() };
  g.n++; g.where.add(f.where);
  groups.set(key, g);
}
console.log(`${signedOut ? 'signed out' : `signed in as ${owner.name}`} on ${BASE}: ${findings.length} findings, ${links.size} links opened`);
for (const [key, g] of [...groups].sort()) console.log(`${String(g.n).padStart(3)}  ${key}   ← ${[...g.where].slice(0, 2).join(' | ')}`);
