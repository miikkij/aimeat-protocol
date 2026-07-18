# AIMEAT-boosted OpenHands

A **repeatable, preconfigured** deployment of [OpenHands](https://github.com/OpenHands/OpenHands)
that is wired to an AIMEAT node out of the box and knows how to build & publish AIMEAT apps.

Proven: OpenHands + **Kimi K2.7 Code** (via OpenRouter, ~**$0.4/app**) fetched the node's
build-app spec, built single-file AIMEAT apps, and **published them live over MCP** — e.g.
`tetrisat.apps.aimeat.io`. This bundle turns that from a fiddly one-off into a scripted setup.

## What you get

| Piece | What it does |
|-------|--------------|
| `skills/aimeat-app-builder/` | An always-available OpenHands **skill**. Its golden rule: fetch `GET /v1/prompts/build-app` from the node at runtime (canonical, never drifts) → build one HTML file → verify locally → publish via the `aimeat_app_publish` MCP tool → return the live URL. Kills the hallucinated-`src` failure mode. |
| `config.toml.template` | Preconfigured **MCP** (AIMEAT `/v2/mcp/appdev`, bearer token) + **LLM** (Kimi via OpenRouter) + **microagent pruning**. Rendered to a git-ignored `config.toml` with your secrets. |
| `docker-compose.yml` | Runs `openhands:1.8`, persistent `~/.openhands` volume, LLM env, config mount. |
| `scripts/aimeat-connect.sh` | Runs the AIMEAT **device-auth** flow; you approve the agent once in the browser; the token is captured and stored. No manual token juggling. |
| `scripts/render-config.sh` | Fills the config template with your secrets and installs the skill into `~/.openhands/skills/`. |
| `scripts/setup.sh` | One-shot: `.env` → connect → render → `up`. Idempotent. |

## Quick start (on the Docker host — WSL2 in our setup)

```bash
cd tools/aimeat-openhands
cp .env.example .env
# edit .env: set OPENROUTER_API_KEY (openrouter.ai/keys) and AIMEAT_OWNER (your username)
bash scripts/setup.sh
```

`setup.sh` will:
1. print an **approve-this-agent** URL + code → open it, approve in your AIMEAT profile → Agents;
2. capture the agent token into `secrets/aimeat.env` (git-ignored);
3. render `config.toml`, install the skill, and `docker compose up -d`.

Then open **http://localhost:3000** and say *"Build an AIMEAT app that …"*. It fetches the
spec, builds, publishes over MCP, and hands you the live URL.

## Re-deploying / another machine

Everything needed is in this folder + `.env`. On a fresh host: `cp .env.example .env`,
fill it, `bash scripts/setup.sh`. The only interactive step is the one-time browser approval.
State persists in `~/.openhands`, so restarts (`docker compose restart`) keep the config.

## Notes & gaps to verify on the live container

- **Model slug**: confirm `openrouter/moonshotai/kimi-k2.7-code` exists at openrouter.ai/models
  (adjust `LLM_MODEL` in `.env` if the slug differs).
- **config.toml vs GUI**: the GUI reliably reads `LLM_*` env (set in compose) and its own
  `~/.openhands/settings.json`. If the mounted `config.toml` MCP block isn't picked up by the
  web app, add the MCP server **once** via the UI (Settings → MCP → Streamable HTTP,
  url `<node>/v2/mcp/appdev`, bearer = the token in `secrets/aimeat.env`); it then persists in
  the mounted volume forever. `config.toml`'s `api_key` is sent as `Authorization: Bearer`.
- **Pruning defaults**: list the bundled microagents the image ships and add the unwanted ones
  to `disabled_microagents` in `config.toml.template`; set `load_public_skills=false` in the
  agent context to skip the public catalog. See the WSL2 deploy prompt.

Token lifetime: the agent token is long-lived (node `agentJwtTtlSeconds`, ~90 days). When it
expires, delete `secrets/aimeat.env` and re-run `scripts/setup.sh`.
