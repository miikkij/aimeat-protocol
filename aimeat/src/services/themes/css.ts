/**
 * @file src/services/themes/css.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A custom theme as the stylesheet the node serves, and the check on a theme's own CSS.
 *
 *   THE STYLESHEET. A custom theme answers the same `data-palette` attribute the built-in palettes
 *   answer (the pill sets it), so nothing on a page has to know which kind it is. Its light values sit
 *   on `html[data-palette='<id>'][data-theme]` and its dark values on `…[data-theme='dark']`, after
 *   them: both outrank theme.css's own blocks and its palette bridge (0,1,1 and the bridge's 0,2,1
 *   border rung) by weight or by coming later, whatever order the sheets load in after theme.css.
 *   Every theme token is written, so no bridge formula reads a palette the theme does not have.
 *
 *   THE THEME'S OWN CSS may change a component only through the hooks the component declares in the
 *   catalogue (Jouni's plan, 07-themes-and-styles.md: "it can change how a component looks, never
 *   what it does or its markup"). It is a list of rules; each selector is `:root` or one component's
 *   own class, and each declaration sets one of that component's hooks to a value of the hook's
 *   kind. Anything else is refused with the reason: an @-rule, a nested rule, a property that is not
 *   a hook, a value outside the grammar.
 * @structure ThemeHook · HookRegistry · catalogueHooks · themeStylesheet · checkThemeCss · ThemeCssRule
 * @usage import { themeStylesheet, checkThemeCss } from './css.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { THEME_TOKENS, FACE_SLOTS, faceStack } from './tokens.js';
import { checkValue } from './values.js';
import type { TokenMap, ThemeFaces } from './builtin.js';
import type { UiThemeHook } from '../ui-library/types.js';
import { UI_ENTRY_SOURCES } from '../ui-library/entries.js';

export type ThemeHook = UiThemeHook;
/** For each component: the class a theme's rule names, and the hooks it may set there. */
export type HookRegistry = Record<string, { component: string; hooks: ThemeHook[] }>;

/** Every part's hooks from the component catalogue, keyed by the class a theme's rule names. */
export function catalogueHooks(): HookRegistry {
    const out: HookRegistry = {};
    for (const e of UI_ENTRY_SOURCES) if (e.themeHooks) out[e.themeHooks.selector] = { component: e.id, hooks: e.themeHooks.hooks };
    return out;
}

export interface ThemeCssRule { selector: string; declarations: Array<{ property: string; value: string }> }

const LENGTH = /^(0|\d+(\.\d+)?(px|rem|em))$/;
const MAX_CSS = 8000;

/** The rules of a theme's CSS, or the first reason it cannot be stored. */
export function checkThemeCss(css: string, registry: HookRegistry): { rules: ThemeCssRule[] } | { error: string } {
    if (typeof css !== 'string') return { error: 'theme CSS is a string' };
    if (css.length > MAX_CSS) return { error: `theme CSS is at most ${MAX_CSS} characters` };
    const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    if (/\/\*|\*\//.test(text)) return { error: 'a comment does not close' };
    if (/[@<\\"'`]/.test(text)) return { error: 'theme CSS holds rules only: no @-rules, quotes, backslashes or angle brackets' };
    const allHooks = new Map<string, ThemeHook>();
    for (const entry of Object.values(registry)) for (const h of entry.hooks) allHooks.set(h.name, h);
    const rules: ThemeCssRule[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let consumed = 0;
    for (const m of text.matchAll(re)) {
        if (text.slice(consumed, m.index).trim()) return { error: `something outside a rule: "${text.slice(consumed, m.index).trim().slice(0, 40)}"` };
        consumed = (m.index ?? 0) + m[0].length;
        const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (!selectors.length) return { error: 'a rule has no selector' };
        const declarations: Array<{ property: string; value: string }> = [];
        for (const raw of m[2].split(';').map((d) => d.trim()).filter(Boolean)) {
            const i = raw.indexOf(':');
            if (i < 0) return { error: `"${raw.slice(0, 40)}" is not a declaration` };
            const property = raw.slice(0, i).trim(), value = raw.slice(i + 1).trim();
            for (const sel of selectors) {
                const allowed = sel === ':root' ? allHooks : new Map((registry[sel]?.hooks || []).map((h) => [h.name, h]));
                if (sel !== ':root' && !registry[sel]) return { error: `"${sel}" is not a component a theme may style; the selectors are :root and ${Object.keys(registry).join(', ')}` };
                const hook = allowed.get(property);
                if (!hook) return { error: `"${property}" is not a theme hook of ${sel === ':root' ? 'any component' : registry[sel].component}` };
                const bad = hook.kind === 'length' ? (LENGTH.test(value) ? null : 'a length such as 3px or .2rem') : checkValue(value, 'colour');
                if (bad) return { error: `${property}: ${bad}` };
            }
            declarations.push({ property, value });
        }
        rules.push({ selector: selectors.join(', '), declarations });
    }
    if (text.slice(consumed).trim()) return { error: `something outside a rule: "${text.slice(consumed).trim().slice(0, 40)}"` };
    return { rules };
}

const declarationsOf = (map: TokenMap, faces?: ThemeFaces): string[] => {
    const out: string[] = [];
    for (const t of THEME_TOKENS) if (map[t.name] !== undefined) out.push(`  ${t.name}: ${map[t.name]};`);
    if (faces) for (const [slot, token] of Object.entries(FACE_SLOTS)) {
        const face = faces[slot as keyof ThemeFaces];
        const stack = face ? faceStack(face) : undefined;
        if (stack) out.push(`  ${token}: ${stack};`);
    }
    return out;
};

/**
 * The stylesheet of one custom theme. Its values are checked before they are stored (values.ts,
 * checkThemeCss), and the id is held to [a-z0-9-] where it is made, so nothing here can leave a
 * declaration.
 */
export function themeStylesheet(theme: { id: string; name: string; light: TokenMap; dark: TokenMap; faces?: ThemeFaces; css?: string | null },
    registry: HookRegistry): string {
    const at = `html[data-palette='${theme.id}']`;
    const lines = [
        `/* Theme "${theme.name.replace(/\*\//g, '')}" (${theme.id}), served by the node from its record. */`,
        `${at}, ${at}[data-theme] {`, ...declarationsOf(theme.light, theme.faces), '}',
        `${at}[data-theme='dark'] {`, ...declarationsOf(theme.dark), '}',
    ];
    if (theme.css) {
        const parsed = checkThemeCss(theme.css, registry);
        if ('rules' in parsed) for (const r of parsed.rules) {
            const sels = r.selector.split(', ').map((s) => s === ':root' ? at : `${at} ${s}`).join(', ');
            lines.push(`${sels} {`, ...r.declarations.map((d) => `  ${d.property}: ${d.value};`), '}');
        }
    }
    return lines.join('\n') + '\n';
}
