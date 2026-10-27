/**
 * @file check-registry.mjs
 * @description Canonical read-only checks for check:fast, audit reports and SARIF.
 * @version-history
 *  - 2026-10-27: check:string-bounds (every Zod string bounded, zero allowed) and check:write-validation (writing routes read their body through a schema; seeded ratchet).
 *  - 2026-10-23: check:unbounded-lists also refuses a Postgres take-first read without LIMIT 1 (aimeat.io stalled on one that day).
 *  - 2026-10-20: check:unbounded-lists (QA audit P7-10) and check:storage-conformance (P4-09), two ratchets seeded from today's code.
 *  - 2026-10-20: check:unit-ports, a unit test uses port 0 and never a fixed one (three red CI runs in the week from 2026-10-12).
 *  - 2026-10-18: check:atomic-writes, a read of a record followed by an unconditional write of the same key.
 *  - 2026-10-18: check:browser-libs, the two browser client libraries' route parameters as a shrink-only list.
 *  - 2026-10-18: check:python-shapes and check:python-daemon, the Python package against the node's schemas and the connector.
 *  - 2026-10-18: check:audience-badge, every view that shows the owner their content draws the AudienceBadge (plan doc-mvcn6c7e4e5q, V6.4).
 *  - 2026-10-16: check:posture-defaults (invariants 8 and 10) and check:own-node-backend (a suite's own node follows the run's backend) (QA audit S10-05, P1-02).
 *  - 1.20.0 (2026-10-16): check:mcp-test-calls, the ratchet on catalog MCP tools no E2E suite calls (QA audit W27); check:denial-coverage also asks every authenticated route for a refusal test (W29, P3-08).
 *  - 1.19.1 (2026-10-16): check:silent-catch's label names what it now holds: src/static per file and per shape, and every exemption counted with its reason (W25).
 *  - 1.19.0 (2026-10-11): check:doc-links, a served string never sends its reader to a repository docs/ file.
 *  - 1.18.0 (2026-10-11): lint, the pre-commit hook's cached ESLint, so the 800-line file limit refuses the gate and not only the commit after it.
 *  - 1.17.0 (2026-10-11): check:package-scripts, every package.json script points at a tracked file and an existing script.
 *  - 1.16.0 (2026-10-11): check:config-tab, the admin Config tab against the schema, the English locale and the code that reads the settings.
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
    { script: 'check:config-tab', label: 'The Config tab: every section indexed, every setting named and read, lists and numbers consistent' },
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
    // Wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille (2026-10-18): the Python
    // package and the connector are written twice, and nothing compared them.
    { script: 'check:python-shapes', label: 'The Python offer and signal builders name every node schema field, or the difference is listed; the pytest fixture is fresh' },
    { script: 'check:python-daemon', label: 'The Python daemon and aimeat connect agree on loopback routes, node REST routes and MCP tool names, or the difference is listed' },
    { script: 'check:browser-libs', label: 'The portal services and the app libraries call no new route with different parameters; the list only shrinks' },
    { script: 'check:plain-language', label: 'Plain language for the messages a person hears' },
    { script: 'check:poster-shapes', label: 'Design-language shapes live in poster.css, not in view sheets' },
    { script: 'check:ui-library', label: 'Every interface part is in the component catalogue, and its facts are fresh' },
    { script: 'check:theme-tokens', label: 'theme.css holds tokens only; every page that links it links the shell block' },
    { script: 'check:shape-tokens', label: 'A component sheet reads the theme\'s shape values, never a corner, frame, shadow or letter case of its own' },
    { script: 'check:dialogs', label: 'One dialog for the site: no hand-rolled overlay, backdrop or role="dialog" box' },
    { script: 'check:viewport', label: 'Cortex pack integrity: embed + VERSION constants + registry versions' },
    { script: 'check:ai-disclosure', label: 'AI disclosure gates: one LLM path, one publish path, labels intact' },
    // Plan doc-mvcn6c7e4e5q, V6.4: each view printed its kind's stored word for who can read a thing.
    { script: 'check:audience-badge', label: 'Every view that shows the owner their content says who can read it with the AudienceBadge' },
    { script: 'check:locales', label: 'Language files agree with en.json' },
    { script: 'check:licenses', label: 'Licences allowed, every served file accounted for' },
    { script: 'check:notices', label: 'Third-party notices match the tree' },
    { script: 'check:protocol-versions', label: 'Protocol versions declared vs current' },
    { script: 'check:supply-chain', label: 'CI and model images: third-party code runs pinned, and never beside a secret or a write token' },
    { script: 'check:route-scopes', label: 'Route authorization gates' },
    { script: 'check:denial-coverage', label: 'Every suite asks what a second principal gets, and every authenticated route has a refusal test' },
    // QA audit 2026-10, W27: 138 of 431 catalog MCP tools were named by no E2E suite, so a handler's
    // own access check could be removed with every suite green. The list may only shrink.
    { script: 'check:mcp-test-calls', label: 'Every MCP tool is called by an E2E suite, or listed with a reason; the list only shrinks' },
    { script: 'check:suite-ports', label: 'No two E2E suites write down the same port' },
    { script: 'check:unit-ports', label: 'No unit test listens on, connects to or names as dead a fixed port' },
    // Wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli (2026-10-27): about 370
    // Zod strings had no length limit, and 46 of about 790 writing routes checked their body by schema.
    { script: 'check:string-bounds', label: 'Every Zod string under src/ has a length limit from models/input-limits.ts' },
    { script: 'check:write-validation', label: 'Every writing route that reads a body checks it with a schema, or is listed; the list only shrinks' },
    { script: 'check:unbounded-lists', label: 'No new storage list without a bound, no new whole-table read, and no Postgres take-first read without LIMIT 1; the list only shrinks' },
    { script: 'check:storage-conformance', label: 'No new storage repository without a two-provider case, and the methods those cases call only rise' },
    { script: 'check:outbound-fetch', label: 'Outbound fetch goes through safeFetch' },
    // 2026-10-01, after the peer-registration incident: who writes a federation peer, and who trusts
    // its url or key, each with the proof it relies on (security/peer-paths.json).
    { script: 'check:peer-paths', label: 'Every federation peer writer and reader says on what proof' },
    // QA audit 2026-10-16, S10-05: invariants 8 and 10 had no check, and .env.example, the code
    // defaults and the start-up self-check disagreed in four places.
    { script: 'check:posture-defaults', label: '.env.example, the code defaults and the start-up self-check agree; the default agent scopes hold no powerful scope' },
    // QA audit 2026-10-16, P1-02 and W11: a suite's own node follows the run's backend, and the
    // suites that still start a SQLite node of their own are counted and may only fall.
    { script: 'check:own-node-backend', label: 'A suite that starts its own node follows the run\'s backend, or is listed with its reason' },
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
    // Wish wish-tarkistus-ei-atomiselle-kirjoitukselle-uudessa-koodissa (2026-10-18): the version
    // condition existed and new code wrote without it, sixteen times, most on money routes.
    { script: 'check:atomic-writes', label: 'No code reads a record and writes the same key back without a version condition, beyond the listed ones; the list only shrinks' },
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
    { script: 'check:package-scripts', label: 'Every package.json script points at a tracked file and an existing script' },
    // The pre-commit hook's own lint, cached. Without it a file past the 800-line limit passed the
    // gate and was refused at the commit that followed, twice on 2026-10-11.
    { script: 'lint', label: 'ESLint as the pre-commit hook runs it: the 800-line file limit and every other lint error' },
    { script: 'check:copied-logic', label: 'No decision is written out on two sides' },
    { script: 'check:doc-counts -- --strict', label: 'The counts this project states about itself' },
    { script: 'check:instructions', label: 'What every session loads stays small, and every path rule names real files' },
    { script: 'check:scope-parity', label: 'One permission word, every door' },
    // From the instruction review of 2026-09-18: production's manual documented routes deleted
    // three weeks earlier, and every structural check was green because none reads the prose.
    { script: 'check:prompt-refs', label: 'What an agent is told names only tools and routes that exist' },
    // From the docs audit of 2026-10-11: the handbooks, a tool description, the Boards page and the
    // connect prompt sent their reader to repository docs/ files no route serves.
    { script: 'check:doc-links', label: 'Served text links no repository file the node does not serve' },
    // Built on 2026-09-03 for exactly this axis and wired into nothing until 2026-09-14, when an
    // agent's company update dropped organism_id in silence: REST took the field and MCP did not.
    { script: 'check:field-reach', label: 'A record field REST can set, an agent can set too' },
    { script: 'check:liaison-surface', label: 'Published surfaces match, and neither needs a release' },
    // The whole-tree silent-exception pass, which until 2026-09-13 ran nowhere: the hook sees only
    // staged files and nothing else called it, so the three cleaned shapes were held at zero by
    // eslint alone and the fourth had no keeper at all.
    { script: 'check:silent-catch -- --strict', label: 'A caught error leaves a trace: no file holds more silent handlers or exemptions than before, src/static included, and every exemption gives its reason' },
];

// The five compiler invariants share one program and run together, outside the fast pool.
export const AUDIT_CHECKS = [...FAST_CHECKS,
    { script: 'check:invariants', label: 'Five compiler invariants (one shared TypeScript program)' }];
