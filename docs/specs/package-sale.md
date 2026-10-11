# Package sale: the node-to-node contract

Status: current, checked against the code on 2026-10-11. Every node serves this file at
`GET /v1/specs/package-sale.md`.

This is what a node needs to sell, buy or serve a private install package together with another
AIMEAT node. Three nodes take part, and one node may play more than one part:

| Part | What it does |
|---|---|
| **Repository** | Holds the package, its author's offer and the entitlements. Runs no checkout and holds no buyer accounts. A node takes this part when its operator turns on the package repository role (`AIMEAT_PACKAGE_REPOSITORY`). |
| **Selling node** | A node the package's author names as a seller. It runs the checkout for its own buyers and asks the repository to grant, change or end an entitlement. |
| **Customer node** | The node that receives the package and its updates. It proves its key when it redeems a claim code or pulls a version. |

How the selling node sets its own price, runs its checkout and keeps its books is that node's own
business and is not part of this contract. The design history is a document in the AIMEAT
development organism.

## 1. The signed request

Every request in this contract is signed by the node that sends it. There is no bearer token and
no account on the repository.

The sender adds five headers:

| Header | Value |
|---|---|
| `x-source-node` | The sending node's id. |
| `x-timestamp` | The moment of signing, ISO 8601. |
| `x-audience` | The id of the node the request is for. |
| `x-nonce` | A one-time value. |
| `x-signature` | The Ed25519 signature, base64, of the string below, made with the sender's node key. |

The signed string is this JSON, with the keys in exactly this order:

```json
{ "source_node": "<x-source-node>", "timestamp": "<x-timestamp>",
  "purpose": "package-sale", "method": "PUT", "path": "/v1/federation/package-sales/<group>/entitlements/<node>",
  "body_sha256": "<hex sha256 of JSON.stringify(body), or of {} when there is no body>",
  "audience": "<x-audience>", "nonce": "<x-nonce>" }
```

- `purpose` is `package-sale` for a selling node's request and `package-claim` for a customer node's
  claim (section 4).
- `method` is upper case. `path` is the request path as sent, with its query string.
- `body_sha256` covers the parsed body, so a signature made for one request cannot be replayed as
  another.

The receiver checks, in this order: the three headers `x-source-node`, `x-timestamp` and
`x-signature` are present; the key the sender must have signed with exists (for a sale, an active
peer with a key); the timestamp is within five minutes; `x-audience` is the receiver's own id and
`x-nonce` is present; the signature; and last, that the nonce has not been seen before.

| Refusal | When |
|---|---|
| 401 `UNAUTHORIZED` | A header is missing, the audience or nonce is missing or wrong, or the signature does not verify. |
| 400 `STALE_TIMESTAMP` | The timestamp is missing, invalid, or more than five minutes away. |
| 401 `REPLAYED` | The nonce was already used. A node signs every request anew. |
| 403 `FORBIDDEN` | The sender of a sale request is not an active peer of the repository. |

## 2. Who may sell

A package's author names the nodes that sell it (`PUT /v1/package-sellers/{nodeId}` on the
repository, or the MCP tool `aimeat_package_sellers`). The repository registers each seller as a
peer under the key its node card publishes. A request from any other node, and a request about a
package that does not exist, answer the same refusal, so a stranger learns nothing about which
private packages exist:

```
403 NOT_A_SELLER
```

## 3. Requests a selling node sends to the repository

All paths are on the repository. `{groupId}` is the package group, URL-encoded.

| Request | What it does | Answer |
|---|---|---|
| `GET /v1/federation/package-sales/{groupId}/config-needs` | The questions a buyer will be asked at install. | `{ group_id, version, bundle, name, questions, defaults, problems }` |
| `GET /v1/federation/package-sales/{groupId}/offer` | The author's offer (section 5), every terms entry, and what the version on sale can do. | `{ group_id, author, state, terms, earlier_terms, updated_at, all_terms, latest }`; 404 `NO_OFFER` when the author set none |
| `PUT /v1/federation/package-sales/{groupId}/entitlements/{nodeId}` | Grant or change the entitlement of a customer node. Body: `updates_until`, `channel`, `note`, `terms_id`, and `node: { url, public_key }` for a node the repository does not know yet. | `{ entitlement, peer_registered, peer_pending }` |
| `DELETE /v1/federation/package-sales/{groupId}/entitlements/{nodeId}` | End an entitlement this seller made. | `{ revoked: true }` |
| `PUT /v1/federation/package-sales/{groupId}/claims` | A one-time claim code for a sale whose customer node does not exist yet. Body: `updates_until`, `channel`, `note`, `terms_id`. | `{ claim_code, expires_at }` |

Rules the repository applies:

- **A seller changes and ends only the grants it made itself.** The author and the repository's
  operator may change any grant.
- **An omitted `updates_until` keeps the grant's current date.** Send a date with every paid grant;
  `null` means updates without an end.
- **`terms_id` names the author's terms the sale was made on.** The repository copies those terms
  into the entitlement, so a later change of the author's price reaches only new sales. An unknown
  id answers 404 `TERMS_NOT_FOUND`.
- **A new customer node is registered only when its card agrees.** With `node`, the repository reads
  the node's `/.well-known/aimeat` and registers it as a packages-only peer when the card names the
  same node id and key (`peer_registered: true`). When the node does not answer, the grant stands and
  the registration waits for the node's first signed request (`peer_pending: true`). A grant to the
  repository's own id is refused.

## 4. A customer node redeems a claim code

```
POST /v1/federation/package-claims/{groupId}
{ "code": "pkgc_...", "node_id": "<the customer node>", "url": "https://...", "public_key": "<base64 Ed25519>" }
```

The request is signed with purpose `package-claim` and with the key the body names, so it proves
that the sender holds that key. `node_id` must equal `x-source-node`. The repository consumes the
code in one step before it registers the node, so one code grants one node.

| Answer | When |
|---|---|
| `{ entitlement, peer_registered, peer_pending }` | The claim was redeemed. |
| 404 `CLAIM_NOT_FOUND` | No claim with that code waits for this package. |
| 404 `NOT_A_REPOSITORY` | The node does not take the repository part. |
| 400 `INVALID_INPUT` | `node_id` is not the signing node, or the code is not a claim code. |

A claim expires 30 days after it was made. The repository keeps only its SHA-256.

## 5. The records

**The offer** is the author's terms for one package group. The author sets it on the repository
(`PUT /v1/packages/{groupId}/offer`, MCP `aimeat_package_offer`); a selling node reads it as above.

```
{ group_id, author,
  state: "on_sale" | "paused" | "ended",
  terms: {                                   // the current terms; earlier ones stay, by id
    id, createdAt,
    grant:   "payment" | "approval" | "automatic",
    price:   { amount, currency } | null,    // micro-units of EUR or USD; required for "payment"
    updates: { included_days, renewal: { amount, currency, period_days } | null },
    channel: "stable" | "beta",
    licence: { subject: "node", per: "purchase", spdx?, terms_url?, text_sha256? },
    tax:     { prices_include_tax, category? },
    support: { email?, security_email? } } }
```

A price is money. A morsel paces how fast agents write and buys nothing, so it is never a price.
`paused` stops new sales and keeps renewals; `ended` stops both, and every entitlement runs to its
date.

**The entitlement** is one customer node's right to one package group:

```
{ nodeId,
  updatesUntil: "<ISO 8601>" | null,         // versions published after this moment are not served
  channel: "stable" | "beta",                // stable: published versions; beta: beta versions too
  note?, soldBy?,                            // the selling node whose signed request made the grant
  terms?: { offerTermsId, price, renewal, acceptedAt },
  grantedAt, grantedBy, updatedAt }
```

A customer node may pull every version on its channel published up to `updatesUntil`. After that
date the repository answers `UPDATES_ENDED` for a newer version, and the copy the customer already
installed keeps working.

## 6. What this contract does not cover

The selling node's checkout, its own prices (`PUT /v1/package-sales/catalogue`), approvals and
renewals on its side, and the package format and its signed attestation, which are the package
repository's own routes in `openapi.yaml`.
