/**
 * @file app-agent-surfaces.ts
 * @description The per-origin agent documents a published app serves on its own host: llms.txt,
 *   AGENTS.md and sitemap.md. All three are built from the same three inputs — the app record, its
 *   tool manifest, the node config — so they cannot describe different apps, and there is no
 *   per-app configuration anywhere: an app gets its origin automatically on first open, so anything
 *   needing a manual step would be missing from every app already published.
 *
 *   The first pass pointed all three paths at the app's Agent Face. That was one document too few.
 *   A scanner asked llms.txt for a blockquote summary and link lists, asked sitemap.md for links,
 *   and asked AGENTS.md for installation/configuration/usage sections; the Agent Face is prose
 *   about what the app does and has none of those shapes. The face is still the substance — each
 *   document wraps it in the structure its own convention asks for.
 *
 * @structure
 *   - appLlmsTxt(config, app, tools, face)   — llmstxt.org shape: H1, blockquote, H2 link lists
 *   - appAgentsMd(config, app, tools, face)  — Installation / Configuration / Usage
 *   - appSitemapMd(config, app, origin)      — H2 sections with links to this origin's surfaces
 * @usage
 *   const face = await buildAppAgentFace(config, storage, app);
 *   res.type('text/plain; charset=utf-8').send(appLlmsTxt(config, app, tools, face?.markdown));
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 12b)
 */
import type { AimeatConfig } from '../config.js';
import type { AppRecord } from '../storage/interface.js';

/** Display name for an app: its manifest name, else the filename without its extension. */
export function appDisplayName(app: AppRecord): string {
  return app.manifest?.name?.trim() || app.filename.replace(/\.[^.]+$/, '');
}

/** One-line summary, falling back to something true rather than something empty. */
export function appSummary(app: AppRecord): string {
  const d = app.manifest?.description?.trim();
  if (d) return d;
  return `${appDisplayName(app)} — an application published on AIMEAT by ${app.ownerName}.`;
}

/** The two identifiers every call needs, stated literally because one of them is guessable-wrong. */
function identifiers(app: AppRecord): string {
  return `    owner:  ${app.ownerName}
    app_id: ${app.filename}        (not "${app.filename.replace(/\.[^.]+$/, '')}")`;
}

/**
 * The app's llms.txt: H1, blockquote summary, H2 sections whose bodies are link lists, then the
 * Agent Face as the substance. Served as `text/plain` — the llmstxt.org convention names that
 * content type, and this path had been answering `text/markdown`.
 */
export function appLlmsTxt(
  config: AimeatConfig, app: AppRecord, origin: string, tools: string[], face?: string,
): string {
  const b = config.baseUrl.replace(/\/$/, '');
  const o = encodeURIComponent(app.ownerName);
  const f = encodeURIComponent(app.filename);
  const toolLines = tools.length
    ? tools.map((t) => `- \`${t}\` — call via \`aimeat_app_tool_invoke { owner: "${app.ownerName}", app: "${app.filename}", tool: "${t}" }\``).join('\n')
    : '- This app publishes no priced tools.';

  return `# ${appDisplayName(app)}

> ${appSummary(app)} Published on AIMEAT by ${app.ownerName}; served at ${origin}. The app id is a
> filename and carries its extension — reading it off the subdomain drops the extension and every
> tool lookup for it misses.

## Documentation

- [This app](${origin}/): the running application
- [Agent orientation](${origin}/AGENTS.md): how to call this app
- [Site map](${origin}/sitemap.md): every document this origin serves
- [Full content](${origin}/llms-full.txt): this document, at the conventional full path
- [MCP Server Card](${origin}/.well-known/mcp.json): the server, transport and this app's tools

## Discovery

- [Tool listing](${b}/v1/apps/${o}/${f}/webmcp): every tool with its input and output schema
- [Bound skills](${b}/v1/apps/${o}/${f}/skills): what an agent can learn to use this app well
- [Node manual](${b}/llms.txt): the AIMEAT node this app runs on
- [Node glossary](${b}/v1/glossary.md): GHII, GAII, morsels and the rest
- [Get an identity](${b}/auth.md): RFC 8628 device flow, owner-approved

## Identifiers

\`\`\`
${identifiers(app)}
\`\`\`

## Tools

${toolLines}

${face ?? appSummary(app)}
`;
}

/**
 * The app's AGENTS.md. Section names are Installation, Configuration and Usage because that is the
 * vocabulary a coding agent — and the conventions built around it — expects to find; the content
 * under them is about calling a hosted capability rather than installing a package, which is what
 * this actually is.
 */
export function appAgentsMd(
  config: AimeatConfig, app: AppRecord, origin: string, tools: string[], face?: string,
): string {
  const b = config.baseUrl.replace(/\/$/, '');
  const o = encodeURIComponent(app.ownerName);
  const f = encodeURIComponent(app.filename);
  const first = tools[0] ?? 'search';

  return `# ${appDisplayName(app)}

> ${appSummary(app)} This document tells an agent how to call it.

## Installation

Nothing to install. This app runs on an AIMEAT node and is reachable two ways.

Over MCP — attach any MCP-capable client to \`${b}/v1/mcp\` (OAuth 2.1), then:

\`\`\`
${identifiers(app)}

aimeat_app_tools_get   { owner: "${app.ownerName}", app_id: "${app.filename}" }
\`\`\`

Over HTTP — get an identity through the RFC 8628 device flow described at \`${b}/auth.md\`, then
call the endpoints in \`${b}/v1/spec\`.

## Configuration

- **Scopes.** The owner approves a scope set when they approve your agent. A call outside it
  answers 403 naming the scope, never an empty result.
- **Payment.** Priced tools answer 402 with the terms attached until a checkout for them completes;
  completing the checkout IS the invocation.
- **Schemas.** Every tool carries a full input and output schema in the manifest, so nothing has to
  be inferred from the app source: \`${b}/v1/apps/${o}/${f}/webmcp\`

## Usage

\`\`\`
aimeat_app_tool_invoke {
  owner: "${app.ownerName}",
  app:   "${app.filename}",
  tool:  "${first}",
  input: { ... }
}
\`\`\`

${tools.length ? `Available tools: ${tools.map((t) => `\`${t}\``).join(', ')}.` : 'This app publishes no priced tools.'}

## What this app does

${face ?? appSummary(app)}

## Where the rest is

- [llms.txt](${origin}/llms.txt) · [Site map](${origin}/sitemap.md)
- [Node manual](${b}/llms.txt) · [Node glossary](${b}/v1/glossary.md) · [OpenAPI](${b}/v1/spec)
`;
}

/**
 * The app root's markdown mirror: frontmatter, the Agent Face, and a Sitemap section.
 *
 * The root used to answer with the bare Agent Face. That is the right substance and the wrong
 * envelope: a markdown mirror is expected to open with frontmatter naming the page and to close
 * with a way onward, and the face has neither, so a reader landing on it learns what the app does
 * and nothing about where anything else is.
 */
export function appRootMirrorMd(
  config: AimeatConfig, app: AppRecord, origin: string, face?: string,
): string {
  const b = config.baseUrl.replace(/\/$/, '');
  return `---
title: ${appDisplayName(app)}
description: ${appSummary(app).replace(/\n+/g, ' ')}
url: ${origin}/
owner: ${app.ownerName}
app_id: ${app.filename}
---

# ${appDisplayName(app)}

> ${appSummary(app)}

${face ?? appSummary(app)}

## Sitemap

- [Application](${origin}/) · [llms.txt](${origin}/llms.txt) · [AGENTS.md](${origin}/AGENTS.md)
- [Full site map](${origin}/sitemap.md): every document this origin serves
- [MCP Server Card](${origin}/.well-known/mcp.json) · [Tool listing](${b}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/webmcp)
- [AIMEAT node](${b}/) · [Node manual](${b}/llms.txt) · [Glossary](${b}/v1/glossary.md)
`;
}

/** The app's site map: H2 sections, every entry a markdown link on this origin. */
export function appSitemapMd(config: AimeatConfig, app: AppRecord, origin: string): string {
  const b = config.baseUrl.replace(/\/$/, '');
  const o = encodeURIComponent(app.ownerName);
  const f = encodeURIComponent(app.filename);
  return `# ${appDisplayName(app)} — site map

> Everything this origin serves, on one page.

## This app

- [Application](${origin}/): the running app
- [Agent Face](${origin}/?format=md): the same app as markdown
- [llms.txt](${origin}/llms.txt): the agent manual for this app
- [llms-full.txt](${origin}/llms-full.txt): the same, at the conventional full path
- [AGENTS.md](${origin}/AGENTS.md): how to call this app

## Discovery

- [MCP Server Card](${origin}/.well-known/mcp.json): server, transport and this app's tools
- [Protected resource metadata](${origin}/.well-known/oauth-protected-resource): RFC 9728
- [robots.txt](${origin}/robots.txt) · [sitemap.xml](${origin}/sitemap.xml)

## The node behind it

- [AIMEAT node](${b}/): what this app is published on
- [Node manual](${b}/llms.txt) · [Glossary](${b}/v1/glossary.md) · [OpenAPI](${b}/v1/spec)
- [Tool listing](${b}/v1/apps/${o}/${f}/webmcp) · [Bound skills](${b}/v1/apps/${o}/${f}/skills)
- [Register an agent](${b}/auth.md)
`;
}
