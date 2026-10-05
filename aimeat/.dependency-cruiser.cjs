/**
 * @file .dependency-cruiser.cjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layering rules of this codebase, as rules rather than as prose.
 *
 *   WHY A TOOL RATHER THAN ANOTHER SCRIPT. Three of the eight custom ESLint rules in eslint-rules/
 *   are import-boundary rules written by hand: no-storage-in-mcp, no-express-in-service and
 *   no-adhoc-extension-ctx. Each is about a hundred lines of AST walking to answer "may this file
 *   reach that one", which is the one question a dependency graph answers for free. Those rules stay
 *   where they are — they carry seeded exemption lists and they report inside the editor, which this
 *   does not — and what goes here is what they cannot see: layer direction across the whole tree,
 *   import cycles, and modules nothing reaches.
 *
 *   WHAT IS DELIBERATELY NOT HERE. The extension, cortex and app namespaces are a RUNTIME boundary:
 *   an app calls a cortex method through `AIMEAT.data`, which is a global at run time and not an
 *   import, so no import graph can see the rule. public/ is out of scope for the same kind of reason
 *   — it has no build step and resolves its own absolute paths through the importmap in spa.html,
 *   which check:importmap already reads.
 * @structure forbidden — one rule per boundary, each with the comment that says what it protects
 * @usage
 *   cd aimeat && pnpm check:deps          # the gate
 *   cd aimeat && pnpm deps:graph          # the same graph as an SVG, to look at
 * @version-history
 *   v1.1.0 — 2026-10-05 — The exclude is anchored, so the connector's MCP tools are read; four layer
 *     rules (services and mcp do not import routes, services do not import mcp, mcp does not import
 *     the cli) with today's edges in the baseline; a warning for a server module src/index.ts never
 *     reaches (secaudit 2026-10, M1). tool-catalog-is-a-bottom-layer: the catalog moved from
 *     src/mcp/catalog/ to src/tool-catalog/ and imports nothing above utils/ (M4).
 *   v1.0.0 — 2026-09-04 — Initial.
 */
module.exports = {
    forbidden: [
        {
            name: 'shared-dispatch-has-no-cli-runtime',
            comment: 'Credential stores and shell setup belong to the CLI adapter, not node dispatch.',
            severity: 'error',
            from: { path: '^src/(tool-dispatch/|services/node-(invoke|capabilities)[.]ts$)' },
            to: { path: '^src/(cli|routes)/', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'manifest-is-transport-independent',
            comment: 'The shared extension builder belongs below routes and CLI adapters.',
            severity: 'error',
            from: { path: '^src/services/extension-manifest[.]ts$' },
            to: { path: '^src/(routes|cli|mcp)/', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'no-circular',
            comment:
                'A cycle means neither module can be understood, tested or moved without the other. '
                + 'Nothing in this repo checked for one before 2026-09-04.',
            severity: 'error',
            from: { path: '^src' },
            to: { circular: true },
        },
        {
            name: 'storage-is-the-bottom',
            comment:
                'The storage layer answers questions and never asks the layers above it one. A '
                + 'provider that reaches back into a route or a service cannot be swapped, which is '
                + 'the whole point of having two of them.',
            severity: 'error',
            from: { path: '^src/storage' },
            to: {
                path: '^src/(routes|services|mcp|cli)',
                // A type crosses no layer at run time: `import type { AppAiPosture }` compiles away,
                // and moving those two shapes out of services/ would be a rename with no behaviour in
                // it. What this rule is for is a storage provider importing a FUNCTION from above,
                // which is a decision living in the wrong layer.
                dependencyTypesNot: ['type-only'],
            },
        },
        {
            name: 'service-takes-the-caller-not-the-request',
            comment:
                'A service takes the caller, not an Express request, so a second surface can call it. '
                + 'This is the import half of eslint-rules/no-express-in-service.js: that rule reads '
                + 'the parameter types, this one refuses the import that makes them reachable.',
            severity: 'error',
            from: { path: '^src/services', pathNot: 'src/services/(extension-ctx|http)' },
            to: { dependencyTypes: ['npm'], path: '^express$' },
        },
        {
            name: 'routes-do-not-import-the-cli',
            comment:
                'The CLI is a client of this node, not a part of it: it talks over HTTP and MCP like '
                + 'any other agent. A route reaching into src/cli means a capability exists on one '
                + 'road and not the other, which is the drift check:mcp-tools was written for.',
            severity: 'error',
            from: { path: '^src/routes' },
            to: { path: '^src/cli' },
        },
        {
            name: 'services-do-not-import-routes',
            comment:
                'A service is what every surface calls; a route is one surface. A service reaching '
                + 'into a route makes the other surfaces depend on HTTP code (secaudit 2026-10, M1). '
                + 'Today\'s edges are the known-violations baseline and may only shrink.',
            severity: 'error',
            from: { path: '^src/services' },
            to: { path: '^src/routes', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'services-do-not-import-mcp',
            comment: 'The same direction for the MCP surface (secaudit 2026-10, M1).',
            severity: 'error',
            from: { path: '^src/services' },
            to: { path: '^src/mcp', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'mcp-does-not-import-routes',
            comment:
                'An MCP tool calls the service a route calls, never the route (one capability, one '
                + 'implementation; .claude/rules/backend.md). Secaudit 2026-10, M1.',
            severity: 'error',
            from: { path: '^src/mcp' },
            to: { path: '^src/routes', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'mcp-does-not-import-the-cli',
            comment:
                'The CLI is a client of this node. The node\'s MCP surface reaching into it means a '
                + 'capability lives in the client (secaudit 2026-10, M1; mcp/contacts.ts did, through a shim).',
            severity: 'error',
            from: { path: '^src/mcp' },
            to: { path: '^src/cli', dependencyTypesNot: ['type-only'] },
        },
        {
            name: 'no-orphans',
            comment:
                'A module nothing imports is either dead or was meant to be wired up and never was. '
                + 'Warn rather than error: a type-only module and an entry point both read as orphans.',
            severity: 'warn',
            from: {
                orphan: true,
                pathNot: [
                    '[.]d[.]ts$',
                    '^src/index[.]ts$',
                    '^src/types/',
                ],
            },
            to: {},
        },
        {
            name: 'tool-catalog-is-a-bottom-layer',
            comment:
                'The tool catalog (names, descriptions, input shapes, scopes) is read by the node MCP, '
                + 'the connector and the shared dispatch, so it imports nothing above utils/: a catalog '
                + 'that imports a service drags that service into the CLI (secaudit 2026-10, M4). It '
                + 'lived under src/mcp/ until 2026-10-05.',
            severity: 'error',
            from: { path: '^src/tool-catalog/' },
            to: {
                path: '^src/(routes|services|mcp|cli|storage|auth|tool-dispatch|commerce|middleware)/',
                // The data map's spec string: a leaf that imports one type and nothing else.
                pathNot: '^src/services/data-map/data-map-types[.]ts$',
                dependencyTypesNot: ['type-only'],
            },
        },
        {
            name: 'reachable-from-the-node',
            comment:
                'A server module the node never loads from src/index.ts is dead or wired by a path no '
                + 'graph sees (a dynamic import with a computed name). no-orphans misses a module that '
                + 'is imported only by other unreachable modules, such as a forwarding file nobody '
                + 'loads (secaudit 2026-10, M1). The CLI, the browser bundles and the type files have '
                + 'entry points of their own.',
            severity: 'warn',
            from: { path: '^src/index[.]ts$' },
            to: {
                path: '^src/',
                pathNot: ['^src/(cli|static|types|generated)/', '/__tests__/', '[.]d[.]ts$', '^src/index[.]ts$'],
                reachable: false,
            },
        },
        {
            name: 'not-to-dev-dep',
            comment:
                'Production code importing a devDependency: it works locally and is missing from the '
                + 'published package, where it fails on the first request that reaches the line.',
            severity: 'error',
            from: { path: '^src', pathNot: '[.]spec[.]ts$|[.]test[.]ts$' },
            to: { dependencyTypes: ['npm-dev'] },
        },
        {
            name: 'no-deprecated-core',
            comment: 'A Node core module that Node itself has deprecated.',
            severity: 'error',
            from: {},
            to: { dependencyTypes: ['core'], path: '^(punycode|domain|constants|sys|_linklist|_stream_wrap)$' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        // Anchored: the unanchored form `(^|/)(test|tools|scripts)/` also matched
        // src/cli/connect/mcp/tools/, so 58 connector tool files were never read (secaudit 2026-10, M1).
        exclude: { path: '^(test|tools|scripts)/' },
        tsConfig: { fileName: 'tsconfig.json' },
        tsPreCompilationDeps: true,
        enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
        reporterOptions: {
            dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
            archi: { collapsePattern: '^(src/[^/]+)' },
        },
    },
};
