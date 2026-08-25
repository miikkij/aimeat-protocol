/**
 * @file src/services/surface-layout/blocks-portal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every block the node's public front page can be built from. Read against
 *   public/views/landing.js, which is the page these describe, and its siblings landing-doors.js,
 *   landing-builder.js and landing-wall.js, which hold the components.
 *
 *   THE RAW TEMPLATE IS NOT ONE OF THESE, AND MUST NOT BECOME ONE. An operator who has uploaded a
 *   whole HTML document still wins over any layout, unchanged. That template is the one place on
 *   this platform where operator-authored markup runs with a CSP nonce, and folding it into a block
 *   would carry that into a page composed from parts nobody read as a whole. Converting a template
 *   to blocks is a decision an operator makes by hand, never an automatic migration: there is no
 *   honest way to turn arbitrary HTML into a block list.
 *
 *   `portal.text` AND `portal.board` REPLACE TAGS WITH BLOCKS. Both were {{memory:portal/x}} and
 *   {{board:slug}} written into a template by hand. As blocks they carry props the admin form can
 *   draw and the AI prompt can describe, which a string inside a document cannot.
 * @structure PORTAL_BLOCKS
 * @usage
 *   import { PORTAL_BLOCKS } from './blocks-portal.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial: the sections of today's landing page, derived from
 *     views/landing.js and its three siblings.
 */
import type { SurfaceBlockDef } from './registry-types.js';

export const PORTAL_BLOCKS: readonly SurfaceBlockDef[] = [
    {
        id: 'portal.welcome-door',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'welcomeDoor',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'The front door: what this place is in one sentence, and the ways in.',
    },
    {
        id: 'portal.pitch',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.pitch',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'One line saying what this node is, above everything that asks the visitor to do something.',
    },
    {
        id: 'portal.wish',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.wish',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'One field where a visitor says what they need, and lands in a chat that starts on it.',
    },
    {
        id: 'portal.build-invite',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.invite',
        liveDomains: ['templates', 'packages'],
        props: {
            openByDefault: {
                type: 'boolean',
                default: false,
                description: 'Whether the builder starts open. Measured behaviour says shut: an open generator on the front page held nobody.',
            },
        },
        maxPerSurface: 1,
        summary: 'The app generator, folded: describe an idea, get a prompt to paste into any AI chat.',
    },
    {
        id: 'portal.connect-invite',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.connect',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'The second door: connect the AI they already use, and run all of this from that chat.',
    },
    {
        id: 'portal.changelog',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.log',
        liveDomains: ['site'],
        props: {},
        maxPerSurface: 1,
        summary: 'What shipped here lately, folded to one line.',
    },
    {
        id: 'portal.gallery',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.wall',
        liveDomains: ['apps'],
        props: {
            firstPage: {
                type: 'number',
                default: 12,
                min: 3,
                max: 60,
                description: 'How many apps the wall shows before the button that reveals the rest.',
            },
            sort: {
                type: 'enum',
                values: ['newest', 'popular'],
                default: 'newest',
                description: 'Which order the wall opens in. Newest says the place is alive; most-opened says what is good.',
            },
        },
        maxPerSurface: 1,
        summary: 'The wall of apps people published here, with a search and a sort.',
    },
    {
        id: 'portal.totals',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.totals',
        liveDomains: ['apps', 'organisms', 'agents'],
        props: {},
        maxPerSurface: 1,
        summary: 'Cumulative counters: how many apps, spaces and agents this node holds.',
    },
    {
        id: 'portal.hero',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.hero',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'The ownership question — owner or tenant — and the three ways to answer it.',
    },
    {
        id: 'portal.agent-prompt',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.agentPrompt',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'A copyable prompt for building a local agent fleet. The tinkerer path.',
    },
    {
        id: 'portal.ask-ai',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.askAi',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'A prompt that asks their own AI what this is and whether it is for them.',
    },
    {
        id: 'portal.stats',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.stats',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'What this node did today, and the line offering the same to the visitor.',
    },
    {
        id: 'portal.transparency',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.trans',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'One line on how this node marks what a model wrote, and a link to the page that states it properly.',
    },
    {
        id: 'portal.text',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'surface.portalText',
        liveDomains: ['site'],
        props: {
            key: {
                type: 'string',
                maxLength: 200,
                description: 'Which portal memory record holds the words, e.g. portal/about. This is the {{memory:...}} tag as a block.',
            },
        },
        maxPerSurface: 8,
        summary: 'A passage the operator wrote, stored as a portal record and shown here.',
    },
    {
        id: 'portal.board',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'surface.portalBoard',
        liveDomains: ['boards'],
        props: {
            slug: {
                type: 'string',
                maxLength: 120,
                description: 'Which board to show recent posts from. Only system and public boards are ever rendered.',
            },
            limit: {
                type: 'number',
                default: 5,
                min: 1,
                max: 20,
                description: 'How many recent posts to show.',
            },
        },
        maxPerSurface: 4,
        summary: 'The latest posts from one board, for announcements a visitor should see.',
    },
];
