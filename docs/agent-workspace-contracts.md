# Agent workspace contracts

This guide moved to the node. Every AIMEAT node serves it as the built-in skill
**`aimeat-workspace-contracts`**, so an agent reads it from the node it works on:

- over MCP: `aimeat_skill_get { "name": "aimeat-workspace-contracts" }`
- over REST: `GET /v1/skills/aimeat-workspace-contracts?scope=node`, for example
  <https://aimeat.io/v1/skills/aimeat-workspace-contracts?scope=node>

It covers the contract an agent carries, adding its spaces to a workspace, the `workspace.record`
event that wakes a connected agent, a loop that is safe to run again, the discovery tags, the
`adopt-contract` task, engagements, and the optional objectives, KPIs and `_meta` note.

Older references to sections of this file: §7b is now section 8 of the skill (tags), §7c is
section 9 (the adopt-contract task), §7d is section 10 (engagements), and §9 is section 11
(objectives and KPIs).

The skill's source is
[`aimeat/src/data/builtin-skills.workspace-contracts.ts`](../aimeat/src/data/builtin-skills.workspace-contracts.ts).
