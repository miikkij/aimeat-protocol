# 01 Overview

> Checked against AIMEAT node 4.2.0 (commit a463a1e3b) on 2026-11-03. Maintained with the code: see the README for how.

This page tells an evaluating IT or security team what AIMEAT is, what it is not, under which licence it comes, how its versions work, which versions get security fixes, who maintains it, and which organisations it fits. Read it first. The other pages of this package go deeper on each subject.

## What AIMEAT is

AIMEAT is a self-hosted server ("node") that keeps the knowledge, apps and agents of people and groups, and lets each person reach it from the AI they already use. AI chat over MCP (Model Context Protocol) is the primary interface; the web UI is the control room for status and settings ([Feature list](../AIMEAT-Feature-List.md)).

| Part | What it is | Source |
|---|---|---|
| The node | One Node.js 24 process (TypeScript, Express 5), plain HTTP on port 40050 by default, behind a reverse proxy that holds TLS | `aimeat/src/index.ts`, `AIMEAT_PORT`, [Production deployment](../operations/production-deployment.md) |
| Storage | PostgreSQL (`postgres-kysely`, the production backend) or SQLite, chosen with `AIMEAT_STORAGE` | `aimeat/src/storage/providers/postgres-kysely/migrate.ts`, `aimeat/.env.example` |
| Web UI | A Preact single-page app with no build step, served by the node | `aimeat/public/spa.html` |
| MCP server | The interface for AI clients (Claude, ChatGPT, Cursor, VS Code and others) | `aimeat/src/mcp/index.ts`, `aimeat/src/tool-catalog/definitions.ts` |
| REST API | The documented HTTP contract | `openapi.yaml` |
| CLI | `aimeat start`, `aimeat init`, `aimeat validate`, `aimeat connect` and others | `aimeat/bin/aimeat.ts` |
| Protocol specification | AIMEAT Core, normative since node 4.0.0 | `docs/AIMEAT-Core-2026-11.md`, `docs/AIMEAT-Platform-reference.md` |
| CrewAI package | A Python package that connects CrewAI agents to a node, with its own version line | `python/aimeat-crewai/pyproject.toml` |
| Desktop app | A packaged personal node, with its own version line | `aimeat-desktop/package.json` |

Three principal types act on a node: people (GHII, a human identity such as `alice@node-id`), AI agents (GAII, an agent identity that acts for one person with scoped permissions) and ecosystem apps (GEAI, an outside application onboarded with a scope allowlist) ([Identity model](../coding-guidelines/identity-model.md)). People share knowledge in organisms (a group with members) and workspaces (a shared space inside an organism) ([Data ownership](../data-ownership.md)). What a node is for, and how an organisation runs one node, many nodes or a person's own node beside its other services, is on [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md).

## What AIMEAT is not

| It is not | What that means for you | Source |
|---|---|---|
| A hosted service | You install, run, back up and update it. The project runs one demo node; nothing in this package makes claims about it | `.github/SECURITY.md` |
| An AI model | AI features need an AI provider key or a local model server that you choose. Without one, the node stores and serves data, and AI features stay off | [06 AI and models](06-ai-and-models.md), `aimeat/src/services/ai/types.ts` |
| A TLS terminator | The node speaks plain HTTP. A reverse proxy holds the certificates | [Production deployment](../operations/production-deployment.md) |
| A data processing platform | A node keeps refined knowledge and the state apps show. High-volume processing runs in separate services that read from and write to the node | [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md#what-a-node-is-for) |
| A cluster manager | A node runs as one process, or as several processes on one PostgreSQL database, active or standby; page 18 lists what stays per process. Growth beyond one node is more nodes, each with its own database, connected by federation | [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md) |
| A backup system | Database, secrets and node key are yours to back up | [Backup and restore](../operations/backup-and-restore.md) |
| A certified product | The repository holds no certification or audit attestation by a third party | [14 Compliance mapping](14-compliance-mapping.md) |

## Licence

- The code is under the MIT licence (`LICENSE`). You may use, change, fork and redistribute it, also inside a closed organisation, with the copyright notice kept.
- Third-party components and their licences are listed in `THIRD-PARTY-NOTICES.md` and as a CycloneDX SBOM (`aimeat/scripts/gen-sbom.ts`, see [12 Updates and releases](12-updates-releases.md)).
- One component is GPL: the compiled ffmpeg build for in-browser video. The install script downloads it separately; it is not committed to the repository and not part of the AIMEAT distribution (`aimeat/public/lib/vendored-assets.json`).
- A licence gate checks the licence of every shipped component (`aimeat/scripts/check-licenses.ts`), and pull requests are checked for new copyleft dependencies (`.github/workflows/dependency-review.yml`).

## Versions and change records

| Item | Where | Source |
|---|---|---|
| Node version | Semantic versioning (major.minor.patch), 4.2.0 at this commit | `aimeat/package.json` |
| Change log up to node 3.15.0 | Markdown file in the repository | `CHANGELOG.md` |
| Change log from 3.16 onwards | JSON file, served by every node at `/changelog.json` and as a page at `/v1/changelog`; each entry has a kind (`feature`, `fix`, `security`, `notice`) | `aimeat/public/changelog.json` |
| What a major version removes | A removal is first deprecated: it answers with `Deprecation: true` and `X-AIMEAT-Removed-In`, is counted in `GET /v1/stats`, and is removed in the named major version | [Upgrading](../operations/upgrading.md) |
| Outside protocol versions the node declares | MCP, A2A, OAuth metadata and others, with the AIMEAT Core edition (`2026-11`) | `aimeat/security/protocol-versions.json`, [Upgrading: Protocol versions](../operations/upgrading.md#protocol-versions) |
| CrewAI package versions | Own version line and change log | `python/aimeat-crewai/CHANGELOG.md` |

## Supported versions

Only the newest release of the node receives security fixes. Any older release receives none (`.github/SECURITY.md`). The newest release is the `aimeat` package on npm (`npm view aimeat version`). The CrewAI package and the desktop app follow the same rule on their own version lines.

What this means for you: there is no long-term support line. Plan to follow releases, and read [12 Updates and releases](12-updates-releases.md) for the procedure.

## Maintenance model

| Question | Answer | Source |
|---|---|---|
| Who maintains the code | The maintainer named in `.github/SECURITY.md` | `.github/SECURITY.md` |
| Who runs the node | Your organisation. You are the operator: you install, configure, update, back up and monitor it | [03 Shared responsibility](03-shared-responsibility.md) |
| How security problems are reported | Privately, through GitHub private vulnerability reporting or the e-mail address in the security policy. The stated aim is acknowledgement within 48 hours, assessment within a week and a fix within two weeks | `.github/SECURITY.md` |
| Is there a support contract | Not from the open-source project. A service level exists only if your organisation agrees one separately with a party that offers it | `.github/SECURITY.md` |
| Can you maintain it yourselves | Yes, with a team of any size. The MIT licence allows a fork, the build runs from source (`pnpm build`), the repository's checks run locally with `pnpm gate`, and the rules, guidelines, tests and CI a new team continues from are in the repository | [17 Exit plan, continue it yourselves](17-exit-plan.md#continue-it-yourselves), `aimeat/scripts/gate.ts` |

## Node types

`AIMEAT_NODE_TYPE` accepts four values (`aimeat/src/config.ts`). Read [Environment examples](../coding-guidelines/environment-configs.md) before you choose.

| Type | Use | What to know |
|---|---|---|
| `full` | The default. An organisation's node | PostgreSQL or SQLite. Set `AIMEAT_SECURITY_PROFILE=public` on a real deployment |
| `personal` | One person's node | Defaults to the `local` security profile. Exposing it publicly needs the `public` profile, set and checked by hand |
| `relay` | Relay hosting for other nodes | Accepted by configuration and limited by runtime guards (`aimeat/src/server-bootstrap/middleware-guards.ts`). The guide states that the name alone does not give working replication or a tested resource budget |
| `mirror` | A read-only copy role | Same statement as `relay`: verify the routes you need on your own deployment |

## Who it fits, and who it does not

**It fits an organisation that:**

- has someone who can run a Linux service with a reverse proxy, TLS certificates, DNS records and PostgreSQL, and who can follow releases ([Production deployment](../operations/production-deployment.md));
- wants its people's and agents' knowledge on a server it controls, on premises or in its own cloud account ([Data ownership](../data-ownership.md));
- uses AI clients from more than one vendor, or wants to choose the AI provider and region itself ([Where AI calls are processed](../operations/openrouter-region.md));
- signs people in with its own identity provider: Microsoft Entra ID, Google, SAML 2.0 with SCIM provisioning, or passwords and passkeys ([Organisation node sign-in](../organisation-node-sign-in.md)).

**It does not fit an organisation that:**

- has nobody to operate a Linux service, apply updates and test restores;
- needs a vendor service level or a long-term support version as a condition of use;
- needs active-active high availability of one node with no session affinity and no path routing at the load balancer (see [18 Scope and deployment patterns](18-scope-and-deployment-patterns.md#several-node-processes-on-one-database));
- needs one system for high-volume data processing; that work runs in separate services beside the node ([18](18-scope-and-deployment-patterns.md#services-around-a-node));
- cannot accept a single-maintainer open-source project as the source of fixes and is not ready to continue a fork itself, which the MIT licence allows ([17 Exit plan, continue it yourselves](17-exit-plan.md#continue-it-yourselves)).

## Limits

- Only the newest node release receives security fixes; there is no long-term support line (`.github/SECURITY.md`).
- No support contract or service level comes with the open-source project.
- The project has one named maintainer (`.github/SECURITY.md`). The MIT licence and the rules, checks and tests in the repository let an organisation continue the software itself ([17 Exit plan, continue it yourselves](17-exit-plan.md#continue-it-yourselves)).
- Several processes on one PostgreSQL database are supported, as a standby or as more active processes. Request rate limits, the AI key hold, idempotency keys and requests through a tunnel stay per process, so several active processes divide the limits. The project records no test of several processes behind a load balancer ([18](18-scope-and-deployment-patterns.md#limits)).
- `relay` and `mirror` node types are accepted, but the guide states that the names alone do not give working replication or a tested resource budget (`docs/coding-guidelines/environment-configs.md`).
- The change log is in two places: `CHANGELOG.md` up to node 3.15.0, `aimeat/public/changelog.json` after it.
- The repository holds no third-party certification or audit attestation.

## Open questions

- OPEN: Does any party offer a commercial support contract or service level for self-hosted AIMEAT nodes, and on what terms? The maintainer named in `.github/SECURITY.md` can answer.
