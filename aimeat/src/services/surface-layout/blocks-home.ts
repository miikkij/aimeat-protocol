/**
 * @file src/services/surface-layout/blocks-home.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every block a member's home can be built from, and the onboarding home's step
 *   machine. Read against public/views/home/index.js, which is the page these describe.
 *
 *   NOTHING HERE IS FIXED CHROME. The nameplate and the trust line are blocks like the rest,
 *   because the operator was given the whole page. The trust line carries this node's AI-labelling
 *   and data-ownership statement, so an operator removing it is removing that — their call, made on
 *   purpose, not by accident. Nobody is locked out either way: the SPA header's role-gated links are
 *   not configurable and are always there.
 *
 *   THE WAY INTO SETTINGS IS THE NAMEPLATE'S, and there is no separate block for it. There was one
 *   for a moment, and driving the page in a browser showed it for what it was: a second Settings
 *   button under a page that already had one on the nameplate. One control, one place.
 *
 *   THE STEP MACHINE IS ONE BLOCK. `home.steps` is the onboarding funnel, and its inside is not
 *   open for arranging: branch B moves the agent step from second to third, the dimmed steps are
 *   numbered by position, and the write-once funnel markers are set inside those components. An
 *   operator may drop it or put their own words above it. Reordering its insides is not a thing
 *   the schema can express, which is the point.
 *
 *   liveDomains ARE REAL DOMAIN STRINGS, checked against what emitChange() actually publishes.
 *   An invented one would simply never fire and the block would look stale for reasons nobody
 *   could find.
 * @structure HOME_BLOCKS
 * @usage
 *   import { HOME_BLOCKS } from './blocks-home.js';
 * @version-history
 *   v1.1.0 — 2026-08-27 — home.mcp-connect: the short way into an MCP connection, on the home of
 *     an account that has none. It gates on the connection record itself rather than on a step
 *     someone ticked, so it cannot stay up after the thing it asks for has happened.
 *   v1.0.0 — 2026-08-26 — Initial: the blocks of today's finished home and the onboarding step
 *     machine, derived from views/home/index.js:263-295 and status-parts.js.
 */
import type { SurfaceBlockDef } from './registry-types.js';

export const HOME_BLOCKS: readonly SurfaceBlockDef[] = [
    {
        id: 'home.nameplate',
        surfaces: ['home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'home.identityHint',
        liveDomains: ['ghii'],
        props: {},
        maxPerSurface: 1,
        summary: 'Who the person is: their picture, their name, and the way into their settings.',
    },
    {
        // Present on every node and absent from almost every page: it draws only while nothing has
        // ever connected over MCP, and the person reaches this home through a browser, so the one
        // thing missing is the road they came here to build. It disappears the moment any AI opens
        // a session, and nothing has to be marked done for that to happen.
        id: 'home.mcp-connect',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'mcpInstall.homeTitle',
        liveDomains: ['instances'],
        props: {},
        maxPerSurface: 1,
        summary: 'The one-click links and config files that attach an AI to this node. Absent once one is connected.',
    },
    {
        id: 'home.mat',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.webpage',
        liveDomains: ['portfolio'],
        props: {},
        maxPerSurface: 1,
        summary: 'One line linking the web page their AI made for them. Absent until they have one.',
    },
    {
        id: 'home.mailbox',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.mail',
        liveDomains: ['messages'],
        props: {},
        maxPerSurface: 1,
        summary: 'Whether anything unread is waiting, and how much.',
    },
    {
        id: 'home.chat-door',
        surfaces: ['home'],
        presence: { kind: 'capability', capability: 'chat' },
        localeStem: 'home.chatDoor',
        liveDomains: ['chat', 'instances'],
        props: {},
        maxPerSurface: 1,
        summary: 'Which mind answers when they open the chat here, and the way in.',
    },
    {
        id: 'home.fleet',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.fleet',
        liveDomains: ['agents'],
        props: {},
        maxPerSurface: 1,
        summary: 'How many of their agents are home and whether any of them is in trouble.',
    },
    {
        id: 'home.things',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.things',
        liveDomains: ['memory', 'files', 'organisms', 'apps'],
        props: {
            rows: {
                type: 'string[]',
                values: ['assets', 'organisms', 'knowledge', 'apps'],
                default: ['assets', 'organisms', 'knowledge', 'apps'],
                maxItems: 4,
                description: 'Which named rows this band shows, in this order. Leave one out and it is gone.',
            },
        },
        maxPerSurface: 1,
        summary: 'What they have made: counts, the spaces they share, their knowledge packages, their apps.',
    },
    {
        id: 'home.playbooks',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.playbooks',
        liveDomains: ['config'],
        props: {
            tourUrl: {
                type: 'string',
                maxLength: 300,
                default: '',
                description: 'Address of a guided tour offered beside the playbooks. Empty means no tour is offered.',
            },
        },
        maxPerSurface: 1,
        summary: 'Named outcomes they can set up, each with its steps and the prompt that walks it.',
    },
    {
        id: 'home.achievements',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'home.ach',
        liveDomains: ['memory', 'agents', 'organisms'],
        props: {},
        maxPerSurface: 1,
        summary: 'What they have tried here so far, as a strip of small marks.',
    },
    {
        id: 'home.feed',
        surfaces: ['home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'home.feed',
        liveDomains: ['home'],
        props: {
            limit: {
                type: 'number',
                default: 6,
                min: 1,
                max: 30,
                description: 'How many things that happened are listed before the link to everything.',
            },
        },
        maxPerSurface: 1,
        summary: 'What has happened on this account lately, newest first.',
    },
    {
        id: 'home.open-items',
        surfaces: ['home'],
        presence: { kind: 'always' },
        localeStem: 'openItems',
        liveDomains: ['agent-tasks', 'work'],
        props: {
            maxAgeDays: {
                type: 'number',
                default: 7,
                min: 1,
                max: 90,
                description: 'How old an unfinished item may be before it stops being listed.',
            },
        },
        maxPerSurface: 1,
        summary: 'What they meant to do here and have not finished.',
    },
    {
        id: 'home.install-cta',
        surfaces: ['home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'install',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'An offer to install this as an app on their device. Only ever shown when the browser offers it.',
    },
    {
        id: 'home.trust',
        surfaces: ['home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'home.trust',
        liveDomains: [],
        props: {},
        maxPerSurface: 1,
        summary: 'How this node labels what a model wrote, and who owns the data. Removing it removes that statement.',
    },
    {
        id: 'home.steps',
        surfaces: ['home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'home.step1',
        liveDomains: ['agents', 'portfolio', 'agent-onboarding'],
        props: {},
        maxPerSurface: 1,
        summary: 'The setup path a new person walks before the account does anything. Its own order is not arrangeable.',
    },
];
