/**
 * @file cli/connect/tool-call-defs-packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component-package tools for the shell / local-call dispatch: /v1/packages, its
 *   group ids and its version history.
 *
 *   WHY THIS IS A SEPARATE FILE AND A SEPARATE NAME. These handlers used to be called aimeat_app_*,
 *   on this door only, while the same names on the node's MCP meant the single-file web apps at
 *   /v1/apps. Measured on production the day it was found: 50 apps, 4 packages, three of the four
 *   being ::system examples. So an agent on this door could not reach one real app — told to list
 *   apps it got four system examples, told to publish an app it created a package with no app
 *   address. The split even ran through a single flow: aimeat_app_get read a package while
 *   aimeat_app_draft_write wrote an app.
 *
 *   Packages are a real capability and they keep it, under the name that describes them.
 * @structure packageTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { packageTools } from './tool-call-defs-packages.js';
 * @version-history
 *   v1.1.0 -- 2026-08-23 -- aimeat_package_install, and aimeat_package_publish sending what the
 *     route reads. Publish posted {name, description, content}; POST /v1/packages requires a
 *     `components` array and never reads `content`, so it was answered 400 every time.
 *   v1.0.0 -- 2026-08-16 -- Split out of tool-call-defs-apps.ts when the app tools were pointed back
 *     at apps. Pure extraction: the handlers are unchanged, only their names and their home.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import {
    query, requiredString, optionalString, optionalBoolean, optionalArray, optionalRecord, requiredArray,
} from './tool-call-helpers.js';

export const packageTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_package_list',
        description: 'List component packages on this node. NOT apps — see aimeat_app_list for the single-file web apps.',
        input: { query: { type: 'string', description: 'Search query.' } },
        handler: ({ client }, input) => client.get(`/v1/packages${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_package_get',
        description: 'Get one component package by its group id.',
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}`),
    },
    {
        name: 'aimeat_package_versions',
        description: 'List one component package\'s version history.',
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions`),
    },
    {
        name: 'aimeat_package_delete',
        description: 'Archive one version of a component package.',
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
        handler: ({ client }, input) => client.delete(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions/${encodeURIComponent(requiredString(input, 'version'))}`),
    },
    {
        // POST /v1/packages takes a `components` ARRAY and reads no `content` field. This handler
        // sent {name, description, content} from the day it was extracted, so every call it
        // published was answered 400 INVALID_INPUT and the tool could not succeed once.
        name: 'aimeat_package_publish',
        description: 'Publish a component package: one or more components (app, extension, cortex, translation) that install together.',
        input: {
            name: { type: 'string', required: true, description: 'Package name. With your owner name it forms the group id.' },
            description: { type: 'string', description: 'What the package is for.' },
            category: { type: 'string', description: 'Category for the package gallery.' },
            tags: { type: 'array', description: 'Tags for search.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Who may install it. Defaults to private.' },
            components: {
                type: 'array', required: true,
                description: 'The components, each { id, type: "app"|"extension"|"cortex"|"translation", label?, content, dependencies? }. At least one.',
            },
            manifest: { type: 'object', description: 'Package manifest: object types, schedules, the workspace it provisions.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {
                name: requiredString(input, 'name'),
                components: requiredArray(input, 'components'),
            };
            const description = optionalString(input, 'description');
            if (description !== undefined) body.description = description;
            const category = optionalString(input, 'category');
            if (category !== undefined) body.category = category;
            const tags = optionalArray(input, 'tags');
            if (tags !== undefined) body.tags = tags;
            const visibility = optionalString(input, 'visibility');
            if (visibility !== undefined) body.visibility = visibility;
            const manifest = optionalRecord(input, 'manifest');
            if (manifest !== undefined) body.manifest = manifest;
            return client.post('/v1/packages', body);
        },
    },
    {
        // Taking a package into use, as opposed to authoring one. A fleet daemon reaches the node
        // through this table, so without an entry here the tool exists on the other two doors and
        // not on the one an agent actually calls.
        name: 'aimeat_package_install',
        description: 'Install a component package as your own copy. Each component is registered under your identity, so what you get is yours to edit.',
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier, from aimeat_package_list.' },
            label: { type: 'string', description: 'What to call this copy, e.g. the company it is for.' },
            version: { type: 'string', description: 'A specific version. Defaults to the latest published one.' },
            dry_run: { type: 'boolean', description: 'Report what would be registered and register nothing.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const label = optionalString(input, 'label');
            if (label !== undefined) body.label = label;
            const version = optionalString(input, 'version');
            if (version !== undefined) body.version = version;
            const dryRun = optionalBoolean(input, 'dry_run');
            if (dryRun !== undefined) body.dry_run = dryRun;
            return client.post(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/install`, body);
        },
    },
];
