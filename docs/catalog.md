# Documentation catalog

Reviewed against repository commit `b26f00157` and its documentation cleanup on 2026-09-16.
The original inventory contained **208 tracked files**. This catalog also includes the new entry
points and maintenance files. Gitignored local files, including private testing instructions,
are outside this public inventory and were preserved.

## Result

- Keep current guides and specs, with the corrections recorded in this change.
- Preserve runtime assets in their loader paths. There is one CSM template set, `aimeat/docs/csm-examples`; the unloaded root copy was removed on 2026-10-11.
- Treat external integrations and provider reports as dated references.
- Plans, design specs and build notes live on the node, in the AIMEAT development organism. The
  `archive/` folder of 45 plans and test outlines was removed on 2026-10-11 (ruling D6); git history
  keeps every file. A file kept here as history carries a history notice at its top.
- Guidance written for an AI is a built-in skill every node serves (`aimeat_skill_get`), not a file
  here. A repository file that moved keeps a short pointer only where outside links may reach it.
- Use [maintenance.md](maintenance.md) for status meanings, review triggers and check limits.

“Maintained” means the file belongs to the active documentation set. It does not mean
that every example has been executed or every external or legal statement revalidated.
The source column identifies the implementation or rule to read at the next change.
`pnpm check:docs` checks structure and inventory, not semantic correctness.

## Files

| File | Status | Purpose and validity | Check against |
|---|---|---|---|
| [aimeat/docs/AIMEAT_Help_Prompt.md](../aimeat/docs/AIMEAT_Help_Prompt.md) | runtime | Served help prompt; root and packaged copies must agree; every route checked against openapi.yaml on 2026-10-11 | `aimeat/src/routes/bootstrap.ts` |
| [aimeat/docs/AIMEAT_Help_Prompt_Person.md](../aimeat/docs/AIMEAT_Help_Prompt_Person.md) | runtime | Served person help prompt; root and packaged copies must agree | `aimeat/src/routes/bootstrap.ts` |
| [aimeat/docs/README.md](../aimeat/docs/README.md) | entry | What the package's docs/ folder carries and why AI guidance is a built-in skill instead; checked 2026-10-11 | `aimeat/scripts/copy-dist-assets.mjs` |
| [aimeat/docs/configuration-guide.md](../aimeat/docs/configuration-guide.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [aimeat/docs/csm-bundles/README.md](../aimeat/docs/csm-bundles/README.md) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/decision.csm.yaml](../aimeat/docs/csm-bundles/project/decision.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/deliverable.csm.yaml](../aimeat/docs/csm-bundles/project/deliverable.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/goal.csm.yaml](../aimeat/docs/csm-bundles/project/goal.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/manifest.template.json](../aimeat/docs/csm-bundles/project/manifest.template.json) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/plan.csm.yaml](../aimeat/docs/csm-bundles/project/plan.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/resource.csm.yaml](../aimeat/docs/csm-bundles/project/resource.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-examples/auction.csm.yaml](../aimeat/docs/csm-examples/auction.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; no economy block, no morsel fee; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/dating-directory.csm.yaml](../aimeat/docs/csm-examples/dating-directory.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/hobby-directory.csm.yaml](../aimeat/docs/csm-examples/hobby-directory.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/marketplace.csm.yaml](../aimeat/docs/csm-examples/marketplace.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; no economy block, no morsel fee; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/news-feed.csm.yaml](../aimeat/docs/csm-examples/news-feed.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/opinion-board.csm.yaml](../aimeat/docs/csm-examples/opinion-board.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/csm-examples/video-directory.csm.yaml](../aimeat/docs/csm-examples/video-directory.csm.yaml) | runtime | Seed template served at /v1/csm/templates; every stated limit reaches the locked schema; checked 2026-10-11 | `aimeat/test/unit/csm-template-limits.test.ts` |
| [aimeat/docs/observability-guide.md](../aimeat/docs/observability-guide.md) | reference | Observability setup reference; check installed instrumentation and deployment | `aimeat/src` |
| [docs/AIMEAT-Feature-List.md](AIMEAT-Feature-List.md) | maintained | Generated feature index; update through its generator | `aimeat/scripts/build-everything.ts` |
| [docs/AIMEAT-RFC-v4.0-Core-full.md](AIMEAT-RFC-v4.0-Core-full.md) | reference | Core v4.0 as published; known errata in the errata file; replaced by AIMEAT Core 2026-11 with node 4.0.0 | `docs/AIMEAT-RFC-v4.0-errata.md` |
| [docs/AIMEAT-RFC-v4.0-Platform-full.md](AIMEAT-RFC-v4.0-Platform-full.md) | reference | Platform v4.0 as published; known errata in the errata file; to be replaced by a Platform reference versioned with the node | `docs/AIMEAT-RFC-v4.0-errata.md` |
| [docs/AIMEAT-RFC-v4.0-errata.md](AIMEAT-RFC-v4.0-errata.md) | maintained | Known errata and pending changes in RFC v4.0, checked against node 3.26.1 on 2026-10-11 | `openapi.yaml` |
| [docs/AIMEAT_Help_Prompt.md](AIMEAT_Help_Prompt.md) | runtime | Served help prompt; root and packaged copies must agree; every route checked against openapi.yaml on 2026-10-11 | `aimeat/src/routes/bootstrap.ts` |
| [docs/AIMEAT_Help_Prompt_Person.md](AIMEAT_Help_Prompt_Person.md) | runtime | Help prompt a person pastes into a consumer AI, served at /v1/help/prompt/person; root and packaged copies must agree | `aimeat/src/routes/bootstrap.ts` |
| [docs/README.md](README.md) | entry | Navigation to the maintained guide or current contract; plans and build notes live on the node; checked 2026-10-11 | `docs/catalog.md` |
| [docs/a-endpoints.md](a-endpoints.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/agent-workspace-contracts.md](agent-workspace-contracts.md) | entry | Pointer: the guide is the built-in skill aimeat-workspace-contracts; kept because the RFC, the changelog and the crewai package cite this path; checked 2026-10-11 | `aimeat/src/data/builtin-skills.workspace-contracts.ts` |
| [docs/ai-transparency.md](ai-transparency.md) | maintained | Implementation disclosure; private research links removed, legal analysis not revalidated | `aimeat/src/services` |
| [docs/aimeat-cross-federation.md](aimeat-cross-federation.md) | maintained | Actual peer routes, permissions and cache settings; settings table checked against `aimeat/src/config.ts` on 2026-10-11 | `aimeat/src/routes/federation-genesis.ts` |
| [docs/aimeat-dmz-architecture.md](aimeat-dmz-architecture.md) | maintained | Memory visibility model and consent boundaries in node 3.26, checked on 2026-10-11; normative content moves to AIMEAT Core 2026-11 | `aimeat/src/services/consent.ts` |
| [docs/aimeat-eudiw-integration.md](aimeat-eudiw-integration.md) | maintained | Wallet verification is blocked at startup; route existence is not support | `aimeat/src/config-eudiw-guard.ts` |
| [docs/aimeat-interest-profile-spec.md](aimeat-interest-profile-spec.md) | reference | Interest-profile format reference; check schema before a new integration | `aimeat/src/models` |
| [docs/aimeat-pwa-guide.md](aimeat-pwa-guide.md) | maintained | Offline fallback, share intake and push behavior | `aimeat/public/sw.js` |
| [docs/aimeat-semantic-ontology.md](aimeat-semantic-ontology.md) | reference | Semantic vocabulary reference; not proof every annotation is enforced | `aimeat/src/services/csm-parser.ts` |
| [docs/aimeat-vc-spec.md](aimeat-vc-spec.md) | maintained | Actual credential payload and authority; no conformance claim | `aimeat/src/services/vc-issuer.ts` |
| [docs/app-developer-ai-guide.md](app-developer-ai-guide.md) | entry | Pointer: the guide is part of the built-in skill aimeat-ai-capabilities; kept because README.md and the Feature List link this path; checked 2026-10-11 | `aimeat/src/data/builtin-skills.ai-capabilities.ts` |
| [docs/b-config.md](b-config.md) | maintained | Effective configuration and operator settings | `aimeat/src/config.ts` |
| [docs/building-an-aimeat-compatible-agent.md](building-an-aimeat-compatible-agent.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/building-an-aimeat-compatible-ecosystem-app.md](building-an-aimeat-compatible-ecosystem-app.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/c-platform-notes.md](c-platform-notes.md) | maintained | What each kind of AI client can do with a node; per-tool setup is GET /v1/ai-tools; checked 2026-10-11 | `aimeat/src/services/ai-tool-setup.ts` |
| [docs/catalog.md](catalog.md) | maintained | Complete tracked-file inventory for both documentation trees | `aimeat/scripts/check-docs.mjs` |
| [docs/coding-guidelines/README.md](coding-guidelines/README.md) | entry | Index of the development guides and the verification commands; plans live on the node; checked 2026-10-11 | `aimeat/scripts/gate.ts` |
| [docs/coding-guidelines/agent-tags.md](coding-guidelines/agent-tags.md) | maintained | Agent tags, the five modes and run mode, and who may set them; checked 2026-10-11 | `aimeat/src/routes/agents/profile-metadata.ts` |
| [docs/coding-guidelines/architecture.md](coding-guidelines/architecture.md) | maintained | Subsystem map: where routes, services, storage and the SPA live, and how routes are mounted; checked 2026-10-11 | `aimeat/src/server-bootstrap/routes-loader.ts` |
| [docs/coding-guidelines/code-style.md](coding-guidelines/code-style.md) | maintained | TypeScript and route conventions: envelope, router factory, caller object, imports; checked 2026-10-11 | `aimeat/src/middleware/envelope.ts` |
| [docs/coding-guidelines/dependency-management.md](coding-guidelines/dependency-management.md) | maintained | Adding a dependency: licence check, overrides, vendored libraries, audits; checked 2026-10-11 | `aimeat/scripts/check-licenses.ts` |
| [docs/coding-guidelines/environment-configs.md](coding-guidelines/environment-configs.md) | maintained | Environment examples per node type, and the per-checkout test settings; the sealed-config design is on the node; checked 2026-10-11 | `aimeat/src/services/config-sealing.ts` |
| [docs/coding-guidelines/extension-memory-architecture.md](coding-guidelines/extension-memory-architecture.md) | maintained | Extension, cortex and app namespaces, and how each layer reads and writes; checked 2026-10-11 | `aimeat/src/routes/extensions/actions.ts` |
| [docs/coding-guidelines/file-headers.md](coding-guidelines/file-headers.md) | maintained | Source file header format, what lint enforces, the 800-line limit; checked 2026-10-11 | `aimeat/eslint-rules/file-header.js` |
| [docs/coding-guidelines/getting-started.md](coding-guidelines/getting-started.md) | maintained | Set up a checkout, the sandbox, a single suite and the gate; maintainer sessions apart; checked 2026-10-11 | `aimeat/scripts/test-env-init.ts` |
| [docs/coding-guidelines/identity-model.md](coding-guidelines/identity-model.md) | maintained | GHII, GAII and GEAI, the caller object, visitors and morsel pacing; checked 2026-10-11 | `aimeat/src/utils/gaii.ts` |
| [docs/coding-guidelines/init-wizard.md](coding-guidelines/init-wizard.md) | maintained | Adding a setting to `aimeat init` and the config coverage gate; checked 2026-10-11 | `aimeat/src/cli/init-wizard/steps-core.ts` |
| [docs/coding-guidelines/mcp-uploads.md](coding-guidelines/mcp-uploads.md) | maintained | Presigned uploads for file-taking MCP tools: token, types, errors; checked 2026-10-11 | `aimeat/src/services/upload-token.ts` |
| [docs/coding-guidelines/memory-contracts.md](coding-guidelines/memory-contracts.md) | maintained | Self-describing memory records and the row store; checked 2026-10-11 | `aimeat/src/services/track-registry.ts` |
| [docs/coding-guidelines/prompt-writing.md](coding-guidelines/prompt-writing.md) | maintained | How a prompt string is written: say what to do; no rewrite of a prompt that works; checked 2026-10-11 | `aimeat/src/services/prompt-defaults/platform.ts` |
| [docs/coding-guidelines/security-development-dna.md](coding-guidelines/security-development-dna.md) | maintained | Security rules: trust model, the invariants, posture, per-change checklist; checked 2026-10-11 | `aimeat/src/middleware/caller.ts` |
| [docs/coding-guidelines/security.md](coding-guidelines/security.md) | maintained | Security lookup: function names, headers, and each security setting with the field that reads it, no copied values; checked 2026-10-11 | `aimeat/src/config.ts` |
| [docs/coding-guidelines/shell-and-git.md](coding-guidelines/shell-and-git.md) | maintained | The two shells, commit messages, hooks and trailers; checked 2026-10-11 | `.githooks/commit-msg` |
| [docs/coding-guidelines/storage-sync.md](coding-guidelines/storage-sync.md) | maintained | Adding a field or a record type to both storage providers; checked 2026-10-11 | `aimeat/src/storage/interface.ts` |
| [docs/coding-guidelines/testing-requirements.md](coding-guidelines/testing-requirements.md) | maintained | Test tiers, the single-suite command, the model suite and how a suite is registered; checked 2026-10-11 | `aimeat/test/run-e2e-ci.ts` |
| [docs/connecting-an-outside-account.md](connecting-an-outside-account.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/connector-forward-tunnel.md](connector-forward-tunnel.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/csm-spec.md](csm-spec.md) | maintained | CSM grammar: the keys the parser reads, the compiled JSON Schema, nested required lists; one template set; checked 2026-10-11 | `aimeat/src/services/csm-parser.ts` |
| [docs/data-processing-agreement-template.md](data-processing-agreement-template.md) | reference | Operator contract template; requires case-specific completion and review | `docs/ai-transparency.md` |
| [docs/document-signing.md](document-signing.md) | maintained | Operator settings and setup for document signing, signature checks and EU wallet signing; verify against config-schema-docsign.ts when changing it | `aimeat/src/services/config-schema-docsign.ts` |
| [docs/ecosystem-app-automation-howto.md](ecosystem-app-automation-howto.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/examples/agent-commissioner.html](examples/agent-commissioner.html) | reference | Example artifact; adapt and validate before publishing | `docs/portal-developer-guide.md` |
| [docs/extensions/marketplace-behaviors/README.md](extensions/marketplace-behaviors/README.md) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/browse.js](extensions/marketplace-behaviors/actions/browse.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/create-listing.js](extensions/marketplace-behaviors/actions/create-listing.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/delist.js](extensions/marketplace-behaviors/actions/delist.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/deliver.js](extensions/marketplace-behaviors/actions/deliver.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/purchase.js](extensions/marketplace-behaviors/actions/purchase.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/rate.js](extensions/marketplace-behaviors/actions/rate.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/actions/update-listing.js](extensions/marketplace-behaviors/actions/update-listing.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/marketplace-behaviors/extension.yaml](extensions/marketplace-behaviors/extension.yaml) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/README.md](extensions/matching-behaviors/README.md) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/actions/create-profile.js](extensions/matching-behaviors/actions/create-profile.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/actions/get-suggestions.js](extensions/matching-behaviors/actions/get-suggestions.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/actions/respond.js](extensions/matching-behaviors/actions/respond.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/actions/run-matching.js](extensions/matching-behaviors/actions/run-matching.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/actions/update-profile.js](extensions/matching-behaviors/actions/update-profile.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/matching-behaviors/extension.yaml](extensions/matching-behaviors/extension.yaml) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/README.md](extensions/membership-behaviors/README.md) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/actions/invite.js](extensions/membership-behaviors/actions/invite.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/actions/join.js](extensions/membership-behaviors/actions/join.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/actions/leave.js](extensions/membership-behaviors/actions/leave.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/actions/promote.js](extensions/membership-behaviors/actions/promote.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/actions/review-request.js](extensions/membership-behaviors/actions/review-request.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/membership-behaviors/extension.yaml](extensions/membership-behaviors/extension.yaml) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/rest-connector/README.md](extensions/rest-connector/README.md) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/rest-connector/actions/pull.js](extensions/rest-connector/actions/pull.js) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/extensions/rest-connector/extension.yaml](extensions/rest-connector/extension.yaml) | runtime | Distributed extension example; validate with sandbox when changing behavior | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/frontend-development-guide.md](frontend-development-guide.md) | maintained | The node's own SPA: views, stylesheets, admin tab registry, locales, cache busting, browser tests. Contributor documentation for this repository, so it stays here and is not made a skill (docs audit phase 3, 2026-10-11); checked 2026-10-11 | `aimeat/src/routes/portal-spa.ts` |
| [docs/guides/agent-data-dashboard-cookbook.md](guides/agent-data-dashboard-cookbook.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/guides/building-extension-cortex-app-stack.md](guides/building-extension-cortex-app-stack.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/guides/protecting-your-work-with-extensions.md](guides/protecting-your-work-with-extensions.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/integrations/crewai-upgrade-to-serve.md](integrations/crewai-upgrade-to-serve.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/integrations/crewai.md](integrations/crewai.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/internal/open-core-audit.md](internal/open-core-audit.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/known_gaps.md](known_gaps.md) | maintained | Developer-approved gaps; approval required for new entries | `CLAUDE.md` |
| [docs/maintenance.md](maintenance.md) | maintained | Review triggers and limits of the structural check | `aimeat/scripts/check-docs.mjs` |
| [docs/manuals/csm-manual.md](manuals/csm-manual.md) | maintained | Writing a CSM: field rules the parser reads, registration routes, gallery equal to the seed templates, prices as data and payment through the checkout; checked 2026-10-11 | `aimeat/src/services/csm-parser.ts` |
| [docs/manuals/msm-manual.md](manuals/msm-manual.md) | maintained | Writing and registering an MSM: what the parser keeps and the validator refuses, the routes, the extension that runs it, pacing as toll_morsels; checked 2026-10-11 | `aimeat/src/services/msm-parser.ts` |
| [docs/manuals/service-extensions-manual.md](manuals/service-extensions-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/manuals/service-owner-manual.md](manuals/service-owner-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/msm-examples/README.md](msm-examples/README.md) | runtime | What the ten shipped MSM examples show and do not promise; pacing as toll_morsels; vendor details not re-checked; checked 2026-10-11 | `aimeat/src/routes/msm.ts` |
| [docs/msm-examples/ai-logo-design.msm.yaml](msm-examples/ai-logo-design.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/coinbase-transfer.msm.yaml](msm-examples/coinbase-transfer.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/mobilepay-payment.msm.yaml](msm-examples/mobilepay-payment.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/nuki-smartlock.msm.yaml](msm-examples/nuki-smartlock.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/posti-shipping.msm.yaml](msm-examples/posti-shipping.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/price-estimation.msm.yaml](msm-examples/price-estimation.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/product-image-analysis.msm.yaml](msm-examples/product-image-analysis.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/stripe-marketplace.msm.yaml](msm-examples/stripe-marketplace.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/weather-pricing.msm.yaml](msm-examples/weather-pricing.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; vendor API not re-checked; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/msm-examples/wolt-restaurant.msm.yaml](msm-examples/wolt-restaurant.msm.yaml) | runtime | MSM example served at /v1/msm/templates; parses and validates, pacing as toll_morsels; payment through the checkout, not in the call; checked 2026-10-11 | `aimeat/test/unit/msm-templates.test.ts` |
| [docs/organisation-node-sign-in.md](organisation-node-sign-in.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/personal-node-setup-guide.md](personal-node-setup-guide.md) | maintained | Personal node anchoring with password sign-in and the ticket-authenticated tunnel; every command run against node 3.26.1 on 2026-10-11 | `aimeat/src/routes/personal.ts` |
| [docs/pitfalls.md](pitfalls.md) | maintained | Recorded platform traps; preserve dates and evidence | `CLAUDE.md` |
| [docs/portal-developer-guide.md](portal-developer-guide.md) | entry | Navigation to the maintained guide or current contract; checked 2026-10-11 | `aimeat/src/routes/app-templates.ts` |
| [docs/security/deployment-checklist.md](security/deployment-checklist.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/incident-response.md](security/incident-response.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/threat-model.md](security/threat-model.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/verification-matrix.md](security/verification-matrix.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/skills-registry.md](skills-registry.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/specs/datamap.md](specs/datamap.md) | maintained | Public spec of the aimeat.datamap/2 record, served at /v1/specs/datamap.md; every field held to the types; checked 2026-10-11 | `aimeat/src/services/data-map/data-map-types.ts` |
| [docs/specs/package-sale.md](specs/package-sale.md) | maintained | Node-to-node contract of a package sale (signed requests, offer, entitlement, claims), served at /v1/specs/package-sale.md; checked 2026-10-11 | `aimeat/src/routes/package-sales.ts` |
| [docs/specs/signals-contract.md](specs/signals-contract.md) | maintained | Signals contract | `aimeat/src/routes/signals.ts` |
| [docs/specs/visibility-contract.md](specs/visibility-contract.md) | maintained | AI visibility record contract | `aimeat/src/services/visibility/visibility-counter.ts` |
| [docs/specs/tracked-response-contract.md](specs/tracked-response-contract.md) | maintained | Tracked response contract | `aimeat/src/routes/tracked-responses.ts` |
| [docs/typesafe/README.md](typesafe/README.md) | reference | What the gitignored TypeSafe snapshot folder is, and why its contents never enter git | `aimeat/src/services/decide` |
| [docs/visitor-geography.md](visitor-geography.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src/utils/geo-headers.ts` |
| [docs/voice-library.md](voice-library.md) | maintained | Configurable voice sessions, adapters, streaming API and browser verification | `aimeat/src/static/sdk-libs/voice` |
