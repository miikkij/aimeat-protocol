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
 *   v1.3.0 -- 2026-09-05 -- aimeat_package_status_set, because publishing was reachable on no
 *     surface at all; aimeat_package_list gains the parameters the route actually reads (its `query`
 *     was sent as ?q= and the route reads ?search=, so the filter was dropped in silence).
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
        input: {
            search: { type: 'string', description: 'Optional search over name, description and tags.' },
            author: { type: 'string', description: 'Only this author\'s packages. Your own name also shows your private ones.' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Defaults to published.' },
        },
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
        // Authoring a package by hand meant pasting every app's source, naming its cortexes and
        // getting the dependency order right, which is why the only packages on a node were the ones
        // it seeds itself. The node already knows what each app loads, so the caller names apps.
        name: 'aimeat_package_compose',
        description: 'Make a package out of apps you already published, with the cortexes they load. Names what the installing node must supply itself.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Package name. With your owner name it forms the group id.' },
            apps: { type: 'array', required: true, description: 'Filenames of your own apps, e.g. ["shop.html", "admin.html"]. At least one.' },
            description: { type: 'string', description: 'What the package is for.' },
            category: { type: 'string', description: 'Category for the package gallery.' },
            tags: { type: 'array', description: 'Tags for search.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Who may install it. Defaults to private.' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Defaults to published, so you can install it at once.' },
            include_cortex: { type: 'boolean', description: 'Package the cortexes you installed yourself. Default true. Node-shipped cortexes are never packaged.' },
            allow_expectations: { type: 'boolean', description: 'Compose even when an app calls an extension the package cannot carry, recording it as a requirement instead.' },
        },
    },
    {
        // Publishing was unreachable. A package is created private and, until this tool existed, the
        // only way to move it between draft, published and archived was PATCH
        // /v1/packages/{group}/versions/{version} — a door no MCP or CLI surface carried. So an agent
        // could author a package and then neither see it (the list and get doors read published) nor
        // install it (install refuses anything else).
        name: 'aimeat_package_status_set',
        description: 'Move one package version between draft, published and archived. Only the author may.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier.' },
            version: { type: 'string', description: 'Which version. Defaults to the latest one.' },
            status: { type: 'string', required: true, enum: ['draft', 'published', 'archived'], description: 'The status to set.' },
        },
    },
    {
        // Bringing a package in from another node. Idempotent on purpose, so the same call is both
        // "install that one from over there" and "bring me the newer one": a source that has nothing
        // newer answers applied:false rather than an error.
        name: 'aimeat_package_pull',
        description: 'Bring a package published on another node onto this one, verifying that node\'s signature and every component digest before anything is written.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'The package on the other node, e.g. "signage::alice".' },
            node_id: { type: 'string', description: 'A peer this node knows. Its address and key are read from the peer record.' },
            source_url: { type: 'string', description: 'A node that is not a peer. Operator only, and only with trust:"tofu".' },
            trust: { type: 'string', enum: ['tofu'], description: 'Accept and pin the key that node publishes. Needed only with source_url.' },
            version: { type: 'string', description: 'A specific version. Defaults to the latest one published there.' },
        },
    },
    {
        // Updating a whole installed package in one act. The per-component migration road still
        // exists and is what a component the owner EDITED goes through; this one moves everything
        // that can move safely and names the rest.
        name: 'aimeat_package_update',
        description: 'Update a whole installed package to its latest version. Parts you have edited are left untouched and reported, never overwritten.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            instance_id: { type: 'string', required: true, description: 'The installed copy, from the instances list.' },
            dry_run: { type: 'boolean', description: 'Report what would change and change nothing.' },
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
