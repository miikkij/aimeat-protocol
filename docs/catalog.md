# Documentation catalog

Reviewed against repository commit `b26f00157` and its documentation cleanup on 2026-09-16.
The original inventory contained **208 tracked files**. This catalog also includes the new entry
points and maintenance files. Gitignored local files, including private testing instructions,
are outside this public inventory and were preserved.

## Result

- Keep current guides and specs, with the corrections recorded in this change.
- Preserve runtime assets in their loader paths. The two CSM example sets differ.
- Treat external integrations and provider reports as dated references.
- Preserve 45 relocated plans and test outlines in `archive/`. Six other historical
  documents remain at their existing paths for existing references.
- Use [maintenance.md](maintenance.md) for status meanings, review triggers and check limits.

“Maintained” means the file belongs to the active documentation set. It does not mean
that every example has been executed or every external or legal statement revalidated.
The source column identifies the implementation or rule to read at the next change.
`pnpm check:docs` checks structure and inventory, not semantic correctness.

## Files

| File | Status | Purpose and validity | Check against |
|---|---|---|---|
| [aimeat/docs/AIMEAT_Help_Prompt.md](../aimeat/docs/AIMEAT_Help_Prompt.md) | runtime | Served help prompt; root and packaged copies must agree | `aimeat/src/routes/bootstrap.ts` |
| [aimeat/docs/README.md](../aimeat/docs/README.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [aimeat/docs/agent-scheduler-guide.md](../aimeat/docs/agent-scheduler-guide.md) | maintained | Agent scheduling guide; use current scheduler and constraint handlers | `aimeat/src/services/scheduler.ts` |
| [aimeat/docs/aimeat-dmz-architecture.md](../aimeat/docs/aimeat-dmz-architecture.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [aimeat/docs/configuration-guide.md](../aimeat/docs/configuration-guide.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [aimeat/docs/csm-bundles/README.md](../aimeat/docs/csm-bundles/README.md) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/decision.csm.yaml](../aimeat/docs/csm-bundles/project/decision.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/deliverable.csm.yaml](../aimeat/docs/csm-bundles/project/deliverable.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/goal.csm.yaml](../aimeat/docs/csm-bundles/project/goal.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/manifest.template.json](../aimeat/docs/csm-bundles/project/manifest.template.json) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/plan.csm.yaml](../aimeat/docs/csm-bundles/project/plan.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-bundles/project/resource.csm.yaml](../aimeat/docs/csm-bundles/project/resource.csm.yaml) | runtime | Project bundle asset or loader guidance; preserve paths and inspect compiled constraints | `aimeat/src/services/template-bundles.ts` |
| [aimeat/docs/csm-examples/auction.csm.yaml](../aimeat/docs/csm-examples/auction.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/dating-directory.csm.yaml](../aimeat/docs/csm-examples/dating-directory.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/hobby-directory.csm.yaml](../aimeat/docs/csm-examples/hobby-directory.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/marketplace.csm.yaml](../aimeat/docs/csm-examples/marketplace.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/news-feed.csm.yaml](../aimeat/docs/csm-examples/news-feed.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/opinion-board.csm.yaml](../aimeat/docs/csm-examples/opinion-board.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/csm-examples/video-directory.csm.yaml](../aimeat/docs/csm-examples/video-directory.csm.yaml) | runtime | Seed template; older constraint keywords can be ignored by parser | `aimeat/src/services/csm-seed.ts` |
| [aimeat/docs/integrations/dify-hello-integration.md](../aimeat/docs/integrations/dify-hello-integration.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [aimeat/docs/observability-guide.md](../aimeat/docs/observability-guide.md) | reference | Observability setup reference; check installed instrumentation and deployment | `aimeat/src` |
| [docs/AIMEAT-Feature-List.md](AIMEAT-Feature-List.md) | maintained | Generated feature index; update through its generator | `aimeat/scripts/build-everything.ts` |
| [docs/AIMEAT-RFC-v4.0-Core-full.md](AIMEAT-RFC-v4.0-Core-full.md) | maintained | Canonical Core concepts; implementation version is separate | `openapi.yaml` |
| [docs/AIMEAT-RFC-v4.0-Platform-full.md](AIMEAT-RFC-v4.0-Platform-full.md) | maintained | Platform contract; retired scopes and directives corrected | `aimeat/src/routes` |
| [docs/AIMEAT_Help_Prompt.md](AIMEAT_Help_Prompt.md) | runtime | Served help prompt; root and packaged copies must agree | `aimeat/src/routes/bootstrap.ts` |
| [docs/README.md](README.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/a-endpoints.md](a-endpoints.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/agent-workspace-contracts.md](agent-workspace-contracts.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/ai-transparency.md](ai-transparency.md) | maintained | Implementation disclosure; private research links removed, legal analysis not revalidated | `aimeat/src/services` |
| [docs/aimeat-cross-federation.md](aimeat-cross-federation.md) | maintained | Actual peer routes, permissions and cache settings | `aimeat/src/routes/federation-genesis.ts` |
| [docs/aimeat-dmz-architecture.md](aimeat-dmz-architecture.md) | maintained | Memory visibility model and consent boundaries | `aimeat/src/routes/memory.ts` |
| [docs/aimeat-eudiw-integration.md](aimeat-eudiw-integration.md) | maintained | Wallet verification is blocked at startup; route existence is not support | `aimeat/src/config-eudiw-guard.ts` |
| [docs/aimeat-interest-profile-spec.md](aimeat-interest-profile-spec.md) | reference | Interest-profile format reference; check schema before a new integration | `aimeat/src/models` |
| [docs/aimeat-pwa-guide.md](aimeat-pwa-guide.md) | maintained | Offline fallback, share intake and push behavior | `aimeat/public/sw.js` |
| [docs/aimeat-semantic-ontology.md](aimeat-semantic-ontology.md) | reference | Semantic vocabulary reference; not proof every annotation is enforced | `aimeat/src/services/csm-parser.ts` |
| [docs/aimeat-vc-spec.md](aimeat-vc-spec.md) | maintained | Actual credential payload and authority; no conformance claim | `aimeat/src/services/vc-issuer.ts` |
| [docs/aiplatforms/README.md](aiplatforms/README.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/chatgpt.md](aiplatforms/chatgpt.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/claude-ai.md](aiplatforms/claude-ai.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/cursor.md](aiplatforms/cursor.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/deepseek.md](aiplatforms/deepseek.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/gemini.md](aiplatforms/gemini.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/github-copilot.md](aiplatforms/github-copilot.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/goose.md](aiplatforms/goose.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/grok.md](aiplatforms/grok.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/lmstudio.md](aiplatforms/lmstudio.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/m365-copilot.md](aiplatforms/m365-copilot.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/mistral.md](aiplatforms/mistral.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/ollama.md](aiplatforms/ollama.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/openclaw.md](aiplatforms/openclaw.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/aiplatforms/perplexity.md](aiplatforms/perplexity.md) | reference | Dated vendor report; product, plan and price claims need rechecking before use | `docs/aiplatforms/README.md` |
| [docs/app-developer-ai-guide.md](app-developer-ai-guide.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/archive/README.md](archive/README.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/archive/node/analysis/2026-03-17-lint-analysis.md](archive/node/analysis/2026-03-17-lint-analysis.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/00-index.md](archive/node/e2etests/00-index.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/01-portfolio.md](archive/node/e2etests/01-portfolio.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/02-agents.md](archive/node/e2etests/02-agents.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/03-chat-sessions.md](archive/node/e2etests/03-chat-sessions.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/04-wallet.md](archive/node/e2etests/04-wallet.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/05-knowledge.md](archive/node/e2etests/05-knowledge.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/06-organisms.md](archive/node/e2etests/06-organisms.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/07-memory.md](archive/node/e2etests/07-memory.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/08-work.md](archive/node/e2etests/08-work.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/09-services.md](archive/node/e2etests/09-services.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/10-boards.md](archive/node/e2etests/10-boards.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/11-apps.md](archive/node/e2etests/11-apps.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/12-extensions.md](archive/node/e2etests/12-extensions.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/13-federation.md](archive/node/e2etests/13-federation.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/14-nodes.md](archive/node/e2etests/14-nodes.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/15-access.md](archive/node/e2etests/15-access.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/16-data-wallet.md](archive/node/e2etests/16-data-wallet.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/17-node-stats.md](archive/node/e2etests/17-node-stats.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/18-security.md](archive/node/e2etests/18-security.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/e2etests/19-notifications.md](archive/node/e2etests/19-notifications.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-04-sqlite-storage-adapter-design.md](archive/node/plans/2026-03-04-sqlite-storage-adapter-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-04-sqlite-storage-adapter-plan.md](archive/node/plans/2026-03-04-sqlite-storage-adapter-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-06-portfolio-page-plan.md](archive/node/plans/2026-03-06-portfolio-page-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-06-portfolio-page-research.md](archive/node/plans/2026-03-06-portfolio-page-research.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-12-code-quality-audit-report.md](archive/node/plans/2026-03-12-code-quality-audit-report.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-03-12-code-quality-remediation-plan.md](archive/node/plans/2026-03-12-code-quality-remediation-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-04-03-test-template-scaffolds.md](archive/node/plans/2026-04-03-test-template-scaffolds.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-05-28-mcp-tool-unification-plan.md](archive/node/plans/2026-05-28-mcp-tool-unification-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-06-03-agent-access-tokens-plan.md](archive/node/plans/2026-06-03-agent-access-tokens-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-06-03-agent-scheduler-and-scheduled-tasks-plan.md](archive/node/plans/2026-06-03-agent-scheduler-and-scheduled-tasks-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-06-03-owner-session-refresh-tokens-plan.md](archive/node/plans/2026-06-03-owner-session-refresh-tokens-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-06-09-workspace-document-public-sharing-plan.md](archive/node/plans/2026-06-09-workspace-document-public-sharing-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/plans/2026-07-03-portfolio-subdomain-plan.md](archive/node/plans/2026-07-03-portfolio-subdomain-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/plans/2026-03-10-tag-components.md](archive/node/superpowers/plans/2026-03-10-tag-components.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/plans/2026-03-11-sse-live-updates.md](archive/node/superpowers/plans/2026-03-11-sse-live-updates.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/plans/2026-03-11-system-prompts-management.md](archive/node/superpowers/plans/2026-03-11-system-prompts-management.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/plans/2026-03-15-scheduler-activate-trigger-and-execution-log.md](archive/node/superpowers/plans/2026-03-15-scheduler-activate-trigger-and-execution-log.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/plans/2026-03-17-single-balance-migration.md](archive/node/superpowers/plans/2026-03-17-single-balance-migration.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/specs/2026-03-10-tag-components-design.md](archive/node/superpowers/specs/2026-03-10-tag-components-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/specs/2026-03-11-msm-management-design.md](archive/node/superpowers/specs/2026-03-11-msm-management-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/specs/2026-03-11-sse-live-updates-design.md](archive/node/superpowers/specs/2026-03-11-sse-live-updates-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/specs/2026-03-11-system-prompts-management-design.md](archive/node/superpowers/specs/2026-03-11-system-prompts-management-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/node/superpowers/specs/2026-03-17-single-balance-migration-design.md](archive/node/superpowers/specs/2026-03-17-single-balance-migration-design.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/archive/openapi-sync-plan.md](archive/openapi-sync-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/b-config.md](b-config.md) | maintained | Effective configuration and operator settings | `aimeat/src/config.ts` |
| [docs/building-an-aimeat-compatible-agent.md](building-an-aimeat-compatible-agent.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/building-an-aimeat-compatible-ecosystem-app.md](building-an-aimeat-compatible-ecosystem-app.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/c-platform-notes.md](c-platform-notes.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/catalog.md](catalog.md) | maintained | Complete tracked-file inventory for both documentation trees | `aimeat/scripts/check-docs.mjs` |
| [docs/coding-guidelines/README.md](coding-guidelines/README.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/coding-guidelines/agent-tags.md](coding-guidelines/agent-tags.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/architecture.md](coding-guidelines/architecture.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/code-style.md](coding-guidelines/code-style.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/dependency-management.md](coding-guidelines/dependency-management.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/environment-configs.md](coding-guidelines/environment-configs.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/extension-memory-architecture.md](coding-guidelines/extension-memory-architecture.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/file-headers.md](coding-guidelines/file-headers.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/getting-started.md](coding-guidelines/getting-started.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/identity-model.md](coding-guidelines/identity-model.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/init-wizard.md](coding-guidelines/init-wizard.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/mcp-uploads.md](coding-guidelines/mcp-uploads.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/memory-contracts.md](coding-guidelines/memory-contracts.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/prompt-writing.md](coding-guidelines/prompt-writing.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/security-development-dna.md](coding-guidelines/security-development-dna.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/security.md](coding-guidelines/security.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/shell-and-git.md](coding-guidelines/shell-and-git.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/storage-sync.md](coding-guidelines/storage-sync.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/coding-guidelines/testing-requirements.md](coding-guidelines/testing-requirements.md) | maintained | Platform development guidance; apply current repository rules and source | `CLAUDE.md` |
| [docs/connecting-an-outside-account.md](connecting-an-outside-account.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/connector-forward-tunnel.md](connector-forward-tunnel.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/csm-examples/auction.csm.yaml](csm-examples/auction.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/dating-directory.csm.yaml](csm-examples/dating-directory.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/hobby-directory.csm.yaml](csm-examples/hobby-directory.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/marketplace.csm.yaml](csm-examples/marketplace.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/news-feed.csm.yaml](csm-examples/news-feed.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/opinion-board.csm.yaml](csm-examples/opinion-board.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/organism.csm.yaml](csm-examples/organism.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-examples/video-directory.csm.yaml](csm-examples/video-directory.csm.yaml) | reference | CSM example distinct from package seed set; validate compiled schema before use | `aimeat/src/services/csm-parser.ts` |
| [docs/csm-spec.md](csm-spec.md) | maintained | CSM grammar with ignored constraint spellings called out | `aimeat/src/services/csm-parser.ts` |
| [docs/csp/csp-management-spec.md](csp/csp-management-spec.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/data-processing-agreement-template.md](data-processing-agreement-template.md) | reference | Operator contract template; requires case-specific completion and review | `docs/ai-transparency.md` |
| [docs/datakartta-maaritelma.md](datakartta-maaritelma.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
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
| [docs/federation-economic-layer.md](federation-economic-layer.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/frontend-development-guide.md](frontend-development-guide.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/guides/agent-data-dashboard-cookbook.md](guides/agent-data-dashboard-cookbook.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/guides/building-extension-cortex-app-stack.md](guides/building-extension-cortex-app-stack.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/guides/local-first-package-workflow.md](guides/local-first-package-workflow.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/guides/protecting-your-work-with-extensions.md](guides/protecting-your-work-with-extensions.md) | maintained | Development guide; update when the documented platform interface changes | `aimeat/src` |
| [docs/handbook/README.md](handbook/README.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/handbook/local-agents.md](handbook/local-agents.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/init-prompts/openclaw-aimeat-agent.md](init-prompts/openclaw-aimeat-agent.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/integrations/crewai-upgrade-to-serve.md](integrations/crewai-upgrade-to-serve.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/integrations/crewai.md](integrations/crewai.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/integrations/lm-studio-setup.md](integrations/lm-studio-setup.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/integrations/openclaw-compatibility.md](integrations/openclaw-compatibility.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/integrations/openclaw-setup.md](integrations/openclaw-setup.md) | reference | Client integration example; verify installed client and discover current node tools | `aimeat/src/cli` |
| [docs/internal/open-core-audit.md](internal/open-core-audit.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/known_gaps.md](known_gaps.md) | maintained | Developer-approved gaps; approval required for new entries | `CLAUDE.md` |
| [docs/maintenance.md](maintenance.md) | maintained | Review triggers and limits of the structural check | `aimeat/scripts/check-docs.mjs` |
| [docs/manuals/csm-manual.md](manuals/csm-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/manuals/msm-manual.md](manuals/msm-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/manuals/service-extensions-manual.md](manuals/service-extensions-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/manuals/service-owner-manual.md](manuals/service-owner-manual.md) | maintained | Service authoring guide; parser and route handlers determine enforcement | `aimeat/src/services` |
| [docs/msm-examples/README.md](msm-examples/README.md) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/ai-logo-design.msm.yaml](msm-examples/ai-logo-design.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/coinbase-transfer.msm.yaml](msm-examples/coinbase-transfer.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/mobilepay-payment.msm.yaml](msm-examples/mobilepay-payment.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/nuki-smartlock.msm.yaml](msm-examples/nuki-smartlock.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/posti-shipping.msm.yaml](msm-examples/posti-shipping.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/price-estimation.msm.yaml](msm-examples/price-estimation.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/product-image-analysis.msm.yaml](msm-examples/product-image-analysis.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/stripe-marketplace.msm.yaml](msm-examples/stripe-marketplace.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/weather-pricing.msm.yaml](msm-examples/weather-pricing.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/msm-examples/wolt-restaurant.msm.yaml](msm-examples/wolt-restaurant.msm.yaml) | runtime | Distributed service template; external API compatibility requires a fresh check | `aimeat/scripts/copy-dist-assets.mjs` |
| [docs/optics/ux-principles.md](optics/ux-principles.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/organisation-node-sign-in.md](organisation-node-sign-in.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/personal-node-setup-guide.md](personal-node-setup-guide.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/pitfalls.md](pitfalls.md) | maintained | Recorded platform traps; preserve dates and evidence | `CLAUDE.md` |
| [docs/plain-language-field-test.md](plain-language-field-test.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/plans/sealed-config-plan.md](plans/sealed-config-plan.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/portal-developer-guide.md](portal-developer-guide.md) | entry | Navigation to the maintained guide or current contract | `docs/README.md` |
| [docs/security/deployment-checklist.md](security/deployment-checklist.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/incident-response.md](security/incident-response.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/threat-model.md](security/threat-model.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/security/verification-matrix.md](security/verification-matrix.md) | maintained | Operational security guidance; check current enforcement and verification evidence | `aimeat/src/auth` |
| [docs/skills-registry.md](skills-registry.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src` |
| [docs/specs/secretary-decision-contract.md](specs/secretary-decision-contract.md) | historical | Earlier plan, draft or audit; retained as history, not current instructions | `docs/README.md` |
| [docs/specs/signals-contract.md](specs/signals-contract.md) | maintained | Signals contract | `aimeat/src/routes/signals.ts` |
| [docs/specs/tracked-response-contract.md](specs/tracked-response-contract.md) | maintained | Tracked response contract | `aimeat/src/routes/tracked-responses.ts` |
| [docs/visitor-geography.md](visitor-geography.md) | maintained | Current feature or operating guide; verify against implementation when changing it | `aimeat/src/utils/geo-headers.ts` |
| [docs/templates/b2b-sales-hub/README.md](templates/b2b-sales-hub/README.md) | reference | Example artifact; adapt and validate before publishing | `docs/portal-developer-guide.md` |
| [docs/templates/b2b-sales-hub/template-meta.json](templates/b2b-sales-hub/template-meta.json) | reference | Example artifact; adapt and validate before publishing | `docs/portal-developer-guide.md` |
