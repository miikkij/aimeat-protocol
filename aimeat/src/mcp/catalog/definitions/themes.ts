/**
 * @file src/mcp/catalog/definitions/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of Themes & Styles: the node's themes read and made from a chat. A theme is
 *   the look of every page of this node's own interface (not of apps built on it): a light and a dark
 *   set of colours, three faces, and optional CSS that reaches components only through their hooks.
 * @structure themeTools
 * @usage import { themeTools } from './themes.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import type { AimeatToolDefinition } from './types.js';

export const themeTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_theme_list',
        description: "List this node's themes: the look every page of the node's own interface wears (published apps keep their own). Each theme is a light and a dark set of colours, three faces, and optional CSS for components' theme hooks. The six built-ins (aimeat, paper, circuit, contrast, mist, voltage) are read only; the node's own are the operator's. You also get the operator's choices (whether people pick their own theme, the one theme for everybody when they do not, which themes the pill offers, the default), every contrast line of each theme, and what a theme may set: the token names, the faces this node serves, and each component's hooks. The operator's choices are config rows themes.personal_choice, themes.fixed, themes.offered and themes.default, changed with aimeat_admin_config.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {},
    },
    {
        name: 'aimeat_theme_get',
        description: "Read one theme whole: every token value in light and in dark, its faces, its theme CSS, whether it has one mode only, whether it is retired, what it was copied from, and its contrast in both modes (each line: which words on which ground, the ratio, the minimum). `id` is from aimeat_theme_list.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: "The theme's id, from aimeat_theme_list (for example 'aimeat' or 'paper')." },
        },
    },
    {
        name: 'aimeat_theme_save',
        description: "Make or change one of this node's themes. Without `id` you make a new theme: it starts as a copy of `basedOn` (default 'aimeat') and takes what you send over it. With `id` you edit that theme; a built-in cannot be edited, copy it instead. `light` and `dark` are objects of token → CSS colour (hex, rgb(), hsl(), color-mix(in srgb, …), var(--token)); send only the tokens you change. `faces` picks { headline, body, mono } from the faces this node serves. `css` is optional rules for component hooks only, such as `.poster-slab { --slab-shadow: var(--accent); }`. `onlyMode` is 'light', 'dark' or null. `retired: true` takes a theme out of the pill without deleting it; false brings it back. `dryRun: true` checks everything and saves nothing. The whole theme is checked before it is saved, contrast included (words 4.5:1 on the page and on a card, the accent 3:1, words on the sun 4.5:1, in both modes), and a refusal names every problem at once. Only the node operator can do this, and only with the site:theme-write permission. To offer the theme in the pill, set themes.offered with aimeat_admin_config.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', description: 'The theme to edit. Leave it out to make a new one.' },
            name: { type: 'string', description: 'What people see in the pill. 1 to 60 characters.' },
            basedOn: { type: 'string', description: "For a new theme: the theme it starts from (default 'aimeat')." },
            light: { type: 'object', description: 'Token → colour for light mode, only the ones you change.' },
            dark: { type: 'object', description: 'Token → colour for dark mode, only the ones you change.' },
            faces: { type: 'object', description: '{ headline, body, mono }, each a face this node serves.' },
            css: { type: 'string', description: 'Rules that set component hooks only; empty removes it.' },
            onlyMode: { type: 'string', description: "'light' or 'dark' when the theme has one mode only; empty for both." },
            retired: { type: 'boolean', description: 'true takes it out of the pill; false brings it back.' },
            dryRun: { type: 'boolean', description: 'Check everything and save nothing.' },
        },
    },
];
