# dify-bridge

Reference prototype for the **Dify ↔ AIMEAT** integration. It is the Direction-2 ("AIMEAT calls Dify") translation layer: a tiny, zero-dependency shim that receives AIMEAT capability-invoke webhooks and forwards them to a Dify app's Service API, plus two helper scripts to register and test the capability.

Full design & contract: [`docs/integrations/dify-hello-integration.md`](../../docs/integrations/dify-hello-integration.md).

```
AIMEAT agent ──invoke──▶ AIMEAT node ──webhook──▶ dify-bridge ──Service API──▶ Dify
                                          { input, caller, capability }   { inputs, user }
              { result } ◀───────────────────────────── { result: <dify outputs> }
```

## Files

| File | Purpose |
|---|---|
| `src/shim.ts` | HTTP server: AIMEAT webhook → Dify Service API → `{ result }`. `DIFY_MODE=mock` runs without Dify. |
| `src/register-capability.ts` | One-time **owner** action: registers the `manual` webhook-backed capability. |
| `src/invoke-capability.ts` | End-to-end test: invokes the capability through AIMEAT and prints the result. |
| `.env.example` | All config. |

No new dependencies — uses `node:http` + global `fetch`, run via the repo's `tsx`.

## Quick start (fully local, with mock Dify)

All commands from the **`aimeat/`** directory.

1. **Start an AIMEAT node** that permits webhook capabilities and loopback webhooks:
   ```bash
   AIMEAT_DEV_MODE=true \
   AIMEAT_CAPABILITY_PUBLISHING=open \
   AIMEAT_CAPABILITY_WEBHOOKS=allowlist_only \
   AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST=127.0.0.1 \
   pnpm dev
   ```
   (`AIMEAT_DEV_MODE=true` lets the loopback shim past the SSRF check; without it, 127.0.0.1 is blocked.)

2. **Start the shim** (mock mode — no Dify creds needed):
   ```bash
   DIFY_MODE=mock pnpm exec node --import tsx tools/dify-bridge/src/shim.ts
   ```

3. **Register the capability** (needs an owner JWT or owner-grant PAT):
   ```bash
   AIMEAT_TOKEN=<owner-token> \
   WEBHOOK_URL=http://127.0.0.1:8787/invoke \
   pnpm exec node --import tsx tools/dify-bridge/src/register-capability.ts
   ```

4. **Invoke it end-to-end** (any caller token):
   ```bash
   AIMEAT_TOKEN=<any-caller-token> CAP_ID=dify-summarize-doc \
   INPUT='{"text":"hello from an AIMEAT agent"}' \
   pnpm exec node --import tsx tools/dify-bridge/src/invoke-capability.ts
   ```
   You should see the (mock) Dify output returned through AIMEAT.

## Going live (real Dify)

In a Dify **workflow** app, open *API Access*, generate an app key, then restart the shim:
```bash
DIFY_MODE=live \
DIFY_BASE_URL=https://api.dify.ai \
DIFY_APP_KEY=app-xxxxxxxx \
DIFY_APP_TYPE=workflow \
pnpm exec node --import tsx tools/dify-bridge/src/shim.ts
```
The shim maps the AIMEAT `input` → Dify `inputs` and the caller GHII → Dify `user`, calls `POST /v1/workflows/run` in blocking mode, and returns `data.outputs` as `{ result }`. Set `DIFY_APP_TYPE=chat` to target a chat app via `/v1/chat-messages`.

## Use AIMEAT *from* Dify (Direction 1: Dify is an AIMEAT agent)

This makes a Dify agent register in AIMEAT, run Hello Integration, and then read/write
memory, use storage, build knowledge packages, and invoke other agents' capabilities.

### Step 1 (one-time): register + onboard the agent
Agent registration needs a human approval, so it can't be a pure inline workflow. Run it
(bash, then PowerShell):
```bash
AIMEAT_BASE_URL=http://127.0.0.1:40050 OWNER=<your-owner> AGENT_NAME=dify \
pnpm exec node --import tsx tools/dify-bridge/src/connect-onboard.ts
```
```powershell
$env:OWNER='<your-owner>'; $env:AGENT_NAME='dify'; $env:AIMEAT_BASE_URL='http://127.0.0.1:40050'
pnpm exec node --import tsx tools/dify-bridge/src/connect-onboard.ts
```
It prints a code + URL → **approve it in AIMEAT (Profile → Agents)** → it finishes Hello
Integration and prints the agent **GAII + token**. (For a long-lived credential, instead
create a PAT in AIMEAT Profile → Access and skip the token-expiry concern.)

### Step 2 (one-time): import the tools into Dify
In Dify: **Tools → Custom → Create Custom Tool** → paste/URL-import
[`aimeat-dify-tools.openapi.yaml`](aimeat-dify-tools.openapi.yaml) → **Authorization method**:
- Authorization type = **Header**, Auth Type = **Bearer**, Key = `Authorization`.
- **Value = the raw token ONLY** (the JWT or PAT) — Dify adds the `Bearer ` prefix in Bearer
  mode, so do NOT type `Bearer ` yourself (that causes a double-`Bearer` 401). Use the
  **Custom** auth type only if you want to type the full `Bearer <token>` value yourself.

> **Networking:** Dify runs in Docker, so `localhost` is the container. The spec's server
> URL is `http://host.docker.internal:40050` (host as seen from Docker). If that doesn't
> resolve, use your host's LAN IP. Edit the server URL in Dify after import if needed.

After import, an **Agent node** can call these tools (memory write/read/list/search/delete,
storage upload/download, knowledge import/get, capability list/invoke).

### Recipes
- **Store / get / edit memory:** call `aimeat_memory_write` (write the same key again to
  edit — version auto-increments), `aimeat_memory_read`, `aimeat_memory_search`.
- **Storage:** `aimeat_storage_upload` (base64 data) / `aimeat_storage_download`.
- **Build a coherent knowledge package from raw data:** give an **Agent/LLM node** the raw
  material and a prompt like *"organize this into entries with titles; pick a content_type
  from idea|research|plan|dataset|document|tutorial|collection|article|story|fiction|guide"*,
  then have it call `aimeat_knowledge_import` with that `package` object. (`content_type` is
  required — that's the one field the importer won't infer.)
- **Use / "activate" other agents:** `aimeat_capability_list` to discover, then
  `aimeat_capability_invoke` to run another agent's/service's capability and get the result.

### Not in the v1 tool spec (available, shapes not yet curated here)
- **Create an application** (`POST /v1/apps` / MCP `aimeat_app_publish`)
- **Delegate a task to another agent** (`POST /v1/agents/{name}/tasks`)
Ask to add these once their request bodies are curated against the spec.

## Constraints (read these)

- **10-second ceiling.** AIMEAT aborts the webhook at 10s, so only fast Dify workflows fit the synchronous capability path. `DIFY_TIMEOUT_MS` keeps the shim under that. Long workflows belong on the async work/escrow queue, not a capability.
- **No auth from AIMEAT.** The webhook carries only `X-AIMEAT-Node` + `X-AIMEAT-Timestamp` (no bearer). Protect the shim by **network isolation**; the node-id/timestamp checks are advisory; the `?key=` secret is only safe for **non-public** capabilities (a public capability's record exposes its `webhookUrl`).
- **SSRF.** Loopback/private shim hosts require `AIMEAT_DEV_MODE=true` on the node. Production shim must be on a node-reachable host.
- **Production node config.** Use a real domain allowlist (`AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST=bridge.yourhost`) instead of `open`.
