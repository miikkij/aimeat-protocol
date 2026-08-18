/**
 * @file scripts/carousel/preview.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renders the same slide markup make.mjs prints, one PNG per page, so the pages can
 *   actually be looked at before anything is published. A PDF nobody has seen is a guess.
 * @usage node scripts/carousel/preview.mjs scripts/carousel/slides.origami.json
 *        -> genimages/carousel/preview/<name>-01.png ...
 * @version-history
 *   v1.1.0 — 2026-07-26 — imports slides.mjs instead of scraping make.mjs for its CSS
 *   v1.0.0 — 2026-07-26 — first cut
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZE, writePage } from './slides.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const spec = JSON.parse(readFileSync(resolve(process.cwd(), process.argv[2]), 'utf8'));
const outDir = join(repo, 'genimages', 'carousel');
const preview = join(outDir, 'preview');
mkdirSync(preview, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
let broken = 0;
for (let i = 0; i < spec.slides.length; i++) {
    await page.goto(writePage(spec, outDir, i, spec.name + '-one'), { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    broken += await page.evaluate(() => Array.from(document.images).filter((im) => !im.naturalWidth).length);
    const n = String(i + 1).padStart(2, '0');
    await page.screenshot({ path: join(preview, `${spec.name}-${n}.png`) });
}
if (broken) console.error('WARNING:', broken, 'image(s) did not load');
await browser.close();
console.log('wrote', spec.slides.length, 'previews to', preview);
