/**
 * @file cli/connect/tool-call-defs-packages.ts
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
 *   v1.0.0 -- 2026-08-16 -- Split out of tool-call-defs-apps.ts when the app tools were pointed back
 *     at apps. Pure extraction: the handlers are unchanged, only their names and their home.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString } from './tool-call-helpers.js';

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
        name: 'aimeat_package_publish',
        description: 'Publish a component package.',
        input: {
            name: { type: 'string', required: true, description: 'Package name.' },
            description: { type: 'string', required: true, description: 'Package description.' },
            content: { type: 'string', required: true, description: 'Package content.' },
        },
        handler: ({ client }, input) => client.post('/v1/packages', {
            name: requiredString(input, 'name'),
            description: requiredString(input, 'description'),
            content: requiredString(input, 'content'),
        }),
    },
];
