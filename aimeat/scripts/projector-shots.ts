/**
 * @file projector-shots.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Takes the slide projector's pictures (front page, views/landing-v2-projector.js):
 *   one screenshot of every page of Settings & Controls and of Admin, signed in as the operator,
 *   and one of every app in the show (public/img/frontdemo/projector/show.json), into
 *   public/img/frontdemo/projector/<where>-<id>.png. The projector shows a placeholder for a page
 *   whose file is missing, so this script is the only way a real picture gets there.
 *
 *   THE PICTURES GO ON A PUBLIC PAGE. They are taken in the operator's session and show whatever
 *   the pages show that operator, so look at every file before committing it: an admin page can
 *   carry an address, a key or another person's name.
 *
 *   THE SIGN-IN IS THE BROWSER'S OWN. The script logs in with the owner's password through the same
 *   door the sign-in dialog uses (POST /v1/ghii/login), which sets the httpOnly refresh cookie, and
 *   writes the session the auth library expects into localStorage before the first page runs. A
 *   token alone is not enough: an owner session refreshes on every boot from that cookie and a
 *   session without one is thrown away (sdk-libs/auth/session.js, restoreStoredSession).
 *   Playwright drives the machine's own Edge or Chrome first and a Playwright-installed Chromium
 *   after that, like the screenshot worker.
 *
 *   THE SHOW IS DATA. show.json lists the apps in order with their own settle, because a Design
 *   Book takes twenty seconds to draw its first screen and a calculator takes two; the projector
 *   reads the same file, so the pictures and the words cannot drift apart.
 * @usage
 *   AIMEAT_SHOT_BASE=https://aimeat.io AIMEAT_SHOT_USER=<owner> AIMEAT_SHOT_PASSWORD=<password> \
 *     pnpm projector:shots [--only settings|admin|apps|settings:scheduler,apps:design-book] \
 *     [--width 1600] [--height 1000] [--settle 1800] [--show <path to a show.json>]
 * @structure SETTINGS · ADMIN · SLOW_MS · arg · launchBrowser · readShow · main
 * @version-history
 *   v1.2.0 — 2026-09-14 — The apps in the show, from show.json: their own settle, a page other than
 *     the app itself (the catalogue), and the catalogue's details view opened before the shutter.
 *     Nine more slow menu pages, measured on aimeat.io.
 *   v1.1.0 — 2026-09-14 — A settle per slow page (scheduler 16 s, messages 11 s, measured on
 *     aimeat.io) and --only takes a list of pages, so one page can be retaken alone.
 *   v1.0.0 — 2026-09-14 — Initial, with the front page as the message frame says it (TARGET-075).
 */
import { chromium, type Browser } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The same ids views/landing-v2-projector.js lists; a tab added there is added here. */
const SETTINGS = [
  'messages', 'contacts', 'discover', 'portfolio', 'fleet', 'agents', 'ecosystem', 'offers', 'scheduler',
  'workflows', 'chatsessions', 'mcp', 'wallet', 'usage', 'pnl', 'companies', 'knowledge', 'skills',
  'organisms', 'memory', 'notebook', 'living', 'work', 'actions', 'boards', 'apps', 'appdev', 'extensions',
  'capabilities', 'federation', 'nodes', 'access', 'dataWallet', 'nodeStats', 'security', 'email',
  'notifications', 'ai', 'calibrator', 'packages', 'libraries',
];
const ADMIN = [
  'overview', 'economy', 'config', 'security', 'compliance', 'cors', 'maintenance', 'hooks', 'portal',
  'discovery', 'subdomains', 'stats', 'database', 'metrics', 'usage', 'prompts',
  'owners', 'agents', 'ghii', 'agent-integration', 'org-ownership', 'sso',
  'actions', 'boards', 'chatInstances', 'realtime', 'work', 'messages', 'memory-admin', 'agent-tasks',
  'sharing-groups', 'capabilities', 'apps',
  'email', 'push', 'consul', 'scheduler',
  'directory', 'extensions', 'cortex', 'csm', 'knowledge', 'skills', 'packages',
  'msm',
  'federation', 'genesis',
];

/**
 * Pages that take longer than the rest to fill: the settle before the shutter, in milliseconds,
 * where the default (--settle) is not enough. Measured on aimeat.io on 2026-09-14: the scheduler
 * needs about 15 s, the messages page about 10 s, and the rest of this list around 10 s.
 */
const SLOW_MS: Record<string, number> = {
  'settings:scheduler': 16_000,
  'settings:messages': 12_000,
  'settings:skills': 12_000,
  'settings:living': 12_000,
  'settings:nodes': 12_000,
  'admin:compliance': 12_000,
  'admin:memory-admin': 12_000,
  'admin:subdomains': 12_000,
  'admin:skills': 12_000,
};

type Name = string | Record<string, string>;
interface ShowEntry { id: string; name: Name; app?: string; url?: string; settle?: number; detailOf?: string; line?: Name }
interface Target { where: 'settings' | 'admin' | 'apps'; id: string; url: string; settle: number; detailOf?: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function launchBrowser(): Promise<Browser> {
  const forced = arg('channel');
  const attempts: Array<{ channel?: string; label: string }> = forced
    ? [{ channel: forced, label: `--channel ${forced}` }]
    : [{ channel: 'msedge', label: 'system Edge' }, { channel: 'chrome', label: 'system Chrome' }, { label: 'Playwright Chromium' }];
  let last = '';
  for (const a of attempts) {
    try {
      return await chromium.launch({ headless: true, channel: a.channel });
    } catch (e) { last = `${a.label}: ${(e as Error).message.split('\n')[0]}`; }
  }
  throw new Error(`No browser to drive (${last}). Install one with: npx playwright install chromium`);
}

/** The apps in the show, from show.json (or --show <path>); an unreadable file is an empty show. */
function readShow(path: string): ShowEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.apps) ? parsed.apps.filter((e: ShowEntry) => e && typeof e.id === 'string' && (e.app || e.url)) : [];
  } catch (e) {
    console.warn(`show.json not read (${(e as Error).message.split('\n')[0]}); no app slides.`);
    return [];
  }
}

async function main(): Promise<void> {
  const base = (process.env.AIMEAT_SHOT_BASE || 'http://localhost:40600').replace(/\/$/, '');
  const username = process.env.AIMEAT_SHOT_USER || '';
  const password = process.env.AIMEAT_SHOT_PASSWORD || '';
  if (!username || !password) {
    console.error('AIMEAT_SHOT_USER and AIMEAT_SHOT_PASSWORD (an owner with the operator role) are required.');
    process.exit(2);
  }
  const only = arg('only');
  const width = Number(arg('width') || 1600);
  const height = Number(arg('height') || 1000);
  const settle = Number(arg('settle') || 1800);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'frontdemo', 'projector');
  mkdirSync(outDir, { recursive: true });
  const show = readShow(arg('show') || resolve(outDir, 'show.json'));

  // --only takes a side (settings | admin | apps) or a comma-separated list of pages
  // (settings:scheduler, apps:design-book, or a bare id that matches on any side), so one slow
  // page can be retaken alone.
  // Commas or spaces: PowerShell turns a comma-separated argument into an array and hands it on
  // as one space-separated string, so both spellings name the same pages.
  const wanted = (only || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const SIDES = ['settings', 'admin', 'apps'];
  // A side name selects the whole side and nothing else: "apps" is the show, not the Apps tab.
  const keep = (where: Target['where'], id: string) =>
    wanted.length === 0 || wanted.some((w) => w === where || w === `${where}:${id}` || (!SIDES.includes(w) && w === id));
  const appUrl = (app: string) => {
    const slash = app.indexOf('/');
    return `${base}/v1/apps/${encodeURIComponent(app.slice(0, slash))}/${encodeURIComponent(app.slice(slash + 1))}?mode=inline`;
  };
  const targets: Target[] = [
    ...SETTINGS.filter((id) => keep('settings', id)).map((id) => ({ where: 'settings' as const, id, url: `${base}/v1/profile?tab=${encodeURIComponent(id)}`, settle: Math.max(settle, SLOW_MS[`settings:${id}`] ?? 0) })),
    ...ADMIN.filter((id) => keep('admin', id)).map((id) => ({ where: 'admin' as const, id, url: `${base}/v1/admin?tab=${encodeURIComponent(id)}`, settle: Math.max(settle, SLOW_MS[`admin:${id}`] ?? 0) })),
    ...show.filter((e) => keep('apps', e.id)).map((e) => ({
      where: 'apps' as const, id: e.id,
      url: e.url ? (e.url.startsWith('http') ? e.url : `${base}${e.url}`) : appUrl(e.app as string),
      settle: Math.max(settle, Number(e.settle) || 0), detailOf: e.detailOf,
    })),
  ];
  if (targets.length === 0) {
    console.error(`--only ${only} matches no page. Use settings, admin, apps, or pages like settings:scheduler,apps:design-book.`);
    process.exit(2);
  }

  const browser = await launchBrowser();
  let ok = 0; let fail = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });

    // The browser's own sign-in: the request context shares the cookie jar, so the refresh cookie
    // the login sets is the one the pages will refresh from.
    const login = await ctx.request.post(`${base}/v1/ghii/login`, { data: { username, password } });
    const body = await login.json().catch(() => null);
    const token: string | undefined = body?.data?.token;
    if (!login.ok() || !token) {
      throw new Error(`sign-in as ${username} refused (${login.status()}): ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
    }
    const claims = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const session = {
      owner: username, gaii: null, ghii: `${username}@${claims.node || ''}`, jwt: token,
      roles: claims.roles || [], displayName: body?.data?.ghii?.display_name || '',
    };
    await ctx.addInitScript((s: unknown) => {
      try { localStorage.setItem('aimeat_session', JSON.stringify(s)); } catch { /* storage blocked */ }
    }, session);

    const page = await ctx.newPage();
    for (const tgt of targets) {
      try {
        await page.goto(tgt.url, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForTimeout(tgt.settle);
        if (tgt.detailOf) {
          // The catalogue's details view has no address of its own; open it the way a row's ⋯ does.
          const slash = tgt.detailOf.indexOf('/');
          // Runs in the page; `globalThis` there is the window, and this file has no DOM types.
          await page.evaluate(([owner, filename]) => {
            const launcher = (globalThis as unknown as { _launcher?: { openPublishedDetail?: (o: string, f: string, l: string, v: number) => void } })._launcher;
            launcher?.openPublishedDetail?.(owner, filename, '', 0);
          }, [tgt.detailOf.slice(0, slash), tgt.detailOf.slice(slash + 1)]);
          await page.waitForTimeout(Math.max(4_000, Math.floor(tgt.settle / 2)));
        }
        const png = await page.screenshot({ type: 'png' });
        const file = resolve(outDir, `${tgt.where}-${tgt.id}.png`);
        writeFileSync(file, png);
        console.log(`  ✓ ${tgt.where}/${tgt.id} → ${file}`);
        ok++;
      } catch (e) {
        console.warn(`  ✗ ${tgt.where}/${tgt.id} — ${(e as Error).message.split('\n')[0]}`);
        fail++;
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${ok} taken, ${fail} failed. Look at every picture before committing: they go on a public page.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
