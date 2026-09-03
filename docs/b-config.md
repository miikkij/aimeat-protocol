## Appendix B: Node Configuration

What a node actually reads, where each value comes from, and how an operator changes it.

This appendix used to carry an aspirational JSON schema from the v1 era, with roughly seventy-five
settings that exist nowhere in the code. It now describes the reference implementation, checked
against `aimeat/src/services/config-schema.ts` and `aimeat/.env.example` on 3 September 2026.

**One sentence version:** every setting has a dot path (`morsel_policy.daily_allowance`) and an
environment variable (`AIMEAT_DAILY_ALLOWANCE`); there are about 300 of them; `aimeat config` prints
what your node is running with, and `GET /v1/admin/config` returns the same thing with types, ranges
and where each value came from.

### Where a value comes from

Lowest priority first. A later source overwrites an earlier one.

| # | Source | How it gets in |
|---|--------|----------------|
| 1 | Built-in default | Hard-coded in `src/config.ts`. A node with no configuration at all still boots. |
| 2 | Config file | `--config <path>`, otherwise `aimeat.ini`, `aimeat.json` or a `.env` in the working directory. Parsed into dot paths, then written into the process environment for any key the environment has not already set. |
| 3 | Environment variable | `AIMEAT_*`, plus `DATABASE_URL`. This is the normal way to configure a node. |
| 4 | CLI flag | `aimeat start --db sqlite --db-path ./data/aimeat.db` and friends, mapped onto the same dot paths. |
| 5 | Consul KV | Only when `consul.enabled`. Watched live, so a change lands without a restart. |
| 6 | Database | What an operator saved through the admin dashboard. Applied last, at boot, and refused on any sealed or immutable path. |

Two kinds of setting stand outside that order:

- **Immutable fields** are read once at boot and never take a database override: `node.id`,
  `node.port`, `node.type`, `storage.type`, `DATABASE_URL`, `sqlite_path`, `admin_password`,
  `node.sealed_config_keys`. Change them in the environment or the file, then restart.
- **Sealed fields** are the paths whoever *runs* the node nominated as read-only, listed in
  `AIMEAT_SEALED_CONFIG_KEYS` (for example `quota.memory_mb,quota.storage_mb,rate_limits.global`).
  This is for a node one party operates on behalf of another: the operator still sees the value and
  its source is reported as `sealed`, but the admin dashboard refuses to move it and a database
  override on that path is ignored with a line in the boot log. Empty on a self-hosted node, where
  nothing changes. → `docs/plans/sealed-config-plan.md`

### Seeing what this node is running with

```bash
aimeat config                      # every setting, as the running process resolved it
aimeat config export --format env  # the same thing as a .env you can keep
aimeat config export --format ini  # or as aimeat.ini
aimeat config export --format json # or as JSON
aimeat validate                    # what is missing, wrong, or unsafe for a public node
```

`GET /v1/admin/config` (operator role) returns the same picture as data: for every visible field its
value, type, range, description, whether it is mutable, whether this node can edit it, **where the
value came from** (`default` · `file` · `env` · `consul` · `database` · `sealed`), and whether it can
be reset. Secrets never appear as values: an API key shows up as `<path>_configured: true|false`.

### Changing it

**From the environment or a file** for anything, including the immutable fields. `aimeat/.env.example`
is the authoritative list, 366 documented keys in 71 sections, each with a safe public default
and the local override written next to it. Copy it to `.env` and uncomment what you need.

**From the admin dashboard** for the mutable subset, which is a `PUT /v1/admin/config` underneath:

```json
{ "changes": [
  { "path": "morsel_policy.daily_allowance", "value": 75 },
  { "path": "quota.memory_mb", "value": 25 }
] }
```

That route needs persistent storage. On the in-memory backend it answers `403 READONLY_CONFIG` and
tells you to use `.env` or an `aimeat.ini` from `aimeat init`, because a value saved into a database
that disappears on restart is worse than no value.

### The field groups

About 300 fields in some fifty groups. The dot path's first segment is the group.

| Group | Fields | What it governs |
|---|---|---|
| `site` | 24 | The node's public face: front page, links, content signals, whether AI training is allowed |
| `security` | 19 | Login and registration rate limits, password lockout, the login tarpit, body size limits, the auth log |
| `ai` | 17 | The node's own model key, per-person free allowance, and the default model per role |
| `operator` | 15 | Who runs this node, as a GDPR data controller. Required, or `/v1/privacy` answers 503 |
| `quota` | 13 | Per-owner ceilings: memory MB and keys, storage MB, file and app size, workspace rows |
| `rate_limits` | 13 | Requests per second per endpoint family, multiplied by who is asking: operator 10x, owner 2x, agent 1x, anonymous 0.5x |
| `seo` | 13 | Titles, descriptions, og-image, indexing posture |
| `morsel_policy` | 11 | Welcome bonus, daily allowance and its cap, burn rate, pacing toll, operator mint ceiling |
| `federation` | 11 | Peering policy, relay hops, heartbeats, depeering grace, Web Bot Auth signing |
| `connections` | 11 | Outbound accounts (Google, Microsoft) an owner can attach |
| `email` | 10 | SMTP and whether address confirmation is required |
| `eudiw` | 10 | European digital identity wallet verification |
| `realtime` | 10 | P2P rooms: how many, how big, how long idle |
| `federation_sync` | 9 | What is replicated to peers, how often, how large a batch |
| `node` | 8 | Id, port, type, base URL, sealed keys, and the dev, test and anonymous modes |
| `totp` | 8 | Two-factor: period, window, failed-attempt ceiling |
| `extensions` | 8 | The QuickJS-WASM sandbox: memory, timeout, outbound call budget |
| `push` | 8 | Web push and its VAPID keys |
| `personal_nodes` | 7 | Slots, mailbox quota and retention for personal nodes anchored here |
| `connect_tunnel` | 7 | The connector's forward tunnel: heartbeat, offline threshold, timeouts |
| `work` | 6 | Queue depth, webhook retries, URL length ceiling |
| `commerce` | 6 | Whether commerce is on, the fee mode, the operator's fee account |
| `consul` | 6 | Optional fleet configuration source |
| `auth` | 4 | JWT and agent token lifetimes, the Entra tenant allowlist |
| `marketplace` | 4 | Listing fee, transaction fee, escrow |
| `agent` | 4 | System principles, per-task token ceiling, mandatory logging |
| `consent`, `cortex`, `portfolio`, `cookies`, `cross_federation` | 3 each | Consent retention; cortex install limits; portfolio size; cookie banner; genesis peers |
| `features`, `stats`, `metrics`, `scopes`, `sso`, `tasks` | 2 each | Feature switches, who may read stats and metrics, default and maximum agent scopes, organisation sign-in, task auto-archive |
| `storage`, `boards`, `apps`, `cors`, `mcp`, `moderation`, `registration`, `setup`, `msm`, `indexing`, `echat`, `proactive`, `account_events` | 1 each | One knob apiece: backend type, public boards per owner, app SEO mode, allowed origins, MCP session idle, auto-hide threshold, registration mode, setup IP allowlist, MSM install role, IndexNow key, anonymous encrypted chat, proactive guidance, the account-event window |

Three top-level paths sit outside any group because they are secrets or paths, not policy:
`database_url`, `sqlite_path`, `admin_password`.

### The settings most operators change

Defaults as shipped in `.env.example`.

| Dot path | Environment variable | Default | What it does |
|---|---|---|---|
| `node.type` | `AIMEAT_NODE_TYPE` | `full` | `full`, `relay`, `mirror` or `personal` |
| `node.port` | `AIMEAT_PORT` | `40050` | HTTP listen port |
| `node.base_url` | `AIMEAT_BASE_URL` | `http://localhost:$PORT` | The address this node publishes as its own |
| `node.anonymous_mode` | `AIMEAT_ANONYMOUS` | `false` | Read and limited writes with no account, alongside normal auth |
| `node.dev_mode` | `AIMEAT_DEV_MODE` | `false` | Allows localhost webhooks; re-registration resets the password only |
| `storage.type` | `AIMEAT_STORAGE` | `memory` | `sqlite` or `postgres-kysely` for anything that must survive a restart |
| `auth.jwt_ttl_seconds` | `AIMEAT_JWT_TTL` | `3600` | Session token lifetime |
| `morsel_policy.welcome_bonus` | `AIMEAT_WELCOME_BONUS` | `100` | Morsels a new owner starts with |
| `morsel_policy.daily_allowance` | `AIMEAT_DAILY_ALLOWANCE` | `50` | Accrued per day |
| `morsel_policy.daily_allowance_cap` | `AIMEAT_DAILY_ALLOWANCE_CAP` | `500` | Where accrual stops |
| `morsel_policy.burn_rate` | `AIMEAT_BURN_RATE` | `0.10` | Share of a transfer that leaves circulation |
| `morsel_policy.pacing_toll_default` | `AIMEAT_PACING_TOLL_DEFAULT` | `0` | What a write costs by default |
| `quota.memory_mb` | `AIMEAT_MEMORY_QUOTA_MB` | `10` | Memory per owner |
| `quota.memory_max_keys_per_agent` | `AIMEAT_MEMORY_MAX_KEYS` | `1000` | Keys per principal. aimeat.io runs this at 100 000; build against 1000 |
| `quota.memory_max_value_size_kb` | `AIMEAT_MEMORY_MAX_VALUE_SIZE_KB` | `1024` | One memory value |
| `quota.storage_mb` | `AIMEAT_STORAGE_QUOTA_MB` | `100` | Files per owner |
| `quota.storage_max_file_size_mb` | `AIMEAT_STORAGE_MAX_FILE_SIZE_MB` | `10` | One file |
| `quota.app_max_size_mb` | `AIMEAT_APP_MAX_SIZE_MB` | `5` | One published app |
| `work.queue_max_pending` | `AIMEAT_WORK_QUEUE_MAX_PENDING` | `10` | Pending work items per agent |
| `rate_limits.global` | `AIMEAT_RL_GLOBAL` | `300` | Requests per second, all endpoints |
| `rate_limits.auth` | `AIMEAT_RL_AUTH` | `20` | Requests per second on auth |
| `rate_limits.memory` | `AIMEAT_RL_MEMORY` | `120` | Requests per second on memory |
| `security.login_rate_limit_max` | `AIMEAT_LOGIN_RATE_LIMIT_MAX` | `15` | Login attempts per window |
| `security.password_lockout_attempts` | `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` | `5` | Failures before an account locks |
| `security.json_body_limit_mb` | `AIMEAT_JSON_BODY_LIMIT_MB` | `5` | Request body ceiling |
| `features.extended_features_enabled` | `AIMEAT_EXTENDED_FEATURES` | `true` | The platform layer on top of the Core |
| `registration.mode` | `AIMEAT_REGISTRATION_MODE` | `open` | Who may create an account: `open`, `oauth`, `invite` or `closed`. → `docs/organisation-node-sign-in.md` |
| `node.sealed_config_keys` | `AIMEAT_SEALED_CONFIG_KEYS` | empty | Paths this node's host makes read-only |

**The security posture is environment-only.** `AIMEAT_SECURITY_PROFILE` takes `local` or `public`,
defaults to `public`, and is read straight from the environment rather than through the field schema,
so it has no dot path and cannot be changed from the dashboard. It decides the settings whose safe
value differs between localhost and the open internet: private-network egress, the AI provider
allowlist, and whether app origin isolation is on when nothing has said. `aimeat validate` reports
what the current posture leaves open. → `docs/coding-guidelines/security-development-dna.md`

Operator identity (`operator.*`) has no default on purpose. A node that has not said who runs it
answers 503 on `/v1/privacy` rather than naming somebody else as the data controller.

### What is no longer configuration

Earlier versions of this appendix described settings for subsystems that have since been removed
from the code. None of these paths exists, and setting the environment variables does nothing:

- `micro_memory.*` and the Tier 0.5 keys in `auth` (`keyed_browse_enabled`, `otk_ttl_seconds`,
  `otk_max_per_session`). Deprecated in RFC v4.0, deleted on 23 August 2026. The routes answer 404
  and the E2E suite asserts it.
- `extended_pricing.*`, `trust_policy.*` and `abuse_prevention.*`. Specified in the v1-era schema,
  never implemented as settings. Trust and pacing exist, with their behaviour in code rather than in
  knobs.
- `boards.public_boards`, the hard-coded list of node-wide boards. Boards were deprecated in v4.0
  and **reinstated on 30 August 2026**; what remains configurable is `boards.public_per_owner_max`.

---

**END OF APPENDIX B**

---
