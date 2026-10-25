/**
 * @file src/tool-catalog/definitions/internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of an app opened to the internet on a node that shows its content to
 *   signed-in accounts only (services/internet-opening/). The owner (or their agent) reads, opens and
 *   closes their own app's opening; an operator lists every opening, decides what waits, and names the
 *   owners who open without asking. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/internet-opening.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-internet-opening.ts), the last two over the REST routes in
 *   routes/internet-opening.ts.
 * @structure internetOpeningTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const APP = { type: 'string' as const, required: true, description: 'The app\'s filename, e.g. "campaign.html" (aimeat_app_list gives it).' };

export const internetOpeningTools = [
    {
        name: 'aimeat_app_internet_opening_get',
        description: 'Whether one of the person\'s own apps is open to everyone on the internet, on a node that otherwise shows its content to its signed-in accounts only. Answers `mode` (how this node opens apps: "operator" an operator approves, "self" the owner opens and the operators are told, "off" nobody opens, "not-needed" the node is open to everyone already), `may_open_directly` (whether this person opens without waiting for an operator), `declared_forms` (the intake forms the live version names in its <meta name="aimeat-intake">, which open with it), and `opening`: its `state` (requested, open, declined, request_expired, expired, closed), the reason, who asked and when, who approved, `until`, the open forms, what waits for an operator (`request`, `forms_request`) and the history newest first. `opening` is null for an app never opened. Same data as GET /v1/apps/{owner}/{filename}/internet-opening.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'App Open to the Internet?', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['agent', 'appdev'],
        input: { app: APP },
    },
    {
        name: 'aimeat_app_internet_open',
        description: 'Open one of the person\'s own apps to everyone on the internet, on a node that otherwise shows its content to its signed-in accounts only: for example a campaign landing page with a consent form. The app page, its own documents and the intake forms its live version names in <meta name="aimeat-intake" content="org/ws/formId ..."> open; its other data calls stay closed. `reason` is required: who the page is for and what they do there; the operators and the history show it. `days` is how long it stays open (default and maximum: the node\'s setting, 90 unless changed); it closes itself then, and the person is reminded 7 days before. Where the node lets this person open on their own it opens at once (`outcome` "opened") and the operators are told; otherwise it waits for an operator (`outcome` "requested", HTTP 202) and the person hears the decision. Called on an app already open, it extends the end date with the new reason ("extended" or "extend_requested"). An agent without the publish:public permission on a node whose publish gate asks first gets `outcome` "owner_asked" with a `publish_request` to hand the person. Refused: an app whose own setting lets only signed-in accounts or one organisation open it (APP_NOT_OPEN_TO_ANYONE: set who may open it to anyone first), one with an access code, parked or taken down; NOT_NEEDED on an open node; OPENING_OFF when the operators switched it off. Tell the person in one sentence whether it is open now or waits, and until when.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Open App to the Internet', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'app:write',
        surfaces: ['agent', 'appdev'],
        input: {
            app: APP,
            reason: { type: 'string', required: true, description: 'Why it is opened: who it is for and what they do there. 3 to 500 characters.' },
            days: { type: 'number', description: 'How many days it stays open, 1 to the node\'s maximum (default: the maximum).' },
        },
    },
    {
        name: 'aimeat_app_internet_close',
        description: 'Close an app to the internet at once, or withdraw the opening request that waits. The person closes their own app; an operator closes anyone\'s by naming `owner`, and that owner is told. The app then opens only for the node\'s signed-in accounts again, as before. `reason` is recorded in the opening\'s history. Answers NOT_OPEN when the app is neither open nor waiting. Same as DELETE /v1/apps/{owner}/{filename}/internet-opening.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Close App to the Internet', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['agent', 'appdev', 'admin'],
        input: {
            app: APP,
            owner: { type: 'string', description: 'Operators only: the account whose app to close. Leave out for the person\'s own app.' },
            reason: { type: 'string', description: 'Why it is closed, for the history (and for the owner, when an operator closes it).' },
        },
    },
    {
        name: 'aimeat_admin_internet_openings',
        description: 'Operator-only. Every app this closed node has opened to the internet, and what waits: the node\'s `mode` and `max_days`, `counts` (open, waiting for a decision, ending within 7 days), `openings` (each with the app, its owner, reason, who asked and when, who approved, until, version at opening and now, the open forms, what waits in `request` or `forms_request`, and the history newest first) and `openers` (the owners who open without asking, with who allowed it, why and until when). Without `state` it lists what is open, what waits and the last 30 days of the rest. Same data as GET /v1/admin/internet-openings. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Apps Open to the Internet', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            state: { type: 'string', enum: ['requested', 'open', 'declined', 'request_expired', 'expired', 'closed'], description: 'Only the openings in this state.' },
        },
    },
    {
        name: 'aimeat_admin_internet_opening_decide',
        description: 'Operator-only. Approve or decline what waits on one app\'s opening: the first opening, an extension of its end date, or intake forms a new version added (`which` "forms"; by default the opening or extension first). Approving the first opening opens the app and its declared forms at once, for the days asked. A decline needs `note`, which the owner reads. The owner is told either way, and the decision is recorded on their account. Answers NOTHING_TO_DECIDE when nothing waits. Same as POST /v1/admin/internet-openings/{owner}/{filename}/decision.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Decide an Internet Opening', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            owner: { type: 'string', required: true, description: 'The account whose app it is.' },
            app: APP,
            decision: { type: 'string', required: true, enum: ['approve', 'decline'], description: '"approve" or "decline".' },
            note: { type: 'string', description: 'The reason, for the owner. Required with "decline".' },
            which: { type: 'string', enum: ['request', 'forms'], description: '"request" for the opening or extension, "forms" for forms a new version added. Default: the opening or extension, else the forms.' },
        },
    },
    {
        name: 'aimeat_admin_internet_opener_set',
        description: 'Operator-only. Let one owner open their apps to the internet without an operator\'s approval, or take that back (`allowed` false). The operators still hear of every opening and every new version, and can close any. Taking it back closes nothing: what the owner opened stays open and listed, and their next opening or extension waits for an operator. `reason` is required when allowing; `until` (an ISO date) ends the trust by itself. The owner is told, and the change is recorded on their account. Same as PUT and DELETE /v1/admin/internet-openers/{owner}.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Trust an Owner to Open Apps', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            owner: { type: 'string', required: true, description: 'The account name.' },
            allowed: { type: 'boolean', required: true, description: 'true lets them open without asking; false takes it back.' },
            reason: { type: 'string', description: 'Why they may open without asking. Required with allowed true.' },
            until: { type: 'string', description: 'An ISO date when the trust ends by itself. Leave out for no end.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
