# Skills Registry — SKILL.md packs for agents, crews, workspaces and apps

The skills registry makes **expertise a first-class, portable unit**: a `SKILL.md` pack
(the same format as Claude skills and CrewAI skills) that lives in a scoped registry on the
node and is loaded by agents **by reference** — never copied into prompts by hand.

Core principle: **skill (content) ≠ registry (scope) ≠ attachment (consumer).**
A skill doesn't know where it lives; a registry is just a memory-key namespace with the
platform's existing access rules; consumers (agents, crews, AI chats, apps) resolve refs
through one choke point (`resolveSkillRef()` in `aimeat/src/services/skills.ts`).

> Skills are **NOT knowledge packages**. Knowledge packages are curated memory collections;
> skills are prompt-injected expertise with a strict contract and their own system.

## The SKILL.md contract

A skill is a directory `skill-name/` with a required `SKILL.md` plus optional
`scripts/`, `references/`, `assets/` — no other paths are accepted (422).

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
- `allowed-tools` is accepted as inert metadata only — it never provisions tools.

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
copies** — owners link in the agent's Data Access tab; agents/operators via
`aimeat_skill_link`. Consumers resolve fresh content at load time.

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
to `manifest.binding` for cheap filtering.

**Owner shortcut:** in the profile **Apps tab**, every "My Apps" card shows its bound skills
with an **Attach skill / detach** picker — attaching rewrites the chosen skill's frontmatter
binding and republishes it (version bumps). The public **app catalog detail view** shows an
app's bound skills to everyone (visitors see public-bound ones).

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

## aimeat-agency (desktop appliance)

aimeat-agency runs local crews through the same crewaimeat runtime, so **everything above
applies unchanged**: its local agents authenticate to the node (connector/daemon token),
`fetch_agent_skills()` pulls their linked refs, `workspace_skills` opt-in pulls the target
workspace's packs, and pins behave identically. The appliance needs no skill-specific code —
the owner curates skills on the node (profile/admin/workspace UIs) and every agency crew
picks them up on its next build. Offline/unreachable node degrades loudly to repo-local
skills only (the standard failure boundary).

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

- `aimeat_skill_list` — `library` (node + user + workspace memberships), `linked`, `mine`,
  `workspace`, or `binding=` views; manifests only (progressive disclosure).
- `aimeat_skill_get {ref}` — the body; supports `@semver` pins.
- **`aimeat_workspace_overview` includes a "Skills (loadable expertise)" table** with
  ready-to-copy `ws:` refs — an AI connected to a workspace sees available expertise in the
  same single map read it already does, no extra calls.
- 7 seeded node runbooks teach node/profile management (`aimeat-node-operations`,
  `manage-my-agents`, `configure-routing`, …) — list them with `aimeat_skill_list`.

## Security

Skill ZIP uploads go through the hardened `safeUnzip` (traversal/symlink/zip-bomb guards) with
a strict layout allowlist; publish/link are owner-authed; workspace scope is membership-gated
(`canReadWorkspace`); operator config-writes use propose-then-confirm tokens.
