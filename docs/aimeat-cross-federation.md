# Cross-federation

A node can exchange catalogues and consented memory with approved genesis peers.
The implemented routes and authorization are in
[federation-genesis.ts](../aimeat/src/routes/federation-genesis.ts); request and
response schemas belong in [openapi.yaml](../openapi.yaml).

## Routes

| Purpose | Route |
|---|---|
| Request peering | `POST /v1/federation/genesis-peer` |
| List peers | `GET /v1/federation/genesis-peers` |
| Approve a peer | `PUT /v1/federation/genesis-peer/:id/approve` |
| Suspend a peer | `PUT /v1/federation/genesis-peer/:id/suspend` |
| Remove a peer | `DELETE /v1/federation/genesis-peer/:id` |
| Search the combined catalogue | `GET /v1/federation/cross-catalogue` |
| Receive a signed catalogue | `POST /v1/federation/genesis-catalogue-ingest` |
| Read across genesis peers | `GET` / `POST /v1/federation/genesis-memory-read` |
| Read or update subscriptions | `GET` / `PUT /v1/federation/genesis-peer/:id/subscriptions` |
| Network statistics | `GET /v1/federation/network-stats` |
| Organism reputation | `GET /v1/organisms/:id/reputation` |

Peering management requires operator authority. Catalogue ingestion verifies an
active peer and its signature. The caller-initiated POST memory read requires
`memory:read`; peer reads must also satisfy federation consent. Cached results
do not replace authorization. See the route handlers before writing a client.

## Configuration

Defaults below come from [config.ts](../aimeat/src/config.ts). See the
[configuration guide](b-config.md) for effective node settings.

| Variable | Default | Purpose |
|---|---|---|
| `AIMEAT_CROSS_FEDERATION_ENABLED` | `false` | Cross-federation feature flag |
| `AIMEAT_MAX_GENESIS_PEERS` | `10` | Genesis peer limit |
| `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` | `6` | Catalogue sync interval |
| `AIMEAT_FEDERATION_TIMEOUT_MS` | `10000` | Peer request timeout |
| `AIMEAT_GENESIS_MEMORY_CACHE` | `false` | Cache permitted genesis memory results |
| `AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS` | `4` | Memory cache lifetime |

Synchronization and failure handling are defined by
[genesis-peering.ts](../aimeat/src/services/genesis-peering.ts).
Cache writes and reads use the shared
[genesis memory cache](../aimeat/src/services/genesis-memory-cache.ts).
A stored remote catalogue entry retains its remote ID separately; callers use
the returned memory key to address an entry. Do not assume that a local record
ID is valid on another node.
