---
paths:
  - "**/aimeat/src/**"
  - "**/aimeat/public/**"
  - "**/docs/AIMEAT-Feature-List.md"
---

# Feature guide maintenance

When adding, changing or removing a user-visible platform capability, review
`docs/AIMEAT-Feature-List.md` in the same change. Update its benefit, availability,
limitations and real REST/MCP access where affected. If no guide change is needed,
say why in the change description. Individual application inventories stay in App Catalog.

The Markdown file is the content source for `/v1/everything`, its Markdown mirror,
initial HTML and JSON. Run `cd aimeat` then `pnpm build:everything` after changing it.
`pnpm check:everything` verifies generated-file freshness; it cannot detect a feature
that was never documented. Preserve existing section and feature anchors when editing.
The version and date record a source review, not the live node's configuration or uptime.
