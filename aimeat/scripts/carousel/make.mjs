/**
 * @file scripts/carousel/make.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds a LinkedIn document carousel (a PDF read one page at a time) out of a
 *   slide list and screenshots taken from a real board. Sibling of scripts/demo-video/ and
 *   scripts/gen_image.py: a marketing-asset tool, nothing here touches the app or the protocol.
 * @structure  slides JSON -> slides.mjs markup -> page.pdf() at 1080x1080 per page
 * @usage      from aimeat/ so @playwright/test resolves:
 *               node scripts/carousel/make.mjs scripts/carousel/slides.origami.json
 *             Output: genimages/carousel/<name>.pdf. Look at it first with preview.mjs.
 * @version-history
 *   v1.1.0 — 2026-07-26 — markup moved to slides.mjs so the preview renders the same pages
 *   v1.0.0 — 2026-07-26 — first cut, for the ORIGAMI "empty surface to published app" carousel
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZE, writePage } from './slides.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const specPath = process.argv[2];
if (!specPath) {
    console.error('usage: node scripts/carousel/make.mjs <slides.json>');
    process.exit(1);
}
const spec = JSON.parse(readFileSync(resolve(process.cwd(), specPath), 'utf8'));
const outDir = join(repo, 'genimages', 'carousel');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.goto(writePage(spec, outDir, null, spec.name + '-all'), { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const broken = await page.evaluate(() => Array.from(document.images).filter((i) => !i.naturalWidth).length);
if (broken) throw new Error(broken + ' slide image(s) failed to load; not writing a PDF with holes in it');
const out = join(outDir, spec.name + '.pdf');
await page.pdf({ path: out, width: `${SIZE}px`, height: `${SIZE}px`, printBackground: true });
await browser.close();
console.log('wrote', out, '(' + spec.slides.length + ' pages)');
