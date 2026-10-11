# MCP Presigned Upload Guide

## DEFAULT RULE (read this first)

**Any file over about 1 KB going to the node (published apps, storage files, extension, cortex and skill ZIPs) goes through the presigned path, never inline.** The presigned path keeps the file bytes out of the AI context window entirely.

- **Never paste base64 into a tool call**, and **never `Read` or `cat` a base64 (or large) file into context to inline it.** A ~60 KB single-line base64 file bills about 2.5 tokens per character, so reading it costs tens of thousands of tokens. If you are base64-encoding a file so you can paste it, stop and use the presigned path.
- **The pattern** (the same for every tool below: one metadata call, one raw PUT):
  ```bash
  # 1. metadata only (omit the content parameter) -> returns upload_url
  #    aimeat_app_publish { filename, name, version }        (app)
  #    aimeat_storage_upload { key, ... }                    (storage file)
  # 2. PUT the raw bytes from disk: no encoding, no context round-trip
  curl -s -X PUT "<upload_url>" -H "Content-Type: <content_type>" --data-binary @path/to/file
  ```
  The PUT response is the publish or upload result (JSON).

### Trap: `aimeat_app_draft_save` (staging) is INLINE-ONLY

The draft route (`PUT /v1/apps/:owner/:filename/draft`) and `aimeat_app_draft_save` have **no presigned mode**: both require the draft's HTML as base64 in the call (`content`, or `content_base64` on the tool), and neither mints an upload token. Do not stage a large app by reading its base64 into context. For a large app, use one of these instead:

- **Publish live** with `aimeat_app_publish` in upload mode. This is safe when the app's link is not yet distributed and the real send or use is gated elsewhere.
- **Build the draft in pieces** with `aimeat_app_draft_write` (plain UTF-8 text, mode `replace` for the first piece and `append` for the rest), then `aimeat_app_draft_publish`.
- **Change a live app without its source in context**: `aimeat_app_draft_seed` copies the published source into the draft slot on the server, `aimeat_app_draft_replace` changes an exact passage, and `aimeat_app_draft_publish` promotes it.

## Overview

AIMEAT MCP tools support presigned upload URLs to transfer files from the agent's filesystem directly to the node without passing content through the AI context window.

## How It Works

1. The agent calls the MCP tool with metadata only (it omits the content parameter).
2. The node validates the metadata and mints a single-use upload token (60 minute TTL). The `upload_url` carries a short handle (`u_…`) that stands for the signed token, so the URL is short enough to copy without error.
3. The tool returns `upload_url` with the method (PUT), the content type, the size cap and the expiry. The field names differ slightly between tools (`upload_method` / `method`, `max_size_bytes` / `max_bytes`); `upload_url` is always there.
4. The agent uploads the file with any HTTP client (curl, PowerShell, Python, …) to `PUT /v1/upload/:token`.
5. The node verifies and spends the token, processes the file, and returns the JSON result.

## Affected Tools

| Tool | Omit this to get an upload URL | Upload format | Upload type (`utype`) |
|------|--------------------------------|---------------|-----------------------|
| `aimeat_app_publish` | `content` (plain HTML) and `content_base64` | Raw HTML | `app` |
| `aimeat_storage_upload` | `data_base64` | Raw file | `storage` |
| `aimeat_extension_install` | `manifest` + `scripts` | ZIP | `extension` |
| `aimeat_cortex_install` | `manifest` + `libs` | ZIP | `cortex` |
| `aimeat_skill_publish` | `skill_md` | ZIP of the skill directory | `skill` |
| `aimeat_theme_font_save` | (always presigned) | One woff2 file per listed face file; the answer carries one `upload_url` per file in `uploads` | `font` |

Four REST routes mint the same tokens when the body says `mode: 'presigned'`: `POST /v1/apps`, `POST /v1/memory/files`, `POST /v1/extensions` and `POST /v1/cortex`.

## Inline Fallback

The app, storage, extension, cortex and skill tools keep their inline parameters. If the agent provides content inline, the tool works without an upload. Upload mode activates only when the content parameters are omitted. Use inline only for files under about 1 KB.

## ZIP Format

### Extension ZIP:
```
manifest.yaml
scripts/
  init.js
  search.js
```

### Cortex ZIP:
```
manifest.yaml
libs/
  main.js
  helpers.js
```

A cortex ZIP under the name of a cortex the caller already installed replaces it in place.

### Skill ZIP:
```
SKILL.md            (at the root, or inside one wrapping directory)
scripts/            (optional)
references/         (optional)
assets/             (optional)
```

## Upload Token Security

- **Single-use, and durable:** the first PUT spends the token by filing it in the revoked-token table (`storage.revokeTokenIfAbsent`, one conditional insert) until the token's own expiry. A reused token gets 409, also after a restart and on another process over the same database. Of two concurrent requests with one token, exactly one spends it.
- **Short handle, in memory:** the handle-to-token map lives in the node process. A handle lost to a restart behaves like an expired token: ask for a fresh URL.
- **60-minute TTL:** an expired token gets 410.
- **Type-bound:** the token names its upload type, so an app token cannot upload a storage file.
- **Size-capped:** the token's `maxBytes` is enforced on the upload; over the cap is 413.
- **Signed with the node key:** EdDSA over the node's Ed25519 key pair; there is no separate key to manage.
- **Actor recorded:** the token carries the principal that asked for the URL (`actor`) beside the owner bucket the file lands in (`sub`), so an agent's upload keeps its provenance.

## Adding Upload Support to New Tools

1. Add the new type to `utype` in `UploadTokenPayload` and `VerifiedUploadToken` (`src/services/upload-token.ts`), and list the options it must carry in `PRESIGNED_META_KEYS`.
2. Make the content parameters optional in the tool's catalog schema (`src/tool-catalog/definitions/`).
3. If content is omitted, mint the token with `generateUploadToken({ sub, actor, utype, meta: buildUploadMeta(utype, input), maxBytes, contentType })`. Use `buildUploadMeta` rather than a hand-written `meta`, so an option the tool accepts is not dropped on the way to the upload.
4. Add a `case` for the type in the switch in `src/routes/upload.ts`, with its handler.
5. Update the tool description to document both modes.

## Key Files

| File | Purpose |
|------|---------|
| `src/services/upload-token.ts` | Token mint and verify, the handle map, the durable single-use spend, `PRESIGNED_META_KEYS` |
| `src/services/upload-zip.ts` | ZIP parsing for extension and cortex uploads (a skill ZIP is unpacked in `upload-skill.ts` through `src/services/safe-zip.ts`) |
| `src/routes/upload.ts` | `PUT /v1/upload/:token`; the app, extension and cortex handlers |
| `src/routes/upload-storage.ts` | The storage upload handler |
| `src/routes/upload-skill.ts` | The skill upload handler |
| `src/mcp/apps.ts` | Dual-mode `aimeat_app_publish`; inline-only `aimeat_app_draft_save` |
| `src/mcp/apps-draft-edit.ts` | `aimeat_app_draft_write`, `_replace`, `_seed` and the draft read |
| `src/mcp/core-storage.ts` | Dual-mode `aimeat_storage_upload` (mints through `mintStorageUploadUrl` in `src/services/storage-file-write.ts`) |
| `src/mcp/extensions.ts` | Dual-mode `aimeat_extension_install` |
| `src/mcp/cortex.ts` | Dual-mode `aimeat_cortex_install` (the offer is `cortexUploadOffer` in `src/services/cortex-upload-offer.ts`, shared with `POST /v1/cortex`) |
| `src/mcp/skills.ts` | Dual-mode `aimeat_skill_publish` |
| `src/mcp/themes.ts` | `aimeat_theme_font_save` (the upload URLs come from `src/services/themes/fonts.ts`) |
