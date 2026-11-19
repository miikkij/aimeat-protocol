# Portal and hosted-app development

Choose the guide for the surface you are changing.

## The node's own web interface

Use [the frontend development guide](frontend-development-guide.md) for the
Preact and HTM application under `aimeat/public/`. It explains view modules,
shared components, localization and verification.

Read [CLAUDE.md](../CLAUDE.md), the frontend path rule and the current frontend
verification skill before editing platform UI.

## A hosted application

Read the target node's `GET /v1/prompts/build-app-atelier` first. It is the build
specification for every app; its platform sections cover what only some apps need. The
Classic track was retired on 2026-11-19. Use `GET /v1/app-templates` or the node's
app-building tools to select a supported starter (a genre, the Atelier shell or a use case).

Hosted apps have their own origins and owner-approved grants. Use the served
authentication and data SDK. The node's internal `/js/api.js` module and owner
session are not a portable hosted-app authentication contract.

See:

- [AI-assisted apps](app-developer-ai-guide.md)
- [Extension, cortex and app stack](guides/building-extension-cortex-app-stack.md)
- [Agent-data dashboard](guides/agent-data-dashboard-cookbook.md), an app that shows what the
  person's agents found and gives one of them a follow-up task, with a cortex and no extension
- [Agent commissioner](examples/agent-commissioner.html), a one-page example that gives one of
  the person's agents a task and follows it to its deliverable. It declares the scopes it uses
  with `<meta name="aimeat-scopes">`, because the default app grant covers memory and storage only
- [Ecosystem applications](building-an-aimeat-compatible-ecosystem-app.md), for
  independently hosted applications with a GEAI identity

This entry point replaces a second SDK and authentication guide whose examples
had diverged from the current app model. Keep detailed API signatures in the
served SDK documentation and the relevant guide.
