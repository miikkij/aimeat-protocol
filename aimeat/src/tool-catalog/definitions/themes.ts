/**
 * @file src/tool-catalog/definitions/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of Themes & Styles: the node's themes read, made, styled and repaired from a
 *   chat (07-themes-and-styles.md). A theme is the look of AIMEAT's own pages (not of apps built on
 *   it): its styles (colours in light and dark, three faces, a mode), CSS for single components, and
 *   CSS for the whole theme. The CSS is as free as CSS is; only CSS that does not parse is refused.
 * @structure themeTools
 * @usage import { themeTools } from './themes.js';
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v2.3.0 — 2026-10-03 — aimeat_theme_font_save (the font manager); aimeat_theme_list describes `fonts`.
 *   v2.2.0 — 2026-09-24 — Shape values: aimeat_theme_save takes `shapes`, aimeat_theme_list names them.
 *   v2.1.0 — 2026-09-24 — aimeat_theme_policy_set: who chooses, from chat (the settings tool only reads).
 *   v2.0.0 — 2026-09-24 — The two-level model: aimeat_theme_style_save and
 *     aimeat_theme_component_css_set; free CSS with warnings; versions and restore.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { tokenMap } from '../input-schemas.js';
import { FONT_KINDS } from '../../models/tool-input-vocabulary.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';

export const themeTools = [
    {
        name: 'aimeat_theme_list',
        description: "List this server's themes: the look of every page of AIMEAT's own interface (the home, the chat, Settings & Controls, admin; published apps keep their own). A theme holds styles; a style is a set of colours in light and dark, three faces and a mode (both, light only, dark only). The built-in AIMEAT theme holds the six built-in styles (aimeat, paper, circuit, contrast, mist, voltage) and is read only; copy it to make your own. For each theme you get its styles with their main colours and any contrast line they miss, which styles the pill offers and the default one, which components have CSS in it and whether that CSS is served, and its theme CSS warnings. You also get who chooses (whether people pick, which themes are available, the default theme; changed with aimeat_theme_policy_set), what a style may set (the colour tokens, the faces this server serves, each component's usual things to change) and the shape values a theme may set (vocabulary.shapes: corners, frames, shadows, letter case, each with what it is for and the built-in value). Every component reads the shape values, so set a theme's look there first and keep component CSS for what is one component's own. `fonts` is every face: `base` (the faces this server ships with, free licences, each with its licence, copyright holder and source) and `added` (faces the operator added with aimeat_theme_font_save, never base setup; licenceStatus \"unknown\" means nobody stated the licence or the copyright holder, and it shows at an audit), each with the styles that use it. For the operator's own agent it also carries `owners`: the fonts owners keep in their own storage for their apps, an inventory only.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: list, with the operator\'s choices', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_theme_get',
        description: "Read one theme whole: every style with every colour in light and dark, its faces and mode, the theme's component CSS and theme CSS, the warnings each carries (contrast lines, CSS that can hide a control, motion, literal colours, faces, selectors outside their component) and whether each component's CSS is served, and the versions it was saved as (to put one back with aimeat_theme_save and restoreVersion). `id` is from aimeat_theme_list.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: one, whole', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'admin'],
        input: {
            id: { type: 'string', required: true, description: "The theme's id, from aimeat_theme_list (for example 'aimeat').", zod: z.string().min(1).max(40) },
        },
    },
    {
        name: 'aimeat_theme_save',
        description: "Make or change one of this server's themes. Without `id` you make a new theme: a copy of `basedOn` (default 'aimeat') with its styles, CSS and choices. With `id` you change that theme: `name`; `shapes`, the theme's shape values (for example { \"--shape-corner\": \"16px\", \"--shape-case-heading\": \"none\" }; a value that does not fit its kind is refused with the reason); `css`, the theme CSS for the whole theme (any CSS: selectors, !important, @media, @keyframes; empty removes it); `defaultStyle` and `offeredStyles` (style ids of this theme, which the pill offers); `retired` true takes it out of the pill without deleting it. `restoreVersion` puts back a version from aimeat_theme_get, which is the way to undo a save. `dryRun` checks and saves nothing. Only CSS that does not parse is refused; everything else comes back as warnings with the line. The built-in theme is read only. Only the operator of this server can do this, with the site:theme-write permission. To make a theme available to people, use aimeat_theme_policy_set.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: make, change, copy, retire or put back a version', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Making the node's themes: the look of every page. The same kind of word as the layout's, no
        // wildcard carries it, and the handler also asks whether the account runs this node.
        scope: 'site:theme-write',
        surfaces: ['agent', 'admin'],
        input: {
            id: { type: 'string', description: 'The theme to change. Leave it out to make a new one.', zod: z.string().max(40) },
            name: { type: 'string', description: 'What people see in the pill. 1 to 60 characters, and no other theme may have it (retired ones included).', zod: z.string().max(60) },
            basedOn: { type: 'string', description: "For a new theme: the theme it copies (default 'aimeat').", zod: z.string().max(40) },
            css: { type: 'string', description: 'Theme CSS for the whole theme; empty removes it.', zod: z.string().max(64000) },
            shapes: { type: 'object', description: "The theme's shape values (corners, frames, shadows, letter case), only the ones you change; an empty value puts the built-in one back. aimeat_theme_list names them.", zod: z.record(z.string(), z.string().max(200)) },
            defaultStyle: { type: 'string', description: 'The style a person sees first in this theme.', zod: z.string().max(40) },
            offeredStyles: { type: 'array', description: 'The style ids of this theme the pill offers.', zod: z.array(z.string().max(40)).max(40) },
            retired: { type: 'boolean', description: 'true takes the theme out of the pill; false brings it back.' },
            restoreVersion: { type: 'number', description: 'Put back this saved version (from aimeat_theme_get).', zod: z.number().int().min(1) },
            dryRun: { type: 'boolean', description: 'Check everything and save nothing.' },
        },
    },
    {
        name: 'aimeat_theme_style_save',
        description: "Make or change a style inside a theme: its colours in light and dark, its three faces and its mode. Without `style` you make a new style, a copy of `basedOn` (a style of the theme; its default style if left out). `light` and `dark` are objects of colour token → CSS colour (hex, rgb(), hsl(), color-mix(in srgb, …), var(--token)); send only what you change; aimeat_theme_list names the tokens. `faces` picks { headline, body, mono } from the faces this server serves. `onlyMode` is 'light' or 'dark' for a style with one mode, empty for both; the pill then says why its light/dark switch is off. `retired` true takes the style out of the pill. A value that does not parse is refused; a contrast line under its minimum (words 4.5:1 on the page and on a card, the accent 3:1, words on the sun 4.5:1) is a warning, and the style is saved. Only the operator, with site:theme-write.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: make or change a style', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'site:theme-write',
        surfaces: ['agent', 'admin'],
        input: {
            theme: { type: 'string', required: true, description: 'The theme the style belongs to.', zod: z.string().min(1).max(40) },
            style: { type: 'string', description: 'The style to change. Leave it out to make a new one.', zod: z.string().max(40) },
            name: { type: 'string', description: 'What people see in the pill. 1 to 60 characters.', zod: z.string().max(60) },
            basedOn: { type: 'string', description: 'For a new style: the style of this theme it copies.', zod: z.string().max(40) },
            light: { type: 'object', description: 'Token → colour for light mode, only the ones you change.', zod: tokenMap },
            dark: { type: 'object', description: 'Token → colour for dark mode, only the ones you change.', zod: tokenMap },
            faces: { type: 'object', description: '{ headline, body, mono }, each a face this server serves.', zod: z.object({ headline: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }) },
            onlyMode: { type: 'string', description: "'light' or 'dark' for a style with one mode; empty for both." },
            retired: { type: 'boolean', description: 'true takes the style out of the pill; false brings it back.' },
            dryRun: { type: 'boolean', description: 'Check everything and save nothing.' },
        },
    },
    {
        name: 'aimeat_theme_policy_set',
        description: "Decide who chooses the look of this server's own pages: `personalChoice` (true: people pick a theme and a style in the look picker; false: everybody sees the default theme in its default style and there is no picker), `offered` (the theme ids people can choose; at least one, none retired) and `default` (the theme a visitor and a new person see first; one of the offered). Send only what changes. These are the Config tab's themes.* settings, saved the same way. Only the operator, with site:theme-write. aimeat_theme_list shows the current choice.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: who chooses, which are available, the default', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'site:theme-write',
        surfaces: ['agent', 'admin'],
        input: {
            personalChoice: { type: 'boolean', description: 'People choose in the look picker (true), or everybody sees the default (false).' },
            offered: { type: 'array', description: "The theme ids people can choose, for example ['aimeat', 'pebble'].", zod: z.array(z.string().max(40)).min(1).max(40) },
            default: { type: 'string', description: 'The default theme: one of the offered.', zod: z.string().max(40) },
        },
    },
    {
        name: 'aimeat_theme_font_save',
        description: "Add a face (font) to this server, so its themes and the Design Book can use it at once, or change or remove one you added. Give `family` (the name a style chooses, for example 'Space Mono'), `files` (each woff2 file the face has: `weight` '400' or '100 900' for a variable face, `style` normal or italic, and for a face shipped in parts a `subset` name with its `unicodeRange`), `kind` (what it falls back to: sans-serif, serif, monospace or cursive) and what you know of its licence: `licence` (for example 'OFL-1.1'), `copyright` (the holder, as the font says) and `source` (where it came from). The answer has one `upload_url` per file: PUT the woff2 bytes there (curl -X PUT --data-binary @file.woff2 '<upload_url>'). The face is served, and a style may choose it, once a file has arrived. The only check on the bytes is that they are woff2; there is no limit on size or on how many. A face you add is always marked as added, never as part of the base setup, and the operator answers for it: without a licence or a copyright holder it is marked licence unknown, which shows on the Fonts tab, the libraries page and the compliance report. Ask the person for the licence before you add a face, and add only faces they may lawfully use. Sending the same family again changes it; leave `files` out to keep its files. `remove: true` removes the face and its files, refused while a style of a theme uses it (the refusal names them). Only the operator of this server, with site:theme-write. aimeat_theme_list shows every face.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        // remove: true deletes a face and its files, so the tool as a whole is destructive.
        annotations: { title: 'Themes: add, change or remove a face (font)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'site:theme-write',
        surfaces: ['agent', 'admin'],
        input: {
            family: { type: 'string', required: true, description: "The face's name as a style chooses it, for example 'Space Mono'.", zod: z.string().min(1).max(60) },
            kind: { type: 'string', description: "What it falls back to while it loads: 'sans-serif' (default), 'serif', 'monospace' or 'cursive'.", zod: z.enum(FONT_KINDS) },
            files: { type: 'array', description: 'The woff2 files the face has, each { weight, style?, subset?, unicodeRange? }; one upload_url comes back for each. Leave it out on a change to keep the files.', zod: z.array(z.object({
                weight: z.string().max(9).describe("'400', or '100 900' for a variable face."),
                style: z.string().max(6).optional().describe("'normal' (default) or 'italic'."),
                subset: z.string().max(30).optional().describe("A name for one part of a face shipped in parts, such as 'latin' or 'latin-ext'."),
                unicodeRange: z.string().max(4000).optional().describe("That part's unicode-range as CSS writes it, for example 'U+0000-00FF, U+0131'."),
            })) },
            licence: { type: 'string', description: "The licence, for example 'OFL-1.1'. Without it the face is marked licence unknown.", zod: z.string().max(200) },
            copyright: { type: 'string', description: 'Who holds the copyright, as the font says. Without it the face is marked licence unknown.', zod: z.string().max(500) },
            source: { type: 'string', description: 'Where the face came from, an https:// address.', zod: z.string().max(500) },
            remove: { type: 'boolean', description: 'true removes the face and its files; refused while a style uses it.' },
        },
    },
    {
        name: 'aimeat_theme_component_css_set',
        description: "Style one component in one theme with CSS of your own, for example \"give the loud action a coral ground\": theme 'my-theme', component 'slab', css '.poster-slab { background: var(--accent); border-radius: 8px; }'. Start each rule from the component's own classes (aimeat_ui_component_get names them, and the usual things to change); a selector that reaches outside the component is a warning, not a refusal. Any CSS works (!important, @media, @keyframes); only CSS that does not parse is refused. The answer says whether the CSS is served and every warning with its line: something that can hide a control or block a click, motion without a reduced-motion guard, a literal colour that stays the same in every style and mode, a face this server does not serve. Empty css removes it. `dryRun` checks and saves nothing. Only the operator, with site:theme-write.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Themes: CSS for one component', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'site:theme-write',
        surfaces: ['agent', 'admin'],
        input: {
            theme: { type: 'string', required: true, description: 'The theme the CSS belongs to.', zod: z.string().min(1).max(40) },
            component: { type: 'string', required: true, description: "The component's id, from aimeat_ui_component_list (for example 'slab').", zod: z.string().min(1).max(60) },
            css: { type: 'string', description: 'The CSS; empty removes it.', zod: z.string().max(64000) },
            dryRun: { type: 'boolean', description: 'Check and save nothing.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
