# Package documentation and runtime assets

Start with the repository's [documentation index](../../docs/README.md).

| Path | Purpose |
|---|---|
| `AIMEAT_Help_Prompt.md` | Package copy of the maintained help prompt; kept identical by `pnpm check:docs` |
| `AIMEAT_Help_Prompt_Person.md` | Package copy of the help prompt for a person; kept identical the same way |
| `configuration-guide.md` | Entry point to the configuration reference |
| `observability-guide.md` | Stats and metrics guidance |
| `csm-examples/` | Templates loaded by the CSM routes and startup seeder |
| `csm-bundles/` | Organism-template schemas and manifest |

The build copies this directory to `dist/docs/`. Guidance for an AI (scheduling, workspace
contracts, AI in apps) is a built-in skill every node serves (`aimeat_skill_get`), not a file here.

In an installed package, repository-relative links may be unavailable. Use the
node's `/llms.txt`, `/v1/docs`, `/v1/spec` and `/v1/prompts/build-app` for served
documentation, and `aimeat config` for the installed CLI's configuration.
