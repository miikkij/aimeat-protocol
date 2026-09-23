/**
 * @file scripts/design-lab-crops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shoots the crops the design lab's decisions show beside each live variant: the real
 *   element on its real page, in light and dark, read from public/views/design-lab/decisions-data.js.
 *   Writes public/img/design-lab/<decision>/<variant>-<theme>.png and a manifest
 *   (public/img/design-lab/crops.json) that says, per variant, which crops exist and why one does
 *   not ("not on this page", "no crop asked for"). The lab reads the manifest, so a missing crop is
 *   said in words, never shown as a broken image.
 *
 *   It runs against a node the operator can sign in to, usually `pnpm sandbox`, because the crops
 *   need a signed-in home, chat, profile and admin with data on them.
 * @usage pnpm design-lab:crops --base http://localhost:40609 --user sandbox --password '…' [--only chip]
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'img', 'design-lab');
const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };

/** Per variant: the crops that exist, or why there is none. */
type CropEntry = { light?: string; dark?: string; missing?: string };
type Manifest = Record<string, Record<string, CropEntry>>;
type Crop = { url: string; selector: string; click?: string | string[]; eval?: string };
type Decision = { id: string; variants: Array<{ id: string; crop: Crop | null }> };
const BASE = arg('base', 'http://localhost:40609');
const USER = arg('user', 'sandbox');
const PASSWORD = arg('password', process.env.SANDBOX_PASSWORD || '');
const ONLY = arg('only', '');
if (!PASSWORD) throw new Error('--password is needed (or SANDBOX_PASSWORD)');

const { DECISIONS } = await import(pathToFileURL(path.join(ROOT, 'public', 'views', 'design-lab', 'decisions-data.js')).href) as { DECISIONS: Decision[] };
const manifestPath = path.join(OUT, 'crops.json');
const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const browser = await chromium.launch();
for (const theme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await ctx.addInitScript((t: string) => {
    try { localStorage.setItem('aimeat-theme', t); localStorage.setItem('aimeat_theme', JSON.stringify(t)); localStorage.setItem('aimeat-lang', 'en'); } catch { /* private mode */ }
  }, theme);
  const login = await ctx.request.post(`${BASE}/v1/ghii/login`, { data: { username: USER, password: PASSWORD } });
  if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);
  const page = await ctx.newPage();

  for (const d of DECISIONS) {
    if (ONLY && d.id !== ONLY) continue;
    manifest[d.id] ??= {};
    mkdirSync(path.join(OUT, d.id), { recursive: true });
    for (const v of d.variants) {
      const entry: CropEntry = manifest[d.id][v.id] ?? {};
      const crop = v.crop;
      if (!crop) { manifest[d.id][v.id] = { missing: 'no page draws it in a state a crop can reach' }; continue; }
      try {
        await page.goto(`${BASE}${crop.url}`);
        await page.waitForTimeout(2200);
        for (const sel of ([] as string[]).concat(crop.click || [])) { await page.click(sel, { timeout: 4000 }); await page.waitForTimeout(700); }
        if (crop.eval) { await page.evaluate(new Function(crop.eval) as () => void); await page.waitForTimeout(1500); }
        const el = page.locator(crop.selector).first();
        if (!(await el.count()) || !(await el.isVisible())) throw new Error('not on this page');
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        if (!box) throw new Error('not on this page');
        const pad = 10;
        const file = `${d.id}/${v.id}-${theme}.png`;
        await page.screenshot({
          path: path.join(OUT, file),
          clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(box.width + pad * 2, 1200), height: Math.min(box.height + pad * 2, 600) },
        });
        entry[theme] = `/img/design-lab/${file}`;
        delete entry.missing;
        manifest[d.id][v.id] = entry;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!entry.light && !entry.dark) manifest[d.id][v.id] = { missing: message.includes('not on this page') ? 'not on the page with the data this node has' : message.slice(0, 80) };
      }
    }
  }
  await ctx.close();
}
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const all = Object.values(manifest).flatMap((d) => Object.values(d));
console.log(`crops: ${all.filter((e) => e.light).length} variants shot, ${all.filter((e) => e.missing).length} without a crop`);
for (const [d, vs] of Object.entries(manifest)) for (const [v, e] of Object.entries(vs)) if (e.missing) console.log(`  ${d}/${v}: ${e.missing}`);
