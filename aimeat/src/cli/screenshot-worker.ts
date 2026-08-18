/**
 * @file screenshot-worker.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator screenshot worker, shipped as the `aimeat screenshot-worker` subcommand.
 *   Lists published apps with no screenshot, renders each headless, captures a JPEG, and uploads it
 *   via POST /v1/apps/:owner/:filename/screenshot. Uses `playwright-core` (no bundled browser
 *   download) and drives the machine's OWN Chrome/Edge via a channel, so it works on an npm/npx
 *   install with zero extra download on Windows/desktop; a headless server with no browser falls
 *   back to a `playwright install chromium` hint. Apps are opened ANONYMOUSLY (login-gated apps just
 *   yield a screenshot of their login screen — still a fine thumbnail). The node works fine without
 *   this; screenshots are an opt-in operator feature.
 * @structure runScreenshotWorker() entry; launchBrowser() channel fallback; runOnce() one scan.
 * @usage
 *   AIMEAT_OP_TOKEN=<operator-pat> aimeat screenshot-worker \
 *     [--base http://localhost:40050] [--limit 50] [--watch 600] [--force] [--dry-run]
 *     [--width 1200] [--height 750] [--channel msedge|chrome]
 *   One-shot by default; --watch N loops every N seconds (a self-contained daemon). For unattended
 *   runs use a long-lived operator PAT (POST /v1/access/tokens, grant_operator) — not a login JWT.
 * @version-history
 *   v1.0.0 — 2026-06-20 — extracted from scripts/screenshot-worker.ts into a CLI subcommand;
 *     playwright-core + system-browser (Edge/Chrome) channel fallback so npm installs work without a
 *     300 MB browser download; keeps --watch daemon, anonymous render, operator-PAT auth.
 */
import { chromium, type Browser } from 'playwright-core';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

interface AppRow { owner: string; filename: string; has_screenshot?: boolean }

/**
 * Launch a headless browser WITHOUT requiring a 300 MB Playwright browser download: prefer the
 * machine's installed Edge/Chrome via `channel`, then fall back to a Playwright-installed Chromium
 * (present on dev machines / after `npx playwright install chromium`). Errors with install guidance
 * if none is usable. A specific --channel skips the probing.
 */
async function launchBrowser(): Promise<Browser> {
  const forced = arg('channel');
  const attempts: Array<{ channel?: string; label: string }> = forced
    ? [{ channel: forced, label: `--channel ${forced}` }]
    : [
        { channel: 'msedge', label: 'system Edge' },
        { channel: 'chrome', label: 'system Chrome' },
        { label: 'Playwright-installed Chromium' },
      ];
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, channel: a.channel });
      console.log(`Browser: ${a.label}.`);
      return browser;
    } catch (e) { lastErr = e; }
  }
  throw new Error(
    'No usable browser found (tried Edge, Chrome, and a Playwright-installed Chromium). '
    + 'Install one with: npx playwright install chromium\n'
    + `Last error: ${(lastErr as Error).message}`,
  );
}

// One scan: list apps, capture every one still missing a screenshot, upload it. A fresh browser per
// cycle keeps long-running watch mode leak-free.
async function runOnce(base: string, token: string, opts: {
  limit: number; width: number; height: number; pageTimeout: number; force: boolean; dry: boolean;
}): Promise<{ ok: number; fail: number }> {
  const listRes = await fetch(`${base}/v1/apps?limit=${opts.limit}`);
  if (!listRes.ok) { console.error(`Failed to list apps: ${listRes.status}`); return { ok: 0, fail: 0 }; }
  const list = await listRes.json() as { data?: { apps?: AppRow[] } };
  const apps = list?.data?.apps ?? [];
  const targets = apps.filter((a) => opts.force || !a.has_screenshot);
  console.log(`${apps.length} apps listed; ${targets.length} need a screenshot${opts.force ? ' (--force)' : ''}.`);
  if (targets.length === 0) return { ok: 0, fail: 0 };

  const browser = await launchBrowser();
  let ok = 0; let fail = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    for (const a of targets) {
      const label = `${a.owner}/${a.filename}`;
      const path = `/v1/apps/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.filename)}`;
      const page = await ctx.newPage();
      try {
        // Open ANONYMOUSLY. 'load' (not 'networkidle') — many AIMEAT apps poll / hold an SSE stream
        // and never go idle, which would time out an otherwise fine app.
        await page.goto(`${base}${path}?mode=inline`, { waitUntil: 'load', timeout: opts.pageTimeout });
        await page.waitForTimeout(1200); // let client-rendered UI paint + intro animations settle
        const jpeg = await page.screenshot({ type: 'jpeg', quality: 80 });
        if (opts.dry) { console.log(`  ⏭  ${label} — captured ${jpeg.length}B (dry-run, not uploaded)`); ok++; continue; }
        const up = await fetch(`${base}${path}/screenshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ screenshot: jpeg.toString('base64'), screenshot_mime_type: 'image/jpeg' }),
        });
        if (up.ok) { console.log(`  ✅ ${label}`); ok++; }
        else { console.warn(`  ❌ ${label} — upload ${up.status}: ${(await up.text()).slice(0, 120)}`); fail++; }
      } catch (e) {
        console.warn(`  ❌ ${label} — ${(e as Error).message}`); fail++;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Cycle done: ${ok} captured, ${fail} failed.`);
  return { ok, fail };
}

export async function runScreenshotWorker(): Promise<void> {
  const base = (arg('base') ?? process.env.AIMEAT_BASE ?? 'http://localhost:40050').replace(/\/+$/, '');
  const token = arg('token') ?? process.env.AIMEAT_OP_TOKEN ?? '';
  const dry = has('dry-run');
  const watch = parseInt(arg('watch', '0')!, 10); // seconds between scans; 0 = run once
  const opts = {
    limit: parseInt(arg('limit', '50')!, 10),
    width: parseInt(arg('width', '1200')!, 10),
    height: parseInt(arg('height', '750')!, 10),
    pageTimeout: parseInt(arg('timeout', '20000')!, 10),
    force: has('force'),
    dry,
  };

  if (!token && !dry) {
    console.error('Missing operator token. Set AIMEAT_OP_TOKEN or pass --token <token> (or use --dry-run).');
    process.exit(1);
  }

  if (watch > 0) {
    console.log(`Watch mode: backfilling missing screenshots every ${watch}s. Ctrl-C to stop.`);
    for (;;) {
      try { await runOnce(base, token, opts); } catch (e) { console.error('Cycle error:', (e as Error).message); }
      await new Promise((r) => setTimeout(r, watch * 1000));
    }
  }

  const { ok, fail } = await runOnce(base, token, opts);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}
