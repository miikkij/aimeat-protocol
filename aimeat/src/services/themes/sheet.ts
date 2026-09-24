/**
 * @file src/services/themes/sheet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One theme as the stylesheet the node serves (`GET /v1/themes/:id/theme.css`): its
 *   custom styles' token blocks, its shape values, its component CSS and its theme CSS. A page links the sheet of the
 *   theme it wears and no other, so the operator's CSS is written as it is, unscoped: as free as CSS
 *   is (07 "What the operator's CSS may do").
 *
 *   THE LIFECYCLE (07 "Lifecycle"). Component CSS is served only when its component is still in the
 *   catalogue and at least one of its rules still starts from one of the component's classes; CSS that
 *   does not parse is never served. Each is reported with the reason, so Themes & Styles marks it
 *   (S4) and an AI reads it with aimeat_theme_get. Because the catalogue is built into the node, the
 *   check runs whenever a sheet is made, which covers "when the node starts and when the catalogue
 *   changes".
 * @structure ComponentCssState · componentCssState · themeSheet · catalogueHooks · servedFaces
 * @usage import { themeSheet, componentCssState } from './sheet.js';
 * @version-history
 *   v1.1.0 — 2026-09-24 — The theme's shape values, before its component CSS (07 "New components
 *     follow the theme").
 *   v1.0.0 — 2026-09-24 — Initial (replaces css.ts's hooks-only theme CSS).
 */
import { getUiComponent } from '../ui-library/catalogue.js';
import { UI_ENTRY_SOURCES } from '../ui-library/entries.js';
import type { UiThemeHook } from '../ui-library/types.js';
import { THEME_FACES } from './tokens.js';
import { lintCss, touchesClasses, type CssWarning } from './css-lint.js';
import { styleSheet, type Style } from './styles.js';
import { shapeSheet } from './shapes.js';

/** The families the node serves, for the face warning. */
export const servedFaces = (): string[] => Object.keys(THEME_FACES);

/** Every component's theme hooks, keyed by component id (the usual things to change, S5). */
export function catalogueHooks(): Record<string, { selector: string; hooks: UiThemeHook[] }> {
    const out: Record<string, { selector: string; hooks: UiThemeHook[] }> = {};
    for (const e of UI_ENTRY_SOURCES) if (e.themeHooks) out[e.id] = e.themeHooks;
    return out;
}

export type ComponentCssStatus = 'served' | 'removed' | 'stale' | 'broken' | 'empty';
export interface ComponentCssState { component: string; status: ComponentCssStatus; reason: string; warnings: CssWarning[] }

/** Whether one piece of component CSS is served, and why not when it is not. */
export function componentCssState(componentId: string, css: string): ComponentCssState {
    if (!css || !css.trim()) return { component: componentId, status: 'empty', reason: 'No CSS.', warnings: [] };
    const entry = getUiComponent(componentId);
    if (!entry) return { component: componentId, status: 'removed', reason: 'This component is no longer in the catalogue, so its CSS is kept and not served.', warnings: [] };
    const report = lintCss(css, { componentClasses: entry.classes, faces: servedFaces() });
    if (report.error) return { component: componentId, status: 'broken', reason: `Line ${report.error.line}: ${report.error.text}`, warnings: [] };
    const touching = report.rules.filter((r) => touchesClasses(r.selectors, entry.classes));
    if (report.rules.length && !touching.length) {
        return { component: componentId, status: 'stale', reason: `None of its rules starts from this component's classes now (${entry.classes.slice(0, 6).join(', ')}), so it is not served.`, warnings: report.warnings };
    }
    return { component: componentId, status: 'served', reason: '', warnings: report.warnings };
}

/**
 * The stylesheet of one theme. `styles` are the theme's custom styles (a built-in style is drawn by
 * the node's own sheets); retired styles are left out.
 */
export function themeSheet(theme: { id: string; name: string; styles: Style[]; shapes?: Record<string, string>; componentCss: Record<string, string>; css: string | null }): string {
    const parts: string[] = [`/* Theme "${theme.name.replace(/\*\//g, '')}" (${theme.id}), served by the node from its record. */`];
    for (const s of theme.styles) if (!s.builtin && !s.retired) parts.push(styleSheet(s));
    // The theme's shapes before its component CSS, so one component's own CSS can still differ.
    const shapes = shapeSheet(theme.shapes);
    if (shapes) parts.push('/* Shape values */', shapes);
    for (const [component, css] of Object.entries(theme.componentCss || {})) {
        if (componentCssState(component, css).status !== 'served') continue;
        parts.push(`/* Component CSS: ${component} */`, css.trim());
    }
    if (theme.css && theme.css.trim() && !lintCss(theme.css).error) parts.push('/* Theme CSS */', theme.css.trim());
    return parts.join('\n') + '\n';
}
