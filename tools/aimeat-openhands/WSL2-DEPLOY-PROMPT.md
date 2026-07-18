# Prompt for the WSL2 Claude — deploy the AIMEAT-boosted OpenHands

Copy everything below the line into the WSL2 Claude Code session.

---

You are deploying a **preconfigured, AIMEAT-boosted OpenHands** from a bundle that already
exists in the Windows repo. Do the work end-to-end; ask me only for the two secrets you
cannot derive. Do not commit any secrets. Keep the existing `~/.openhands` volume intact.

## 0. Source bundle

The bundle is at `/mnt/e/dev/GitHub/aimeat-protocol/tools/aimeat-openhands` (Windows mount).
**Copy it into WSL home** so secrets and the config live off the Windows mount:

```bash
rsync -a --exclude='.env' --exclude='secrets/' --exclude='config.toml' \
  /mnt/e/dev/GitHub/aimeat-protocol/tools/aimeat-openhands/ ~/aimeat-openhands/
cd ~/aimeat-openhands
chmod +x scripts/*.sh
```

Read `README.md` and `config.toml.template` there — they explain every piece.

## 1. Clear the old ad-hoc container (keep the volume)

An OpenHands may already be running on :3000 from an earlier manual `docker run`. Free the
port but **preserve `~/.openhands`** (do NOT delete the volume/dir):

```bash
docker ps -a --filter "publish=3000"
docker rm -f openhands-app 2>/dev/null || true   # only removes the container, not ~/.openhands
```

## 2. Fill `.env`

```bash
cp .env.example .env
```

Set in `.env`:
- `OPENROUTER_API_KEY` — **ask me for it** (or reuse the key already configured in the running
  OpenHands if you can read it from `~/.openhands/settings.json`).
- `AIMEAT_OWNER` — **ask me** for my AIMEAT username (the owner the agent registers under).
- Leave `AIMEAT_BASE_URL=https://aimeat.io` and `LLM_MODEL=openrouter/moonshotai/kimi-k2.7-code`
  unless I say otherwise. First verify that model slug exists at openrouter.ai/models; if not,
  ask me which Kimi/other cheap slug to use and update `LLM_MODEL`.

## 3. Run setup (connect + render + up)

```bash
bash scripts/setup.sh
```

This runs `aimeat-connect.sh`, which prints an **approval URL + a short code**. **Surface that
URL and code to me** — I approve the agent in my AIMEAT profile → Agents tab. The script waits,
captures the token into `secrets/aimeat.env`, renders `config.toml`, installs the
`aimeat-app-builder` skill into `~/.openhands/skills/`, and does `docker compose up -d`.

If `setup.sh` exits after creating `.env` (first run), fill `.env` and run it again.

## 4. Prune default microagents

Enumerate what the image ships, then disable the ones irrelevant to AIMEAT app-building
(keep general coding/git ones; drop framework/product-specific noise). List them:

```bash
docker exec aimeat-openhands sh -lc 'ls -R /app 2>/dev/null | grep -i microagent | head -50' || true
# also check the SDK skills dirs the app loads:
docker exec aimeat-openhands sh -lc 'ls -R /.openhands/skills /.openhands/microagents 2>/dev/null' || true
```

Add the unwanted microagent **names** to `disabled_microagents = [...]` in
`~/aimeat-openhands/config.toml.template`, then re-render and restart:

```bash
bash scripts/render-config.sh && docker compose up -d
```

Show me the list before disabling if you're unsure which to keep.

## 5. Verify the wiring (report what you actually observe)

1. **Container healthy:** `docker compose ps` shows `aimeat-openhands` up; `docker compose logs
   --tail=80` has no fatal errors.
2. **LLM:** open http://localhost:3000 → Settings shows the Kimi/OpenRouter model (from `LLM_*`
   env). If not, tell me.
3. **MCP connected:** confirm the AIMEAT MCP server shows connected and the `aimeat_*` tools are
   available. If the GUI did **not** pick up the `config.toml` MCP block, add it **once** in
   Settings → MCP → Streamable HTTP: url `https://aimeat.io/v2/mcp/appdev`, bearer =
   `AIMEAT_AGENT_TOKEN` from `secrets/aimeat.env`. It then persists in `~/.openhands` forever.
   Report which path worked (config.toml vs one-time UI add).
4. **Skill loaded:** `docker exec aimeat-openhands sh -lc 'cat /.openhands/skills/aimeat-app-builder/SKILL.md | head -5'`.
5. **Smoke test (optional but ideal):** start a conversation and ask *"List my AIMEAT apps"* —
   the agent should call an `aimeat_*` MCP tool and return results, proving the MCP + token work.

## 6. Report back

Tell me, concretely: container status, whether MCP connected via config.toml or needed the
one-time UI add, which microagents you disabled, and the smoke-test result. Do **not** print the
agent token or the OpenRouter key back to me — just confirm they're in place. If anything
failed, say exactly what and where.
