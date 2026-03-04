# AIMEAT Cross-Federation Guide

## Overview

AIMEAT cross-federation connects independent nodes into a decentralized network through genesis peering. Each node maintains autonomy over its data and users while selectively sharing catalogue entries, organism reputations, and service definitions with peer nodes.

## Architecture

Federation is point-to-point between nodes. There is no central registry or hub. Each node independently manages its peer relationships.

```
Node A                    Node B                    Node C
  |                         |                         |
  |<-- genesis peer ------->|                         |
  |                         |<-- genesis peer ------->|
  |                         |                         |
  |<------------ cross-catalogue query -------------->|
  |          (routed via Node B if A-C not peered)    |
```

Nodes communicate over HTTPS using standard AIMEAT API calls authenticated with Ed25519-signed JWTs. Each peering relationship is bidirectional: both nodes can query each other's federated catalogue entries.

## Peering Lifecycle

A genesis peer relationship progresses through defined states:

```
request --> pending --> approve --> active
                          |
                          +--> suspend --> (reactivate or delete)
```

1. **Request:** Node A's operator sends a peering request to Node B, including the node's public URL and identity.
2. **Pending:** The request appears in Node B's pending peer list for operator review.
3. **Approve:** Node B's operator approves the request. Both nodes exchange signing keys and begin synchronization.
4. **Active:** Catalogue sync runs on schedule. Cross-node queries are enabled.
5. **Suspend:** Either operator can temporarily halt synchronization without deleting the relationship.
6. **Delete:** Permanently removes the peering relationship and purges cached data from the peer.

## Endpoints

### `POST /v1/genesis-peer`

Initiates a peering request to the local node. Called by the remote node's peering service.

Request body:
```json
{
  "nodeId": "remote-node-001",
  "url": "https://remote-node.example.com",
  "publicKey": "<base64url-encoded Ed25519 public key>"
}
```

### `GET /v1/genesis-peers`

Lists all peer relationships for the local node. Requires `operator` role. Returns peer ID, node ID, URL, status, and last sync timestamp for each peer.

Query parameters:
- `status` -- Filter by state: `pending`, `active`, `suspended` (optional)

### `PUT /v1/genesis-peer/:peerId/approve`

Approves a pending peer request. Requires `operator` role. Triggers initial catalogue synchronization.

### `PUT /v1/genesis-peer/:peerId/suspend`

Suspends an active peer. Synchronization stops immediately. The peer's cached catalogue entries are retained but marked stale.

### `DELETE /v1/genesis-peer/:peerId`

Permanently removes a peer relationship. Purges all cached data from that peer. The remote node is notified and should reciprocally remove the relationship.

### `GET /v1/cross-catalogue`

Queries the federated catalogue across all active peers. Accepts the same query parameters as the local catalogue endpoint (`city`, `interest`, `radius_km`, `type`) plus:

- `peer` -- Restrict query to a specific peer node ID (optional)
- `limit` -- Maximum results per peer (default: 20)

Results include a `sourceNode` field indicating which peer provided each entry.

### `GET /v1/network-stats`

Returns aggregate statistics about the federation network visible from the local node. Includes total active peers, total federated catalogue entries, last sync timestamps, and per-peer entry counts.

## Organism Reputation

Organisms (groups/communities) have a computed reputation score accessible across the federation.

### `GET /v1/organisms/:id/reputation`

Returns the organism's reputation in schema.org `Rating` format:

```json
{
  "@type": "Rating",
  "ratingValue": 4.2,
  "bestRating": 5,
  "worstRating": 0,
  "ratingCount": 37,
  "reviewCount": 12
}
```

The reputation score is derived from member activity, content quality flags, and peer endorsements. Federated peers cache and serve each other's organism reputations with a configurable staleness threshold.

## CSM Federation

Cross-Service Manifest (CSM) records control whether a service definition is shared across the federation. The `federate` boolean field on each CSM record determines inclusion:

- `federate: true` -- The CSM record is included in catalogue sync and visible to peer nodes.
- `federate: false` (default) -- The CSM record is local-only and not shared.

Operators can update the `federate` field via `PUT /v1/csm/:csmId`. Changes take effect at the next sync cycle.

## Cross-Node Matching

When cross-federation is enabled, the interest matching engine extends its search to federated catalogue entries. The matching process:

1. Collects the local user's interest profile from their GHII record.
2. Queries each active peer's catalogue for entries with overlapping interests.
3. Ranks results by interest overlap score, geographic proximity, and peer trust level.
4. Returns merged results with source attribution.

Matching respects consent settings: only users who have opted into federated visibility appear in cross-node results.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_CROSS_FEDERATION_ENABLED` | `false` | Enable federation endpoints and sync |
| `AIMEAT_MAX_GENESIS_PEERS` | `10` | Maximum number of active peer relationships |
| `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` | `6` | Hours between automatic catalogue sync cycles |
| `AIMEAT_FEDERATION_CACHE_TTL_HOURS` | `24` | How long cached peer data is considered fresh |
| `AIMEAT_FEDERATION_TIMEOUT_MS` | `10000` | HTTP timeout for peer-to-peer requests |

## Scheduled Sync

When federation is enabled, a background task runs at the interval defined by `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS`. Each cycle:

1. Iterates through all active peers.
2. Fetches each peer's federated catalogue entries (CSM records with `federate: true`).
3. Updates the local cache, adding new entries and removing ones no longer present on the peer.
4. Fetches updated organism reputation scores from each peer.
5. Records the sync timestamp on the peer record.

Failed syncs are logged and retried at the next interval. Three consecutive failures trigger an automatic suspension notification to the operator.

---

*AIMEAT Protocol -- Overscale Solutions Oy, 2026*
