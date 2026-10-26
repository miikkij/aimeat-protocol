# Skills Registry — SKILL.md packs for agents, crews, workspaces and apps

The skills registry makes **expertise a first-class, portable unit**: a `SKILL.md` pack in the
[Agent Skills format](https://agentskills.io/specification) (the format Claude Code, Claude.ai,
Cursor, Copilot, CrewAI and the other clients read) that lives in a scoped registry on the node and
is loaded by agents **by reference** — never copied into prompts by hand.

Core principle: **skill (content) ≠ registry (scope) ≠ attachment (consumer).**
A skill doesn't know where it lives; a registry is just a memory-key namespace with the
platform's existing access rules; consumers (agents, crews, AI chats, apps) resolve refs
through one choke point (`resolveSkillRef()` in `aimeat/src/services/skills.ts`).

> Skills are **NOT knowledge packages**. Knowledge packages are curated memory collections;
> skills are prompt-injected expertise with a strict contract and their own system.

## The SKILL.md contract

A skill is a directory `skill-name/` with a required `SKILL.md` plus any other files beside it:
`scripts/`, `references/` and `assets/` by convention, and a `LICENSE.txt`, a `forms.md` at the root
or a `templates/` folder just as well. A file path must stay inside the folder on every platform
(`isAllowedSkillPath` in `aimeat/src/services/skill-md.ts`): no `..` segment, no leading `/`, no
backslash, no `:` or other character Windows reserves, no control character, no device name such as
`NUL`, no segment ending in a dot or a space, no `.git` folder, at most 200 characters, and no second
spelling of `SKILL.md`. A path that breaks one is refused with 422 `BAD_FILE_PATH`. A ZIP upload drops
the Finder's `__MACOSX/` and `.DS_Store` entries.

`SKILL.md` is UTF-8 text. Any other file may be text or bytes: a file that is not UTF-8 text (an
image, a font, a PDF) is stored as base64 and its entry in the manifest's `files` says
`encoding: "base64"`. Readers decode it: the ZIP download and `aimeat skill install` write the bytes,
and an AI reading `fileContents` is told so in the tool description. Over JSON (POST `/v1/skills`,
`aimeat_skill_publish`) a binary file is sent as `{ "content": "<base64>", "encoding": "base64" }`.

```markdown
---
name: sanomat-editorial-style          # 1–64 chars, lowercase a-z 0-9 hyphens, = dir name
description: House editorial voice and structure rules. Use when writing or editing any article for Sanomat.
license: MIT                            # optional
compatibility: crewai>=1.15             # optional, free text
metadata:                               # optional mapping; travels with the skill
  audience: crew
---

# Sanomat editorial style

The markdown body is the expertise — injected into an agent's prompt on activation.
Keep it focused (<~50k chars; hard cap 100k). Big material goes into references/ files.
```

- `description` is the **discovery index key** — write "what it does + when to use it".
- Republishing the same name **patch-bumps** the registry version (`1.0.0 → 1.0.1 → …`).
  A republish holds exactly the files it sends; `keep_files: true` keeps the files the skill already
  holds that it does not send, which is how the Skills pages and the app binding change SKILL.md alone.
- `allowed-tools` is accepted as inert metadata only — it never provisions tools.

**The standard's stricter rules.** A skill NEW to its registry must also follow the two rules of
the Agent Skills specification that its reference validator (`skills-ref`) refuses, or it is refused
with 422 `NOT_STANDARD`: no two hyphens in a row in `name`, and `compatibility` at most 500
characters. A skill already in the registry was published under the older rules and republishes as
before. Either way the answer's `skill.standardIssues` lists everything that breaks the standard,
including what only warns: a top-level field the standard does not define (Claude Code adds some;
move it under `metadata` to keep the skill portable), an empty `compatibility`, an `allowed-tools`
that is not a string, and a `metadata` value that is not a string. The last one warns rather than
refuses because `skills-ref` reads every YAML value as a string and accepts `version: 1.0`, a list or a
map, so AIMEAT refuses no skill the reference validator accepts, with one exception: a name with a
letter outside a–z (`café-notes`), which `skills-ref` accepts and the specification's own text does
not, is refused with `BAD_NAME`, because a name is part of every ref and memory key. A package install publishes its
skills with warnings only, so a package composed before 2026-10-26 still installs. The built-in
skills are checked against the reference validator in the gate (below).

## Scopes and refs

| Scope | Ref | Who reads | Managed from |
|---|---|---|---|
| Node | `node:{name}` | every authenticated identity on the node | Admin → Skills |
| User | `user:{owner}/{name}` | the owner + their agents; `members`/`public` opt-in | Profile → Skills |
| Workspace | `ws:{org}/{ws}/{name}` | organism-workspace members; rides workspace **exports and templates** | workspace → Skills tab |
| App-bound | any node/user ref + a **binding** (below) | the skill's own scope rules | Profile → Apps (attach picker) |

**Version pins:** every ref accepts `@{semver}` — `user:alice/style@1.0.2` resolves the
immutable snapshot written at that publish (the registry retains the newest **10**; an
unretained pin fails loud with "not retained"). Pin registry-linked skills on
production-critical consumers; leave shared/curated surfaces on latest.

**Agent attachment:** links live at memory key `agents.{name}.skills` as **refs, never
copies** — owners link in the agent's Data Access tab or from the skill's opened row on the
profile Skills page; agents/operators via `aimeat_skill_link`. Consumers resolve fresh content
at load time. `GET /v1/skills?include=links` returns each library skill with `linkedBy`, the
caller's own agents that hold its ref (a pinned ref keeps its `@version`).

**Versions and visibility:** resolving a skill returns `versions`, the retained snapshots a
pin can name. Visibility changes **without a republish**: `PATCH /v1/skills/{name}?scope=user`
with `{ visibility }` (node scope for operators; `aimeat_skill_update` over MCP) — the version
stays and no snapshot is written. Publishing is still the only way to change the text.

**Retiring a skill:** name the successor in the frontmatter, `metadata.superseded_by: user:alice/new-name`
(a ref or a bare name); the registry mirrors it to `supersededBy`, and the Skills page lists
the skill as replaced instead of leaving the fact in the description.

## App-bound skills (`binding`) — how and why

**Why:** an AI-boosted app (an app calling `AIMEAT.ai.complete()`, or any app an agent is
asked to drive) has usage knowledge that belongs *with the app*, not in every agent's
prompt: what the app is for, its data keys, its quirks, the right workflow. Binding a skill
to the app lets ANY agent that is about to use the app fetch exactly that expertise on
demand — progressive disclosure at the app level.

**How to set it (the skill author does this — the binding lives in the SKILL's frontmatter,
so it survives export/clone/republish):**

```markdown
---
name: drop-filing-guide
description: How to file notes correctly in the DROP app — spaces, titling, and when to link a TARGET. Use whenever operating DROP on behalf of the owner.
metadata:
  binding: app:happydude500001/drop.html   # app:{ownerName}/{filename}
---

# Filing in DROP
1. Always classify before filing …
```

Publish it like any skill (`POST /v1/skills`, `aimeat_skill_publish`, or the profile Skills
tab). The node validates the format (`app:{owner}/{filename}`, 422 otherwise) and mirrors it
to `manifest.binding` for cheap filtering. A user-scope skill binds only to an app of its own
publisher: a binding to another account's app is refused with 422 `BAD_FIELD`, and the app
listings leave out any user skill whose owner does not own the app (since 2026-10-09; the app's
public pages present a bound skill as that app's own guide). A node-scope skill is the
operator's and may name any app on the node; a workspace skill's binding is not checked,
because no app listing reads workspace skills.

**Owner shortcut:** in the profile **Apps tab**, every "My Apps" card shows its bound skills
with an **Attach skill / detach** picker — attaching rewrites the chosen skill's frontmatter
binding and republishes it (version bumps). The public **app catalog detail view** shows an
app's bound skills to everyone (visitors see public-bound ones; the route needs no sign-in).

**How consumers fetch them:**

```
GET /v1/apps/{owner}/{filename}/skills            # by app identity
GET /v1/skills?binding=app:{owner}/{filename}     # same, query form
aimeat_skill_list { binding: "app:{owner}/{filename}" }   # MCP
```

Response: manifest summaries (ref/name/description/version). Load bodies with
`aimeat_skill_get {ref}` / `GET /v1/skills/{name}?scope=…`.

**The agent pattern** (also seeded as the node skill `use-app-bound-skills`):
before driving an app, list its bound skills; if any exist, resolve and apply them; if the
description says "use whenever operating X", treat it as required reading.

**A package carries them.** When you compose a package from your apps (`aimeat_package_compose`,
`POST /v1/packages/compose`), each of YOUR OWN user-scope skills bound to one of those apps goes
into the package as a `skill` component that depends on the app. A skill you can only read, and a
node skill, stay behind; `include_skills: false` leaves them all behind. Installing the package
publishes each skill in the installer's own registry under its own name, visibility `owner`, with
`metadata.binding` rewritten to the installer's copy of the app, so the customer's AI has the
operating guide for every app it installed. The installed skill carries `fromPackage`
(`{ groupId, instanceId }`). The installer's own skill always wins: when they already have a skill
of that name that the package did not publish, the install leaves it as it is and names it in
`warnings`. An update replaces, and an uninstall with `removeComponents` removes, only a skill that
install published. Code: `services/packages/install/package-skill-component.ts`.

## Consuming from crewaimeat (JSON crew definitions)

crewaimeat resolves registry skills at **crew build time** — fetch-fresh, materialized to a
temp dir, validated fail-loud, merged with precedence **repo-local > owner-linked >
workspace-auto**. `Agent(skills=[])` is rejected by crewai — pass `None` when empty.

A JSON crew definition (`crew_def.py` contract) carries skills declaratively:

```jsonc
{
  "name": "sanomat-editorial",
  "skills": ["sanomat-editorial-style"],        // bare name -> <repo>/skills/<name>/ (strongest pin: git)
  "registry_skills": true,                       // default: also fetch the agent's LINKED skills
  "workspace_skills": true,                      // OPT-IN (default false): auto-attach the target
                                                 // workspace's skills (derived from record_spaces)
  "agents": [
    {
      "role": "editor",
      "skills": ["user:happydude500001/comedy-set-craft@1.0.0"]   // per-agent, PINNED registry ref
    }
  ]
}
```

- **Pin policy** (agreed in the shared spec): repo-local skills need no pin (git is the pin
  and they shadow registry copies); registry-linked skills on production-critical crews are
  pinned at link time; workspace auto-attach stays deliberately latest.
- An app-driving crew should additionally fetch `?binding=app:{owner}/{file}` for the app it
  operates and inject those skills for the driving agent.

## Crews on a person's own computer

A crew that runs on a person's own computer goes through the connector (`aimeat connect serve`)
and the same crewaimeat runtime, so **everything above applies unchanged**: its agents
authenticate to the node with the connector's token, `fetch_agent_skills()` pulls their linked
refs, the `workspace_skills` opt-in pulls the target workspace's packs, and pins behave the same.
The owner curates skills on the node and every crew picks them up on its next build. An offline
or unreachable node degrades loudly to repo-local skills only (the standard failure boundary).

The desktop appliance that once ran such crews (aimeat-agency) is gone: the aimeat-desktop app
removed its local agent runner on 2026-09-29 and now attaches AI tools to an AIMEAT and can run a
local node (`aimeat-desktop/README.md`).

## Installing skills into Claude (Code / Desktop / claude.ai)

The SKILL.md contract is the Anthropic agent-skill format, so a registry skill installs
anywhere Claude reads skills — three ways:

1. **CLI (Claude Code / Desktop Cowork):**
   ```bash
   aimeat skill install node:manage-my-agents                 # → ~/.claude/skills/
   aimeat skill install user:alice/style@1.0.2 --project      # → ./.claude/skills/
   aimeat skill install ws:ORG/WS/team-style --dir D:\skills  # explicit target
   # auth: connector primary config by default; --agent <name>, or --node <url> --token <jwt>
   ```
   Provenance (`metadata.aimeat_ref` + `aimeat_node`) is stamped into the local SKILL.md,
   so a re-run detects/installs updates.
2. **ZIP (claude.ai chat):** `GET /v1/skills/{name}/zip` — the profile/workspace Skills tabs
   have a **⤓ .zip** button. The ZIP is already in the `{name}/SKILL.md` layout claude.ai's
   skill upload expects; it also unzips straight into `~/.claude/skills/`. `@semver` pins work.
3. **Self-install by any connected Claude:** with the AIMEAT MCP connector, ask
   "install the AIMEAT skill node:xyz locally" — `aimeat_skill_get` + write the files. The
   seeded node runbook **`install-skills-locally`** teaches exactly this (paths per surface,
   provenance, update check).

Zero-install remains the native mode: a connected Claude can always `aimeat_skill_get` the
expertise on demand — install only when the skill must work without the connector or should
auto-trigger via Claude's native skill discovery.

## Where AI chats see skills (MCP)

Loading follows the Agent Skills standard's three levels of progressive disclosure, so a large skill
never fills the reader's context at once:

| Level | What the reader gets | MCP | REST |
|---|---|---|---|
| 1. Metadata | name, description, version, file index | `aimeat_skill_list`, or `aimeat_skill_get { manifest_only: true }` | `GET /v1/skills`, `GET /v1/skills/{name}?manifest_only=true` |
| 2. Instructions | the above plus SKILL.md | `aimeat_skill_get { body_only: true }` | `GET /v1/skills/{name}?body_only=true` |
| 3. Resources | the above plus one file | `aimeat_skill_get { path: "references/forms.md" }` | `GET /v1/skills/{name}?path=references/forms.md` |

Without any of the three, `aimeat_skill_get` returns every file at once, as it always did. A `path`
the skill does not hold is 404 / `FILE_NOT_FOUND`, and the lookup stops there instead of trying the
node library's skill of the same name.

- `aimeat_skill_list` — `library` (node + user + workspace memberships), `linked`, `mine`,
  `workspace`, or `binding=` views; manifests only (progressive disclosure).
- `aimeat_skill_get {ref}` — the body; supports `@semver` pins, on the connector too.
- **`aimeat_workspace_overview` includes a "Skills (loadable expertise)" table** with
  ready-to-copy `ws:` refs — an AI connected to a workspace sees available expertise in the
  same single map read it already does, no extra calls.
- The node seeds its built-in skills from `src/data/builtin-skills*.ts` on every boot: runbooks for
  node and profile management (`aimeat-node-operations`, `manage-my-agents`, `configure-routing`, …),
  the app builders, the game skills, and the conversation skills that steer the node's own chat
  (`aimeat-first-conversation`, `aimeat-welcome-pages`, `aimeat-paying-for-the-ai`, …). An
  unedited copy follows the repo; a copy edited on the node is kept. List them with
  `aimeat_skill_list`. `pnpm check:skills-standard` writes each one out as a skill folder and runs
  the specification's reference validator, `skills-ref` (pinned, through uv), on all of them; `pnpm
  gate` runs it when a built-in skill or the check changed, so a built-in skill that breaks the
  standard does not reach main.

## Discovery from outside, and other nodes

`GET /.well-known/agent-skills/index.json` (Agent Skills Discovery RFC v0.2.0) lists every public
node-scope skill with the URL of its exact SKILL.md and that file's sha256; the other files of such a
skill are read with `GET /v1/skills/{name}?scope=node&path=…`, which needs no sign-in for a public
skill. A session from another node reads skills as an anonymous caller does, so it sees public skills
only. Skills are not copied between nodes: the federated ref form (`skill:{name}#{owner}@{node}`) is
not built, and a skill reaches another node only inside a package (above) or a workspace export.

## Security

Skill ZIP uploads go through the hardened `safeUnzip` (traversal/symlink/zip-bomb guards) with
the path rule of the contract above; publish/link are owner-authed; operator config-writes use
propose-then-confirm tokens.

**Reading a workspace skill is membership-gated** (`canReadWorkspace`). **Writing one asks the
workspace WRITE rule**, because a workspace skill is workspace content stored under
`organism.{org}.w.{ws}.skills.*` that every member's agents load as instructions: publishing or
deleting it needs the workspace's registered creator, an organism manager, or an active
`workspace-contributor` grant (`services/skill-workspace-gate.ts`, Core 2026-11 COL-09). A `viewer`
grant reads and does not write. The delete removes every member's copies for the creator and an
organism manager; a contributor removes their own.
