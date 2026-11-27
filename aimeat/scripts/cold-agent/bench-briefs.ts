/**
 * @file scripts/cold-agent/bench-briefs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five fixed orders of the Atelier build bench: what a person asks their own AI to
 *   build, word for word the same in every round, so two rounds differ only in what the node, the
 *   kit and the build specification were on the day.
 *
 *   WHY FIVE AND WHY THESE. Each one needs a different part of the platform: a personal record
 *   store (list), a team's shared data with roles (team), a working surface that fills the page and
 *   draws shapes (map), a game with a shared score table (game), and a public page that takes
 *   sign-ups from people with no account (page). An order a genre covers whole measures nothing
 *   about the parts: three measured builds of a tip calculator read the Design Book zero times,
 *   and that was the right answer.
 *
 *   EVERY ORDER ANSWERS THE INTERVIEW IN ADVANCE. The build specification asks the person five
 *   questions, the data map and whether an introduction is wanted, and waits. A measured build
 *   must not depend on what the person happened to answer that day, so the order carries the
 *   answers, and ends by saying that nothing more is to be asked.
 *
 *   A brief's `proves` are the facts its pass is read from: patterns over the published page, and
 *   for what a page's text cannot say (who may open it, whether it draws signed out) what the node
 *   says about the app. They say the app uses the part of the platform the order needs, and
 *   nothing about how well.
 * @structure AppFacts · Brief · BRIEFS · briefPrompt()
 * @usage
 *   import { BRIEFS, briefPrompt } from './bench-briefs.js';
 * @version-history
 *   v1.1.0 — 2026-11-27 — A proof also reads the node's facts about the app. The first baseline
 *     round failed two builds that did what was ordered: a team list kept by an extension, and a
 *     public page forked from a genre, which has no `requireLogin: false` in its text.
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { api } from './tasks.js';

/** The name the bench gives the sandbox node in the run folder's MCP configuration. */
export const BENCH_MCP_SERVER = 'aimeat-sandbox';

export interface BriefSetupContext {
    baseUrl: string;
    ownerName: string;
    ownerToken: string;
    otherOwnerToken: string;
    memberToken: string;
    marker: string;
}

/** What the node says about the published app, for a proof the page's text cannot give. */
export interface AppFacts {
    /** Who may open the app, as its settings say: `anyone`, `signed-in` or `organism:<id>`; null when not read. */
    openTo: string | null;
    /** Whether the node's own browser saw the app draw with nobody signed in; null when the playtest did not run. */
    signedOutDraws: boolean | null;
}

export interface Brief {
    id: string;
    /** The app's name without the run's marker. */
    name: string;
    /** What the person wants, in their words. `{org}` is the organism a setup made. */
    spec: string;
    /** The answers to the build interview's questions about people and data. */
    answers: string;
    /** Runs once before the session, for an order that needs something to exist first. Returns the `{org}` name. */
    setup?: (ctx: BriefSetupContext) => Promise<string>;
    /** Facts read from the published page; the brief passes when every one holds. */
    proves: Array<{ what: string; test: (html: string, app: AppFacts) => boolean }>;
}

const keepsOnNode = (html: string): boolean =>
    /\/v1\/libs\/aimeat-living\.js/.test(html) || (/\/v1\/libs\/aimeat-data\.js/.test(html) && /\b\w+\.data\.(set|get)\s*\(/.test(html));

export const BRIEFS: Brief[] = [
    {
        id: 'list',
        name: 'Errands',
        spec: 'A personal errands list. I add an errand with a title and, when I want, a due date. I tick an errand done, and I can take the tick back. '
            + 'I see the open errands first, with the ones due today or late marked, and one number that says how many are open. I can edit and remove an errand. '
            + 'It has to remember everything when I come back tomorrow, on my phone too.',
        answers: 'Only I use it, signed in. Every errand is PERSONAL: mine alone, and nobody else reads it.',
        proves: [{ what: 'keeps the errands on the node', test: keepsOnNode }],
    },
    {
        id: 'team',
        name: 'Tool shed',
        spec: 'A lending register for the shared tools of our residents\' association. Every member sees one common list of tools: the name of each, where it is kept, and who has it now. '
            + 'A member marks a tool borrowed in their own name and marks it returned. Only the board adds a tool or removes one. '
            + 'Each member can also keep a private note on a tool, which nobody else sees.',
        answers: 'The members of my organism "{org}" use it, and nobody else opens it. The list of tools and who has each one is SHARED BY THE TEAM: one common set that every member reads. '
            + 'The private notes are PERSONAL. Every member may mark a tool borrowed and returned; only the role "board" adds and removes tools. '
            + 'So: when Bob marks the ladder borrowed, Carol sees at once that Bob has it, and Carol\'s note on the ladder is seen by Carol only. Yes, that is right.',
        setup: async (ctx) => {
            const name = `Harbour Street Residents ${ctx.marker}`;
            const org = await api<{ organism: { id: string } }>(ctx.baseUrl, '/v1/organisms', ctx.ownerToken, {
                method: 'POST', body: { name, description: 'The residents\' association of Harbour Street.', type: 'project', join_policy: 'open', visibility: 'private' },
            });
            if (org.status >= 300 || !org.data) throw new Error(`team setup: creating the organism answered ${org.status}`);
            for (const [who, token] of [['the second owner', ctx.otherOwnerToken], ['the member', ctx.memberToken]] as const) {
                const joined = await api(ctx.baseUrl, `/v1/organisms/${org.data.organism.id}/join`, token, { method: 'POST', body: {} });
                if (joined.status >= 300) throw new Error(`team setup: ${who} joining answered ${joined.status}`);
            }
            return name;
        },
        // Two homes are shared by the team: an organism workspace, and the namespace of an extension
        // that enforces the board's rule on the node. The first baseline build chose the extension,
        // and a proof that knew only the workspace failed it.
        proves: [
            {
                what: 'keeps the shared list in a home the team shares: an organism workspace or an extension\'s namespace',
                test: html => /\/v1\/libs\/aimeat-organism\.js|AIMEAT\.organism\b|workspacePicker\s*\(/.test(html) || /\.data\.action\s*\(|\/v1\/ext\//.test(html),
            },
            { what: 'opens only to the organism\'s members', test: (_html, app) => app.openTo === null || app.openTo.startsWith('organism:') },
        ],
    },
    {
        id: 'map',
        name: 'Berry map',
        spec: 'A map of my berry and mushroom places. A place is an AREA I draw on the map as a shape, with a name, what grows there and a note. '
            + 'I can also draw a walking ROUTE as a line from a parking spot to a place, and the app shows the length of the route. '
            + 'I switch the map between a street map and an aerial or terrain view when one is available, and I hide or show the areas and the routes separately. '
            + 'A list beside the map names the places, and picking one moves the map to it. On a phone the map is the whole screen and the list comes up from the bottom.',
        answers: 'Only I use it, signed in. Every place and every route is PERSONAL: mine alone.',
        proves: [
            { what: 'draws on a real map', test: html => /leaflet/i.test(html) || /AIMEAT\.atelier\.map\s*\(|\b[aA]\.map\s*\(\s*\{/.test(html) },
            { what: 'draws areas and routes as shapes', test: html => /polygon|geoJSON|areas\s*:/i.test(html) && /polyline|routes?\s*:/i.test(html) },
            { what: 'keeps the places on the node', test: keepsOnNode },
        ],
    },
    {
        id: 'game',
        name: 'Lantern catch',
        spec: 'A small arcade game of my own design. Lanterns fall from the top of the screen at different speeds. I move a boat left and right along the bottom and catch them. '
            + 'A caught lantern is one point. A red lantern costs a life, and I have three lives. The fall gets faster every twenty points, and a round ends when the lives are gone. '
            + 'It plays with the arrow keys, with a gamepad, and by touch on a phone. It has a title screen, a pause, a sound switch and a high-score table.',
        answers: 'Anyone plays it without signing in. The high-score table is PUBLIC to the players: a signed-in player saves a score under their name and everybody sees the table. '
            + 'Nothing else is kept.',
        proves: [
            { what: 'starts from the game shell or a game engine the node serves', test: html => /aimeat-phaser|\/lib\/phaser|aimeat-game\.js/i.test(html) },
            { what: 'has a score table', test: html => /leaderboard|high.?score|hiscore/i.test(html) },
        ],
    },
    {
        id: 'page',
        name: 'Library open day',
        spec: 'A page for the open day of our village library on 14 March. It says what the day is, when and where, and the programme hour by hour in five items. '
            + 'It has a sign-up form for the storytelling hour: a name, the number of children and an e-mail address. The people who sign up have no account here. '
            + 'I read the sign-ups in the app when I am signed in, and I am the only one who can. The page should look like an invitation worth opening, not like a form.',
        answers: 'Anyone opens the page without signing in. The sign-ups are mine alone to read, and they hold personal data: a name and an e-mail address. '
            + 'The page is its own introduction.',
        proves: [
            // Read from the node, not from the page: a page forked from a genre boots without the
            // shell call whose `requireLogin: false` the first version of this proof looked for.
            { what: 'opens without signing in', test: (_html, app) => app.openTo === 'anyone' && app.signedOutDraws !== false },
            { what: 'takes the sign-ups through the node\'s public form', test: html => /aimeat-intake/i.test(html) || /AIMEAT\.intake\b|intakeForm\s*\(/.test(html) },
        ],
    },
];

/**
 * The whole order as the person pastes it. The frame is the same for every brief: where the node
 * is, which connection to use, the answers, and that nothing more is to be asked.
 */
export function briefPrompt(brief: Brief, v: { baseUrl: string; marker: string; org?: string }): string {
    const fill = (text: string) => text.replaceAll('{org}', v.org ?? '');
    return [
        `I am building an app on my own AIMEAT. It runs on this computer at ${v.baseUrl}. It is a local sandbox, not aimeat.io. `
            + `You are connected to it over MCP as the server "${BENCH_MCP_SERVER}", and you act there as my agent. `
            + 'Build the app on that AIMEAT and publish it there. Use no other AIMEAT connection.',
        '',
        'THE APP',
        `${fill(brief.spec)} Call it "${brief.name} ${v.marker}".`,
        '',
        'MY ANSWERS TO WHAT YOU WOULD ASK',
        `${fill(brief.answers)} The finest level. English and Finnish. No introduction for a new user beyond what I said. Take the design you recommend.`,
        '',
        'Do not ask me anything more. Where I have not said, decide, and tell me at the end what you decided. '
            + 'Finish everything the publish answer says the app still owes. When you are done, give me the app\'s address and a short list of what you built.',
        '',
    ].join('\n');
}
