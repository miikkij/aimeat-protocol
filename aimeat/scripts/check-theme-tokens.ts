/**
 * @file scripts/check-theme-tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description theme.css holds tokens only, and every page that links it links the shell block after it.
 *
 *   WHAT IT HOLDS, and why each one:
 *   - Every rule in public/css/theme.css declares custom properties only. The shell's rules live in
 *     catalogued component sheets (css/components/), so a change to a part is made in its sheet and a
 *     theme changes tokens. Until 2026-09-24 theme.css carried 261 rules besides its tokens.
 *   - theme.css parses as the browser reads it: no comment is closed early. A stray star-slash in its
 *     header once hid the rule after the header from every browser, silently.
 *   - Every page that links /css/theme.css links the shell block right after it, in the order
 *     spa.html links it. The block is theme.css's former rules in their former order; a page with a
 *     part missing or out of order draws differently from the SPA.
 * @usage pnpm check:theme-tokens
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation: theme.css holds tokens only).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRules } from './build-ui-library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const THEME = path.join(PUBLIC, 'css', 'theme.css');
const THEME_LINK = /<link rel="stylesheet" href="\/css\/theme\.css"\s*\/?>/;

/** Declarations of one rule body, as property names. */
const propsOf = (body: string): string[] =>
    body.split(';').map(d => d.trim()).filter(Boolean).map(d => d.slice(0, d.indexOf(':')).trim()).filter(Boolean);

/** The first stylesheet links after theme.css's, in order. */
function linksAfterTheme(html: string): string[] | null {
    const at = html.search(THEME_LINK);
    if (at < 0) return null;
    const rest = html.slice(at).split('\n').slice(1);
    const out: string[] = [];
    for (const line of rest) {
        const t = line.trim();
        if (!t || t.startsWith('<!--') || t.startsWith('-->') || /^[^<]*-->$/.test(t) || /^[A-Za-z(].*[^>]$/.test(t)) continue;
        const m = /^<link rel="stylesheet" href="(\/css\/components\/[^"]+)"/.exec(t);
        if (!m) break;
        out.push(m[1]);
    }
    return out;
}

function htmlFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) htmlFiles(abs, out);
        else if (name.endsWith('.html')) out.push(abs);
    }
    return out;
}

export function themeProblems(): string[] {
    const out: string[] = [];
    const css = readFileSync(THEME, 'utf8');
    // A comment closed early: the text between a star-slash and the next slash-star is not CSS.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\*\//.test(stripped)) out.push('theme.css: a comment is closed early (a stray star-slash); the browser drops the rule after it');
    for (const r of parseRules(css)) {
        const plain = propsOf(r.body).filter(p => !p.startsWith('--'));
        if (plain.length) out.push(`theme.css: "${r.selector.replace(/\s+/g, ' ').slice(0, 70)}" sets ${plain.join(', ')}; theme.css holds tokens only, the rule belongs in a css/components/ sheet`);
    }
    const spa = readFileSync(path.join(PUBLIC, 'spa.html'), 'utf8');
    const block = linksAfterTheme(spa) ?? [];
    if (!block.length) out.push('spa.html: no shell block after theme.css');
    for (const abs of htmlFiles(PUBLIC)) {
        const rel = path.relative(PUBLIC, abs).split(path.sep).join('/');
        const html = readFileSync(abs, 'utf8');
        const links = linksAfterTheme(html);
        if (links === null || rel === 'spa.html') continue;
        if (links.join('\n') !== block.join('\n')) out.push(`${rel}: links theme.css without the shell block in spa.html's order (${links.length} of ${block.length} sheets)`);
    }
    return out;
}

function main(): void {
    const found = themeProblems();
    if (found.length) {
        console.error(`✗ theme tokens: ${found.length} problem(s)`);
        for (const p of found) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log('✓ theme.css holds tokens only, and every page that links it links the shell block');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
