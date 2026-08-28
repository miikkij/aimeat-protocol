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
 *   v1.1.0 — 2026-08-28 — The showroom: six blocks for the front page as a demo floor for the
 *     store (showroom-hero, wall-intro, store, trust, rooms, close). portal.store is the first
 *     portal block gated on config: it exists only when the node has a store to send people to.
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

    // ── The showroom (2026-08-28). The front page as a demo floor for the store: everything on
    //    it is real, and the visitor can take one home. Components in views/landing-showroom*.js.
    {
        id: 'portal.showroom-hero',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.show',
        liveDomains: [],
        props: {
            picture: {
                type: 'boolean',
                default: true,
                description: 'Whether the full-width showroom picture renders under the headline. Off gives a text-only hero.',
            },
        },
        maxPerSurface: 1,
        summary: 'The showroom hero: the claim, the wish box as the one action, and the three quieter doors (get your own, connect your AI, let your AI register you).',
    },
    {
        id: 'portal.wall-intro',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.wallIntro',
        liveDomains: [],
        props: {
            money: {
                type: 'boolean',
                default: true,
                description: 'Whether the payment-rails passage renders under the introduction: cards through Stripe, agents paying agents through x402, and the live proof link when this node has one.',
            },
        },
        maxPerSurface: 1,
        summary: 'What the wall below is: whole systems built in an hour by chatting, several of which earn their keep. Sits directly above the wall.',
    },
    {
        id: 'portal.store',
        surfaces: ['portal'],
        presence: { kind: 'config', configKey: 'storeEnabled' },
        localeStem: 'landing.store',
        liveDomains: [],
        props: {
            fromPrice: {
                type: 'string',
                default: '19 €/mo',
                maxLength: 24,
                description: 'The sticker on the picture: the lowest price a visitor can take one home for. Used only while the store has not published its own (see tiers).',
            },
            tiers: {
                type: 'string',
                default: 'Solo: 19 · Team: 59 · Office: 99 · Own machine: 179 · Compliance: 369 · Managed: from 2 000',
                maxLength: 240,
                description: 'The fallback price ladder as one line: "name: price" pairs separated by " · ", each price per month in euros (the € and "per month" are added on the page). The store is the source: when it publishes the public record ext:shop/tiers ({ from, tiers: [{ name, price }] }), the page shows that and this line is not read.',
            },
        },
        maxPerSurface: 1,
        summary: 'Loved the demo? Take one home. The store door, the three reasons, and the price ladder read from the store itself. Offered only when this node has a store (AIMEAT_SITE_STORE_URL).',
    },
    {
        id: 'portal.trust',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.trust',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'Safe is a list, not a word: every action signed, AI content labeled, consent you can revoke, GDPR as buttons, and the link to how this node marks AI content.',
    },
    {
        id: 'portal.rooms',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.rooms',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'Two cards: adopt agents from the incubator (its door when this node has one), and nobody in it but you.',
    },
    {
        id: 'portal.close',
        surfaces: ['portal'],
        presence: { kind: 'always' },
        localeStem: 'landing.close',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'The last word: the demo is free and does not mind being poked, with the way back up to the wish box and, when there is one, the store.',
    },
];
