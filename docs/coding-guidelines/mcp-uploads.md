# MCP Presigned Upload Guide

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
