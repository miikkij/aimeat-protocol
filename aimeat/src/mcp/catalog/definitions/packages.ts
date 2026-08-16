/**
 * @file mcp/catalog/definitions/packages.ts
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
        description: 'Publish a component package.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Package name.' },
            description: { type: 'string', required: true, description: 'Package description.' },
            content: { type: 'string', required: true, description: 'Package content.' },
        },
    },
];
