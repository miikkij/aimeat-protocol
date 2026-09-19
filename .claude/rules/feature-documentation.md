---
paths:
  - "**/aimeat/src/**"
  - "**/aimeat/public/**"
  - "**/docs/AIMEAT-Feature-List.md"
---

# A new feature is recorded in more than one place

A user-visible platform capability is not finished when the code works. Each place below is read by
someone different, and a place left out is a person who never learns the feature exists. Go through
the list in the change that ships the feature; for each row, either do it or say in the change
description why it does not apply. Written 2026-09-19, when shipping AIMEAT.decide touched fourteen
of these and no single page said so.

| # | Place | Who reads it | Gate that notices a miss |
|---|---|---|---|
| 1 | `openapi.yaml`, then `pnpm generate:types` | integrators, the typed client | `check:openapi-routes` |
| 2 | MCP tools on all three surfaces (`src/mcp/`, `src/cli/connect/mcp/tools/`, `tool-call-defs-*.ts`), their catalog entry, annotations, scope, and `catalog/surfaces.ts` | every AI connected over MCP | `check:mcp-tools`, `check:mcp-schemas`, `check:field-reach` |
| 3 | The surface handbooks (`src/services/handbooks/*.ts`) | an agent's first call, `aimeat_handbook_get` | `check:prompt-refs` (only that named tools exist) |
| 4 | A served library's registry entry (`src/data/library-packs/`), its `aiDoc` and `promptLine` | the app-building prompt, `GET /v1/libs`, bootstrap, llms.txt | `check:sdk` (bundle only) |
| 5 | `docs/AIMEAT-Feature-List.md`, then `pnpm build:everything` | anyone reading `/v1/everything` | `check:everything` (freshness only) |
| 6 | `aimeat/public/changelog.json`, newest first | people on the landing page | `check:changelog` (shape only). **Ask Jouni first**, platform work only |
| 7 | Settings: `src/services/config-schema.ts` row, `.env.example`, a Config-tab group in `public/views/admin/config-tab.js` `DOMAINS` | the operator | `check:config-coverage` |
| 8 | Locales `en`, `fi`, `es`, and a row in the language context for any new term (skill `aimeat-writing`) | people in their language | `check:locales` |
| 9 | A skill: node-wide (`src/data/builtin-skills*.ts`) or the owner's registry (`aimeat_skill_publish`) | an AI using the feature | `check:skill-reviews` (for skills that already watch the code) |
| 10 | The appdev pitfalls (`aimeat_appdev_pitfall_report`) when app builders can get it wrong | an AI building an app | none |
| 11 | `docs/catalog.md` for every new file under `docs/` | the documentation check | `check:docs` |
| 12 | A Platform Development Notes document (what shipped, what it cost, what is open) | the next session | none |
| 13 | The TARGET record or the wish: closed in the session that shipped it | Jouni, the wish bucket | none |
| 14 | A decision record for any ruling made while building | every project under the goal | none |

Rows 10, 12, 13 and 14 have no gate, so they are the ones that get skipped. The `note-writer` agent
does 12 to 14 from a commit hash and a list of what was decided.

## The feature guide itself (row 5)

Review `docs/AIMEAT-Feature-List.md` in the same change. Update its benefit, availability,
limitations and real REST/MCP access where affected. If no guide change is needed, say why in the
change description. Individual application inventories stay in App Catalog.

The Markdown file is the content source for `/v1/everything`, its Markdown mirror,
initial HTML and JSON. Run `cd aimeat` then `pnpm build:everything` after changing it.
`pnpm check:everything` verifies generated-file freshness; it cannot detect a feature
that was never documented. Preserve existing section and feature anchors when editing.
The version and date record a source review, not the live node's configuration or uptime.
