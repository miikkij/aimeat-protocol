---
name: skills-cookbook
description: Everything the owner can do with AIMEAT skills — find, load, install into Claude Code/Desktop/claude.ai, boost agents, author, share via workspaces, bind to apps, pin versions. Use whenever the owner asks "what was that skills thing", how to install a skill, or what they can instruct an AI to do with skills.
license: MIT
metadata:
  audience: owner
  mirror: handbook page hb-skills-cookbook (AIMEAT dev organism, Handbook workspace)
---

# Skills cookbook — everything you can ask your AI to do

Every recipe below is a sentence the owner can say to any AI with the AIMEAT connector.
UI locations are given alongside. Keep answers concrete: run the tool, show the result.

## 1 · Find out what exists
- "List the skills I can use" → `aimeat_skill_list` (node library + own + workspaces).
- "Show this workspace's overview" → the map includes a **Skills (loadable expertise)** table with copy-ready refs.
- "What skills teach the app X?" → `aimeat_skill_list` with `binding: app:{owner}/{file}`.
- UI: Profile → Skills · workspace → Skills tab · Admin → Skills · app catalog → app detail.

## 2 · Use a skill right now (zero install)
- "Load the AIMEAT skill `node:diagnose-a-workflow` and apply it" → `aimeat_skill_get`.
- Native mode: nothing to install, always fresh, pinnable with `@1.0.2`.

## 3 · Install into Claude (works without the connector / auto-triggers)
- Claude Code / Desktop Cowork: "Install the AIMEAT skill `node:manage-my-agents` locally"
  → fetch via `aimeat_skill_get`, write `~/.claude/skills/{name}/` (project: `./.claude/skills/`),
  stamp `metadata.aimeat_ref: {ref}@{version}` + `aimeat_node` for update checks.
  CLI: `aimeat skill install node:manage-my-agents` (also `--project`, `--dir`, `--node/--token`).
- claude.ai chat: Skills tab → **⤓ .zip** (`GET /v1/skills/{name}/zip`) → upload in Settings → Skills.
- Full recipe lives in the node skill `install-skills-locally`.

## 4 · Boost an agent
- "Link the skill `node:set-up-content-pipeline` to my agent crew-forge" → `aimeat_skill_link`.
- UI: Profile → Agents → agent → Data Access → Skills picker. Links are refs (fresh at load);
  pin production-critical ones (`…@1.0.0`). Crews: CrewSpec `skills` / `registry_skills` /
  `workspace_skills` (opt-in).

## 5 · Create / share
- "Create a skill called `sanomat-style` that teaches …, and publish it" → `aimeat_skill_publish`
  (frontmatter: name + description = "what + when"). Republish bumps the version; last 10 pinnable.
- Workspace skill (team-shared, rides exports/templates): workspace → Skills tab, or publish with
  scope=workspace. App-bound: Profile → Apps → card → Attach skill, or frontmatter
  `metadata.binding: app:{owner}/{filename}` — agents check an app's skills before driving it.

## 6 · Operator moves (propose-then-confirm — show the owner the diff)
- "Set my daily AI budget to 2" → `aimeat_operator_ai_config` (API key untouchable).
- "Retag agent X / narrow its scopes" → `aimeat_operator_agent_configure` (narrow-only).
- "Save this workflow but propose first" → `aimeat_workflow_save` with `propose: true`.

## 7 · Ref forms
node:{name} · user:{owner}/{name} · ws:{org}/{ws}/{name} · any + @{semver} · binding target app:{owner}/{filename}
