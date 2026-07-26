/**
 * @file scripts/demo-video/watch.mjs
 * @description A camera, not a driver. Opens one page, signs in with the stored session, and
 *   records until told to stop — without clicking a single thing. Everything that moves on the
 *   recording was done by somebody else: an agent writing the board record over MCP, another
 *   person on another machine, a scheduled job. That is the whole point of the shot.
 *
 *   record.mjs is the opposite tool: it performs. Do not add steps here.
 * @usage node scripts/demo-video/watch.mjs --url=/?b=brd-x --seconds=420 --name=mcp-direct
 *        -> genimages/videos/<name>/<name>.webm  (+ live/NNNN.png every 5s while it runs)
 * @structure args -> context with video -> idle loop with live screenshots -> close (flushes video)
 * @version-history
 *   v1.0.0 - 2026-07-27 - written for the MCP-direct shot, where the browser is a spectator
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const arg = (k, d) => {
    const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : d;
};

const name = arg('name', 'watch');
const path = arg('url', '/');
const seconds = Number(arg('seconds', '300'));
const base = arg('base', 'https://origami.apps.aimeat.io');
const width = Number(arg('width', '1440'));
const height = Number(arg('height', '900'));

const outDir = join(repo, 'genimages', 'videos', name);
const liveDir = join(outDir, 'live');
mkdirSync(liveDir, { recursive: true });

/* The same signed-in session record.mjs uses; pass --state= to point at another one. */
const statePath = arg('state', resolve(process.env.TEMP || '.', 'claude', 'origami-state.json'));
if (!existsSync(statePath)) {
    console.error(`no stored session at ${statePath} — pass --state=<playwright storageState.json>`);
    process.exit(2);
}

const browser = await chromium.launch({
    headless: !process.env.HEADED,
    args: ['--disable-features=Translate,TranslateUI', '--lang=en-GB'],
});
const context = await browser.newContext({
    storageState: statePath,
    viewport: { width, height },
    deviceScaleFactor: 1.5,
    recordVideo: { dir: outDir, size: { width, height } },
});
/* Which board to look at is not a click: the app remembers it in localStorage, so the camera
   says it before the app boots rather than reaching into the UI afterwards. */
const board = arg('board', '');
if (board) await context.addInitScript((id) => localStorage.setItem('origami.project', id), board);

const page = await context.newPage();

console.log(`[watch] ${base}${path} for ${seconds}s — the page is watched, never touched`);
await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await page.waitForLoadState('load').catch(() => {});

/* A still every five seconds, so the run can be followed while it happens and a bad shot is
   caught in the first minute instead of at the end of one. */
let shot = 0;
const started = Date.now();
const tick = setInterval(async () => {
    shot += 1;
    await page.screenshot({ path: join(liveDir, String(shot).padStart(4, '0') + '.png') }).catch(() => {});
    const left = Math.round(seconds - (Date.now() - started) / 1000);
    if (shot % 6 === 0) console.log(`[watch] ${left}s left`);
}, 5000);

await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(tick);

/* Playwright names the file after the page's guid and only flushes it on close. */
await context.close();
await browser.close();
const webm = readdirSync(outDir).filter((f) => f.endsWith('.webm') && !f.startsWith(name)).sort();
if (webm.length) {
    renameSync(join(outDir, webm[webm.length - 1]), join(outDir, `${name}.webm`));
    console.log(`[watch] saved ${join(outDir, `${name}.webm`)}`);
}
