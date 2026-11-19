---
name: aimeat-app-builder
description: >
  Build and publish AIMEAT apps. This OpenHands is wired to an AIMEAT node over MCP
  (the aimeat_* tools). When the user asks to build, make, or publish an app, a game,
  a tool, or anything "on AIMEAT" / "to aimeat.io", follow the workflow below.
license: MIT
metadata:
  author: AIMEAT
  version: "2.0"
---

> **Canonical version lives on the node.** This baked-in copy is a bootstrap seed. If the
> `aimeat_skill_get` tool is available, fetch `node:aimeat-app-builder-atelier` and follow THAT
> version — it is kept current (research flow, pitfall registry, new tooling). Both agree on the
> core rule: the live Atelier specification always wins over this file
> (`GET /v1/prompts/build-app-atelier`). The Classic track this file used to describe was
> retired on 2026-11-19; an app built on it is moved with the specification's section
> `from-classic`.

# Building AIMEAT apps

You are running as an **AIMEAT-boosted OpenHands**: an AIMEAT agent identity is connected
to this instance over MCP. The MCP tools are named `aimeat_*` (e.g. `aimeat_app_publish`,
`aimeat_app_list`, `aimeat_extension_install`, `aimeat_storage_upload`). Use them to
publish directly to the node — you do **not** need the AIMEAT web UI.

An **AIMEAT app** is a **single self-contained HTML file**. The node hosts it and serves it
on its own subdomain (e.g. `https://<name>.apps.aimeat.io/`). Its head is a few lines and its
interface is calls into the served component kit (`AIMEAT.atelier`), which carries the header,
the sign-in, the language switch and the loading, empty and error states. There is **no build
step and no backend to write**: the node is the backend.

## The one rule that matters: fetch the canonical spec first

The node serves the **authoritative, always-current build specification**. It is the single
source of truth for the component kit, the libraries, allowed script URLs, the required
`<meta>` tags, the data patterns and the publish steps. **Before writing any app, fetch it and
follow it exactly:**

```bash
curl -s "https://aimeat.io/v1/prompts/build-app-atelier?format=txt"
```

Over MCP the same specification comes in parts: `aimeat_handbook_get { tier: "build-app-atelier" }`
is the first and lists the rest. Its part `platform` lists the sections only some apps need (a
team, files, AI, anonymous intake, server-side work); read the ones this app is in.

Start from a frame the node ships — never a blank file:

```bash
curl -s https://aimeat.io/v1/designbook?kind=genre                 # the genres a fine app forks
curl -s https://aimeat.io/v1/app-templates/shell-atelier           # the frame for a prototype or a plain page
curl -s https://aimeat.io/v1/app-templates                         # every template, use cases included
```

If the node base URL is not `aimeat.io`, use the one configured for this instance (see the
`AIMEAT_BASE_URL` env / the MCP server URL). Everything the app loads at runtime must be a URL
**listed in that spec**. Never invent script/style `src` URLs (e.g. `/i18n/translations.js`,
`/components/*.js`); those 404 and break the app.

## Workflow

1. **Fetch the spec** (above). Treat it as law. Ask the owner the level first (a quick
   prototype, an ordinary page or the finest), then fork the genre or start from the shell.
2. **Build one HTML file.** Single file, no bundler. Keep the head the shell or genre gives you,
   with `<meta name="aimeat-track" content="atelier">`, the app's filename and its scopes. Build
   the screens from the kit's components; never write your own sign-in, theme or language switch.
3. **Verify locally before publishing.** Do not publish blind:
   - Check JS syntax with a command that names the file explicitly, so a missing path cannot
     read as a pass:
     ```bash
     node -e 'const f=process.argv[1],s=require("fs").readFileSync(f,"utf8");new (require("vm").Script)(s,{filename:f});console.log("parsed:",f)' app-script.js
     ```
     Avoid bare `node --check $VAR`: with an empty or unset variable it reads empty stdin,
     parses that, and exits 0 printing nothing — indistinguishable from a real pass.
   - Serve the file locally and `curl` it back; confirm it is well-formed and the script tags
     resolve to real node URLs.
4. **Publish over MCP.** Call the `aimeat_app_publish` tool with the `spec_token` the
   specification carries. For any file bigger than ~1 KB use the **presigned upload** mode: call
   the tool **without** the content parameter → it returns an `upload_url` → `PUT` the raw HTML
   to that URL:
   ```bash
   curl -s -X PUT "<upload_url>" -H "Content-Type: text/html" --data-binary @app.html
   ```
   Provide `filename` (e.g. `my-app.html`), `name`, `description`, `category`, `tags`, and an
   `icon`. Re-publishing the same `filename` bumps the version — it does not create a duplicate.
5. **Return the live URL.** After publishing, report the app's live address to the user
   (the subdomain `https://<name>.apps.aimeat.io/`). Confirm with `aimeat_app_list` if unsure.

## When the app needs server-side work (an extension)

If the app calls a third-party API with a key, needs a rule the browser cannot break, or works
on a schedule, that belongs in an **AIMEAT extension** (a sandboxed server-side function), not
in the browser. The specification's platform section `server-side` and the node skill
`node:aimeat-extension-builder` cover it. The page reads it **through** the node's cortex libs,
never by calling it directly. Most apps need **no** extension.

## Do / Don't

- **Do** fetch `/v1/prompts/build-app-atelier` every time — it changes and it is canonical.
- **Do** start from a genre or the Atelier shell and keep the app a single HTML file.
- **Do** verify locally, then publish over MCP, then hand back the live URL.
- **Don't** invent library/script URLs or reference files the spec doesn't list.
- **Don't** build a separate backend, a bundler, or a multi-file app — the node is the backend.
- **Don't** hardcode colours or bypass the kit — its `--ak-*` tokens are the look.

Full API detail lives in `./references/aimeat-cheatsheet.md`, but the live spec at
`/v1/prompts/build-app-atelier` always wins on any conflict.
