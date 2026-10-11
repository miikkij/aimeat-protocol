# Maintaining documentation

## What the catalog means

Every tracked file in both documentation trees has one row in [catalog.md](catalog.md).

| Status | Meaning | Maintenance |
|---|---|---|
| maintained | Relevant guidance or specification for the current system | Update with changes to the related implementation |
| runtime | Loaded or distributed data/code, even though stored under `docs` | Preserve paths and validate with its loader; changes can affect behavior |
| reference | Example, provider report, template or proposed contract | Check the stated scope and prerequisites before use |
| historical | A recorded result kept for an existing reference | Carries a history notice at its top; use the linked current source for new work. A new plan or build note is never filed here: it goes to the node |
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

When adding, moving or retiring a file, update its catalog row with a concrete
"check against" path and the date it was checked. Use a maintained guide for present
instructions. Plans, design specifications and build notes live on the node, in the
AIMEAT development organism (Development, and Platform Development Notes); the repository's
archive of old plans was removed on 2026-10-11, and git history keeps it. Do not add plans,
build notes or request queues to the repository.

Guidance written for an AI is a built-in skill every node serves
(`aimeat/src/data/builtin-skills*.ts`), not a repository file: the node cannot serve
`docs/`, so an AI on any node that is sent to a repository path ends at a file it cannot
open. When a file moves, keep a short pointer only where a link from outside the repository
may still reach it.

## Checks

`pnpm check:docs` checks catalog coverage, statuses, source paths, local Markdown
file links outside fenced code, JSON/YAML syntax and the two help-prompt copies.
It also requires a history notice on every file the catalog marks historical, and refuses
a file under `docs/archive/` or `docs/plans/`.

`pnpm check:doc-links` refuses a string the node serves (in `aimeat/src` and
`aimeat/public`) that links a repository `docs/` file the node does not serve. A source
comment may cite one; a string an AI or a person receives may not.

It does not contact external URLs, run example integrations, verify Markdown
heading anchors, certify security or legal compliance, or prove that every prose
statement matches code. A passing check is a structural check, not a content review.

## Review triggers

- API or token changes: agent/ecosystem guides, help prompt and relevant Core/Platform sections.
- Configuration changes: configuration reference, deployment examples and affected operator guides.
- Frontend changes: frontend guidance and any documented user steps.
- Parser or loader changes: CSM/MSM/extension manuals and runtime examples.
- Provider changes: the setup table `aimeat/src/services/ai-tool-setup.ts`, checked against the provider's own documentation.
- A release: check user entry points against that release and remove stale fixed counts.

Use live discovery for tool counts and configuration for limits. Keep a fixed
number only when it explains a dated measurement or an explicit versioned contract.
