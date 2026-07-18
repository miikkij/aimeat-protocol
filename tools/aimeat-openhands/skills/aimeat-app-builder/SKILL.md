---
name: aimeat-app-builder
description: >
  Build and publish AIMEAT apps. This OpenHands is wired to an AIMEAT node over MCP
  (the aimeat_* tools). When the user asks to build, make, or publish an app, a game,
  a tool, or anything "on AIMEAT" / "to aimeat.io", follow the workflow below.
license: MIT
metadata:
  author: AIMEAT
  version: "1.0"
---

# Building AIMEAT apps

You are running as an **AIMEAT-boosted OpenHands**: an AIMEAT agent identity is connected
to this instance over MCP. The MCP tools are named `aimeat_*` (e.g. `aimeat_app_publish`,
`aimeat_app_list`, `aimeat_extension_install`, `aimeat_storage_upload`). Use them to
publish directly to the node — you do **not** need the AIMEAT web UI.

An **AIMEAT app** is a **single self-contained HTML file**. The node hosts it and serves it
on its own subdomain (e.g. `https://<name>.apps.aimeat.io/`). It logs the user in, reads and
writes their data, and uses node-hosted UI/AI libraries — all from `<script>` tags pointing at
the node. There is **no build step and no backend to write**: the node is the backend.

## The one rule that matters: fetch the canonical spec first

The node serves the **authoritative, always-current build-app specification**. It is the
single source of truth for available libraries, allowed script URLs, the required `<meta>`
tags, auth/data APIs, and the templates. **Before writing any app, fetch it and follow it
exactly:**

```bash
curl -s https://aimeat.io/v1/prompts/build-app
```

Also pull the ready-made templates and library list (start from a template — do not invent
structure):

```bash
curl -s https://aimeat.io/v1/app-templates          # starter templates
curl -s https://aimeat.io/llms.txt                   # discovery: build prompt + template links
```

If the node base URL is not `aimeat.io`, use the one configured for this instance (see the
`AIMEAT_BASE_URL` env / the MCP server URL). Everything the app loads at runtime — CSS, auth,
data, UI libraries — must be a URL **listed in that spec**. Never invent script/style `src`
URLs (e.g. `/i18n/translations.js`, `/components/*.js`); those 404 and break the app. Only use
the libraries the spec names.

## Workflow

1. **Fetch the spec** (above). Treat it as law. Skim the templates; pick the closest one.
2. **Build one HTML file.** Single file, no bundler. Include the required meta tags the spec
   lists — at minimum:
   ```html
   <meta name="aimeat-app" content="<filename>.html">
   <meta name="aimeat-scopes" content="memory:read memory:write memory:delete">
   ```
   Load only the node libraries the spec lists (auth, data, ui viewers/forms, the daisyUI +
   Tailwind theme bridge). Use `AIMEAT.auth.mountLoginButton(...)` + `AIMEAT.auth.login()` for
   sign-in, `AIMEAT.data.get/set(key, value, { visibility })` for storage, and the
   `AIMEAT.ui.*` helpers for lists/forms. Respect the AIMEAT light/dark theme via
   `data-theme` + the theme CSS variables (never hardcode brand colors).
3. **Verify locally before publishing.** Do not publish blind:
   - Check JS syntax (`node --check` on the extracted script, or serve the file and load it).
   - Serve the file locally and `curl` it back; confirm it is well-formed and the script tags
     resolve to real node URLs.
4. **Publish over MCP.** Call the `aimeat_app_publish` tool. For any file bigger than ~1 KB
   use the **presigned upload** mode: call the tool **without** the content parameter → it
   returns an `upload_url` → `PUT` the raw HTML to that URL:
   ```bash
   curl -s -X PUT "<upload_url>" -H "Content-Type: text/html" --data-binary @app.html
   ```
   Provide `filename` (e.g. `my-app.html`), `name`, `description`, `category`, `tags`, and an
   `icon` (emoji). Re-publishing the same `filename` bumps the version — it does not create a
   duplicate.
5. **Return the live URL.** After publishing, report the app's live address to the user
   (`https://aimeat.io/v1/apps/<owner>/<filename>` and/or the subdomain
   `https://<name>.apps.aimeat.io/`). Confirm with `aimeat_app_list` if unsure of the URL.

## When the app needs external data (an extension)

If the app needs a third-party API (weather, maps, a public dataset), that call belongs in an
**AIMEAT extension** (a sandboxed server-side function), not in the browser. The build spec and
`aimeat_extension_install` / `aimeat_extension_invoke` cover this. An extension:
- Owns its own `ext:<name>` memory namespace and makes outbound HTTP via `ctx.fetch()`.
- Exports actions as `export default async function (ctx, input) { ... }`.
- Is read by the app **through** the node's cortex libs, never called directly from the page.

Only reach for an extension when the app genuinely needs data the browser cannot fetch
directly. Most apps (games, note tools, trackers, dashboards over the user's own AIMEAT data)
need **no** extension — just auth + data + UI libs.

## Do / Don't

- **Do** fetch `/v1/prompts/build-app` every time — it changes and it is canonical.
- **Do** start from a template and keep the app a single HTML file.
- **Do** verify locally, then publish over MCP, then hand back the live URL.
- **Don't** invent library/script URLs or reference files the spec doesn't list.
- **Don't** build a separate backend, a bundler, or a multi-file app — the node is the backend.
- **Don't** hardcode brand colors or bypass the AIMEAT auth/data/UI libraries.

Full API detail lives in `./references/aimeat-cheatsheet.md`, but the live spec at
`/v1/prompts/build-app` always wins on any conflict.
