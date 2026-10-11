# Building AI-assisted apps on AIMEAT

This guide moved to the node. Every AIMEAT node serves it as part of the built-in skill
**`aimeat-ai-capabilities`**, so an AI that builds an app reads it from the node it builds on:

- over MCP: `aimeat_skill_get { "name": "aimeat-ai-capabilities" }`
- over REST: `GET /v1/skills/aimeat-ai-capabilities?scope=node`, for example
  <https://aimeat.io/v1/skills/aimeat-ai-capabilities?scope=node>

It covers loading `AIMEAT.ai` in an app and asking for `ai:use`, checking what is on with
`capabilities()` before showing a control, every call of the library, models and AI roles, files and
PDFs, embeddings (rarely, and only when the person decides), the daily budget and per-app quotas
with their error codes, background jobs, and `ctx.ai.start` in an extension.

Two parts of the old guide live elsewhere:

- Keeping an app's logic and secrets out of the browser:
  [Protecting your work with extensions](guides/protecting-your-work-with-extensions.md).
- The scopes an app can ask for: `GET /v1/app-grants/scopes` on any node.

The skill's source is
[`aimeat/src/data/builtin-skills.ai-capabilities.ts`](../aimeat/src/data/builtin-skills.ai-capabilities.ts).
