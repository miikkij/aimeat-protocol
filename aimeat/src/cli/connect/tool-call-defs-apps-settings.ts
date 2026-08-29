/**
 * @file src/cli/connect/tool-call-defs-apps-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CLI dispatch definitions for an app's SETTINGS: search visibility
 *   (aimeat_app_seo_set, aimeat_seo_status), the badge and install-chip switches
 *   (aimeat_app_marks_set), the app's own legal pages (aimeat_app_legal_set) and its audit log
 *   (aimeat_app_audit). A pure extraction from tool-call-defs-apps.ts when that file passed the
 *   800-line ceiling; the entries are spread back into appTools, so the assembled table, the
 *   parity gates and test/unit/cli-tool-param-forwarding.test.ts see the same list as before.
 * @structure appSettingsTools: ConnectCliToolDefinition[]
 * @usage import { appSettingsTools } from './tool-call-defs-apps-settings.js';
 * @version-history
 *   v1.0.0 -- 2026-08-29 -- Extracted from tool-call-defs-apps.ts (max-file-lines), no behaviour change.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalArray } from './tool-call-helpers.js';

export const appSettingsTools: ConnectCliToolDefinition[] = [
    {
        // → PATCH /v1/apps/:filename — the app owner's own search-visibility switch and wording.
        //   Only the fields the caller named travel: an absent field means "leave it alone", so
        //   flipping the switch never wipes a title written on an earlier visit. The dispatch
        //   refuses an undeclared parameter rather than dropping it (withDeclaredInputOnly), which
        //   is what stops this door from succeeding while having done less than it was asked.
        name: 'aimeat_app_seo_set',
        description: 'Decide whether one of your apps can be found in a search engine, and what it says about itself when it is. Off until you ask.',
        input: {
            filename: { type: 'string', required: true, description: 'The app to change, with its extension (e.g. "notes.html").' },
            index: { type: 'boolean', description: 'true makes the app findable in search engines; false takes it back out.' },
            title: { type: 'string', description: 'Title for search results and social cards. Empty derives it from the app name.' },
            description: { type: 'string', description: 'Description for search results. Empty derives it from the app description.' },
            keywords: { type: 'array', description: 'Keywords. Empty uses the app tags.' },
            image: { type: 'string', description: 'Absolute https URL for the social card. Empty uses the app screenshot.' },
            lang: { type: 'string', description: 'Language tag such as "fi". Empty reads what the app declares about itself.' },
        },
        handler: ({ client }, input) => {
            const seo: JsonObject = {};
            const index = optionalBoolean(input, 'index');
            if (index !== undefined) seo.index = index;
            for (const field of ['title', 'description', 'image', 'lang'] as const) {
                const v = optionalString(input, field);
                if (v !== undefined) seo[field] = v;
            }
            const keywords = optionalArray(input, 'keywords');
            if (keywords) seo.keywords = keywords;
            return client.patch(`/v1/apps/${encodeURIComponent(requiredString(input, 'filename'))}`, { seo });
        },
    },
    {
        // → PATCH /v1/apps/:filename — the app owner's badge and install-chip switches. Only the
        //   fields the caller named travel. The reviewer's name is not a field on purpose (see the
        //   connector door): the route refuses it from any agent token.
        name: 'aimeat_app_marks_set',
        description: 'Switch the "publish your own app" badge and the browser install offer on one of your served apps. Both on until you ask; naming nothing reports where the app stands.',
        input: {
            filename: { type: 'string', required: true, description: 'The app to change, with its extension (e.g. "notes.html").' },
            badge: { type: 'boolean', description: 'false takes the "publish your own app" badge off this app; true puts it back.' },
            install: { type: 'boolean', description: 'false stops offering visitors to install this app in their browser; true offers it again.' },
        },
        handler: ({ client }, input) => {
            const marks: JsonObject = {};
            for (const field of ['badge', 'install'] as const) {
                const v = optionalBoolean(input, field);
                if (v !== undefined) marks[field] = v;
            }
            return client.patch(`/v1/apps/${encodeURIComponent(requiredString(input, 'filename'))}`, { marks });
        },
    },
    {
        // → PATCH /v1/apps/:filename { legal } — one of the app's own legal pages set or removed;
        //   with no kind, GET /v1/apps/me/:filename/legal reports where the app stands.
        name: 'aimeat_app_legal_set',
        description: 'Publish, replace or remove one of an app\'s own legal pages (terms, privacy, imprint, refunds, accessibility, cookies, support) as markdown, HTML or a link; with no kind, report where the app stands.',
        input: {
            filename: { type: 'string', required: true, description: 'The app, with its extension (e.g. "shop.html").' },
            kind: { type: 'string', description: 'terms, privacy, imprint, refunds, accessibility, cookies or support. Omit to only read where the app stands.' },
            format: { type: 'string', description: 'markdown, html or url.' },
            content: { type: 'string', description: 'The page text, the HTML document, or the absolute https URL.' },
            remove: { type: 'boolean', description: 'true removes the named page.' },
        },
        handler: ({ client }, input) => {
            const filename = requiredString(input, 'filename');
            const kind = optionalString(input, 'kind');
            if (!kind) return client.get(`/v1/apps/me/${encodeURIComponent(filename)}/legal`);
            // Every declared field travels inside the kind object; the node reads `remove: true`
            // as the same act as null. Nothing this door was given is decided here.
            const doc: JsonObject = {};
            const format = optionalString(input, 'format');
            if (format !== undefined) doc.format = format;
            const content = optionalString(input, 'content');
            if (content !== undefined) doc.content = content;
            const remove = optionalBoolean(input, 'remove');
            if (remove !== undefined) doc.remove = remove;
            return client.patch(`/v1/apps/${encodeURIComponent(filename)}`, { legal: { [kind]: doc } });
        },
    },
    {
        // → GET /v1/apps/me/:filename/audit — the owner's audit log of the app's settings.
        name: 'aimeat_app_audit',
        description: 'Read one of your apps\' audit log: every change to how the app is offered, newest first, with who made it and when.',
        input: {
            filename: { type: 'string', required: true, description: 'The app, with its extension.' },
            limit: { type: 'number', description: 'How many of the newest entries to return. Default 50, at most 500.' },
        },
        handler: ({ client }, input) => {
            const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50) || 50));
            return client.get(`/v1/apps/me/${encodeURIComponent(requiredString(input, 'filename'))}/audit?limit=${limit}`);
        },
    },
    {
        // → GET /v1/admin/seo/status — is this node findable, and what is left to do. Operator-only.
        name: 'aimeat_seo_status',
        description: 'Whether this node can be found in a search engine, and what is still undone about it. Operator-only.',
        input: {},
        handler: ({ client }) => client.get('/v1/admin/seo/status'),
    },
];
