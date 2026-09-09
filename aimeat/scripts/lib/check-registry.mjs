/**
 * @file check-registry.mjs
 * @description Canonical read-only checks for check:fast, audit reports and SARIF.
 * @version-history
 *  - 1.0.0 (2026-09-08): A4: share the CI check registry with audit consumers.
 */
export const FAST_CHECKS = [
    { script: 'check:importmap', label: 'Importmap ↔ imports in sync' },
    { script: 'check:prompt-groups', label: 'Every prompt group has a translated heading on the admin page' },
    { script: 'check:profile-tabs', label: 'Every profile tab reachable from the menu' },
    { script: 'check:crew-defs', label: 'Shipped crew definitions match the runtime\'s rules' },
    { script: 'check:config-coverage', label: 'Every setting reachable in the admin Config tab' },
    { script: 'check:no-max-tokens', label: 'No max_tokens caps on AI calls' },
    { script: 'check:openapi', label: 'openapi.yaml parses + refs resolve' },
    { script: 'check:app-catalog', label: 'app-catalog.html ↔ sources in sync' },
    { script: 'check:changelog', label: 'Landing change log parses + newest first' },
    { script: 'check:sdk', label: 'SDK-libs dist ↔ sources in sync' },
    { script: 'check:atelier', label: 'Atelier look matrix — every preset × palette × mode' },
    { script: 'check:atelier-parts', label: 'Atelier parts list ↔ the components\' own JSDoc' },
    { script: 'check:living-nodes', label: 'Living node vocabulary ↔ the node modules\' own JSDoc' },
    { script: 'check:mcp-tools', label: 'MCP tool surface/handler parity' },
    { script: 'check:mcp-schemas', label: 'MCP tool input-schema parity' },
    { script: 'check:plain-language', label: 'Plain language for the messages a person hears' },
    { script: 'check:viewport', label: 'Cortex pack integrity: embed + VERSION constants' },
    { script: 'check:ai-disclosure', label: 'AI disclosure gates: one LLM path, one publish path, labels intact' },
    { script: 'check:locales', label: 'Language files agree with en.json' },
    { script: 'check:licenses', label: 'Licences allowed, every served file accounted for' },
    { script: 'check:notices', label: 'Third-party notices match the tree' },
    { script: 'check:protocol-versions', label: 'Protocol versions declared vs current' },
    { script: 'check:route-scopes', label: 'Route authorization gates' },
    { script: 'check:denial-coverage', label: 'Every suite asks what a second principal gets' },
    { script: 'check:outbound-fetch', label: 'Outbound fetch goes through safeFetch' },
    { script: 'check:trusted-keys', label: 'Server-trusted memory keys are guarded, and each exemption says why' },
    { script: 'check:storage-parity', label: 'Owner-scoped tables are in both deletion cascades' },
    { script: 'check:ext-entrypoints', label: 'Extension sandbox entry points use the shared context builder' },
    { script: 'check:shared-impl', label: 'MCP tools call what REST calls' },
    { script: 'check:surface-focus', label: 'The v2 surfaces are still projections' },
    { script: 'check:deps', label: 'No new import cycle or layer inversion' },
    { script: 'check:sse-parity', label: 'An agent writes, and the open page hears about it' },
    { script: 'check:imports-tracked', label: 'Every relative import points at a tracked file' },
    { script: 'check:copied-logic', label: 'No decision is written out on two sides' },
    { script: 'check:doc-counts -- --strict', label: 'The counts this project states about itself' },
    { script: 'check:scope-parity', label: 'One permission word, every door' },
    { script: 'check:liaison-surface', label: 'Published surfaces match, and neither needs a release' },
];

// The five compiler invariants share one program and run together, outside the fast pool.
export const AUDIT_CHECKS = [...FAST_CHECKS,
    { script: 'check:invariants', label: 'Five compiler invariants (one shared TypeScript program)' }];
