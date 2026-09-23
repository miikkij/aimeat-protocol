/**
 * @file scripts/design-lab-crops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two jobs for the design lab's decisions, read from public/views/design-lab/decisions-data.js:
 *
 *   1. The context picture: each variant's real element on its real page, outlined, with enough of
 *      the page around it to see where it sits, at a readable size (shot at twice the size, shown
 *      at its own). Writes public/img/design-lab/<decision>/<variant>-context.png and a manifest
 *      (public/img/design-lab/crops.json) that says, per variant, which picture exists and why one
 *      does not. The lab reads the manifest, so a missing picture is said in words.
 *   2. The truth check: the same element measured on the real page and in the lab's preview, in
 *      light and dark, and every difference printed. A preview that draws something its page does
 *      not is a fault (Jouni, 2026-09-23), and this is how one is found.
 *
 *   It runs against a node the operator can sign in to, usually `pnpm sandbox`, because the pages
 *   need a signed-in home, chat, profile and admin with data on them.
 * @usage pnpm design-lab:crops --base http://localhost:40609 --user sandbox --password '…' [--only tag]
 * @version-history
 *   v2.0.0 — 2026-09-23 — The context picture (outlined, with room around it) replaces the tight
 *     light and dark crops, which were narrow strips; the preview is measured against the page.
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */
// `measure` and the page callbacks run in the browser, so this file needs the DOM's types.
/// <reference lib="dom" />
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'img', 'design-lab');
const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };

/** Per variant: the context picture, or why there is none. */
type CropEntry = { context?: string; missing?: string };
type Manifest = Record<string, Record<string, CropEntry>>;
/** `user`: another sandbox owner whose data shows the element (an owner without an agent sees the first steps). */
/** `around`: the element to outline and frame when the measured one sits in a container that clips an outline. */
type Crop = { url: string; selector: string; click?: string | string[]; eval?: string; user?: string; around?: string };
type Decision = { id: string; choice: unknown; variants: Array<{ id: string; crop: Crop | null }> };
type Values = Record<string, string>;
const BASE = arg('base', 'http://localhost:40609');
const USER = arg('user', 'sandbox');
const PASSWORD = arg('password', process.env.SANDBOX_PASSWORD || '');
const ONLY = arg('only', '');
if (!PASSWORD) throw new Error('--password is needed (or SANDBOX_PASSWORD)');

const VIEW = { width: 1280, height: 900 };
/** The least of the page shown around an element, so the picture says where it is. */
const AROUND = { width: 620, x: 48, y: 56 };
/** An annotation colour no page of the product uses, so the outline cannot be taken for the design. */
const OUTLINE = '3px solid #2f6feb';

const { DECISIONS } = await import(pathToFileURL(path.join(ROOT, 'public', 'views', 'design-lab', 'decisions-data.js')).href) as { DECISIONS: Decision[] };
const manifestPath = path.join(OUT, 'crops.json');
const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

/**
 * The same reading as views/design-lab/frame.js measureValues, run on the real page. Kept in step
 * by hand; a difference between the two readers would show as a difference on every variant.
 */
function measure(el: Element): Values {
  const TOKENS = ['--text', '--bg', '--card-bg', '--card', '--text-dim', '--border', '--accent', '--sun', '--on-sun',
    '--success', '--success-fg', '--danger', '--warn-fg', '--info-fg', '--bg-surface', '--bg-dim', '--muted'];
  const rgbOf = (value: string): string => {
    const v = String(value || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (hex) {
      const s = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
      return `rgb(${parseInt(s.slice(0, 2), 16)}, ${parseInt(s.slice(2, 4), 16)}, ${parseInt(s.slice(4, 6), 16)})`;
    }
    return v.replace(/\s+/g, ' ');
  };
  const colour = (value: string): string => {
    if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') return 'none';
    const root = getComputedStyle(document.documentElement);
    const hit = TOKENS.find((t) => rgbOf(root.getPropertyValue(t)) === rgbOf(value));
    return hit ? `var(${hit})` : value;
  };
  const rem = (px: string): string => {
    const n = parseFloat(px);
    if (!Number.isFinite(n) || n === 0) return '0';
    return `${String(Math.round((n / 16) * 1000) / 1000).replace(/^0\./, '.')}rem`;
  };
  const s = getComputedStyle(el);
  const width = parseFloat(s.borderTopWidth);
  const size = parseFloat(s.fontSize);
  const spacing = parseFloat(s.letterSpacing);
  return {
    font: `${s.fontFamily.split(',')[0].replace(/["']/g, '').trim()} ${rem(s.fontSize)} ${s.fontWeight}`,
    case: s.textTransform === 'none' ? 'as written' : s.textTransform,
    tracking: Number.isFinite(spacing) && size ? `${String(Math.round((spacing / size) * 100) / 100).replace(/^0\./, '.')}em` : 'normal',
    padding: s.padding.split(' ').map(rem).join(' '),
    frame: s.borderTopStyle === 'none' || !width ? 'none' : `${Math.max(1, Math.round(width))}px ${s.borderTopStyle} ${colour(s.borderTopColor)}`,
    radius: s.borderRadius === '0px' ? 'none' : s.borderRadius,
    fill: s.backgroundImage !== 'none' && s.backgroundImage.includes('gradient') ? 'a gradient' : colour(s.backgroundColor),
    colour: colour(s.color),
    underline: s.textDecorationLine.includes('underline') || (parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== 'none' && parseFloat(s.borderTopWidth) === 0) ? 'yes' : 'no',
    letters: /\p{L}/u.test(el.textContent || '') ? 'yes' : 'no',
    dimmed: parseFloat(s.opacity) < 1 ? 'yes' : 'no',
  };
}

const faults: string[] = [];
const browser = await chromium.launch();
for (const theme of ['light', 'dark'] as const) {
  // One signed-in page per owner, opened when a crop first asks for that owner.
  type Page = Awaited<ReturnType<Awaited<ReturnType<typeof browser.newContext>>['newPage']>>;
  const pages = new Map<string, Page>();
  const pageFor = async (user: string): Promise<Page> => {
    if (pages.has(user)) return pages.get(user);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await ctx.addInitScript((t: string) => {
      try { localStorage.setItem('aimeat-theme', t); localStorage.setItem('aimeat_theme', JSON.stringify(t)); localStorage.setItem('aimeat-lang', 'en'); } catch { /* private mode */ }
    }, theme);
    // tsx names the inner functions of `measure` with a helper that exists only in Node; the page
    // gets a stand-in, so the function runs there as written.
    await ctx.addInitScript('window.__name = (f) => f;');
    const login = await ctx.request.post(`${BASE}/v1/ghii/login`, { data: { username: user, password: PASSWORD } });
    if (!login.ok()) throw new Error(`sign-in failed for ${user}: ${login.status()}`);
    const p = await ctx.newPage();
    pages.set(user, p);
    return p;
  };

  for (const d of DECISIONS) {
    if (ONLY && d.id !== ONLY) continue;
    // A decided decision is built: its page draws the new look, and its pictures stay as they were
    // taken before, which is what they are for.
    if (d.choice) continue;
    manifest[d.id] ??= {};
    mkdirSync(path.join(OUT, d.id), { recursive: true });
    for (const [index, v] of d.variants.entries()) {
      const crop = v.crop;
      if (!crop) { manifest[d.id][v.id] = { missing: 'no page draws it with the data this node has' }; continue; }
      let real: Values | null = null;
      const page = await pageFor(crop.user ?? USER);
      try {
        await page.goto(`${BASE}${crop.url}`);
        await page.waitForTimeout(2200);
        for (const sel of ([] as string[]).concat(crop.click || [])) { await page.click(sel, { timeout: 4000 }); await page.waitForTimeout(700); }
        if (crop.eval) { await page.evaluate(new Function(crop.eval) as () => void); await page.waitForTimeout(1500); }
        const el = page.locator(crop.selector).first();
        if (!(await el.count()) || !(await el.isVisible())) throw new Error('not on this page');
        real = await el.evaluate(measure);
        if (theme === 'light') {
          const shown = crop.around ? page.locator(crop.around).first() : el;
          await shown.evaluate((node: HTMLElement, outline: string) => {
            node.scrollIntoView({ block: 'center' });
            node.style.outline = outline; node.style.outlineOffset = '4px';
          }, OUTLINE);
          await page.waitForTimeout(300);
          const box = await shown.boundingBox();
          if (!box) throw new Error('not on this page');
          const width = Math.min(VIEW.width, Math.max(AROUND.width, box.width + AROUND.x * 2));
          const x = Math.max(0, Math.min(VIEW.width - width, box.x + box.width / 2 - width / 2));
          const y = Math.max(0, box.y - AROUND.y);
          const height = Math.min(VIEW.height - y, box.height + AROUND.y * 2);
          const file = `${d.id}/${v.id}-context.png`;
          await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width, height } });
          for (const old of ['light', 'dark']) rmSync(path.join(OUT, d.id, `${v.id}-${old}.png`), { force: true });
          manifest[d.id][v.id] = { context: `/img/design-lab/${file}` };
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // The manifest is read by a person: a reason in words, never a tool's error text.
        if (theme === 'light') manifest[d.id][v.id] = { missing: message.includes('not on this page') ? 'not on its page with the data this node has' : 'its page did not reach the state that shows it' };
        if (!message.includes('not on this page')) console.error(`  ${d.id}/${v.id} ${theme}: ${message.split('\n')[0].slice(0, 120)}`);
      }
      if (!real) continue;
      // The preview of the same variant, measured the same way: the crop's own selector where it
      // fits the preview too (so the same tone is compared on both sides), else the sample's element.
      await page.goto(`${BASE}/v1/design-lab/frame?id=decision:${encodeURIComponent(d.id)}&v=${index}&theme=${theme}`);
      await page.waitForTimeout(1500);
      const same = page.locator(crop.selector).first();
      const drawn = (await same.count())
        ? await same.evaluate(measure)
        : await page.evaluate(() => (window as unknown as { __dlValues?: Values }).__dlValues ?? null);
      if (!drawn) { faults.push(`${d.id}/${v.id} ${theme}: the preview measured nothing`); continue; }
      for (const k of Object.keys(real)) {
        if (real[k] !== drawn[k]) faults.push(`${d.id}/${v.id} ${theme}: ${k} page "${real[k]}" preview "${drawn[k]}"`);
      }
    }
  }
  for (const p of pages.values()) await p.context().close();
}
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const all = Object.values(manifest).flatMap((d) => Object.values(d));
console.log(`context pictures: ${all.filter((e) => e.context).length}, without: ${all.filter((e) => e.missing).length}`);
for (const [d, vs] of Object.entries(manifest)) for (const [v, e] of Object.entries(vs)) if (e.missing) console.log(`  ${d}/${v}: ${e.missing}`);
console.log(faults.length ? `\npreview differs from its page (${faults.length}):` : '\nevery preview measures as its page');
for (const f of faults) console.log(`  ${f}`);
