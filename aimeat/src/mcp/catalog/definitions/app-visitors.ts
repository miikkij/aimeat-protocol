/**
 * @file src/mcp/catalog/definitions/app-visitors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for "who opened my app": the read (aimeat_app_visitors) and the
 *   switch (aimeat_app_visitors_measure). In a file of their own because organisms-workspaces-apps.ts
 *   sits at the 800-line ceiling; they belong beside the other per-app settings and are listed
 *   right after that slice in definitions.ts.
 * @structure appVisitorsTools: AimeatToolDefinition[]
 * @usage import { appVisitorsTools } from './definitions/app-visitors.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const appVisitorsTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_app_visitors',
        description: 'Who opened one of your own apps, when, and from where, over the last 0 to 360 days (30 when you name none). The answer has two halves. `opens` is always there: every open in the window, how many came from a signed-in person and how many from nobody signed in, and how many different signed-in people that was. It is counts only; a visitor is never named. `visitors` is null until measurement is switched on for the app (aimeat_app_visitors_measure), and after that it says what kind of visitor came: people, AI fetchers and other bots, the AIs by name with `asked` (a person asked their assistant something and it fetched the app to answer) apart from `crawled` (an index or training corpus being built), a per-day series, and, at the precision the owner chose, where the PEOPLE came from by country and by region or city. AI fetchers are never placed, because their address is a data centre. `measurement.geo_available` false means this node is not told where requests come from, so places stay empty whatever precision is chosen. The country code ZZ is a visit whose place could not be told. Read the `reading` block before repeating a number to anyone: it says what each one is worth.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            filename: { type: 'string', required: true, description: 'One of your own apps, with its extension (e.g. "shop.html").' },
            days: { type: 'number', description: 'The trailing window in days, 0 to 360. 0 is today only. Default 30.' },
        },
    },
    {
        name: 'aimeat_app_visitors_measure',
        description: 'Switch visitor measurement on or off for one of your own apps, and choose how precisely a person\'s place is kept. Until it is on, the node counts that the app was opened and nothing about who came. On starts counting people against AI fetchers against other bots, with the AIs named. `geo` sets the place kept for each PERSON: off (none), country, region or city. Each step down comes closer to telling one visitor from another, so choose the coarsest one that answers the question, and say in the app\'s privacy notice that visits are counted by place. No address is ever stored: the place arrives from the reverse proxy in front of the node, already resolved. Off stops the counting and KEEPS what was collected, and the precision is remembered for the next time it goes on.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            filename: { type: 'string', required: true, description: 'One of your own apps, with its extension (e.g. "shop.html").' },
            on: { type: 'boolean', required: true, description: 'true starts counting who opens the app; false stops and keeps what was counted.' },
            geo: { type: 'string', description: 'off, country, region or city. Omit to keep what it was; a first switch-on starts at off.' },
        },
    },
];
