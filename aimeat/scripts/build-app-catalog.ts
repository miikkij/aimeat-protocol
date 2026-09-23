/**
 * @file build-app-catalog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Build step for the app-catalog page. Bundles the modular ES sources under
 *   src/static/app-catalog/ (js/main.js entry + its imports) with esbuild into one IIFE, inlines
 *   the CSS, and injects both into _template.html — producing the served, self-contained
 *   src/static/app-catalog.html. The catalog is node-served (standalone retired, TARGET-021), so it
 *   is assembled at build time from many maintainable modules instead of one 9000-line inline script.
 * @structure
 *   - readTemplate() → the markup shell with __APP_CATALOG_STYLES__ / __APP_CATALOG_BUNDLE__ markers
 *   - bundleJs()     → esbuild main.js → IIFE text (</script> escaped so inline injection is safe)
 *   - themePosterTokens(themeCss) → the type and sun tokens copied out of public/css/theme.css
 *   - buildAppCatalog() → assemble + write src/static/app-catalog.html (+ a generated-file banner)
 * @usage  pnpm build:app-catalog   (also run by `pnpm build` and `pnpm dev`)
 * @version-history
 *   v2.0.0 — 2026-09-22 — The catalog is drawn by the site's one set: the build inlines theme.css's
 *     whole :root and dark token blocks, public/css/poster.css (the shapes) and public/css/parts.css
 *     (the parts, last, so a part wins over a leftover catalog rule of the same weight). The catalog's
 *     markup emits the same classes through js/parts-html.js. A token, shape or part changed at its
 *     one home now reaches the catalog on the next build, like every other page.
 *   v1.4.0 — 2026-09-22 — The shape tokens are copied too: dialog.css reads them since the corner,
 *     the rule weights and the offset shadows became tokens, and without them the catalog's dialogs
 *     would lose their frame.
 *   v1.3.0 — 2026-09-18 — styles/app-catalog-visitors.css is appended after the poster sheet: the
 *     Visitors section's own sheet, because the poster sheet is at the line ceiling.
 *   v1.2.0 — 2026-09-13 — public/css/dialog.css is appended after the poster sheet, and the bundle
 *     takes public/js/dialog.js through js/dialogs.js, so the catalog's dialogs are the site's one
 *     dialog rather than a copy; a change to either file makes check:app-catalog fail until the page
 *     is rebuilt.
 *   v1.1.0 — 2026-09-13 — The poster sheet's type and sun tokens come from theme.css at build time
 *     instead of a hand copy. The copy had stayed at its 2026-08-28 values (Archivo Black, -.035em)
 *     for two weeks after theme.css moved to Fjalla One and its own tracking; now a change there
 *     makes check:app-catalog fail until the page is rebuilt, which is the drift made visible.
 *   v1.0.0 — 2026-07-10 — Initial modular build (TARGET-021 Aalto 3): esbuild bundle + CSS inline.
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src', 'static', 'app-catalog');
const OUT_FILE = join(__dirname, '..', 'src', 'static', 'app-catalog.html');

const THEME_FILE = join(__dirname, '..', 'public', 'css', 'theme.css');
/** The site's one dialog; the catalog's dialogs wear the same file the SPA links. */
const DIALOG_CSS_FILE = join(__dirname, '..', 'public', 'css', 'dialog.css');
/** The shared shapes and parts, the same two files the SPA links. */
const POSTER_CSS_FILE = join(__dirname, '..', 'public', 'css', 'poster.css');
const PARTS_CSS_FILE = join(__dirname, '..', 'public', 'css', 'parts.css');

const STYLES_MARKER = '__APP_CATALOG_STYLES__';
const BUNDLE_MARKER = '__APP_CATALOG_BUNDLE__';
const TOKENS_MARKER = '/* __THEME_POSTER_TOKENS__ */';

/** The tokens the catalog's poster sheet reads from the house theme: the faces, how a headline is set, the sun. */
const THEME_TOKENS = [
  '--font-headline', '--font-body', '--font-mono',
  '--font-poster', '--font-poster-weight', '--font-poster-text-weight', '--font-poster-strong-weight',
  '--font-poster-tracking', '--font-poster-leading',
  '--font-poster-section', '--font-poster-section-weight',
  '--sun', '--on-sun',
  // The shape tokens: dialog.css (inlined below) and every shared part read them.
  '--shape-radius', '--rule-hair', '--rule-thing', '--rule-heavy', '--rule-edge', '--rule-stripe',
  '--offset-s', '--offset-m', '--offset-l',
];

/**
 * The declarations of THEME_TOKENS in theme.css's :root block, one per line. The catalog page cannot
 * link theme.css (it carries the whole shell), so these are copied into its own sheet at build time.
 * A token missing from theme.css, or declared twice, stops the build rather than copying a guess.
 */
export function themePosterTokens(themeCss: string): string {
  const start = themeCss.search(/^:root\s*\{/m);
  if (start < 0) throw new Error('theme.css has no :root block');
  const end = themeCss.indexOf('\n}', start);
  const block = themeCss.slice(start, end < 0 ? undefined : end);
  return THEME_TOKENS.map((name) => {
    const found = [...block.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'gm'))];
    if (found.length !== 1) throw new Error(`theme.css :root declares ${name} ${found.length} times; the catalog copies exactly one`);
    return `  ${name}: ${found[0][1].trim()};`;
  }).join('\n');
}

/**
 * One top-level block of theme.css, verbatim: the selector line through its closing brace. Braces are
 * counted, so a comment or a nested value cannot end the block early. A block that is missing stops
 * the build rather than drawing the catalog without its tokens.
 */
function cssBlock(css: string, selector: RegExp): string {
  const m = selector.exec(css);
  if (!m) throw new Error(`theme.css has no block ${selector}`);
  let depth = 0;
  for (let i = css.indexOf('{', m.index); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(m.index, i + 1);
  }
  throw new Error(`theme.css block ${selector} is not closed`);
}

/**
 * Every token of the house theme, light and dark: theme.css's :root block and its dark override,
 * copied whole. The catalog cannot link theme.css (it carries the site's whole shell), but it must
 * read the same tokens as every other page, so a theme is one edit for the catalog too.
 */
export function themeTokenBlocks(themeCss: string): string {
  return cssBlock(themeCss, /^:root\s*\{/m) + '\n' + cssBlock(themeCss, /^\[data-theme="dark"\]\s*\{/m);
}

async function bundleJs(): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [join(SRC_DIR, 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  if (!result.outputFiles?.length) throw new Error('esbuild produced no output');
  // Inline into <script>…</script>: any literal </script> in a string/regex would close the tag early.
  return result.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
}

/** Assemble the served HTML from the modular sources (pure — does not touch disk). */
export async function renderAppCatalog(): Promise<string> {
  const template = readFileSync(join(SRC_DIR, '_template.html'), 'utf-8');
  if (!template.includes(STYLES_MARKER)) throw new Error(`template missing ${STYLES_MARKER}`);
  if (!template.includes(BUNDLE_MARKER)) throw new Error(`template missing ${BUNDLE_MARKER}`);

  // The poster face is appended AFTER the base stylesheet so it wins every cascade it shares, and
  // the site's dialog after both, so a dialog here is drawn by the same rules as one in the SPA.
  const poster = readFileSync(join(SRC_DIR, 'styles', 'app-catalog-poster.css'), 'utf-8');
  if (!poster.includes(TOKENS_MARKER)) throw new Error(`app-catalog-poster.css missing ${TOKENS_MARKER}`);
  const themeCss = readFileSync(THEME_FILE, 'utf-8');
  const tokens = themePosterTokens(themeCss);
  // app-catalog.css comes FIRST and nothing may precede it: it begins with the rest of the
  // template's header comment and then opens <head> and the real <style> (the marker sits inside
  // that comment), so anything placed before it lands inside an HTML comment and is never read.
  // After it the house tokens and shapes, the catalog's poster sheet (page debt, shrinking), the
  // site's dialog, and the shared parts last so a part wins over a catalog rule of equal weight.
  const css = readFileSync(join(SRC_DIR, 'styles', 'app-catalog.css'), 'utf-8') + '\n' +
    themeTokenBlocks(themeCss) + '\n' +
    readFileSync(POSTER_CSS_FILE, 'utf-8') + '\n' +
    poster.replace(TOKENS_MARKER, () => tokens.trimStart()) + '\n' +
    // The Visitors section's own sheet: the poster sheet is at the 800-line ceiling, and a section
    // with a chart, a map and two tables is a coherent group to keep together. After the poster
    // sheet, because it composes the poster's tokens and shapes.
    readFileSync(join(SRC_DIR, 'styles', 'app-catalog-visitors.css'), 'utf-8') + '\n' +
    readFileSync(DIALOG_CSS_FILE, 'utf-8') + '\n' +
    readFileSync(PARTS_CSS_FILE, 'utf-8');
  const bundle = await bundleJs();

  const banner =
    '<!-- GENERATED FILE — do not edit directly. Source: src/static/app-catalog/ ' +
    '(js/*.js + styles/*.css + _template.html), the tokens of public/css/theme.css, public/css/poster.css, public/css/parts.css, and public/css/dialog.css + public/js/dialog.js. Rebuild: pnpm build:app-catalog -->\n';

  return banner + template.replace(STYLES_MARKER, () => css).replace(BUNDLE_MARKER, () => bundle);
}

export async function buildAppCatalog(): Promise<void> {
  writeFileSync(OUT_FILE, await renderAppCatalog(), 'utf-8');
}

/** --check: fail (non-zero) if the committed artifact is stale vs the sources, without writing. */
async function checkAppCatalog(): Promise<void> {
  const fresh = await renderAppCatalog();
  const onDisk = readFileSync(OUT_FILE, 'utf-8');
  if (fresh !== onDisk) {
    console.error('✗ src/static/app-catalog.html is STALE vs its sources: src/static/app-catalog/, the tokens in public/css/theme.css, public/css/poster.css, public/css/parts.css, and public/css/dialog.css + public/js/dialog.js.');
    console.error('  Run `pnpm build:app-catalog` and commit the regenerated file (a theme.css token change lands in the catalog this way).');
    process.exit(1);
  }
  console.log('✓ app-catalog.html in sync with its sources');
}

// Run when invoked directly (tsx scripts/build-app-catalog.ts [--check]).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-app-catalog.ts')) {
  const check = process.argv.includes('--check');
  (check ? checkAppCatalog() : buildAppCatalog().then(() => console.log('✓ app-catalog built → src/static/app-catalog.html')))
    .catch((err) => { console.error('✗ app-catalog build failed:', err.message); process.exit(1); });
}
