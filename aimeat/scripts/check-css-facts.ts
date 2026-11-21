/**
 * @file scripts/check-css-facts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Three facts about the node's stylesheets that only a browser shows, checked as text.
 *
 *   undefined-var   A `var(--x)` with no fallback (or a fallback chain that ends in one) naming a
 *                   custom property that no stylesheet declares and no script sets. The whole
 *                   declaration is then invalid: `gap: var(--space-3)` computes to `normal`, a
 *                   `margin` to 0, a colour to the inherited one. Nothing warns (docs/pitfalls.md §4).
 *   ak-root-twice   Two Atelier module sheets both open a rule on the bare root of one `.ak-<family>`
 *                   class. The kit's sheets are one namespace, so two modules that pick one name share
 *                   every rule: textReveal took .ak-reveal from the disclosure component and each word
 *                   became a flex item; the director took .ak-scene from scene3d and every scene was
 *                   painted white (docs/pitfalls.md §36 until 2026-11-21).
 *   fixed-phone-view Inside a `max-width` media rule, `position: fixed` with `inset: 0` or `top: 0` and no
 *                   `--vv-` variable. On iOS the keyboard covers the page instead of shrinking it, so a
 *                   full-screen phone view pinned to the page puts its reply field behind the keyboard,
 *                   and Playwright, which has no keyboard, shows nothing wrong. Pin it to the visual
 *                   viewport: `inset: var(--vv-top, 0px) 0 auto 0; height: var(--vv-height, 100dvh)` with
 *                   trackVisualViewport() from public/js/visual-viewport.js (docs/pitfalls.md §125 until 2026-11-21).
 *
 *   What was there on the first day is listed with a reason in security/css-facts-baseline.json, so
 *   the gate fails on a NEW one and the list only shrinks.
 * @usage cd aimeat && pnpm check:css-facts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = process.cwd();
const BASELINE = join(AIMEAT, 'security', 'css-facts-baseline.json');
const ATELIER = 'public/lib/aimeat-atelier/';

export interface CssFinding { key: string; detail: string }

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties the sheets declare, and every `--name` a script or a page writes as text. */
export function definedProperties(sheets: Array<{ text: string }>, scripts: Array<{ text: string }>): Set<string> {
    const out = new Set<string>();
    for (const s of sheets) for (const m of stripComments(s.text).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
    // A script sets one with style.setProperty('--x', …), a `vars: { '--x': … }` object, or a style
    // string; any mention outside var( is taken as a setter, which errs towards silence.
    for (const s of scripts) for (const m of s.text.matchAll(/(?<!var\(\s*)(--[A-Za-z][A-Za-z0-9_-]*)/g)) out.add(m[1]);
    return out;
}

/** Declared, or set by a script through a prefix it completes at run time (`'--ap-' + key`). */
function isDefined(name: string, defined: Set<string>): boolean {
    if (defined.has(name)) return true;
    for (const d of defined) if (d.endsWith('-') && name.startsWith(d)) return true;
    return false;
}

/**
 * The names a `var(...)` expression starting at `i` depends on to be valid: none when it has a
 * plain fallback, the chain's last name when every fallback is itself a var() with none.
 */
function unresolved(text: string, start: number, defined: Set<string>): string | null {
    // text[start..] begins with "var("
    let depth = 0, end = -1;
    for (let j = start + 3; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) return null;
    const inner = text.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    if (isDefined(name, defined)) return null;
    if (comma < 0) return name;
    const fallback = inner.slice(comma + 1).trim();
    if (!fallback.startsWith('var(')) return null; // a plain fallback value always applies
    return unresolved(fallback, 0, defined);
}

/** Fact one: a var() whose whole chain names nothing anything defines. */
export function undefinedVars(sheets: Array<{ file: string; text: string }>, defined: Set<string>): CssFinding[] {
    const out = new Map<string, CssFinding>();
    for (const s of sheets) {
        const text = stripComments(s.text);
        for (const m of text.matchAll(/var\(/g)) {
            // Only the outermost var() of a chain is judged; an inner one is its fallback.
            if (/,\s*$/.test(text.slice(Math.max(0, m.index! - 40), m.index!))
                && /var\([^()]*$/.test(text.slice(Math.max(0, m.index! - 200), m.index!))) continue;
            const name = unresolved(text, m.index!, defined);
            if (!name) continue;
            const key = `undefined-var:${s.file}:${name}`;
            out.set(key, { key, detail: `${s.file} reads ${name}, which no stylesheet declares and no script sets, with no fallback: the declaration is dropped` });
        }
    }
    return [...out.values()];
}

/** Fact two: the bare root of one .ak- family opened in two Atelier module sheets. */
export function akRootsTwice(sheets: Array<{ file: string; text: string }>): CssFinding[] {
    const owners = new Map<string, Set<string>>();
    for (const s of sheets.filter(x => x.file.startsWith(ATELIER))) {
        for (const r of stripComments(s.text).matchAll(/([^{}]+)\{/g)) {
            for (const sel of r[1].split(',')) {
                const m = /^\.ak-([a-z0-9-]+)$/.exec(sel.trim());
                if (m) owners.set(m[1], new Set([...(owners.get(m[1]) ?? []), s.file]));
            }
        }
    }
    return [...owners].filter(([, files]) => files.size > 1).map(([family, files]) => ({
        key: `ak-root-twice:.ak-${family}`,
        detail: `.ak-${family} opens a rule of its own in ${[...files].sort().join(' and ')}: two modules on one class name share every rule`,
    }));
}

/** Fact three: a phone view pinned to the page rather than the visual viewport. */
export function fixedPhoneViews(sheets: Array<{ file: string; text: string }>): CssFinding[] {
    const out: CssFinding[] = [];
    for (const s of sheets) {
        const text = stripComments(s.text);
        for (const m of text.matchAll(/@media[^{]*max-width[^{]*\{/g)) {
            let depth = 1, j = m.index! + m[0].length;
            while (depth > 0 && j < text.length) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
            const body = text.slice(m.index! + m[0].length, j - 1);
            for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                const decl = r[2];
                if (!/position\s*:\s*fixed/.test(decl)) continue;
                if (!/(?:^|;)\s*inset\s*:\s*0(?:px)?\s*(?:;|$)/.test(decl) && !/(?:^|;)\s*top\s*:\s*0(?:px)?\s*(?:;|$)/.test(decl)) continue;
                if (/--vv-/.test(decl)) continue;
                const selector = r[1].trim().replace(/\s+/g, ' ');
                out.push({ key: `fixed-phone-view:${s.file}:${selector}`, detail: `${s.file}: ${selector} is position: fixed at the page's top edge on a phone; on iOS its bottom sits behind the keyboard` });
            }
        }
    }
    return out;
}

/** Every finding over the node's stylesheets (public/, src/static/) and the scripts that set properties. */
export function cssFacts(root: string = AIMEAT): CssFinding[] {
    const files = [...walk(join(root, 'public')), ...walk(join(root, 'src', 'static'))];
    const rel = (f: string) => relative(root, f).split('\\').join('/');
    const sheets = files.filter(f => f.endsWith('.css')).map(f => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
    const scripts = files.filter(f => /\.(?:m?js|html|ts)$/.test(f)).map(f => ({ text: readFileSync(f, 'utf8') }));
    const defined = definedProperties(sheets, scripts);
    return [...undefinedVars(sheets, defined), ...akRootsTwice(sheets), ...fixedPhoneViews(sheets)];
}

function main(): void {
    const findings = cssFacts();
    const allowed = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { allowed: Record<string, string> }).allowed : {};
    const fresh = findings.filter(f => !(f.key in allowed));
    const stale = Object.keys(allowed).filter(k => !findings.some(f => f.key === k));
    console.log(`\n  CSS facts: ${findings.length} finding(s), ${findings.length - fresh.length} listed in security/css-facts-baseline.json`);
    if (stale.length) {
        console.error('\n  These baseline entries no longer occur; take them off security/css-facts-baseline.json:');
        for (const k of stale) console.error(`    ${k}`);
    }
    if (fresh.length) {
        console.error('');
        for (const f of fresh) console.error(`  ✖ ${f.detail}\n      (${f.key})`);
        console.error('\n  The rule for each kind is in the header of scripts/check-css-facts.ts.\n');
    }
    if (fresh.length || stale.length) process.exit(1);
    console.log('  ✓ no undefined custom property without a fallback, no .ak- root in two sheets, no phone view pinned to the page\n');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
