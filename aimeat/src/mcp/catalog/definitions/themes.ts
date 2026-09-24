/**
 * @file src/mcp/catalog/definitions/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of Themes & Styles: the node's themes read, made, styled and repaired from a
 *   chat (07-themes-and-styles.md). A theme is the look of AIMEAT's own pages (not of apps built on
 *   it): its styles (colours in light and dark, three faces, a mode), CSS for single components, and
 *   CSS for the whole theme. The CSS is as free as CSS is; only CSS that does not parse is refused.
 * @structure themeTools
 * @usage import { themeTools } from './themes.js';
 * @version-history
 *   v2.0.0 — 2026-09-24 — The two-level model: aimeat_theme_style_save and
 *     aimeat_theme_component_css_set; free CSS with warnings; versions and restore.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import type { AimeatToolDefinition } from './types.js';

export const themeTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_theme_list',
        description: "List this server's themes: the look of every page of AIMEAT's own interface (the home, the chat, Settings & Controls, admin; published apps keep their own). A theme holds styles; a style is a set of colours in light and dark, three faces and a mode (both, light only, dark only). The built-in AIMEAT theme holds the six built-in styles (aimeat, paper, circuit, contrast, mist, voltage) and is read only; copy it to make your own. For each theme you get its styles with their main colours and any contrast line they miss, which styles the pill offers and the default one, which components have CSS in it and whether that CSS is served, and its theme CSS warnings. You also get who chooses (whether people pick, which themes are available, the default theme: config rows themes.personal_choice, themes.offered and themes.default, changed with aimeat_admin_config) and what a style may set (the colour tokens, the faces this server serves, each component's usual things to change).",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {},
    },
    {
        name: 'aimeat_theme_get',
        description: "Read one theme whole: every style with every colour in light and dark, its faces and mode, the theme's component CSS and theme CSS, the warnings each carries (contrast lines, CSS that can hide a control, motion, literal colours, faces, selectors outside their component) and whether each component's CSS is served, and the versions it was saved as (to put one back with aimeat_theme_save and restoreVersion). `id` is from aimeat_theme_list.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: "The theme's id, from aimeat_theme_list (for example 'aimeat')." },
        },
    },
    {
        name: 'aimeat_theme_save',
        description: "Make or change one of this server's themes. Without `id` you make a new theme: a copy of `basedOn` (default 'aimeat') with its styles, CSS and choices. With `id` you change that theme: `name`; `css`, the theme CSS for the whole theme (any CSS: selectors, !important, @media, @keyframes; empty removes it); `defaultStyle` and `offeredStyles` (style ids of this theme, which the pill offers); `retired` true takes it out of the pill without deleting it. `restoreVersion` puts back a version from aimeat_theme_get, which is the way to undo a save. `dryRun` checks and saves nothing. Only CSS that does not parse is refused; everything else comes back as warnings with the line. The built-in theme is read only. Only the operator of this server can do this, with the site:theme-write permission. To make a theme available to people, set themes.offered with aimeat_admin_config.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', description: 'The theme to change. Leave it out to make a new one.' },
            name: { type: 'string', description: 'What people see in the pill. 1 to 60 characters.' },
            basedOn: { type: 'string', description: "For a new theme: the theme it copies (default 'aimeat')." },
            css: { type: 'string', description: 'Theme CSS for the whole theme; empty removes it.' },
            defaultStyle: { type: 'string', description: 'The style a person sees first in this theme.' },
            offeredStyles: { type: 'array', description: 'The style ids of this theme the pill offers.' },
            retired: { type: 'boolean', description: 'true takes the theme out of the pill; false brings it back.' },
            restoreVersion: { type: 'number', description: 'Put back this saved version (from aimeat_theme_get).' },
            dryRun: { type: 'boolean', description: 'Check everything and save nothing.' },
        },
    },
    {
        name: 'aimeat_theme_style_save',
        description: "Make or change a style inside a theme: its colours in light and dark, its three faces and its mode. Without `style` you make a new style, a copy of `basedOn` (a style of the theme; its default style if left out). `light` and `dark` are objects of colour token → CSS colour (hex, rgb(), hsl(), color-mix(in srgb, …), var(--token)); send only what you change; aimeat_theme_list names the tokens. `faces` picks { headline, body, mono } from the faces this server serves. `onlyMode` is 'light' or 'dark' for a style with one mode, empty for both; the pill then says why its light/dark switch is off. `retired` true takes the style out of the pill. A value that does not parse is refused; a contrast line under its minimum (words 4.5:1 on the page and on a card, the accent 3:1, words on the sun 4.5:1) is a warning, and the style is saved. Only the operator, with site:theme-write.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            theme: { type: 'string', required: true, description: 'The theme the style belongs to.' },
            style: { type: 'string', description: 'The style to change. Leave it out to make a new one.' },
            name: { type: 'string', description: 'What people see in the pill. 1 to 60 characters.' },
            basedOn: { type: 'string', description: 'For a new style: the style of this theme it copies.' },
            light: { type: 'object', description: 'Token → colour for light mode, only the ones you change.' },
            dark: { type: 'object', description: 'Token → colour for dark mode, only the ones you change.' },
            faces: { type: 'object', description: '{ headline, body, mono }, each a face this server serves.' },
            onlyMode: { type: 'string', description: "'light' or 'dark' for a style with one mode; empty for both." },
            retired: { type: 'boolean', description: 'true takes the style out of the pill; false brings it back.' },
            dryRun: { type: 'boolean', description: 'Check everything and save nothing.' },
        },
    },
    {
        name: 'aimeat_theme_component_css_set',
        description: "Style one component in one theme with CSS of your own, for example \"give the loud action a coral ground\": theme 'my-theme', component 'slab', css '.poster-slab { background: var(--accent); border-radius: 8px; }'. Start each rule from the component's own classes (aimeat_ui_component_get names them, and the usual things to change); a selector that reaches outside the component is a warning, not a refusal. Any CSS works (!important, @media, @keyframes); only CSS that does not parse is refused. The answer says whether the CSS is served and every warning with its line: something that can hide a control or block a click, motion without a reduced-motion guard, a literal colour that stays the same in every style and mode, a face this server does not serve. Empty css removes it. `dryRun` checks and saves nothing. Only the operator, with site:theme-write.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            theme: { type: 'string', required: true, description: 'The theme the CSS belongs to.' },
            component: { type: 'string', required: true, description: "The component's id, from aimeat_ui_component_list (for example 'slab')." },
            css: { type: 'string', description: 'The CSS; empty removes it.' },
            dryRun: { type: 'boolean', description: 'Check and save nothing.' },
        },
    },
];
