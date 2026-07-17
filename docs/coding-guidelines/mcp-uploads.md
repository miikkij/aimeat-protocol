# MCP Presigned Upload Guide

## DEFAULT RULE (read this first)

**Any file over ~1 KB going to the node — published apps AND storage files — MUST be
uploaded via the presigned path, never inlined.** This is not an optimization, it is the
only sane way: it keeps the file bytes out of the AI context window entirely.

- **NEVER paste base64 into a tool call**, and **NEVER `Read`/`cat` a base64 (or large) file
  into context to inline it.** A ~60 KB single-line base64 file bills ~2.5 tokens/char — reading
  it costs tens of thousands of tokens and is the exact recurring time-sink that keeps wasting
  minutes. If you catch yourself base64-encoding a file so you can paste it, stop: use presigned.
- **The canonical pattern** (works for apps and storage — one metadata call, one raw PUT):
  ```bash
  # 1. metadata only (OMIT content_base64 / data_base64) -> returns upload_url
  #    aimeat_app_publish { filename, name, version }        (app)
  #    aimeat_storage_upload { key, ... }                    (storage file)
  # 2. PUT the RAW bytes straight from disk — no encoding, no context round-trip:
  curl -s -X PUT "<upload_url>" -H "Content-Type: <content_type>" --data-binary @path/to/file
  ```
  The PUT response IS the publish/upload result (JSON).

### Trap: `aimeat_app_draft_save` (staging) is INLINE-ONLY

The draft/staging route (`PUT /v1/apps/:owner/:filename/draft`, behind `aimeat_app_draft_save`)
has **no presigned mode** — its `content` is required inline. So do **not** try to stage a large
app by reading its base64 into context to feed the draft tool. For a large app either (a) publish
live via `aimeat_app_publish` presigned (safe when the link is not yet distributed and the real
send/use is gated elsewhere), or (b) accept that staging a big file means an inline cost and decide
it is worth it. Never reach for `Read` on the base64 to bridge the gap.

## Overview

AIMEAT MCP tools support presigned upload URLs to transfer files from the agent's
filesystem directly to the server without passing content through the AI context window.

## How It Works

1. Agent calls MCP tool with metadata only (omits file content parameter)
2. Server validates metadata, generates a single-use upload JWT (60 min TTL)
3. Returns `upload_url`, `upload_method` (PUT), `content_type`, `max_size_bytes`
4. Agent uploads file using any HTTP client (curl, PowerShell, Python, etc.)
5. Server validates token, processes file, returns JSON result

## Affected Tools

| Tool | Content parameter | Upload format |
|------|-------------------|---------------|
| `aimeat_app_publish` | `content_base64` (optional) | Raw HTML |
| `aimeat_storage_upload` | `data_base64` (optional) | Raw file |
| `aimeat_extension_install` | `manifest` + `scripts` (optional) | ZIP |
| `aimeat_cortex_install` | `manifest` + `libs` (optional) | ZIP |

## Inline Fallback

All tools retain backward-compatible inline parameters. If the agent provides
content inline, it works exactly as before. Upload mode activates only when
content parameters are omitted.

## ZIP Format (Extensions/Cortex)

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

## Upload Token Security

- **Single-use:** Token hash tracked in memory, reuse rejected with 409
- **60-min TTL:** Expired tokens rejected with 410
- **Type-bound:** App token cannot upload storage files
- **Size-capped:** max_size_bytes enforced during upload streaming
- **Same signing key:** Uses node Ed25519 keypair (no extra key management)

## Adding Upload Support to New Tools

1. Import `generateUploadToken` from `src/services/upload-token.js`
2. Make content parameters optional in the Zod schema
3. If content is omitted, generate token with appropriate `utype` and metadata
4. Add handler case in `src/routes/upload.ts` switch statement
5. Update tool description to document both modes

## Key Files

| File | Purpose |
|------|---------|
| `src/services/upload-token.ts` | Token generation/verification, single-use tracking |
| `src/services/upload-zip.ts` | ZIP parsing for extension/cortex uploads |
| `src/routes/upload.ts` | `PUT /v1/upload/:token` endpoint |
| `src/mcp/apps.ts` | Dual-mode app publish |
| `src/mcp/core.ts` | Dual-mode storage upload |
| `src/mcp/extensions.ts` | Dual-mode extension install |
| `src/mcp/cortex.ts` | Dual-mode cortex install |
