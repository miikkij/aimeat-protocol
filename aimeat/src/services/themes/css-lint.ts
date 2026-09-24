/**
 * @file src/services/themes/css-lint.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CSS, read: component CSS and theme CSS (Themes & Styles, 07 "What the
 *   operator's CSS may do"). Jouni: "Mahdollisimman muokattavaksi nyt heti kättelyssä, ei kukaan halua
 *   sabotoida ja hajottaa omaa systeemiään". So the node refuses only CSS that does not parse, and
 *   warns, in plain words and with the line, about what can hide a control or block a click, an
 *   animation that ignores reduced motion, a literal colour (it looks the same in every style and
 *   mode), a face the node does not serve, and, for component CSS, a selector that reaches outside
 *   the component. The operator may save anyway.
 *
 *   It is a small reader, not a full CSS parser: it follows comments, strings, brackets and blocks,
 *   which is all the warnings need. What the browser does with the CSS is the browser's business.
 * @structure CssWarning · CssRule · CssReport · lintCss · selectorClasses · touchesClasses
 * @usage import { lintCss } from './css-lint.js'; const r = lintCss(css, { componentClasses, faces });
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, 07-themes-and-styles.md).
 */

export type CssWarningCode = 'hides' | 'motion' | 'literal-colour' | 'face' | 'outside' | 'loads';

export interface CssWarning { line: number; code: CssWarningCode; property?: string; text: string }
export interface CssRule { selectors: string[]; line: number; declarations: Array<{ property: string; value: string; line: number }>; inside: string[] }
export interface CssReport { error: { line: number; text: string } | null; rules: CssRule[]; warnings: CssWarning[] }

const MAX = 64 * 1024;

/** The classes a selector names (`.poster-slab:hover > .x` → poster-slab, x). */
export function selectorClasses(selector: string): string[] {
    return [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/** True when a selector list reaches at least one of the given classes. */
export function touchesClasses(selectors: string[], classes: string[]): boolean {
    const set = new Set(classes);
    return selectors.some((s) => selectorClasses(s).some((c) => set.has(c)));
}

const HIDING: Record<string, (v: string) => boolean> = {
    display: (v) => /\bnone\b/.test(v),
    visibility: (v) => /\b(hidden|collapse)\b/.test(v),
    'pointer-events': (v) => /\bnone\b/.test(v),
    opacity: (v) => { const n = parseFloat(v); return Number.isFinite(n) && (v.trim().endsWith('%') ? n / 100 : n) < 0.3; },
    position: (v) => /\b(fixed|absolute)\b/.test(v),
    'z-index': () => true,
    overflow: (v) => /\bhidden\b/.test(v),
    'overflow-x': (v) => /\bhidden\b/.test(v),
    'overflow-y': (v) => /\bhidden\b/.test(v),
    'clip-path': (v) => !/^\s*none\s*$/.test(v),
    width: (v) => /^\s*0(px|rem|em|%)?\s*$/.test(v),
    height: (v) => /^\s*0(px|rem|em|%)?\s*$/.test(v),
    'max-width': (v) => /^\s*0(px|rem|em|%)?\s*$/.test(v),
    'max-height': (v) => /^\s*0(px|rem|em|%)?\s*$/.test(v),
    'font-size': (v) => /^\s*0(px|rem|em|%)?\s*$/.test(v),
};

const COLOUR_PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|text-decoration-color|caret-color|accent-color)$/;
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(|\b(red|blue|green|black|white|yellow|orange|purple|pink|gray|grey|coral|gold)\b/;

/** Line number (1-based) of an offset. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/**
 * Read CSS: its rules, the one parse error that makes it unusable (unbalanced brackets or quotes, a
 * declaration outside a rule), and every warning. `componentClasses`: for component CSS, the
 * component's own classes; a rule that touches none of them is warned as reaching outside.
 * `faces`: the families the node serves.
 */
export function lintCss(css: string, opts: { componentClasses?: string[]; faces?: string[] } = {}): CssReport {
    const warnings: CssWarning[] = [];
    const rules: CssRule[] = [];
    if (typeof css !== 'string') return { error: { line: 1, text: 'The CSS is not text.' }, rules, warnings };
    if (css.length > MAX) return { error: { line: 1, text: `The CSS is longer than ${MAX / 1024} kB.` }, rules, warnings };
    if (/<\/?style\b/i.test(css)) return { error: { line: lineAt(css, css.search(/<\/?style\b/i)), text: 'The CSS holds a <style> tag; write the rules only.' }, rules, warnings };

    // Blank the comments and the strings (keeping their length, so offsets and lines stay true).
    let text = '';
    for (let i = 0; i < css.length;) {
        if (css.startsWith('/*', i)) {
            const end = css.indexOf('*/', i + 2);
            if (end < 0) return { error: { line: lineAt(css, i), text: 'A comment is not closed with */.' }, rules, warnings };
            text += css.slice(i, end + 2).replace(/[^\n]/g, ' ');
            i = end + 2;
            continue;
        }
        const c = css[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < css.length && css[j] !== c) { if (css[j] === '\\') j++; if (css[j] === '\n') break; j++; }
            if (css[j] !== c) return { error: { line: lineAt(css, i), text: 'A quoted text is not closed on its line.' }, rules, warnings };
            text += c + css.slice(i + 1, j).replace(/[^\n]/g, 'x') + c;
            i = j + 1;
            continue;
        }
        text += c;
        i++;
    }

    // Walk the blocks: a prelude, then { … }. At-rule preludes nest; keyframes' steps are not rules.
    const stack: Array<{ prelude: string; line: number; start: number }> = [];
    let preludeStart = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '{') {
            const prelude = text.slice(preludeStart, i).trim();
            stack.push({ prelude, line: lineAt(text, preludeStart + (text.slice(preludeStart, i).length - text.slice(preludeStart, i).trimStart().length)), start: i + 1 });
            preludeStart = i + 1;
        } else if (c === '}') {
            const block = stack.pop();
            if (!block) return { error: { line: lineAt(text, i), text: 'A } closes nothing.' }, rules, warnings };
            const body = text.slice(block.start, i);
            const isAt = block.prelude.startsWith('@');
            const inKeyframes = stack.some((b) => /^@(-\w+-)?keyframes\b/.test(b.prelude));
            // A block that holds other blocks (an at-rule, or nesting) has its declarations only
            // before its first inner block; those are read with the inner walk. A leaf is read here.
            if (!isAt && !body.includes('{') && !inKeyframes) {
                const declarations: CssRule['declarations'] = [];
                let offset = block.start;
                for (const part of body.split(';')) {
                    const colon = part.indexOf(':');
                    if (part.trim() && colon >= 0) {
                        const lead = part.length - part.trimStart().length;
                        declarations.push({ property: part.slice(0, colon).trim().toLowerCase(), value: css.slice(offset + colon + 1, offset + part.length).trim(), line: lineAt(text, offset + lead) });
                    } else if (part.trim()) {
                        return { error: { line: lineAt(text, offset + part.length - part.trimStart().length), text: `"${part.trim().slice(0, 40)}" is not a declaration (property: value).` }, rules, warnings };
                    }
                    offset += part.length + 1;
                }
                rules.push({ selectors: block.prelude.split(',').map((s) => s.trim()).filter(Boolean), line: block.line, declarations, inside: stack.map((b) => b.prelude) });
            }
            preludeStart = i + 1;
        } else if (c === ';' && stack.length === 0) {
            const stmt = text.slice(preludeStart, i).trim();
            if (stmt && !stmt.startsWith('@')) return { error: { line: lineAt(text, preludeStart), text: `"${stmt.slice(0, 40)}" stands outside a rule.` }, rules, warnings };
            if (/^@import\b/.test(stmt)) warnings.push({ line: lineAt(text, preludeStart), code: 'loads', text: 'An @import loads another sheet; the site\'s content policy decides whether it may.' });
            preludeStart = i + 1;
        }
    }
    if (stack.length) return { error: { line: stack[stack.length - 1].line, text: 'A { is not closed.' }, rules, warnings };
    if (text.slice(preludeStart).trim()) return { error: { line: lineAt(text, preludeStart), text: `"${text.slice(preludeStart).trim().slice(0, 40)}" stands outside a rule.` }, rules, warnings };

    // The warnings.
    const reducedMotion = /@media[^{]*prefers-reduced-motion/.test(text);
    const faces = new Set((opts.faces ?? []).map((f) => f.toLowerCase()));
    for (const rule of rules) {
        if (opts.componentClasses && !touchesClasses(rule.selectors, opts.componentClasses)) {
            warnings.push({ line: rule.line, code: 'outside', text: `"${rule.selectors.join(', ').slice(0, 60)}" does not start from this component's classes, so it also changes other things on the page.` });
        }
        const guarded = rule.inside.some((p) => /prefers-reduced-motion/.test(p));
        for (const d of rule.declarations) {
            const check = HIDING[d.property];
            if (check && check(d.value)) {
                warnings.push({ line: d.line, code: 'hides', property: d.property, text: `${d.property}: ${d.value.slice(0, 40)} can hide a control, move it out of reach or block a click.` });
            }
            if (/^(animation|animation-name|transition)$/.test(d.property) && !/^\s*none\s*$/.test(d.value) && !guarded && !reducedMotion) {
                warnings.push({ line: d.line, code: 'motion', property: d.property, text: `${d.property} moves things for people who asked their device for less motion; wrap it in @media (prefers-reduced-motion: no-preference).` });
            }
            if (COLOUR_PROPS.test(d.property) && LITERAL_COLOUR.test(d.value) && !/var\(--/.test(d.value)) {
                warnings.push({ line: d.line, code: 'literal-colour', property: d.property, text: `${d.property} names a colour directly, so it looks the same in every style and in light and dark; a theme value (var(--accent), var(--text)) follows the style.` });
            }
            if (d.property === 'font-family' || d.property === 'font') {
                const first = (d.property === 'font' ? d.value.split(/\s(?=['"A-Za-z])/).pop() ?? '' : d.value).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
                if (first && !/^var\(/.test(first) && !/^(inherit|initial|unset|serif|sans-serif|monospace|system-ui)$/i.test(first) && faces.size && !faces.has(first.toLowerCase())) {
                    warnings.push({ line: d.line, code: 'face', property: d.property, text: `"${first}" is not a face this server serves, so the browser falls back to another one.` });
                }
            }
            if (/url\(/i.test(d.value)) {
                warnings.push({ line: d.line, code: 'loads', property: d.property, text: `${d.property} loads a file; the site's content policy decides whether it may.` });
            }
        }
    }
    warnings.sort((a, b) => a.line - b.line);
    return { error: null, rules, warnings };
}
