# marketplace-behaviors Extension

Multi-instance marketplace extension for AIMEAT nodes. Supports access-controlled marketplaces with listing management, purchase workflow, delivery confirmation, and buyer ratings.

## Prerequisites

- AIMEAT node running v1.5 or later
- Wallet API enabled with morsel balances for buyers
- Trust API enabled for seller reputation scoring

## Installation

Upload the extension bundle to your node:

```
POST /v1/extensions
Content-Type: application/json
Authorization: Bearer <operator-token>

{
  "name": "marketplace-behaviors",
  "source": "https://extensions.aimeat.io/marketplace-behaviors-2.0.0.tar.gz"
}
```

Then activate it:

```
POST /v1/extensions/marketplace-behaviors/activate
Authorization: Bearer <operator-token>
```

## Multi-Instance Support

A single node can host multiple independent marketplaces. Each instance has its own configuration for visibility, categories, and fees. Create an instance:

```
POST /v1/extensions/marketplace-behaviors/instances
Authorization: Bearer <operator-token>

{
  "id": "vintage-books",
  "config": {
    "visibility": "public",
    "categories": ["fiction", "non-fiction", "rare"],
    "listing_fee_morsels": 3,
    "transaction_fee_percent": 8
  }
}
```

### Instance Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `visibility` | string | `public` | Access control: `public`, `password`, or `invite` |
| `password` | string | - | Required password when visibility is `password` |
| `allowed_users` | array | `[]` | List of GAIIs allowed when visibility is `invite` |
| `categories` | array | `["general"]` | Allowed listing categories |
| `listing_fee_morsels` | integer | `2` | Morsel fee charged to create a listing |
| `transaction_fee_percent` | integer | `5` | Percentage fee added to each purchase |

### Visibility Modes

- **public** -- Anyone can browse and create listings.
- **password** -- Users must include `_password` in their request body to access the marketplace.
- **invite** -- Only GAIIs listed in `allowed_users` (and operators) can access the marketplace.

## Actions

All action endpoints are instance-scoped: `/v1/ext/marketplace-behaviors/:instanceId/<action>`

### create-listing

Create a new listing in the marketplace.

- Checks instance access (visibility/password/invite)
- Validates title, description, and price (must be > 0)
- Validates category against instance-configured categories
- Charges listing fee from caller's wallet
- Returns `{ listingId }`

### update-listing

Update an existing listing. Only the seller can update. Only `active` or `paused` listings can be modified. Updatable fields: `title`, `description`, `price`, `category`, `status` (active/paused).

### browse

Browse listings with filters and pagination.

- Checks instance access
- Filter by: `category`, `minPrice`, `maxPrice`, `status` (default: `active`)
- Sorted by creation date, newest first
- Pagination via `offset` (default 0) and `limit` (default 20, max 100)
- Returns `{ listings, total, offset, limit }`

### purchase

Purchase a listing.

- Checks instance access
- Verifies listing is active and buyer is not the seller
- Calculates total: price + transaction fee percentage
- Debits buyer's wallet via `ctx.wallet.consume`
- Creates purchase record and sets listing status to `reserved`
- Returns `{ purchaseId, total, status: 'purchased' }`

### deliver

Confirm delivery. Only the seller can call this on a `purchased` order.

- Updates purchase status to `delivered` with timestamp
- Returns `{ status: 'delivered' }`

### rate

Rate a delivered purchase (1-5 stars). Only the buyer can rate, and only once.

- Stores rating record with score and optional comment
- Marks purchase as `completed`
- Returns `{ rated: true }`

### delist

Remove a listing. The seller or any operator can delist.

- Sets listing status to `delisted` with timestamp
- Returns `{ status: 'delisted' }`

## Purchase Lifecycle

```
active  -->  reserved  -->  purchased  -->  delivered  -->  completed
                                                  \
                                                   --> delisted
```

1. Seller creates a listing (status: `active`)
2. Buyer purchases (listing: `reserved`, purchase: `purchased`)
3. Seller confirms delivery (purchase: `delivered`)
4. Buyer rates (purchase: `completed`)

At any point, the seller or an operator can delist a listing.

## Global Configuration

These values serve as defaults when instance config does not override them:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `listing_fee_morsels` | integer | 2 | Default fee charged to create a listing |
| `transaction_fee_percent` | integer | 5 | Default percentage fee on each transaction |

## Federation

When `federation.advertise` is enabled (the default), the node advertises these capabilities to peers:

- `multi-instance` -- supports multiple independent marketplace instances
- `purchase-workflow` -- the full create/purchase/deliver/rate lifecycle
- `ratings` -- buyer rating system

## Resource Limits

The extension runs within sandboxed limits:

- **Memory:** 64 MB
- **Timeout:** 5000 ms per action
- **API calls:** 50 per action invocation
