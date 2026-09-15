# Package documentation and runtime assets

Start with the repository's [documentation index](../../docs/README.md).

| Path | Purpose |
|---|---|
| `AIMEAT_Help_Prompt.md` | Package copy of the maintained help prompt; kept identical by `pnpm check:docs` |
| `configuration-guide.md` | Entry point to the configuration reference |
| `aimeat-dmz-architecture.md` | Entry point to the memory-visibility reference |
| `agent-scheduler-guide.md` | Scheduler guidance |
| `observability-guide.md` | Stats and metrics guidance |
| `integrations/dify-hello-integration.md` | Dated integration design |
| `csm-examples/` | Templates loaded by the CSM routes and startup seeder |
| `csm-bundles/` | Organism-template schemas and manifest |

The build copies this directory to `dist/docs/`. Old development plans and manual
test plans are now in [the repository archive](../../docs/archive/README.md), so
they are not included by that copy step.

In an installed package, repository-relative links may be unavailable. Use the
node's `/llms.txt`, `/v1/docs`, `/v1/spec` and `/v1/prompts/build-app` for served
documentation, and `aimeat config` for the installed CLI's configuration.
