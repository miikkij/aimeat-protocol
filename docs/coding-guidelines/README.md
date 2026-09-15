# Development guides

Start with [CLAUDE.md](../../CLAUDE.md) and the applicable
[path rules](../../.claude/rules). They define coordination, worktrees, approval
boundaries and completion requirements.

## Find a guide

| Task | Guide |
|---|---|
| Set up an isolated session | [Getting started](getting-started.md) |
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

Use a private `pnpm sandbox` for interactive checks. Initialize isolated test
environments with `pnpm test:env:init` and the port in your Lifecycle Central claim.

Run the targeted suites the change requires and `pnpm gate` once on the finished
change. The full E2E sweep requires the developer's approval. Follow CLAUDE.md for
integration to main and check CI on the pushed commit.

The actual checks are defined in
[check-registry.mjs](../../aimeat/scripts/lib/check-registry.mjs),
[gate.ts](../../aimeat/scripts/gate.ts) and
[the Git hooks](../../.githooks).

## Documentation

[The documentation index](../README.md) covers both documentation trees.
[OpenAPI](../../openapi.yaml) is the API contract. The conceptual specifications
are [Core](../AIMEAT-RFC-v4.0-Core-full.md) and
[Platform](../AIMEAT-RFC-v4.0-Platform-full.md).
[The archive](../archive/README.md) holds historical plans.
