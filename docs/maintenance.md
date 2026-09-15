# Maintaining documentation

## What the catalog means

Every tracked file in both documentation trees has one row in [catalog.md](catalog.md).

| Status | Meaning | Maintenance |
|---|---|---|
| maintained | Relevant guidance or specification for the current system | Update with changes to the related implementation |
| runtime | Loaded or distributed data/code, even though stored under `docs` | Preserve paths and validate with its loader; changes can affect behavior |
| reference | Example, provider report, template or proposed contract | Check the stated scope and prerequisites before use |
| historical | Earlier plan, audit, draft or recorded result | Preserve as history; use the linked current source for new work |
| entry | Short link to the maintained source | Keep its destination available |

A retained file is useful for its stated purpose. This is not a claim that every
example was run against an external service or that a provider report is current.
Runtime assets require separate behavior tests when their content changes.

## Update with the change

1. Identify the affected guide through the catalog and documentation index.
2. Read the implementation, OpenAPI, configuration schema or served skill that
   determines the behavior. Record limitations when the implementation is partial.
3. Change instructions and examples in the same commit. Keep generated catalogs
   generated, and keep package copies synchronized.
4. Run `pnpm check:docs` and the checks appropriate to the change. Follow
   [CLAUDE.md](../CLAUDE.md) for `pnpm gate` and CI.

When adding, moving or retiring a file, update its catalog row. Use a maintained
guide for present instructions and the archive for old plans. Do not add new
build notes or request queues to the repository; those belong on the node.

## Checks

`pnpm check:docs` checks catalog coverage, statuses, source paths, local Markdown
file links outside fenced code, JSON/YAML syntax and the two help-prompt copies.
It also requires a history notice on archived Markdown files.

It does not contact external URLs, run example integrations, verify Markdown
heading anchors, certify security or legal compliance, or prove that every prose
statement matches code. A passing check is a structural check, not a content review.

## Review triggers

- API or token changes: agent/ecosystem guides, help prompt and relevant Core/Platform sections.
- Configuration changes: configuration reference, deployment examples and affected operator guides.
- Frontend changes: frontend guidance and any documented user steps.
- Parser or loader changes: CSM/MSM/extension manuals and runtime examples.
- Provider changes: the dated client report, checked against the provider's own documentation.
- A release: check user entry points against that release and remove stale fixed counts.

Use live discovery for tool counts and configuration for limits. Keep a fixed
number only when it explains a dated measurement or an explicit versioned contract.
