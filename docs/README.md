# AIMEAT documentation

Use these guides with the version of the code in the same checkout.
The [file catalog](catalog.md) gives every file in `docs/` and `aimeat/docs/` a
purpose and maintenance status. [Maintenance](maintenance.md) explains the checks.

## Start here

| You want to | Read |
|---|---|
| Understand what AIMEAT provides | [Feature guide](AIMEAT-Feature-List.md) |
| Read the protocol | [Core v4.0](AIMEAT-RFC-v4.0-Core-full.md), [Platform v4.0](AIMEAT-RFC-v4.0-Platform-full.md) |
| Find an API operation | [API reference](a-endpoints.md), [OpenAPI](../openapi.yaml) |
| Connect an agent | [Agent guide](building-an-aimeat-compatible-agent.md), [client connection paths](c-platform-notes.md) |
| Connect an external application | [Ecosystem guide](building-an-aimeat-compatible-ecosystem-app.md) |
| Build a hosted app | The target node's `/v1/prompts/build-app`, then [app development](portal-developer-guide.md) |
| Configure a node | [Configuration](b-config.md), [environment examples](coding-guidelines/environment-configs.md) |
| Develop the platform | [Development guides](coding-guidelines/README.md), [CLAUDE.md](../CLAUDE.md) |
| Operate a node | [Deployment checks](security/deployment-checklist.md), [observability](../aimeat/docs/observability-guide.md), [incident response](security/incident-response.md) |
| Work with shared data | [Workspace contracts](agent-workspace-contracts.md), [memory contracts](coding-guidelines/memory-contracts.md) |
| Build services | [Service owner manual](manuals/service-owner-manual.md), [CSM](csm-spec.md), [extensions](manuals/service-extensions-manual.md) |
| Review identity-wallet support | [Current EUDIW status](aimeat-eudiw-integration.md), [credential format](aimeat-vc-spec.md) |

## Which source decides

- **API fields and routes:** `openapi.yaml`, checked against the implementation.
- **Configuration:** `aimeat/src/config*.ts`, the configuration field schema and `.env.example`.
- **Development rules:** `CLAUDE.md`, its path rules and current node skills.
- **App-building instructions:** the target node's build-app prompt, skills and appdev knowledge base.
- **Runtime behavior:** the current implementation and tests. A past test result does not prove the current release.
- **Plans and decisions for ongoing work:** Lifecycle Central. Build notes belong in the node's development-note workspaces.

Specification v4.0 and the node package version are separate version lines.
Read [package.json](../aimeat/package.json) and [CHANGELOG.md](../CHANGELOG.md) for the implementation version.

## Two folders, different purposes

`docs/` holds the project specifications, guides and reference examples.
Some of its examples are also runtime assets: the build copies `msm-examples/`
and `extensions/` into the npm package.

[`aimeat/docs/`](../aimeat/docs/README.md) holds package-local documentation and
runtime CSM schemas and bundles. Keep these assets in place unless the loaders,
package build and their tests are changed together. Similarly named CSM files
in the two trees have different content; they are not interchangeable copies.

## History and local material

[The archive](archive/README.md) holds earlier implementation plans, audits and
manual test plans. They explain past work; use current guides for commands and behavior.

`docs/internal/` also contains local, gitignored working material. It is not part
of the public documentation set. This cleanup covers tracked files and preserves
local private material. The one tracked audit there is listed as historical in the catalog.
