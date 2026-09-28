/**
 * @file scripts/ui-compare.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Compare an app's screen with the approved one BEFORE a person is shown it (wish
 *   visuaalinen-vertailu, 2026-09-29). Postinjalostamo went to Jouni with a grey paste box, the
 *   settings in separate boxes instead of one card with hairlines, and the batch rows in another
 *   look than the approved drawing; each was visible in a side-by-side, and nobody had put one there.
 *
 *   TWO READINGS, because a pixel difference alone cannot tell sample data from a wrong component:
 *     - THE PARTS. Every kit element carries its class and `data-ak-part`. For each kind of part the
 *       tool reads the computed style of the first one (background, border, radius, shadow, font,
 *       padding) on both screens and lists the parts only one screen has and every style that
 *       differs. A white card against a grey one, a box against a hairline: that list names them.
 *     - THE PIXELS. Both screenshots are drawn into a canvas in the browser and compared per pixel,
 *       with a diff picture where they differ. It reads the layout at a glance; its ratio is large
 *       whenever the data differs, so it is evidence, not a verdict.
 *
 *   SIGNED IN ON THE SANDBOX. `--login user:password` grants the app its scopes through the API,
 *   then signs the app in as a person does: Sign in, the node's window, the password. (The silent
 *   sign-in cannot see the node's login on the sandbox, see signInByPopup.)
 * @structure args · signIn · grantApp · signInByPopup · capture · pixelDiff · compareParts · main
 * @usage
 *   pnpm ui:compare --ref http://genre-workbench.apps.localhost:40603/ --app http://postinjalostamo.apps.localhost:40603/ \
 *     --login sandbox:<password> --node http://localhost:40603 --app-ref sandbox/postinjalostamo.html
 *   pnpm ui:compare --ref approved.png --app <url>          (a picture: pixels only)
 *   Options: --width 1440 --height 900 --wait 1500 --out <dir> --click "<text>" (open a view on both first)
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name: string, fallback = ''): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const REF = arg('ref');
const APP = arg('app');
const LOGIN = arg('login');
const NODE = arg('node');
const APP_REF = arg('app-ref');
const WIDTH = Number(arg('width', '1440'));
const HEIGHT = Number(arg('height', '900'));
const WAIT = Number(arg('wait', '1500'));
const CLICK = arg('click');
const OUT = resolve(arg('out', join(process.cwd(), '.ui-compare', new Date().toISOString().replace(/[:.]/g, '-'))));

/** The styles that make a part look like itself. */
const STYLE_KEYS = ['background-color', 'color', 'border-top-width', 'border-top-style', 'border-top-color', 'border-radius',
    'box-shadow', 'font-family', 'font-size', 'font-weight', 'padding-top', 'padding-left', 'gap'];

interface PartReading { count: number; style: Record<string, string> }
interface Capture { png: Buffer; parts: Record<string, PartReading> }

/** Log the browser in on the node: the refresh cookie lands in the context, as a person's login leaves it. */
async function signIn(context: BrowserContext, node: string, login: string): Promise<string> {
    const at = login.indexOf(':');
    const r = await context.request.post(`${node}/v1/ghii/login`, { data: { username: login.slice(0, at), password: login.slice(at + 1) } });
    const j = await r.json() as { ok?: boolean; data?: { token?: string }; error?: { message?: string } };
    if (!r.ok() || !j.data?.token) throw new Error(`login refused: ${r.status()} ${j.error?.message ?? ''}`);
    return j.data.token;
}

/**
 * Grant the app the scopes its page asks for, through the same authorize and consent the popup
 * drives, so its silent sign-in finds a grant. `appRef` is owner/filename.
 */
async function grantApp(context: BrowserContext, node: string, token: string, appRef: string, appUrl: string): Promise<void> {
    // The browser opens the app (an app origin like x.apps.localhost resolves in a browser and not
    // in Node's own resolver) and the scopes are read from the page it serves.
    const probe = await context.newPage();
    await probe.goto(appUrl, { waitUntil: 'domcontentloaded' });
    const scope = ((await probe.getAttribute('meta[name="aimeat-scopes"]', 'content')) ?? '').trim();
    const origin = new URL(probe.url()).origin;
    await probe.close();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: appRef, response_type: 'code', scope, redirect_uri: `${origin}/`,
        code_challenge: challenge, code_challenge_method: 'S256' });
    const a = await context.request.get(`${node}/v1/app-grants/authorize?${q}`, { maxRedirects: 0 });
    const req = /req=([^&]+)/.exec(a.headers()['location'] ?? '')?.[1];
    if (!req) {
        if (a.status() >= 400) throw new Error(`authorize refused: ${a.status()} ${(await a.text()).slice(0, 300)}`);
        console.log(`  grant: the node answered ${a.status()} without a consent request; the app is granted already`);
        return;
    }
    const c = await context.request.post(`${node}/v1/app-grants/authorize-consent`, {
        headers: { Authorization: `Bearer ${token}` }, data: { request_id: decodeURIComponent(req) } });
    if (!c.ok()) throw new Error(`consent refused: ${c.status()} ${await c.text()}`);
}

/**
 * Sign the app in the way a person does: the pill's Sign in opens the node's window, the person
 * logs in there, and the window closes with the app signed in. On the sandbox the app's silent
 * sign-in cannot see the node's login (a browser treats *.apps.localhost and localhost as two
 * sites, where x.apps.aimeat.io and aimeat.io are one), so the window is the only way in.
 */
async function signInByPopup(page: Page, login: string): Promise<void> {
    const at = login.indexOf(':');
    const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 15000 }),
        page.getByRole('button', { name: /sign in|kirjaudu|iniciar/i }).first().click(),
    ]);
    // Already logged in on the node with the grant in place, the window finishes and closes at once.
    const closed = popup.waitForEvent('close', { timeout: 30000 }).then(() => true, () => false);
    const steps = (async () => {
        await popup.waitForLoadState('domcontentloaded');
        const logIn = popup.getByRole('button', { name: /^(log in|kirjaudu sisään|kirjaudu|iniciar sesión)$/i }).first();
        if (await logIn.isVisible({ timeout: 5000 }).catch(() => false)) await logIn.click();
        await popup.locator('#aimeat-username').fill(login.slice(0, at), { timeout: 10000 });
        await popup.locator('#aimeat-password').fill(login.slice(at + 1));
        await popup.locator('#aimeat-go-btn').click();
        // A grant made through the API above needs no consent; a new one shows the approve button.
        const approve = popup.getByRole('button', { name: /allow|approve|salli|hyväksy|permitir/i }).first();
        if (await approve.isVisible({ timeout: 4000 }).catch(() => false)) await approve.click();
    })().catch((err: Error) => { if (!popup.isClosed()) throw err; });
    await steps;
    if (!(await closed)) throw new Error('the sign-in window did not close; is the password right?');
    await page.waitForLoadState('networkidle');
}

/** One screen: its screenshot and, for a page, the style of each kind of kit part on it. */
async function capture(page: Page, target: string, login = ''): Promise<Capture> {
    if (!/^https?:/.test(target)) return { png: readFileSync(target), parts: {} };
    await page.goto(target, { waitUntil: 'networkidle' });
    if (login) await signInByPopup(page, login);
    await page.waitForTimeout(WAIT);
    if (CLICK) {
        await page.getByText(CLICK, { exact: false }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(WAIT);
    }
    const parts = await page.evaluate((keys: string[]) => {
        const out: Record<string, { count: number; marked: boolean; style: Record<string, string> }> = {};
        document.querySelectorAll('[data-ak-part]').forEach((node) => {
            const e = node as HTMLElement;
            if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return;
            // The component's own class (ak-list, ak-section__title), never the shared ak-root.
            const cls = Array.from(e.classList).find((c) => c !== 'ak-root' && /^ak-[a-z0-9-]+(__[a-z0-9-]+)?$/.test(c)) ?? e.tagName.toLowerCase();
            const key = `${cls}|${e.getAttribute('data-ak-part')}`;
            // Read a part in its plain state: a selected or current one looks different on purpose,
            // and one screen having its first item selected is not a difference in the part.
            const marked = e.matches('[aria-current]:not([aria-current="false"]), [aria-selected="true"], [class*="--selected"], [class*="--active"], [class*="--current"]');
            const style = () => { const cs = getComputedStyle(e); return Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)])); };
            if (out[key]) {
                out[key].count++;
                if (out[key].marked && !marked) { out[key].style = style(); out[key].marked = false; }
                return;
            }
            out[key] = { count: 1, marked, style: style() };
        });
        return out;
    }, STYLE_KEYS);
    return { png: await page.screenshot({ fullPage: false }), parts };
}

/** The share of pixels that differ, and a picture of where: drawn in the browser, no library. */
async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<{ ratio: number; png: Buffer }> {
    const r = await page.evaluate(async ([ua, ub]) => {
        const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        const w = ia.width, h = ia.height;
        const read = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h); };
        const da = read(ia), db = read(ib);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d')!;
        const out = x.createImageData(w, h);
        let diff = 0;
        for (let p = 0; p < da.data.length; p += 4) {
            const d = Math.abs(da.data[p] - db.data[p]) + Math.abs(da.data[p + 1] - db.data[p + 1]) + Math.abs(da.data[p + 2] - db.data[p + 2]);
            const grey = (da.data[p] + da.data[p + 1] + da.data[p + 2]) / 3;
            if (d > 48) { diff++; out.data[p] = 230; out.data[p + 1] = 40; out.data[p + 2] = 40; out.data[p + 3] = 255; }
            else { out.data[p] = out.data[p + 1] = out.data[p + 2] = 255 - (255 - grey) * 0.25; out.data[p + 3] = 255; }
        }
        x.putImageData(out, 0, 0);
        return { ratio: diff / (w * h), url: c.toDataURL('image/png') };
    }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
    return { ratio: r.ratio, png: Buffer.from(r.url.split(',')[1], 'base64') };
}

/** What only one screen has, and every style that differs on a part both have. */
function compareParts(ref: Record<string, PartReading>, app: Record<string, PartReading>) {
    const onlyRef = Object.keys(ref).filter((k) => !app[k]).sort();
    const onlyApp = Object.keys(app).filter((k) => !ref[k]).sort();
    const styles: Array<{ part: string; style: string; ref: string; app: string }> = [];
    for (const k of Object.keys(ref).filter((x) => app[x]).sort()) {
        for (const s of STYLE_KEYS) if (ref[k].style[s] !== app[k].style[s]) styles.push({ part: k, style: s, ref: ref[k].style[s], app: app[k].style[s] });
    }
    return { onlyRef, onlyApp, styles };
}

async function main(): Promise<void> {
    if (!REF || !APP) {
        console.error('usage: pnpm ui:compare --ref <url|png> --app <url> [--login user:password --node <base> --app-ref owner/file] [--click <text>]');
        process.exit(2);
    }
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
        // tsx compiles the functions this script sends into the page with a __name() helper the page
        // does not have; an identity function in its place is all it needs.
        await context.addInitScript('window.__name = function (f) { return f; };');
        if (LOGIN) {
            if (!NODE) throw new Error('--login needs --node, the node the app runs on');
            const token = await signIn(context, NODE, LOGIN);
            for (const [url, ref] of [[APP, APP_REF], [REF, arg('ref-app-ref')]]) {
                if (ref && /^https?:/.test(url)) await grantApp(context, NODE, token, ref, url);
            }
        }
        const page = await context.newPage();
        console.log('  reading the reference …');
        const ref = await capture(page, REF);
        console.log('  reading the app …');
        const app = await capture(page, APP, LOGIN);
        console.log('  comparing the pixels …');
        // A fresh blank page draws the two pictures: the app's page may hold a WebGL scene of its own.
        const blank = await context.newPage();
        const diff = await pixelDiff(blank, ref.png, app.png);
        const parts = compareParts(ref.parts, app.parts);
        writeFileSync(join(OUT, 'ref.png'), ref.png);
        writeFileSync(join(OUT, 'app.png'), app.png);
        writeFileSync(join(OUT, 'diff.png'), diff.png);
        const report = { ref: REF, app: APP, viewport: { width: WIDTH, height: HEIGHT }, pixelsDiffer: Number(diff.ratio.toFixed(4)), ...parts };
        writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
        console.log(`\n  ui:compare  ${WIDTH}×${HEIGHT}  → ${OUT}`);
        console.log(`  pixels that differ     ${(diff.ratio * 100).toFixed(1)} %   (diff.png; data that differs counts here too)`);
        console.log(`  parts only the ref has ${parts.onlyRef.length}${parts.onlyRef.length ? ': ' + parts.onlyRef.slice(0, 12).join(', ') : ''}`);
        console.log(`  parts only the app has ${parts.onlyApp.length}${parts.onlyApp.length ? ': ' + parts.onlyApp.slice(0, 12).join(', ') : ''}`);
        console.log(`  styles that differ     ${parts.styles.length}`);
        for (const s of parts.styles.slice(0, 40)) console.log(`    ${s.part}  ${s.style}: ${s.ref}  →  ${s.app}`);
        if (parts.styles.length > 40) console.log(`    … ${parts.styles.length - 40} more in report.json`);
        console.log('\n  Look at app.png beside ref.png before anyone else does. Every line above is a question to answer.');
    } finally {
        await browser.close();
    }
}

main().catch((err) => { console.error(`ui:compare: ${(err as Error).message}`); process.exit(1); });
