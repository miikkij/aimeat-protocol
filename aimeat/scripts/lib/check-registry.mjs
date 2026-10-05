/**
 * @file check-registry.mjs
 * @description Canonical read-only checks for check:fast, audit reports and SARIF.
 * @version-history
 *  - 1.15.0 (2026-10-05): check:storage-file-parity, the SQLite methods files mirror the Postgres ones (secaudit 2026-10, M8).
 *  - 1.14.0 (2026-10-05): check:single-entry, a password check, an account deletion and an operator check each through their one function.
 *  - 1.13.0 (2026-10-01): check:peer-paths, every federation peer writer and reader says on what proof.
 *  - 1.12.0 (2026-09-29): check:classification-reach, stored content reaches a caller through the classification reader.
 *  - 1.11.0 (2026-09-28): check:skill-evals, a changed skill with an eval suite waits for the developer's run-or-skip.
 *  - 1.10.0 (2026-09-26): check:migration-hashes, a migration file on main never changes.
 *  - 1.9.0 (2026-09-26): check:identity-shortening, an identity is cut to an account name only in utils/gaii.ts.
 *  - 1.8.0 (2026-09-24): check:supply-chain, the CI workflows and the local model files.
 *  - 1.7.0 (2026-09-24): check:shape-tokens, a component sheet reads the theme's shape values.
 *  - 1.6.0 (2026-09-24): check:theme-tokens, theme.css holds tokens only.
 *  - 1.5.0 (2026-09-23): check:ui-library, the component catalogue held to the sheets and modules.
 *  - 1.4.0 (2026-09-18): check:prompt-refs, agent-facing text held to the catalogue and the routes.
 *  - 1.3.0 (2026-09-14): check:field-reach, the REST-only record field ratchet.
 *  - 1.2.1 (2026-09-13): check:viewport also holds the library-packs registry to the manifests.
 *  - 1.2.0 (2026-09-13): Hold the always-loaded instruction size and every path rule's globs.
 *  - 1.1.0 (2026-09-13): Refuse new copies of the shared poster shapes.
 *  - 1.0.0 (2026-09-08): A4: share the CI check registry with audit consumers.
 */
export const FAST_CHECKS = [
    { script: 'typecheck:audit-tests', label: 'Architecture regression tests use the current typed contracts' },
    { script: 'check:docs', label: 'Documentation catalog, links, data syntax and help copies agree' },
    { script: 'check:importmap', label: 'Importmap ↔ imports in sync' },
    { script: 'check:prompt-groups', label: 'Every prompt group has a translated heading on the admin page' },
    { script: 'check:profile-tabs', label: 'Every profile tab reachable from the menu' },
    { script: 'check:crew-defs', label: 'Shipped crew definitions match the runtime\'s rules' },
    { script: 'check:config-coverage', label: 'Every setting reachable in the admin Config tab' },
    { script: 'check:no-max-tokens', label: 'No max_tokens caps on AI calls' },
    { script: 'check:openapi', label: 'openapi.yaml parses + refs resolve' },
    { script: 'check:openapi-routes', label: 'The contract and the code name the same routes' },
    { script: 'check:skill-reviews', label: 'Every skill was read against the code it describes, and that code has not changed since' },
    { script: 'check:skill-evals', label: 'A skill with an eval suite that changed has the developer\'s decision: eval run or skipped' },
    { script: 'check:app-catalog', label: 'app-catalog.html ↔ sources in sync' },
    { script: 'check:everything', label: 'everything.json ↔ docs/AIMEAT-Feature-List.md in sync' },
    { script: 'check:changelog', label: 'Landing change log parses + newest first' },
    { script: 'check:sdk', label: 'SDK-libs dist ↔ sources in sync' },
    { script: 'check:atelier', label: 'Atelier look matrix — every preset × palette × mode' },
    { script: 'check:atelier-parts', label: 'Atelier parts list ↔ the components\' own JSDoc' },
    { script: 'check:living-nodes', label: 'Living node vocabulary ↔ the node modules\' own JSDoc' },
    { script: 'check:mcp-tools', label: 'MCP tool surface/handler parity' },
    { script: 'check:mcp-schemas', label: 'MCP tool input-schema parity' },
    { script: 'check:plain-language', label: 'Plain language for the messages a person hears' },
    { script: 'check:poster-shapes', label: 'Design-language shapes live in poster.css, not in view sheets' },
    { script: 'check:ui-library', label: 'Every interface part is in the component catalogue, and its facts are fresh' },
    { script: 'check:theme-tokens', label: 'theme.css holds tokens only; every page that links it links the shell block' },
    { script: 'check:shape-tokens', label: 'A component sheet reads the theme\'s shape values, never a corner, frame, shadow or letter case of its own' },
    { script: 'check:dialogs', label: 'One dialog for the site: no hand-rolled overlay, backdrop or role="dialog" box' },
    { script: 'check:viewport', label: 'Cortex pack integrity: embed + VERSION constants + registry versions' },
    { script: 'check:ai-disclosure', label: 'AI disclosure gates: one LLM path, one publish path, labels intact' },
    { script: 'check:locales', label: 'Language files agree with en.json' },
    { script: 'check:licenses', label: 'Licences allowed, every served file accounted for' },
    { script: 'check:notices', label: 'Third-party notices match the tree' },
    { script: 'check:protocol-versions', label: 'Protocol versions declared vs current' },
    { script: 'check:supply-chain', label: 'CI and model images: third-party code runs pinned, and never beside a secret or a write token' },
    { script: 'check:route-scopes', label: 'Route authorization gates' },
    { script: 'check:denial-coverage', label: 'Every suite asks what a second principal gets' },
    { script: 'check:suite-ports', label: 'No two E2E suites write down the same port' },
    { script: 'check:outbound-fetch', label: 'Outbound fetch goes through safeFetch' },
    // 2026-10-01, after the peer-registration incident: who writes a federation peer, and who trusts
    // its url or key, each with the proof it relies on (security/peer-paths.json).
    { script: 'check:peer-paths', label: 'Every federation peer writer and reader says on what proof' },
    { script: 'check:trusted-keys', label: 'Server-trusted memory keys are guarded, and each exemption says why' },
    // From the September 2026 audit's check of the fixes: a visitor from another node is named
    // `alice@their-node`, and a cut at the '@' anywhere in src/ made it the local account `alice`.
    { script: 'check:identity-shortening', label: 'An identity is cut to an account name only by localAccountName or localAccountOf' },
    // Secaudit 2026-10, C1, C2 and C7: a security decision with a function of its own is made only
    // through it; the hand copies left are counted per file and may only fall.
    { script: 'check:single-entry', label: 'A password check, an account deletion and an operator check each go through their one function' },
    // TARGET-082: stored content reaches a caller only through a loader that takes a classification
    // reader, or through a listed read that says why it is the node's own.
    { script: 'check:classification-reach', label: 'Every content read passes the classification reader or is listed with its reason' },
    { script: 'check:storage-parity', label: 'Owner-scoped tables are in both deletion cascades' },
    // Secaudit 2026-10, M8: claimScheduledFire lived in postgres-kysely/methods/schedules.ts and in
    // sqlite/methods/federation-oauth.ts, so a fix in one provider could not find its twin.
    { script: 'check:storage-file-parity', label: 'A storage method lives in the methods file of the same name in both providers' },
    // From round 6 of the September 2026 security work: the runner records only a migration file's
    // name, so a file changed after main had it left databases with two results under one name.
    { script: 'check:migration-hashes', label: 'A migration file on main never changes, and a new one is listed in the same commit' },
    { script: 'check:ext-entrypoints', label: 'Extension sandbox entry points use the shared context builder' },
    { script: 'check:shared-impl', label: 'MCP tools call what REST calls' },
    { script: 'check:surface-focus', label: 'The v2 surfaces are still projections' },
    { script: 'check:deps', label: 'No new import cycle or layer inversion' },
    { script: 'check:sse-parity', label: 'An agent writes, and the open page hears about it' },
    { script: 'check:imports-tracked', label: 'Every relative import points at a tracked file' },
    { script: 'check:copied-logic', label: 'No decision is written out on two sides' },
    { script: 'check:doc-counts -- --strict', label: 'The counts this project states about itself' },
    { script: 'check:instructions', label: 'What every session loads stays small, and every path rule names real files' },
    { script: 'check:scope-parity', label: 'One permission word, every door' },
    // From the instruction review of 2026-09-18: production's manual documented routes deleted
    // three weeks earlier, and every structural check was green because none reads the prose.
    { script: 'check:prompt-refs', label: 'What an agent is told names only tools and routes that exist' },
    // Built on 2026-09-03 for exactly this axis and wired into nothing until 2026-09-14, when an
    // agent's company update dropped organism_id in silence: REST took the field and MCP did not.
    { script: 'check:field-reach', label: 'A record field REST can set, an agent can set too' },
    { script: 'check:liaison-surface', label: 'Published surfaces match, and neither needs a release' },
    // The whole-tree silent-exception pass, which until 2026-09-13 ran nowhere: the hook sees only
    // staged files and nothing else called it, so the three cleaned shapes were held at zero by
    // eslint alone and the fourth had no keeper at all.
    { script: 'check:silent-catch -- --strict', label: 'A caught error leaves a trace, and no file answers with more substitutes than before' },
];

// The five compiler invariants share one program and run together, outside the fast pool.
export const AUDIT_CHECKS = [...FAST_CHECKS,
    { script: 'check:invariants', label: 'Five compiler invariants (one shared TypeScript program)' }];
