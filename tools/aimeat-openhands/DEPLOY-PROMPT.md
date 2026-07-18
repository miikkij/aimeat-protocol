# Deploy prompt — AIMEAT-boosted OpenHands (dev WSL2 or prod)

Copy everything below the line into a Claude Code session **on the Docker host** (the dev WSL2
box, or the prod server). It works on either — the only difference is where the bundle lives
(step 0). Read the "Prod" notes near the end before deploying to prod.

---

You are deploying a **preconfigured, AIMEAT-boosted OpenHands** from the bundle in this repo
(`tools/aimeat-openhands/`). Do the work end-to-end; ask me only for the two secrets you
cannot derive. Do not commit any secrets. Keep any existing `~/.openhands` volume intact.

## 0. Get the bundle onto this host

Pick the case that matches this machine, then copy the bundle into `~/aimeat-openhands` so
secrets/config live off any shared mount:

```bash
# CASE A — repo already checked out here. Set REPO to its path:
#   dev WSL2:  /mnt/e/dev/GitHub/aimeat-protocol
#   prod (Ubuntu 22.04, overscalesolutions):  /data/services/aimeat-protocol
REPO=/data/services/aimeat-protocol           # <-- prod path; use the WSL2 one on dev
git -C "$REPO" pull --ff-only 2>/dev/null || true

# CASE B — repo NOT here yet (fresh prod box): clone it first, then set REPO:
# git clone <your-aimeat-protocol-remote> ~/aimeat-protocol && REPO=~/aimeat-protocol

rsync -a --exclude='.env' --exclude='secrets/' --exclude='config.toml' \
  "$REPO/tools/aimeat-openhands/" ~/aimeat-openhands/
cd ~/aimeat-openhands
chmod +x scripts/*.sh
```

Read `README.md` and `config.toml.template` there — they explain every piece.

## 1. Clear any old container on :3000 (keep the volume)

If an OpenHands is already on :3000 (e.g. an earlier manual `docker run`), free the port but
**preserve `~/.openhands`** (do NOT delete the volume/dir):

```bash
docker ps -a --filter "publish=3000"
docker rm -f openhands-app aimeat-openhands 2>/dev/null || true   # containers only, not ~/.openhands
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
4. **Skill loaded into the AGENT.** The agent runs in a separate agent-server runtime container;
   the skill is baked into a **custom runtime image** (`runtime/Dockerfile` → COPY into
   `/home/openhands/.openhands/skills/aimeat-app-builder` + `chown` to `openhands`), which
   `scripts/build-runtime.sh` builds and `docker-compose.yml` selects via
   `AGENT_SERVER_IMAGE_REPOSITORY/TAG`. `setup.sh` runs the build automatically. Do NOT
   bind-mount a host dir into the runtime HOME (it 500s conversations on `~/.openhands/profiles`).
   Verify:
   - Image built: `docker image ls | grep aimeat/agent-server`.
   - Skill in the image: `docker run --rm --entrypoint sh aimeat/agent-server:1.26.0-python -lc 'cat /home/openhands/.openhands/skills/aimeat-app-builder/SKILL.md | head -3'`.
   - **Decisive probe:** in a fresh conversation ask *"Do you have a skill about building AIMEAT
     apps? Quote its one golden rule."* Success = the agent names `aimeat-app-builder` and the
     `/v1/prompts/build-app` rule (it will be in the conversation's `SystemPromptEvent`). If it
     says it has no such skill, confirm the app is actually using the custom image
     (`AGENT_SERVER_IMAGE_REPOSITORY`/`TAG` in the running container's env) and that a new
     conversation was started after `up`.
5. **Smoke test:** start a conversation and ask *"List my AIMEAT apps"* — the agent should call
   an `aimeat_*` MCP tool and return results, proving the MCP + token work.

## 6. Report back

Tell me, concretely: container status, whether MCP connected via config.toml or needed the
one-time UI add, which microagents you disabled, and the smoke-test result. Do **not** print the
agent token or the OpenRouter key back to me — just confirm they're in place. If anything
failed, say exactly what and where.

## Prod notes (read before deploying to a prod server)

The bundle is identical on prod; these are the only differences:

- **Bundle source:** use step 0 CASE A with `REPO` = the repo path on the prod box, or CASE B
  to `git clone` it fresh. Everything else is the same.
- **Node URL:** `AIMEAT_BASE_URL` stays `https://aimeat.io` (OpenHands is just an MCP client +
  OpenRouter caller; it talks to the node over HTTPS regardless of where it runs). If you deploy
  a separate prod node, point it there instead.
- **Owner / agent identity:** register the agent under the **prod owner** account (the
  `AIMEAT_OWNER` you approve with). It becomes `openhands#<owner>@<node>`. Consider narrowing
  `AIMEAT_SCOPES` in `.env` from `*` to just what app-building needs
  (`app:* extension:* cortex:* storage:* organism:* workspace:* skill:*`) for least privilege.
- **Do NOT expose the UI publicly without auth.** OpenHands has no login of its own and its UI
  can run arbitrary code on this host. Either reach it over an SSH tunnel (set
  `OPENHANDS_PORT_BIND=127.0.0.1:13781` + `PERMITTED_CORS_ORIGINS=http://localhost:13781`, then
  `ssh -L 13781:localhost:13781 user@host` → `http://localhost:13781`), or expose it via nginx
  with TLS + auth — see the next section. Container port stays 3000 internally either way.

## Expose via nginx (browser access, no SSH tunnel)

The host already runs nginx. Add a dedicated HTTPS subdomain that proxies to the localhost-bound
OpenHands, gated by Basic Auth. **The auth is mandatory** — it is the only thing between the
internet and arbitrary code execution on this host.

1. **Keep OpenHands bound to localhost.** In `.env`: `OPENHANDS_PORT_BIND=127.0.0.1:13781` and
   `PERMITTED_CORS_ORIGINS=https://<subdomain>` (the public HTTPS origin, NOT localhost). Re-run
   `docker compose up -d`.
2. **DNS:** ask me to point an A record for the `<subdomain>` (e.g. `openhands.aimeat.io`) at this
   host, or confirm a wildcard already covers it.
3. **Basic-auth password:** `sudo htpasswd -c /etc/nginx/openhands.htpasswd <username>` (ask me
   for the username; I'll set the password when prompted, or generate a strong one and give it to
   me — do not print it back afterward).
4. **Site config:** copy `nginx/openhands.conf.example` from the bundle, replace `__DOMAIN__` with
   the subdomain, place it in `/etc/nginx/sites-available/openhands.conf`, symlink into
   `sites-enabled/`. It already handles the WebSocket upgrade + long agent-stream timeouts.
5. **TLS cert:** use the host's existing certbot — `sudo certbot --nginx -d <subdomain>` (or match
   however aimeat.io's certs are issued). Ensure the cert paths in the config match.
6. **Apply:** `sudo nginx -t && sudo systemctl reload nginx`.
7. **Verify:** open `https://<subdomain>` → browser prompts for Basic Auth → after login the
   OpenHands UI loads; start a conversation and confirm the agent **streams a reply** (proves the
   WebSocket proxy works, not just the page). Then run the skill probe + MCP smoke test. Confirm
   `https://<subdomain>` is TLS-valid and that hitting it without credentials returns 401.
   Recommended hardening: also uncomment the `allow <your-ip>; deny all;` lines in the config.
- **Docker socket:** the compose mounts `/var/run/docker.sock` (OpenHands spawns its runtime
  container) — same as dev. Ensure the prod host allows that and has the disk for the
  agent-server image.
- **Secrets:** `.env` + `secrets/aimeat.env` are git-ignored; they live only on the host. Back
  them up out-of-band if you want to avoid re-running the device-auth approval.
