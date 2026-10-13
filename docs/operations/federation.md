# Running federation

How an operator connects a node to other AIMEAT nodes, what each level of peering allows, what a signed
request between nodes carries, what to watch, and how to remove a peer. The routes and their bodies
are in [openapi.yaml](../../openapi.yaml); the catalogue and memory exchange between genesis peers is
in [cross-federation](../aimeat-cross-federation.md); the protocol is in the
[Core specification](../AIMEAT-Core-2026-11.md), §9.

## What federation gives

People on different nodes can message each other, find each other's published agents and catalogues,
route work across, and sign in across nodes where the operators allow it. Each node stays its own:
its owners' data stays on it unless they share it, and the operator decides which nodes it trusts and
how far.

## The settings that decide it

There is no single on switch. A node's place in a federation comes from:

| Setting | What it decides |
|---|---|
| `AIMEAT_FEDERATION_ROLE` | `standalone` (the default), `contributor` or `operator` of a federation |
| `AIMEAT_GENESIS_URL` | the federation's genesis node, written by `aimeat join` |
| `AIMEAT_FEDERATION_OPEN_JOIN` | whether this node takes introductions from nodes it has not invited |
| `AIMEAT_FEDERATION_AUTH_POLICY`, `AIMEAT_FEDERATION_DEFAULT_SCOPES` | whether people from peer nodes can sign in here, and with what |
| `AIMEAT_FEDERATION_RELAY_CLAIM` | whether a relayed request must carry a signed claim (see below) |
| `AIMEAT_FEDERATION_AUDIENCE_REQUIRED` | whether a message must prove it was meant for this node (see below) |
| `AIMEAT_DEPEERING_GRACE_HOURS` | how long a removed peer keeps working while work in flight settles |
| `AIMEAT_MAX_RELAY_HOPS` | how many nodes a relayed request may pass through |
| `AIMEAT_FEDERATION_TIMEOUT_MS` | how long this node waits for a peer |
| `AIMEAT_RL_FEDERATION` | the rate limit on introductions |
| `AIMEAT_CROSS_FEDERATION_ENABLED` and the `AIMEAT_GENESIS_*` settings | the genesis catalogue and memory exchange ([cross-federation](../aimeat-cross-federation.md)) |

Values and defaults: [configuration reference](../b-config.md) and `aimeat/.env.example`.

## Peering, step by step

1. **The joining node introduces itself.** From the joining node's working folder, `aimeat join
   <url of the node to join>` discovers the other node, asks which role to take, sends a signed
   introduction, waits for approval, exchanges keys, and writes `AIMEAT_FEDERATION_ROLE` and
   `AIMEAT_GENESIS_URL` into `.env`. The same introduction is `POST /v1/federation/peer/introduce`;
   an operator who wants to start from their side uses `POST /v1/federation/peer/request`.
2. **The other operator approves.** The request waits on the admin Federation tab
   (`/v1/admin?tab=federation`, `GET /v1/admin/peering/requests`). Approving it
   (`PUT /v1/admin/peering/requests/{id}`) creates the peer as approved. Nothing is connected yet.
3. **Activate.** `POST /v1/federation/peer/activate` runs the key exchange first and refuses if it
   fails, so a peer without a verified key never becomes active. A key that differs from the one an
   established peer already has is refused as a rotation.
4. **Check.** `POST /v1/federation/test` and the peer list (`GET /v1/federation/peers`, which also says
   how each peer arrived). The heartbeat then keeps the peer's status current.

An operator's AI reads the whole picture with `aimeat_admin_federation`
(`GET /v1/admin/federation/overview`): where the node stands, what each peer needs, versions behind,
relay-claim readiness. These operator routes and tools need the operator, or an operator's agent
holding `operator:admin`.

## Levels of peering

A peer has a tier. Higher tiers allow more:

| Tier | Allows |
|---|---|
| `contact` | messages only. Not listed in the directory or the book. Cannot be promoted (409 `TIER_NOT_PROMOTABLE`) |
| `visiting` | the catalogue, messages, broadcasts and settlement. No replication, routing or cross-node sign-in |
| `member` | everything above, plus replication and routing. Cross-node sign-in still needs its own opt-in |
| `genesis` | as `member`, marked as a genesis peer of the federation |

A visiting peer becomes a member with `POST /v1/federation/peers/{nodeId}/promote`. Other changes to a
peer go through `PUT /v1/federation/peers/{nodeId}`.

## What a request between nodes carries

Every request from one node to another is signed with the sending node's key and checked by the
receiver:

- **Who and when.** The sending node's id and a timestamp. A request outside the time window (five
  minutes) is refused (`STALE_TIMESTAMP`), and each one passes only once (a replay is refused,
  `REPLAYED`). Keep both nodes' clocks synchronised (NTP).
- **Audience.** The node it is meant for. A message signed for another node is refused
  (`WRONG_AUDIENCE`), so a message one peer received cannot be replayed to another. Messages that
  carry stored data (replication, catalogue sync, the read receipt) also carry their send time under
  the same signature. A message without this proof is refused with `AUDIENCE_REQUIRED` when
  `AIMEAT_FEDERATION_AUDIENCE_REQUIRED` says so, and always from a peer that has sent a proof before.
  From 4.0.0 the format without it is refused whatever the setting says ([upgrading](upgrading.md#what-400-removes)).
- **Relay claim.** A request that one node forwards for another carries `x-relay-claim`, a short-lived,
  single-use statement signed by the relaying node (which node, for whom, which method and path), and
  `x-relay-signature`. Without it the request is refused with `RELAY_CLAIM_REQUIRED`, unless the
  setting or that peer's own answer is `optional`. Set a peer's answer with
  `aimeat_admin_federation_relay_claim_set` (`PUT /v1/federation/peers/{nodeId}/relay-claim`). From
  4.0.0 `optional` is gone and every relay needs a claim, so a 3.x node moves every peer to `required`
  before it upgrades.

## What to watch

- **The federation overview** (`aimeat_admin_federation`): peers that need something, peers whose
  version is behind, peers not ready for the relay claim.
- **Replication backlog:** `GET /v1/admin/federation/sync-health` gives the queue depth. A queue that
  keeps growing means a peer is not taking what this node sends.
- **The log.** The heartbeat writes `Peer <id> degraded after N consecutive failures`, `offline`,
  `recovered` and `purged after de-peering grace period expired`. The relay check writes `relay:
  refused a relayed request` and the reason. Alert on peers going offline and on relay refusals that
  keep coming from one peer.
- There are no federation-specific Prometheus metrics. The HTTP and refusal metrics in the
  [observability guide](../../aimeat/docs/observability-guide.md) count federation routes like any
  other.

## Removing a peer

- **Normal removal:** `aimeat_admin_federation_peer_remove` with `node_id` and a `reason`
  (`DELETE /v1/federation/peers/{nodeId}`). The peer keeps working for `AIMEAT_DEPEERING_GRACE_HOURS`
  so work in flight can settle, then the heartbeat removes it for good.
- **Emergency removal:** the same with `emergency: true`. The connection ends at once, work in flight
  is cancelled and held amounts are returned. Use it for a compromised or hostile peer.
- **A genesis peer can be suspended instead** when you only want to stop the exchange for a while:
  `PUT /v1/federation/genesis-peer/{id}/suspend`, from the admin Genesis tab.

After removing a peer, anything attached through it stops with it: an MCP server attached with `peer`
looks up the peer on every call, so it stops answering.
