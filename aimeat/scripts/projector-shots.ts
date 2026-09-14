/**
 * @file projector-shots.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Takes the slide projector's pictures (front page, views/landing-v2-projector.js):
 *   one screenshot of every page of Settings & Controls and of Admin, signed in as the operator,
 *   into public/img/frontdemo/projector/<where>-<id>.png. The projector shows a placeholder for a
 *   page whose file is missing, so this script is the only way a real picture gets there.
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
 * @usage
 *   AIMEAT_SHOT_BASE=https://aimeat.io AIMEAT_SHOT_USER=<owner> AIMEAT_SHOT_PASSWORD=<password> \
 *     pnpm projector:shots [--only settings|admin] [--width 1600] [--height 1000] [--settle 1800]
 * @structure SETTINGS · ADMIN · arg · launchBrowser · main
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial, with the front page as the message frame says it (TARGET-075).
 */
import { chromium, type Browser } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
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

  const targets: Array<{ where: 'settings' | 'admin'; id: string; url: string }> = [
    ...(only === 'admin' ? [] : SETTINGS.map((id) => ({ where: 'settings' as const, id, url: `${base}/v1/profile?tab=${encodeURIComponent(id)}` }))),
    ...(only === 'settings' ? [] : ADMIN.map((id) => ({ where: 'admin' as const, id, url: `${base}/v1/admin?tab=${encodeURIComponent(id)}` }))),
  ];

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
        await page.goto(tgt.url, { waitUntil: 'load', timeout: 30_000 });
        await page.waitForTimeout(settle);
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
