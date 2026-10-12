# Development guides

Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) for the path from a fresh clone to a pull
request. [CLAUDE.md](../../CLAUDE.md) and the applicable [path rules](../../.claude/rules) are
the rules the maintainers work by: approval boundaries and completion requirements, and the
coordination their own sessions follow.

## Find a guide

| Task | Guide |
|---|---|
| Set up a checkout | [Getting started](getting-started.md) |
| Find a subsystem | [Architecture](architecture.md) |
| Resolve the caller and owner | [Identity model](identity-model.md) |
| Preserve access boundaries | [Security development](security-development-dna.md), [security practices](security.md) |
| Change stored data | [Storage synchronization](storage-sync.md) |
| Choose and run checks | [Testing requirements](testing-requirements.md) |
| Change the web interface | [Frontend guide](../frontend-development-guide.md) |
| Write source code | [Code style](code-style.md), [file headers](file-headers.md) |
| Add a dependency | [Dependency management](dependency-management.md) |
| Change configuration | [Node settings](../b-config.md), [environment examples](environment-configs.md), [init wizard](init-wizard.md) |
| Store shared records | [Memory contracts](memory-contracts.md), [extension memory](extension-memory-architecture.md) |
| Transfer a file over MCP | [MCP uploads](mcp-uploads.md) |
| Write prompts | [Prompt writing](prompt-writing.md) |
| Commit from this environment | [Shell and Git](shell-and-git.md) |
| Group agents | [Agent tags and modes](agent-tags.md) |

## Verification

Use a private `pnpm sandbox` for interactive checks. Initialize the checkout's own
test environment with `pnpm test:env:init` (a maintainer session passes the port
from its claim as `AIMEAT_E2E_PORT`).

Run the targeted suites the change requires and `pnpm gate` once on the finished
change. A green gate is what "done" needs; do not wait for GitHub CI. The full E2E
sweep requires the developer's approval.

The actual checks are defined in
[check-registry.mjs](../../aimeat/scripts/lib/check-registry.mjs),
[gate.ts](../../aimeat/scripts/gate.ts) and
[the Git hooks](../../.githooks).

## Documentation

[The documentation index](../README.md) covers both documentation trees.
[OpenAPI](../../openapi.yaml) is the API contract. The conceptual specifications
are [AIMEAT Core 2026-11](../AIMEAT-Core-2026-11.md), normative from node 4.0.0, and the
[Platform reference](../AIMEAT-Platform-reference.md).
Plans and build notes live on the node, in the AIMEAT development organism.
