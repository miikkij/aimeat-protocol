/**
 * @file mcp/catalog/definitions/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for the component-package tools (/v1/packages).
 *
 *   These are NOT the single-file web apps. Until 2026-08-16 the aimeat_app_* tools on both
 *   connector doors pointed at /v1/packages while the same names on the node's MCP meant /v1/apps,
 *   so an agent on a fleet daemon could not reach a single real app: told to list apps it got four
 *   ::system example packages, told to publish an app it created a package with no app address.
 *   Measured on production that day: 50 apps, 4 packages.
 * @structure packagesTools[] -- catalog entries, folded into definitions.ts
 * @usage import { packagesTools } from './packages.js';
 * @version-history
 *   v1.2.0 -- 2026-08-23 -- aimeat_package_install: taking a package into use was reachable over
 *     HTTP and nowhere else, so a conversation could name a package and not install it.
 *   v1.1.0 -- 2026-08-23 -- aimeat_package_publish declared {name, description, content} while
 *     POST /v1/packages requires a `components` array and never reads `content`, so every call the
 *     catalog described was answered 400 INVALID_INPUT. The entry now says what the route takes.
 *   v1.0.0 -- 2026-08-16 -- Split out when the app tools were pointed back at apps.
 */
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const packagesTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_package_list',
        description: 'List component packages on this node. These are NOT the single-file web apps — for those use aimeat_app_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_package_get',
        description: 'Get one component package by its group id.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
    },
    {
        name: 'aimeat_package_versions',
        description: "List one component package's version history.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
    },
    {
        name: 'aimeat_package_delete',
        description: 'Archive one version of a component package.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
    },
    {
        name: 'aimeat_package_publish',
        description: 'Publish a component package: one or more components (app, extension, cortex, translation) that install together.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Package name. With the author it forms the group id, e.g. "company-brain::alice".' },
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
    },
    {
        // Taking a package into use, as opposed to authoring one. It is the step a conversation
        // reaches for by name ("install the company brain"), and until 2026-08-23 it existed on the
        // HTTP route alone, so an agent could list a package and not install it.
        name: 'aimeat_package_install',
        description: 'Install a component package as your own copy. Each component is registered under your identity, so what you get is yours to edit.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier, from aimeat_package_list.' },
            label: { type: 'string', description: 'What to call this copy, e.g. the company it is for.' },
            version: { type: 'string', description: 'A specific version. Defaults to the latest published one.' },
            dry_run: { type: 'boolean', description: 'Report what would be registered and register nothing.' },
        },
    },
];
