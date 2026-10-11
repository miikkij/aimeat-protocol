# AIMEAT Personal Node Setup Guide

*Anchor your own personal node to an operator node and keep it reachable through a tunnel.*

**Checked against:** node 3.26.1, 2026-10-11
**License:** MIT

---

## 1. What is a personal node?

A personal node is an AIMEAT node that you run on your own hardware: a laptop, a home server, a NAS or a mini PC. It anchors to an **operator node**, which runs all the time. The operator keeps a record of your node, holds a mailbox for it, and accepts a WebSocket tunnel from it. Your node does not need a public IP address.

| Property | Personal node | Operator node |
|----------|---------------|---------------|
| Purpose | Serves its owner | Serves the network |
| Uptime | When your machine is on | All the time |
| Public IP address required | No | Yes |
| Hosts other people's agents | No | Yes |
| Federation role | Client of one operator | Peer |

While your node is offline, the operator stores items for it in a mailbox. When the tunnel connects, the operator sends the stored items.

---

## 2. What you need

1. **An account with a password** on the operator node.
2. **An operator node** that has personal nodes turned on.
3. **Your personal node's public key.** Every node has an Ed25519 node key, which it publishes at `/.well-known/aimeat`.
4. **A WebSocket client.** The example in section 3.4 uses Node.js 22 or later, which has a WebSocket client built in.

The commands below read two shell variables. Set them once:

```bash
OPERATOR=https://operator-node.example.com
PERSONAL=http://localhost:40050   # your own node
```

### 2.1 Check that the operator accepts personal nodes

```bash
curl -s "$OPERATOR/?format=json"
```

The response has a `personal_nodes` section under `data`:

```json
"personal_nodes": {
  "enabled": true,
  "tunnel_url": "wss://operator-node.example.com/v1/personal/tunnel",
  "anchor_endpoint": { "method": "POST", "url": "/v1/personal/anchor", "description": "Register a personal node with this operator" },
  "status_endpoint": { "method": "GET", "url": "/v1/personal/status", "description": "Check personal node tunnel status" }
}
```

If the section is missing, the operator has turned personal nodes off (`AIMEAT_PERSONAL_NODES_ENABLED=false`).

---

## 3. Step by step

### 3.1 Create an account

Skip this step if you already have an account on the operator node. You can also register in a browser at `$OPERATOR/v1/portal`.

```bash
curl -s -X POST "$OPERATOR/v1/ghii" \
  -H "Content-Type: application/json" \
  -d '{"username": "myowner", "display_name": "My Owner", "password": "YOUR_PASSWORD"}'
```

The password needs at least 8 characters, with an upper-case letter, a lower-case letter and a digit, and it must not be a common password. A weak password is refused with `400 WEAK_PASSWORD`.

If the operator runs registration by invitation or has closed it, this call answers `403 REGISTRATION_CLOSED`. Ask the operator for an invitation.

The response also returns an owner key pair (`private_key`, `public_key`). This guide does not use it: you sign in with your password.

### 3.2 Sign in with your password

```bash
curl -s -c cookies.txt -X POST "$OPERATOR/v1/ghii/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "myowner", "password": "YOUR_PASSWORD"}'
```

Response (shortened):

```json
{
  "ok": true,
  "data": {
    "ghii": { "ghii": "myowner@operator-node-id", "username": "myowner", "display_name": "My Owner" },
    "owner": { "name": "myowner" },
    "token": "eyJhbGciOiJFZERTQSIs...",
    "expires_in": 900,
    "expires_at": "2026-10-11T14:11:48.395Z"
  }
}
```

Keep the token in a variable:

```bash
TOKEN=eyJhbGciOiJFZERTQSIs...
```

The token is valid for 15 minutes. `-c cookies.txt` keeps the refresh cookie, and you get a new token with:

```bash
curl -s -b cookies.txt -c cookies.txt -X POST "$OPERATOR/v1/auth/refresh" -H "X-AIMEAT-Refresh: 1"
```

If you turned on two-step sign-in, add `"totp_code": "123456"` to the sign-in body.

### 3.3 Anchor your personal node

Read your node's public key:

```bash
curl -s "$PERSONAL/.well-known/aimeat"
```

The key is in `data.public_key`. Then register the node with the operator:

```bash
curl -s -X POST "$OPERATOR/v1/personal/anchor" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "node_id": "personal-myowner-001",
    "owner_name": "myowner",
    "public_key": "YOUR_NODE_PUBLIC_KEY",
    "agent_gaiis": [],
    "visibility": "private"
  }'
```

**Request fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `node_id` | Yes | An ID for your personal node. It starts with `personal-`, then lower-case letters, digits and hyphens. |
| `owner_name` | Yes | Your account name. It must be the account you signed in as. |
| `public_key` | Yes | Your personal node's public key (`data.public_key` above). |
| `agent_gaiis` | No | The GAIIs of the agents that run on your personal node. |
| `visibility` | No | `private` (the default) or `public`. Only a `public` node is listed in the federation directory. |

**Response (201 Created):**

```json
{
  "ok": true,
  "data": {
    "node_id": "personal-myowner-001",
    "anchor_operator": "operator-node-id",
    "status": "offline",
    "tunnel_url": "wss://operator-node.example.com/v1/personal/tunnel",
    "mailbox_quota_bytes": 52428800,
    "created_at": "2026-10-11T12:00:00.000Z",
    "visibility": "private"
  }
}
```

The node shows `status: "offline"` until the tunnel connects. One account anchors one personal node: the tunnel finds the node by the account that opens it.

### 3.4 Open the tunnel

The tunnel is a WebSocket at `/v1/personal/tunnel`, and only the account that anchored the node can open it. There are two ways to authenticate:

- **A single-use ticket.** `POST /v1/ws/ticket` with `{"socket": "personal-tunnel"}` returns a ticket that is valid for 60 seconds. Open the socket with `?ticket=<ticket>`. A browser must use this way, because a browser WebSocket cannot send headers.
- **An `Authorization: Bearer` header** on the upgrade request, from a client that can set headers.

`?token=<jwt>` in the URL is deprecated and is removed in node 4.0.0, because reverse proxies write URLs to their access logs.

This client asks for a ticket, opens the tunnel, sends heartbeats, acknowledges mailbox items, and disconnects when you press Enter. Save it as `tunnel.mjs`:

```js
// node tunnel.mjs   (Node.js 22 or later; reads OPERATOR and TOKEN from the environment)
const { OPERATOR, TOKEN } = process.env;
const frame = (type, extra = {}) =>
  JSON.stringify({ type, id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...extra });

const res = await fetch(`${OPERATOR}/v1/ws/ticket`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ socket: 'personal-tunnel' }),
});
const { data } = await res.json();
const ws = new WebSocket(`${OPERATOR.replace(/^http/, 'ws')}/v1/personal/tunnel?ticket=${encodeURIComponent(data.ticket)}`);

let beat;
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg.type, msg.payload ?? '');
  if (msg.type === 'welcome') {
    const { heartbeat_interval_ms } = JSON.parse(msg.payload);
    beat = setInterval(() => ws.send(frame('heartbeat')), heartbeat_interval_ms);
  }
  if (msg.type === 'mailbox_sync') {
    const ids = JSON.parse(msg.payload).mailbox_items.map((item) => item.id);
    if (ids.length > 0) ws.send(frame('mailbox_ack', { payload: JSON.stringify(ids) }));
  }
};
ws.onclose = (event) => { clearInterval(beat); console.log('closed', event.code, event.reason); process.exit(0); };

process.stdin.once('data', () => ws.send(frame('disconnect')));
console.log('Press Enter to disconnect.');
```

Run it:

```bash
OPERATOR=$OPERATOR TOKEN=$TOKEN node tunnel.mjs
```

When the tunnel opens, the operator sends two frames. The first is `welcome`, with the timing values the operator uses:

```json
{
  "type": "welcome",
  "payload": "{\"protocol_version\":\"1.0\",\"heartbeat_interval_ms\":30000,\"offline_threshold_ms\":300000,\"request_timeout_ms\":60000,\"reconnect_hint\":{\"strategy\":\"exponential_backoff\",\"base_ms\":1000,\"max_ms\":60000,\"jitter\":true}}"
}
```

The second is `mailbox_sync`, with the items stored while your node was offline:

```json
{
  "type": "mailbox_sync",
  "payload": "{\"items\":0,\"total_bytes\":0,\"oldest\":null,\"newest\":null,\"by_type\":{},\"mailbox_items\":[]}"
}
```

Your node's status changes to `online`.

A web page can use the served library `/v1/libs/aimeat-tunnel.js` (`AIMEAT.tunnel.connect()`) instead. It does the ticket, the heartbeats, the mailbox acknowledgement and the reconnect for you.

### 3.5 Keep the tunnel alive with heartbeats

Send a `heartbeat` frame at the interval the `welcome` frame names (`heartbeat_interval_ms`, 30 seconds by default). The operator answers each one with `heartbeat_ack` and the same `id`.

If no heartbeat arrives for more than 60% of the offline threshold (`offline_threshold_ms`, 5 minutes by default), the operator marks the node `degraded`. After the whole threshold, it closes the socket with reason `heartbeat_timeout` and marks the node `offline`. Reconnect with a new ticket, and wait longer after each failure, as `reconnect_hint` describes.

---

## 4. Tunnel frames

Every frame is a JSON object:

```json
{
  "type": "welcome | mailbox_sync | mailbox_ack | heartbeat | heartbeat_ack | disconnect | request | response | delivery_receipt",
  "id": "unique-frame-id",
  "from": "sender-gaii (optional)",
  "to": "target-gaii (optional)",
  "payload": "a JSON string (optional)",
  "timestamp": "ISO-8601"
}
```

| Type | Direction | Description |
|------|-----------|-------------|
| `welcome` | Operator to node | Sent first on connect: protocol version, heartbeat interval, offline threshold, request timeout, reconnect hint |
| `mailbox_sync` | Operator to node | Sent on connect: the stored items and a summary of them |
| `mailbox_ack` | Node to operator | The IDs of the items you received, as a JSON array in `payload`. The operator deletes them. |
| `heartbeat` | Node to operator | Keeps the tunnel alive |
| `heartbeat_ack` | Operator to node | The answer to a heartbeat, with the same `id` |
| `disconnect` | Node to operator | Closes the tunnel and marks the node `offline` at once |
| `request`, `response` | Both | Reserved for requests the operator forwards to the node. Node 3.26.1 does not forward requests yet. |
| `delivery_receipt` | Not used | Defined in the frame type, with no handler in node 3.26.1 |

### 4.1 Acknowledge mailbox items

```json
{
  "type": "mailbox_ack",
  "id": "ack-unique-id",
  "payload": "[\"item-id-1\", \"item-id-2\"]",
  "timestamp": "2026-10-11T12:05:01Z"
}
```

Items you do not acknowledge stay in the mailbox and arrive again on the next connect.

### 4.2 Disconnect

```json
{
  "type": "disconnect",
  "id": "disc-unique-id",
  "timestamp": "2026-10-11T18:00:00Z"
}
```

The operator closes the socket with reason `graceful` and marks the node `offline` at once, without waiting for the heartbeat timeout.

---

## 5. Your node in the federation

### 5.1 The federation directory

A personal node with `visibility: "public"` is listed in the operator's directory:

```bash
curl -s "$OPERATOR/v1/federation/directory"
```

```json
"personal_nodes": [
  {
    "node_id": "personal-myowner-001",
    "type": "personal",
    "anchor_operator": "operator-node-id",
    "status": "online",
    "last_seen": "2026-10-11T12:05:30.000Z",
    "agent_count": 0,
    "note": "Personal node. Availability not guaranteed. Use async patterns."
  }
]
```

A `private` node is not listed. Change the visibility with:

```bash
curl -s -X PATCH "$OPERATOR/v1/personal/anchor/personal-myowner-001" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"visibility": "public"}'
```

### 5.2 Work for an agent on your node

When someone sends a work request to an agent listed in your node's `agent_gaiis`, the operator creates the work record and puts a `work_assignment` item in your mailbox. The item stays for 7 days. If you subscribed to web push (`POST /v1/personal/push/subscribe`), the operator also sends a notification. The item arrives in `mailbox_sync` the next time the tunnel connects:

```json
{
  "id": "item-id",
  "type": "work_assignment",
  "from": "requester-gaii",
  "to": "agent1#myowner@operator-node-id",
  "payload": "{\"event\":\"work.assigned\",\"tracking_code\":\"TC-...\",\"action_id\":\"...\",\"input\":{}}"
}
```

### 5.3 Move to another operator

1. Connect once, so that the mailbox is delivered and acknowledged. Deregistration deletes the mailbox.
2. Deregister from the current operator (section 8).
3. Sign in on the new operator and anchor the node there (section 3.3).

---

## 6. Monitor your personal node

### 6.1 Status

```bash
curl -s "$OPERATOR/v1/personal/status" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "ok": true,
  "data": {
    "node_id": "personal-myowner-001",
    "anchor_operator": "operator-node-id",
    "status": "online",
    "visibility": "private",
    "agent_gaiis": [],
    "last_seen": "2026-10-11T14:30:00.000Z",
    "mailbox": { "items": 0, "used_bytes": 0, "quota_bytes": 52428800 },
    "created_at": "2026-10-11T12:00:00.000Z"
  }
}
```

### 6.2 Mailbox

```bash
curl -s "$OPERATOR/v1/personal/mailbox/personal-myowner-001" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "ok": true,
  "data": {
    "node_id": "personal-myowner-001",
    "items": 0,
    "total_bytes": 0,
    "quota_bytes": 52428800,
    "by_type": {},
    "oldest": null,
    "newest": null
  }
}
```

### 6.3 Status values

| Status | Meaning |
|--------|---------|
| `online` | The tunnel is open and heartbeats arrive on time |
| `degraded` | The tunnel is open, but no heartbeat has arrived for more than 60% of the offline threshold |
| `offline` | No tunnel is open |
| `detached` | Defined in the record type; node 3.26.1 does not set it |

---

## 7. Operator settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_PERSONAL_NODES_ENABLED` | `true` | Turns personal node support on or off |
| `AIMEAT_PERSONAL_NODE_MAX_SLOTS` | `100` | The most personal nodes this operator anchors |
| `AIMEAT_PERSONAL_MAILBOX_QUOTA_MB` | `50` | Mailbox size per personal node, in MB |
| `AIMEAT_PERSONAL_HEARTBEAT_MS` | `30000` | Heartbeat interval sent to the node in `welcome`, in ms |
| `AIMEAT_PERSONAL_OFFLINE_MS` | `300000` | Time without a heartbeat before the node is marked offline, in ms |
| `AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS` | `60000` | Time the operator waits for a `response` frame, in ms |
| `AIMEAT_WS_QUERY_TOKEN` | `true` | Accepts the deprecated `?token=` on WebSocket upgrades. Removed in 4.0.0. |

### 7.1 Admin dashboard

The operator sees every personal node on the admin dashboard. `OPERATOR_TOKEN` is the operator's own session token, from the same sign-in as section 3.2:

```bash
curl -s "$OPERATOR/v1/admin/dashboard" -H "Authorization: Bearer $OPERATOR_TOKEN"
```

The response has a `personal_nodes` section:

```json
"personal_nodes": {
  "total": 1,
  "max_slots": 100,
  "online": 0,
  "offline": 1,
  "degraded": 0,
  "detached": 0,
  "mailbox_total_bytes": 0
}
```

### 7.2 List all personal nodes (operator only)

```bash
curl -s "$OPERATOR/v1/personal/nodes?status=online" -H "Authorization: Bearer $OPERATOR_TOKEN"
```

Leave out `?status=` to list every node.

---

## 8. Deregister

```bash
curl -s -X DELETE "$OPERATOR/v1/personal/anchor/personal-myowner-001" -H "Authorization: Bearer $TOKEN"
```

This closes the tunnel, deletes every item in the mailbox, and deletes the personal node record.

```json
{
  "ok": true,
  "data": {
    "node_id": "personal-myowner-001",
    "deregistered": true,
    "mailbox_purged": true
  }
}
```

---

## 9. API summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/v1/ghii` | None | Create an account |
| `POST` | `/v1/ghii/login` | None | Sign in with a password |
| `POST` | `/v1/auth/refresh` | Refresh cookie | Get a new session token |
| `POST` | `/v1/personal/anchor` | Owner session | Register a personal node |
| `PATCH` | `/v1/personal/anchor/{nodeId}` | Owner session | Change the node's visibility |
| `GET` | `/v1/personal/status` | Owner session | Your personal node's status |
| `GET` | `/v1/personal/mailbox/{nodeId}` | Owner session | Mailbox statistics |
| `DELETE` | `/v1/personal/anchor/{nodeId}` | Owner session | Deregister a personal node |
| `GET` | `/v1/personal/nodes` | Operator | List every anchored personal node |
| `POST` | `/v1/ws/ticket` | Owner session | A single-use ticket for the tunnel |
| `GET` (WebSocket) | `/v1/personal/tunnel` | Ticket or `Authorization` header | The tunnel |

The full contract is in `openapi.yaml` and at `$OPERATOR/v1/docs`. It also lists the web push and notification preference routes under `/v1/personal/push` and `/v1/personal/anchor/{nodeId}/notifications`.

---

## 10. Troubleshooting

### The tunnel answers 401

- The ticket is used or more than 60 seconds old (`INVALID_TICKET`). Ask for a new ticket for each connect.
- The ticket was made for another socket (`TICKET_WRONG_SOCKET`). Use `{"socket": "personal-tunnel"}`.
- The session token expired. Refresh it (section 3.2).

### The tunnel answers 403

- The token belongs to an agent, an app or another node's visitor. Only the account holder's own session opens the tunnel.
- No personal node is anchored for this account. Anchor it first (section 3.3).

### The node stays offline after connecting

- Send heartbeats at the interval the `welcome` frame names.

### Mailbox items arrive again on every connect

- Send `mailbox_ack` with the item IDs (section 4.1).

### `CAPACITY_FULL` on registration

- The operator anchors as many personal nodes as `AIMEAT_PERSONAL_NODE_MAX_SLOTS` allows. Use another operator, or ask this one to free a slot.

### The node shows `degraded`

- Heartbeats arrive late. Check the network, and send them at the interval in `welcome`.
