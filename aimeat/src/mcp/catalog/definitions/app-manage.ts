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
    limit: { type: 'number', description: 'For audit: how many of the newest entries. Default 50, at most 500.' },
    playtest: { type: 'boolean', description: 'For audit: also open the app in a headless browser, signed out, and report what it did (about a minute).' },
    // visitors
    days: { type: 'number', description: 'For visitors: the trailing window in days, 0 to 360. 0 is today only. Default 30.' },
    on: { type: 'boolean', description: 'For visitors_measure: true starts counting who opens the app; false stops and keeps what was counted.' },
    geo: { type: 'string', enum: ['off', 'country', 'region', 'city'], description: 'For visitors_measure: the place kept for each person. Choose the coarsest that answers the question. Omit to keep what it was.' },
    // ui
    detail: { type: 'array', description: UI_DETAIL_PARAM },
    layout: { type: 'object', description: 'For ui_set: the WHOLE layout { v: 1, look?, nav?, blocks: [{ id, component, props }] }. It replaces what is there; read it first with ui_get.' },
    note: { type: 'string', description: 'For ui_set: one line on what this change was for.' },
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

const DESCRIPTION = 'Manage one of your apps: its settings, search visibility, legal pages, visitors, screen layout, thumbnail, versions, forks, cost, bundled agents and backup, in one tool. Pick `action`; each action takes only its own fields, and a call with a missing or foreign field is refused with every problem named at once, so nothing is charged or changed. Actions:\n'
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
