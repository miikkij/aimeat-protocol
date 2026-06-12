# Local-first package workflow

> **Problem:** A developer (human or Claude Code) builds an
> app + cortex + extension stack on aimeat.io via MCP. Each component
> goes to its own database row on the server. If the server dies, the
> work is gone — there is no shared "this app belongs with that cortex
> belongs with that extension" record.
>
> **Solution:** Treat a **local project directory** as the canonical
> source of truth. MCP calls are deployments OUT of that directory.
> A versioned ZIP of the directory IS the package — survives server
> death, can be re-deployed anywhere, can be shared peer-to-peer
> without going through any AIMEAT API.
>
> The AIMEAT packages API stays as an **optional** sharing channel for
> people who want public discovery and one-click instantiation. It is
> not required for backup or recovery.

---

## 1. The core principle

```
   ┌────────────────────────────────────────────┐
   │  Your local project directory               │
   │   (canonical source — survives everything)  │
   └─────────────┬───────────────────┬───────────┘
                 │                   │
        deploy   │                   │  zip
                 ▼                   ▼
   ┌─────────────────────┐    ┌──────────────────┐
   │  aimeat.io server    │    │  package-v3.zip   │
   │  (runtime)           │    │  (backup + share)  │
   └─────────────────────┘    └──────────────────┘
                                     │
                                     │ optional upload to
                                     ▼
                              ┌──────────────────┐
                              │ /v1/packages     │
                              │ (gallery / share) │
                              └──────────────────┘
```

The directory exists on your machine. MCP/API is just plumbing between
it and the server.

---

## 2. Canonical project structure

When Claude Code (or you) start a new AIMEAT app, scaffold this:

```
my-comic-app/
├── package.yaml              ← Single source of truth: metadata + manifest
├── README.md                 ← Human description (also used as package description)
├── CHANGELOG.md              ← What each version changed (also used as version changelog)
├── .aimeat/                  ← Tooling state — gitignore if you want
│   ├── deployed.json         ← Records what's live on which node (for redeploy diffs)
│   └── snapshots/            ← Local ZIP snapshots before each major change
│       ├── v2026-06-03-1442.zip
│       └── v2026-06-02-1801.zip
├── app/                      ← HTML/CSS/JS apps (one or more)
│   ├── comicland-v2-app.html
│   └── comicland-reader.html
├── cortex/                   ← Cortex libraries (one or more)
│   ├── manifest.yaml         ← Cortex spec
│   └── libs/
│       └── comicland-v2.js
├── extension/                ← Server-side WASM extension (one only — or named subdirs for multiple)
│   ├── manifest.yaml         ← Extension spec
│   └── scripts/
│       └── actions/
│           ├── activate.js
│           ├── add-character.js
│           └── publish-comic.js
├── translations/             ← i18n JSONs
│   ├── fi.json
│   └── en.json
├── memory/                   ← Seed memory entries (loaded on install)
│   └── settings.config.json
└── assets/                   ← Static files (icons, screenshots, sample data)
    ├── icon.svg
    └── screenshot.png
```

**Rules:**

1. **`package.yaml` at the root is the manifest.** Every component listed
   here is what gets deployed and what goes in the ZIP. If a file isn't
   in `package.yaml`, it's not part of the package.

2. **One project = one package.** Comicland is one project, even though
   it has app + cortex + extension. Multiple apps per project are fine
   (e.g., main app + reader), but they share one package.yaml.

3. **`.aimeat/` is local-only state.** Records what's already been
   pushed where, so re-deploys can skip unchanged files. Not part of
   the package. Safe to delete and re-derive from server state.

4. **`snapshots/` are pre-change backups.** Before any destructive
   operation, Claude Code writes a ZIP here. Lets you roll back if a
   "let me refactor the cortex" session went wrong.

---

## 3. The `package.yaml` format

This is the human-and-machine-readable contract:

```yaml
name: comicland-v2                  # unique per author, slug
version: v2026-06-03-1442           # auto-incremented or manual
author: happydude500001              # owner name (NOT GAII)
description: |
  Prompt-driven AI comic community on AIMEAT. Users compose comics from
  characters + environments + generated panels. Multi-language via AI
  translation.
category: community                  # for gallery
tags: [comics, ai, prompts, community, openrouter]
visibility: public                   # public = gallery-listable
license: MIT                         # optional

components:
  - id: app-main
    type: app
    label: "Comicland Main App"
    file: app/comicland-v2-app.html
    deploy:
      mcp_tool: aimeat_app_publish
      filename: comicland-v2-app.html
      icon: "🎨"

  - id: cortex-v2
    type: cortex
    label: "Comicland Cortex"
    dir: cortex/                     # bundled as ZIP at deploy time
    deploy:
      mcp_tool: aimeat_cortex_install
      name: comicland-v2

  - id: ext-v2
    type: extension
    label: "Comicland Extension (router actions)"
    dir: extension/
    deploy:
      mcp_tool: aimeat_extension_install
      name: comicland-v2

  - id: i18n-fi
    type: translation
    label: "Finnish translations"
    file: translations/fi.json
    deploy:
      mcp_tool: aimeat_memory_write
      key: comicland.i18n.fi

  - id: i18n-en
    type: translation
    label: "English translations"
    file: translations/en.json
    deploy:
      mcp_tool: aimeat_memory_write
      key: comicland.i18n.en

  - id: settings-default
    type: memory
    label: "Default settings"
    file: memory/settings.config.json
    deploy:
      mcp_tool: aimeat_memory_write
      key: comicland.settings

dependencies:                        # references between components
  app-main: [cortex-v2]              # app loads cortex
  cortex-v2: [ext-v2, i18n-fi, i18n-en, settings-default]  # cortex reads from ext + memory
```

The `deploy:` block per component tells Claude Code (or the CLI) which
MCP tool to call and what parameters to pass. Adding a new component
type later (e.g., schedules, capabilities) is a matter of adding a new
`type:` + `deploy:` shape.

---

## 4. The session lifecycle

### 4.1 Starting a new project

```
You (in VSCode): "Claude, scaffold a new AIMEAT app called comicland-v2
in this directory. It needs an app, a cortex, and an extension."

Claude Code:
  1. Creates the directory structure (§2)
  2. Writes a starter package.yaml (§3) with empty components
  3. Writes a starter README.md + CHANGELOG.md
  4. Creates an empty snapshot at .aimeat/snapshots/v<now>-initial.zip
  5. Reports: "Scaffolded. Tell me what each component should do."
```

### 4.2 Iterating

```
You: "Add a Publish Comic action to the extension that writes to
comicland.comics.{id}."

Claude Code:
  1. Edits extension/scripts/actions/publish-comic.js locally
  2. Updates extension/manifest.yaml to register the action
  3. Calls MCP aimeat_extension_install (with the updated ZIP) to deploy
  4. Verifies via curl / aimeat_extension_get that the action is live
  5. Does NOT auto-snapshot — waits for a checkpoint cue
```

### 4.3 Checkpointing (the moment that survives server death)

```
You: "Snapshot this as v3."

Claude Code:
  1. Bumps version in package.yaml to v2026-06-03-XXXX
  2. Updates CHANGELOG.md with what changed since last snapshot
  3. ZIPs the entire project dir (excluding .aimeat/snapshots/* to
     avoid recursion) into .aimeat/snapshots/<version>.zip
  4. Reports: "Snapshot saved locally at .aimeat/snapshots/<version>.zip.
     You can keep this ZIP anywhere — it has everything needed to
     re-deploy on any AIMEAT node."
```

That ZIP is **self-sufficient**. Lose the aimeat.io server, lose your
VSCode workspace, lose everything — as long as you have the ZIP, you
can restore the entire app stack on any AIMEAT node.

### 4.4 Recovery (server died, you have the ZIP)

```
You: "Restore comicland-v2 from this ZIP on my new node."

Claude Code:
  1. Unzips into a fresh directory
  2. Reads package.yaml
  3. For each component, calls the corresponding MCP tool to deploy
  4. Updates .aimeat/deployed.json to record the new node
  5. Reports: "Restored. App is at https://newnode/v1/apps/.../<filename>"
```

### 4.5 Sharing (no API involvement required)

```
You: "Send this ZIP to my friend."

You: drop the ZIP in an email / drive / chat.

Friend (also has Claude Code + an AIMEAT node):
  "Install this comicland ZIP on my node."

Friend's Claude Code:
  1. Unzips
  2. Reads package.yaml
  3. Deploys components to friend's node (under friend's owner name)
  4. Reports done.
```

No `/v1/packages` involved. No gallery. No proposal. Just a ZIP and a
re-deploy.

### 4.6 Sharing via gallery (the API path, optional)

If you want public discoverability:

```
You: "Publish this package version to the AIMEAT gallery."

Claude Code:
  1. Reads the latest snapshot ZIP
  2. POSTs to /v1/packages/import (which now also accepts public
     visibility) OR POSTs to /v1/packages/:groupId/versions if it's
     a known package
  3. Sets visibility: public
  4. Reports: "Published to gallery at /v1/packages/<groupId>"
```

Now anyone browsing the AIMEAT gallery can one-click instantiate.

---

## 5. Where the existing AIMEAT packages API fits

The server-side `/v1/packages` API already supports:

- Versioned package records (groupId + version)
- ZIP export (`GET /v1/packages/:groupId/export`)
- ZIP import (`POST /v1/packages/import`)
- Public/private visibility
- Propose-to-gallery flow
- All seven component types (CSM, ext, cortex, app, MSM, memory, translation)

In the local-first model, this API serves two purposes:

1. **Gallery / discovery** — when you want others to find your package
   without sending them a file.
2. **Cross-node import shortcut** — instead of unzipping + N×MCP calls,
   point a new node at `/v1/packages/import` with the ZIP and the
   server does all the deploys server-side.

Neither is required. The local ZIP works without ever touching this
API.

---

## 6. What needs to be built

The pieces of the local-first workflow that don't exist yet:

### 6.1 `v2/mcp/appdev` — focused MCP surface

A NEW MCP namespace, separate from the bloated `/v1/mcp` (which already
has 123 tools and confuses smaller LLMs). Only the tools an appdev
session needs:

| Tool | Purpose |
|---|---|
| `aimeat_appdev_snapshot_local` | Server-side: given a list of owner-installed components, return the manifest YAML that the agent can write into a local package.yaml. Used when starting a project around existing-live components ("export what I've already built into a package"). |
| `aimeat_appdev_deploy_component` | Server-side: thin wrapper that takes one component spec + content and dispatches to the right install tool. Saves the agent from remembering which underlying tool per type. |
| `aimeat_appdev_diff_against_live` | Server-side: compares local package.yaml against what's actually on the node. Returns "these files in your package match live; these differ; these are missing." Used at checkpoint to confirm reality. |
| `aimeat_appdev_import_zip` | Server-side: accepts a ZIP, deploys every component in it. The "restore from backup" one-shot. |

That's four tools instead of the current zero. Small enough for any
LLM, focused enough for the workflow.

Also mirror this in **aimeat-connect server** so personal-node users
get the same tools without needing the cloud node.

### 6.2 CLI helper

```bash
aimeat package init my-comic-app     # scaffolds §2 structure
aimeat package validate              # checks package.yaml against files
aimeat package zip                   # ZIPs into .aimeat/snapshots/<version>.zip
aimeat package deploy <node>         # uses MCP/HTTP to push each component
aimeat package diff <node>           # compares local vs live
aimeat package import <zip>          # extracts ZIP into current dir
```

Lives in the existing `aimeat` CLI (`aimeat/src/cli/`). Doesn't require
MCP — works with any AIMEAT node that has the HTTP API.

### 6.3 Skill / instruction file

A markdown file Claude Code loads when working on an AIMEAT app project.
Tells it:

- The project structure (§2)
- The `package.yaml` format (§3)
- The session lifecycle (§4)
- Naming conventions
- When to snapshot (only on explicit "snapshot this" / "checkpoint")
- How to call `v2/mcp/appdev` tools

Placed at `.claude/skills/aimeat-appdev.md` or similar — Claude Code
auto-loads it when present.

### 6.4 Documentation

This document is part of it. Plus:

- A short "getting started" walkthrough in the existing docs
- A reference for the `package.yaml` schema
- A migration guide for people who already have apps deployed and want
  to retroactively create a project directory ("`aimeat_appdev_snapshot_local`
  → save manifest → fetch files via existing GETs")

---

## 7. Open questions before implementation

### 7.1 Snapshot zip location

Inside the project dir (`.aimeat/snapshots/`) keeps everything local and
gitignorable. OR a separate central location (`~/.aimeat/snapshots/`)
keeps snapshots reachable even if the project dir is moved. **Default
recommendation: project-dir local, with `aimeat package snapshot --to <path>`
to override.**

### 7.2 Component-level versioning

Today each MCP install (app, cortex, extension) auto-increments its own
version on the server. Project-level version (`v2026-06-03-1442` in
package.yaml) is independent. **Recommendation: package version is the
checkpoint label; component versions inside the package are whatever
the server gave them. The ZIP records both.**

### 7.3 Deploy idempotency

If the agent re-deploys an unchanged component, does it bump the
server's version counter? Today: yes (every POST is a new version).
**Recommendation: `aimeat_appdev_deploy_component` does a content hash
diff first and skips if identical. Optional `--force` to override.**

### 7.4 Multi-target deploys

Can one package live on multiple nodes (dev + prod)? **Recommendation:
yes, `.aimeat/deployed.json` is a map of `<nodeUrl>: { component_id: version }`
so the same project tracks state per target.**

### 7.5 Cross-machine collaboration

Two people on Claude Code want to co-develop the same project.
**Recommendation: out of scope for v1. Treat it as "git clone the
project dir." `.aimeat/deployed.json` is per-machine.**

---

## 8. Build order if you say go

Given the answers you gave (full set + on-demand + public+local-zip):

1. **Doc + skill first** (this file + a short Claude Code skill) — so we
   agree on the structure before any code commits to it
2. **CLI helper** (`aimeat package init/validate/zip/deploy/import`) —
   pure local, doesn't depend on server changes, smallest blast radius
3. **`v2/mcp/appdev` namespace** in `aimeat/src/mcp/v2/` with the four
   focused tools listed in §6.1
4. **Mirror to aimeat-connect server** so personal nodes have it too
5. **Documentation polish** — getting-started + schema reference + a
   tutorial that does "build Comicland-mini end to end with backups"

Roughly one or two iterations to land. The CLI is the lift-the-ceiling
piece; everything else is wiring.

---

## 9. What this changes about the Claude Code → AIMEAT loop

Before:

> Claude publishes an app via MCP → row on server → no local record →
> server dies → work gone.

After:

> Claude scaffolds a project dir → writes files locally → deploys via
> MCP → tracks state in `.aimeat/deployed.json` → at checkpoint, ZIPs
> the whole thing into `.aimeat/snapshots/<version>.zip` → ZIP is
> portable, restorable, shareable without any AIMEAT API involvement.

The server becomes a deployment target, not a source of truth. Lose
the server, restore from ZIP onto a new server, you're back. Want to
share with a friend, send the ZIP, they restore on their node.
