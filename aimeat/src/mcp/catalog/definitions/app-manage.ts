/**
 * @file src/mcp/catalog/definitions/app-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage: every setting and read of one of the owner's apps, in ONE tool
 *   with an `action` parameter and a field list per action.
 *
 *   WHY ONE TOOL. The app catalogue could do about twenty things no MCP tool reached (verified
 *   2026-09-27, docs/internal/appcat-mcp-gaps.md in the main checkout), and the node already lists
 *   over 300 tools. The developer ruled on 2026-09-27: one tool with an action parameter, which also
 *   takes over ten small app tools (seo, marks, legal, screenshot, visitors, visitors_measure,
 *   versions, audit, ui_get, ui_set), so the list gets shorter while the capability grows.
 *
 *   ONE TABLE. APP_MANAGE_ACTIONS is the only place an action's fields, required fields, permission
 *   word and one-line summary are written. The catalog input, the description, the per-action
 *   permission check (catalog/action-scopes.ts) and checkAppManageInput(), which all three MCP
 *   interfaces call before anything else, are derived from it.
 * @structure APP_MANAGE_FIELDS · APP_MANAGE_ACTIONS · checkAppManageInput · appManageTools ·
 *   UI_DETAIL_PARAM · uiReadQuery
 * @usage
 *   const checked = checkAppManageInput(input);
 *   if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
 * @version-history
 *   2026-10-01 — IAM round 2 on the member actions: member_set takes `email` and `locale` (a verified account's
 *     address approves it, any other address is invited by email), members takes `q`, `limit` and
 *     `offset`, member_plan_set takes `manage_roles`, and member_audit and member_invite_cancel are
 *     new. The roster actions name the managers beside the owner.
 *   2026-10-01 — The app's member roster: members, member_set, member_remove, member_decline,
 *     member_dismiss, member_plan_get, member_plan_set and member_sweep for the owner and their
 *     agents, member_me and member_request for anybody (routes/app-members.ts). New fields account,
 *     role, level, offerings, expires_at, roles, seats, terms, access, roster_visibility; days and
 *     note name their member meaning too (wish-manage-an-app-s-members-from-chat-mcp-cli-and-crewai-tools-f).
 *   2026-09-28 — config_get and config_set, with the `values` field: the config an app declares
 *     (services/app-config.ts).
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.0.0 — 2026-09-27 — Initial (wish-app-toiminnot-ilman-mcp-ty-kalua-ja-ty-kalujen-m-r-n-hallint).
 */
import type { AimeatToolDefinition, ToolInputField } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

/** What the `detail` field of ui_get says, on every interface. */
export const UI_DETAIL_PARAM = 'For ui_get: names from the catalogue index to get IN FULL: component ids ("table", "statRow") or section names ("effects", "layouts", "ambients"). Omit it for the index alone.';

/** The query the connector and the CLI send the ui route: the index, and the named parts in full. */
export function uiReadQuery(detail: unknown): string {
    const names = Array.isArray(detail) ? detail.filter((d): d is string => typeof d === 'string' && !!d.trim()) : [];
    return '?catalogue=index' + (names.length ? '&detail=' + encodeURIComponent(names.join(',')) : '');
}

/** Every field any action takes. A field's description names the actions that read it. */
export const APP_MANAGE_FIELDS: Record<string, ToolInputField> = {
    filename: { type: 'string', description: 'The app, with its extension (e.g. "shop.html").' },
    owner: { type: 'string', description: 'The app\'s owner. Omit for your own apps; another owner\'s app needs a development grant, or is read only where the action is public.' },
    // seo
    index: { type: 'boolean', description: 'For seo: true makes the app findable in search engines, false takes it back out. Off until you ask.' },
    title: { type: 'string', description: 'For seo: title for search results and social cards. Empty derives it from the app name.' },
    description: { type: 'string', description: 'For seo: the search-result description (empty derives it). For settings: the app\'s own catalogue description.' },
    keywords: { type: 'array', description: 'For seo: keywords. Empty uses the app tags.' },
    image: { type: 'string', description: 'For seo: absolute https URL for the social card. Empty uses the app screenshot.' },
    lang: { type: 'string', description: 'For seo: language tag such as "fi". Empty reads what the app declares.' },
    // marks
    badge: { type: 'boolean', description: 'For marks: false takes the "publish your own app" badge off the app; true puts it back.' },
    install: { type: 'boolean', description: 'For marks: false stops offering visitors to install the app in their browser; true offers it again.' },
    // legal
    kind: { type: 'string', enum: ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'cookies', 'support'], description: 'For legal: which page. Omit to read where the app stands.' },
    format: { type: 'string', enum: ['markdown', 'html', 'url'], description: 'For legal: markdown (rendered with every character escaped), html (served as written on the app\'s own origin) or url (a link to where the page lives).' },
    content: { type: 'string', description: 'For legal: the page text, the HTML document, or the absolute https URL.' },
    remove: { type: 'boolean', description: 'For legal: true removes the named page.' },
    // audit
    limit: { type: 'number', description: 'For audit and member_audit: how many of the newest entries. Default 50, at most 500. For members: how many people per list on one page. Default 100, at most 500.' },
    playtest: { type: 'boolean', description: 'For audit: also open the app in a headless browser, signed out, and report what it did (about a minute).' },
    // visitors
    days: { type: 'number', description: 'For visitors: the trailing window in days, 0 to 360. 0 is today only. Default 30. For member_set: how many days the membership lasts, counted from now; omit it to use the role\'s term from the plan.' },
    on: { type: 'boolean', description: 'For visitors_measure: true starts counting who opens the app; false stops and keeps what was counted.' },
    geo: { type: 'string', enum: ['off', 'country', 'region', 'city'], description: 'For visitors_measure: the place kept for each person. Choose the coarsest that answers the question. Omit to keep what it was.' },
    // ui
    detail: { type: 'array', description: UI_DETAIL_PARAM },
    layout: { type: 'object', description: 'For ui_set: the WHOLE layout { v: 1, look?, nav?, blocks: [{ id, component, props }] }. It replaces what is there; read it first with ui_get.' },
    note: { type: 'string', description: 'For ui_set: one line on what this change was for. For member_set: the owner\'s own note on the decision (at most 400 characters; the member does not see it). For member_request: your message to the owner, who sees it with the request.' },
    version: { type: 'number', description: 'For ui_restore: the layout version to put back (ui_set answers with the one it replaced).' },
    // settings
    name: { type: 'string', description: 'For settings: the app\'s display name. Changes it without a new version.' },
    descriptions: { type: 'object', description: 'For settings: the description per language, { "fi": "…", "es": "…" }.' },
    parked: { type: 'boolean', description: 'For settings: true hides the app from the public catalogue (it still works by link and for you); false lists it again.' },
    forkable: { type: 'boolean', description: 'For settings: true lets anyone signed in fork the app into their own catalogue.' },
    access_code: { type: 'string', description: 'For settings: a code visitors must type to open the app. An empty string removes it. Never read back.' },
    protection: { type: 'object', description: 'For settings: copy protection { obfuscate, domainLock, watermark, noRawDownload }, each true or false.' },
    // screenshot_upload
    screenshot: { type: 'string', description: 'For screenshot_upload: the image as base64, at most 2 MB.' },
    screenshot_mime_type: { type: 'string', description: 'For screenshot_upload: image/png, image/jpeg or image/webp. Default image/png.' },
    // subdomains
    subdomain: { type: 'string', description: 'For subdomain_set and subdomain_delete: the subdomain label (e.g. "shop").' },
    target: { type: 'string', description: 'For subdomain_set: what it serves, "owner/filename" for an app or an absolute URL for a redirect.' },
    subdomain_kind: { type: 'string', enum: ['app', 'redirect'], description: 'For subdomain_set: app serves an app at the subdomain, redirect sends visitors to target.' },
    enabled: { type: 'boolean', description: 'For subdomain_set: false keeps the entry but stops serving it.' },
    // bundled agents
    bundled_agent: { type: 'string', description: 'For agent_*: the name of an agent the app declares in its manifest.' },
    runner_agent: { type: 'string', description: 'For agent_deploy, agent_undeploy and agent_status: which of your agents runs it. Omit to use your task runner.' },
    organism_id: { type: 'string', description: 'For agent_deploy: the organism the deployed agent works in, when the app needs one.' },
    // config
    values: { type: 'object', description: 'For config_set: the fields to change, { "<field>": value }. A null puts a field back to its default; fields not named keep their values.' },
    // members (routes/app-members.ts)
    account: { type: 'string', description: 'For member_set, member_remove, member_decline and member_dismiss: the person, as an account name ("bob"), their identity ("bob@node") or one of their agents. All three mean the same person.' },
    role: { type: 'string', description: 'For member_set: the role to give, in the app\'s own words (e.g. "member", "editor"). It starts with a letter and holds letters, digits, ".", "_" or "-", at most 40 characters. "owner" is refused: the owner already reaches everything.' },
    level: { type: 'number', description: 'For member_set: an optional rank inside the app, where a lower number is more power. Most apps leave it out.' },
    offerings: { type: 'array', description: 'For member_set: the offering ids this membership gives free access to. Omit it to use what the app\'s plan says for the role (member_plan_get).' },
    expires_at: { type: 'string', description: 'For member_set: when the membership ends, as a date such as "2026-12-31T00:00:00Z". It wins over days. An empty string means it does not end.' },
    roles: { type: 'object', description: 'For member_plan_set: each role and the offering ids a member in that role uses free, { "member": ["<offering id>"] }. A role with no entry gives nothing free.' },
    seats: { type: 'object', description: 'For member_plan_set: each role and how many people may hold it at once, { "editor": 3 }. A role with no entry has no limit.' },
    terms: { type: 'object', description: 'For member_plan_set: each role and how long it lasts, { "member": { "days": 30, "renewal": "manual" } }. renewal is "manual", "self-serve" or "none" and only says what is meant to happen; nothing renews or charges by itself.' },
    access: { type: 'string', enum: ['members-free', 'free', 'members-only'], description: 'For member_plan_set: who pays for the app\'s paid calls. members-free (default): members pay nothing, everybody else pays. free: nobody pays. members-only: only members get in at all.' },
    roster_visibility: { type: 'string', enum: ['owner', 'members'], description: 'For member_plan_set: who reads the roster. owner (default) or members, who then see names, roles and join dates only.' },
    manage_roles: { type: 'array', description: 'For member_plan_set: the roles whose holders manage the roster beside the owner: they approve, decline, change and remove roles that do not manage, invite by email and read the history. They never change the plan, run the sweep, or give or take away a managing role. Empty: the owner alone.' },
    email: { type: 'string', description: 'For member_set, instead of account: an email address. When it belongs to a verified account on this server, that person is approved; any other address gets an invitation by email, which makes them a member when they sign up with it. Open invitations are listed by members and cancelled with member_invite_cancel.' },
    locale: { type: 'string', enum: ['en', 'fi', 'es'], description: 'For member_set with email: the language of the invitation email. Omit it to use your own language.' },
    q: { type: 'string', description: 'For members: show only people whose account name, display name, email or note contains this text.' },
    offset: { type: 'number', description: 'For members: how many people to skip on each list, for the next page. Default 0.' },
    before: { type: 'string', description: 'For member_audit: the time of the oldest entry you already have, to read the page before it.' },
    invite_id: { type: 'string', description: 'For member_invite_cancel: the invitation id, from the invites list of members.' },
};

/** One action: its fields (true = required), its permission word (null = none), and one line. */
export interface AppManageAction {
    fields: Record<string, boolean>;
    scope: string | null;
    summary: string;
    /** At least one of these must be present (settings changes something). */
    oneOf?: string[];
    /** The action records an AI provenance declaration, so it takes the two provenance fields. */
    provenance?: boolean;
}

const F = (required: string[], optional: string[] = []): Record<string, boolean> =>
    Object.fromEntries([...required.map(f => [f, true] as const), ...optional.map(f => [f, false] as const)]);

const SETTINGS_FIELDS = ['name', 'description', 'descriptions', 'parked', 'forkable', 'access_code', 'protection'];

/**
 * The member roster. Each action is one route of routes/app-members.ts and names the word that route
 * asks; the route checks it and decides who is the owner, so another owner's app is refused there.
 * Spread into APP_MANAGE_ACTIONS before the account-wide actions, so the operator actions stay last.
 */
const MEMBER_ACTION_SPECS: Record<string, AppManageAction> = {
    members: { fields: F(['filename'], ['owner', 'q', 'limit', 'offset']), scope: 'app:write',
        summary: 'the app\'s member roster: who holds which role, with display names, who asked to join and waits for your decision, who opened the app without a role, and the open email invitations. The owner, and members whose role the plan names as managing the roster read it all; when the plan shows the roster to members, a member reads names and roles only' },
    member_set: { fields: F(['filename', 'role'], ['owner', 'account', 'email', 'locale', 'level', 'note', 'offerings', 'days', 'expires_at']), oneOf: ['account', 'email'], scope: 'exchange:grant',
        summary: 'approve a person into a role, or change their role or end date, by account or by email (an unknown address is invited). The person is notified of a new membership and of a role change, and the plan\'s free access for the role is given to them; the answer says what was given and taken back. The owner, and members whose role the plan names as managing the roster; only the owner gives a managing role' },
    member_remove: { fields: F(['filename', 'account'], ['owner']), scope: 'exchange:grant',
        summary: 'remove a member: they are notified and the free access the membership gave them is taken back. A right to build the app stays. The owner, and members whose role the plan names as managing the roster; only the owner removes a manager' },
    member_decline: { fields: F(['filename', 'account'], ['owner']), scope: 'app:manage',
        summary: 'decline a request to join. The person is told, and may ask again after seven days; until then their ask is kept as declined. The owner, and members whose role the plan names as managing the roster' },
    member_dismiss: { fields: F(['filename', 'account'], ['owner']), scope: 'app:manage',
        summary: 'take a person off the list of people who opened the app without a role. It blocks nobody; they appear again on their next visit. The owner, and members whose role the plan names as managing the roster' },
    member_plan_get: { fields: F(['filename'], ['owner']), scope: 'app:write',
        summary: 'what membership of the app means: the free access per role, seats, terms, who pays, who reads the roster, and which roles manage it. Owner only' },
    member_plan_set: { fields: F(['filename', 'roles'], ['owner', 'seats', 'terms', 'access', 'roster_visibility', 'manage_roles']), scope: 'commerce:sell',
        summary: 'replace the whole membership plan (read it first with member_plan_get). It applies to approvals from now on; people approved before keep what they have until they are approved again. Owner only' },
    member_sweep: { fields: F(['filename'], ['owner']), scope: 'exchange:grant',
        summary: 'close every membership whose end date has passed now, and take back its free access, instead of waiting for the hourly run. Owner only' },
    member_audit: { fields: F(['filename'], ['owner', 'limit', 'before']), scope: 'app:write',
        summary: 'the roster\'s history, newest first: who approved, declined, invited, changed a role or removed whom, and when, and every plan change. The owner, and members whose role the plan names as managing the roster' },
    member_invite_cancel: { fields: F(['filename', 'invite_id'], ['owner']), scope: 'app:manage',
        summary: 'cancel an open email invitation, so the address no longer becomes a member on sign-up. The owner, and members whose role the plan names as managing the roster; only the owner cancels an invitation into a managing role' },
    member_me: { fields: F(['filename'], ['owner']), scope: null,
        summary: 'your own standing in an app, yours or somebody else\'s: your role, whether you are the owner, and your request to join and its state' },
    member_request: { fields: F(['filename', 'owner'], ['note']), scope: 'social:write',
        summary: 'ask the owner of somebody else\'s app to let you in. The owner is notified with your note; asking again replaces the note. A member is told they already are one' },
};

export const APP_MANAGE_ACTIONS: Record<string, AppManageAction> = {
    settings: { fields: F(['filename'], ['owner', ...SETTINGS_FIELDS]), oneOf: SETTINGS_FIELDS, scope: 'app:write',
        summary: 'change name, description, per-language descriptions, parked (hidden from the public catalogue), forkable, access code or copy protection, without a new version' },
    seo: { fields: F(['filename'], ['index', 'title', 'description', 'keywords', 'image', 'lang']), scope: 'app:write',
        summary: 'decide whether the app can be found in search engines (off until you ask) and what it says there; naming nothing reports where it stands' },
    marks: { fields: F(['filename'], ['badge', 'install']), scope: 'app:write',
        summary: 'switch the "publish your own app" badge and the install offer; naming nothing reports them. Naming the reviewer who lifts the AI label is the account holder\'s own act and is not here' },
    legal: { fields: F(['filename'], ['kind', 'format', 'content', 'remove']), provenance: true, scope: 'app:write',
        summary: 'publish, replace or remove one of the app\'s legal pages (terms, privacy, imprint, refunds, accessibility, cookies, support), served under its address; no kind reports which pages it still ought to have' },
    audit: { fields: F(['filename'], ['limit', 'playtest']), scope: 'app:write',
        summary: 'read the app\'s change log, newest first; playtest: true also opens the app signed out in a real browser and reports what a stranger sees' },
    versions: { fields: F(['filename'], ['owner']), scope: null,
        summary: 'list the version history (number, display version, size, created at)' },
    lineage: { fields: F(['filename'], ['owner']), scope: null,
        summary: 'the fork tree: where the app came from and every fork made of it' },
    screenshot: { fields: F(['filename'], ['owner']), scope: 'app:write',
        summary: 'render the published app in a real browser, store the picture as its thumbnail, and answer its URL so you can look at it' },
    screenshot_upload: { fields: F(['filename', 'screenshot'], ['owner', 'screenshot_mime_type']), scope: 'app:write',
        summary: 'set your own image as the thumbnail' },
    screenshot_clear: { fields: F(['filename'], ['owner']), scope: 'app:write',
        summary: 'remove the thumbnail; the next scheduled run takes a new one' },
    preview_link: { fields: F(['filename'], ['owner']), scope: 'app:write',
        summary: 'a short-lived link that opens the app\'s unpublished draft' },
    visitors: { fields: F(['filename'], ['days']), scope: 'signals:read',
        summary: 'who opened the app and from where; read the answer\'s `reading` block before repeating a number' },
    visitors_measure: { fields: F(['filename', 'on'], ['geo']), scope: 'signals:write',
        summary: 'switch visitor measurement on or off and choose how precisely a person\'s place is kept; say it in the app\'s privacy notice' },
    ui_get: { fields: F(['filename'], ['detail']), scope: 'memory:read',
        summary: 'read an Atelier app\'s screen layout and the component catalogue index' },
    ui_set: { fields: F(['filename', 'layout'], ['note']), provenance: true, scope: 'memory:write',
        summary: 'replace the WHOLE layout (read it first); the answer names the version it replaced' },
    ui_restore: { fields: F(['filename', 'version'], []), scope: 'memory:write',
        summary: 'put a replaced layout version back' },
    config_get: { fields: F(['filename'], ['owner']), scope: null,
        summary: 'the config the app declares it needs: each field, its value (defaults filled in) and which required ones are still empty' },
    config_set: { fields: F(['filename', 'values'], []), scope: 'app:write',
        summary: 'change the app\'s config values, checked against what it declares; a managed package install allows it, since config is a setting' },
    cost: { fields: F(['filename'], ['owner']), scope: 'exchange:read',
        summary: 'what the app\'s contracts for other people\'s tools cost: per contract, and totals' },
    agent_deploy: { fields: F(['filename', 'bundled_agent'], ['owner', 'runner_agent', 'organism_id']), scope: 'task:write',
        summary: 'start an agent the app declares, as a task on your runner' },
    agent_undeploy: { fields: F(['filename', 'bundled_agent'], ['owner', 'runner_agent']), scope: 'task:write',
        summary: 'stop it' },
    agent_instances: { fields: F(['filename', 'bundled_agent'], ['owner']), scope: null,
        summary: 'the deployed instances of an agent the app declares' },
    agent_status: { fields: F(['filename', 'bundled_agent'], ['owner', 'runner_agent']), scope: null,
        summary: 'whether it is registered, when it was last seen, and its deploy state' },
    ...MEMBER_ACTION_SPECS,
    grants: { fields: F([], []), scope: 'consent:manage',
        summary: 'the apps your owner has granted permissions to, with their permissions and spend; revoking one is the owner\'s own act on the Access page' },
    backup_export: { fields: F([], []), scope: 'app:write',
        summary: 'write a ZIP backup of all your apps to your private storage and answer its storage key (fetch it with aimeat_storage_download); restoring a backup is the owner\'s own act on the App Catalog page' },
    subdomain_list: { fields: F([], []), scope: 'operator:admin',
        summary: 'operator: the subdomains this server serves apps or redirects on' },
    subdomain_set: { fields: F(['subdomain'], ['target', 'subdomain_kind', 'enabled']), scope: 'operator:admin',
        summary: 'operator: create or change one' },
    subdomain_delete: { fields: F(['subdomain'], []), scope: 'operator:admin',
        summary: 'operator: remove one' },
};

export const APP_MANAGE_ACTION_NAMES = Object.keys(APP_MANAGE_ACTIONS);

/** The provenance fields, which an action with `provenance` takes. */
const PROVENANCE_FIELDS = Object.keys(aiProvenanceCatalogInput);

/** The fields an action takes, required ones first, as the refusal lists them. */
function fieldList(action: AppManageAction): string {
    const names = Object.entries(action.fields).sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([f, req]) => (req ? `${f} (required)` : f));
    if (action.provenance) names.push(...PROVENANCE_FIELDS);
    return names.length ? names.join(', ') : 'none';
}

export type AppManageCheck =
    | { ok: true; action: string }
    | { ok: false; message: string };

/**
 * Check one call against its action's field list, and name everything wrong in one answer: an
 * unknown action, every missing required field, and every field the action does not take.
 * `extra` names parameters an interface adds itself (the connector's agent_name), which are ignored.
 */
export function checkAppManageInput(input: Record<string, unknown>, extra: string[] = []): AppManageCheck {
    const actionName = typeof input.action === 'string' ? input.action : '';
    const action = APP_MANAGE_ACTIONS[actionName];
    if (!action) {
        return { ok: false, message: `action must be one of: ${APP_MANAGE_ACTION_NAMES.join(', ')}.${actionName ? ` "${actionName}" is not one.` : ''}` };
    }
    const present = (f: string) => input[f] !== undefined && input[f] !== null;
    const missing = Object.entries(action.fields).filter(([f, req]) => req && !present(f)).map(([f]) => f);
    const allowed = new Set(['action', ...Object.keys(action.fields), ...(action.provenance ? PROVENANCE_FIELDS : []), ...extra, 'response_format']);
    const foreign = Object.keys(input).filter(f => present(f) && !allowed.has(f));
    const parts: string[] = [];
    if (missing.length) parts.push(`is missing: ${missing.join(', ')}`);
    if (foreign.length) parts.push(`does not take: ${foreign.join(', ')}`);
    if (!missing.length && action.oneOf && !action.oneOf.some(present)) {
        parts.push(`needs at least one of: ${action.oneOf.join(', ')}`);
    }
    if (!parts.length) return { ok: true, action: actionName };
    return { ok: false, message: `action "${actionName}" ${parts.join('. It ')}. Its fields: ${fieldList(action)}.` };
}

const DESCRIPTION = 'Manage one of your apps: its settings, search visibility, legal pages, visitors, screen layout, thumbnail, versions, forks, cost, bundled agents, members and backup, in one tool. Two member actions work on somebody else\'s app: member_me reads your standing and member_request asks to join. Pick `action`; each action takes only its own fields, and a call with a missing or foreign field is refused with every problem named at once, so nothing is charged or changed. Actions:\n'
    + APP_MANAGE_ACTION_NAMES.map(n => `- ${n} (${fieldList(APP_MANAGE_ACTIONS[n]!)}): ${APP_MANAGE_ACTIONS[n]!.summary}.`).join('\n')
    + '\nPermissions are checked per action: an action needs the word shown by the refusal, so an agent without app:write can still read versions, lineage and agent status.'
    + AI_PROVENANCE_TOOL_NOTE;

export const appManageTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_app_manage',
        description: DESCRIPTION,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, enum: APP_MANAGE_ACTION_NAMES, description: 'What to do. The description lists each action with its fields.' },
            ...APP_MANAGE_FIELDS,
            ...aiProvenanceCatalogInput,
        },
    },
];
