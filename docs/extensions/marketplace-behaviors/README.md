# marketplace-behaviors Extension

Multi-instance marketplace extension for AIMEAT nodes: access-controlled marketplaces with listings that carry a money price, an agreement to buy, delivery confirmation and buyer ratings.

**This extension does not move money.** A listing's price is money, stored as data. The buyer pays the seller outside the extension (cash at pickup, a bank transfer), or through the node's checkout when the seller sells the item as an offer or app tool with a money price. The extension records who agreed to buy what, and tracks delivery and the rating.

## Prerequisites

- An AIMEAT node at 3.26 or later. The node ships this extension in `docs/extensions/`.

## Installation

The operator installs it with one call, and it is active at once:

```
POST /v1/admin/extensions/available/marketplace-behaviors/install
Authorization: Bearer <operator-token>
```

## Pacing

Two actions declare a pacing amount in morsels per call, which the node charges before the script runs:

| Action | `tollMorsels` |
|---|---|
| `create-listing` | 2 |
| `purchase` | 1 |

A morsel paces how much a person's agents do; it is never a price, a fee or a currency. The node takes the amount from the caller's morsels, burns the operator's burn-rate share and credits the rest to whoever installed the extension. The installer's own calls are free. The scripts never touch the caller's wallet. When the caller has too few morsels, the node answers 402 and names the daily allowance and, when the operator sells one, a pacing pack.

## Multi-Instance Support

A single node can host multiple independent marketplaces. Each instance has its own visibility, categories and currency. Create an instance (the installer or the operator):

```
POST /v1/extensions/marketplace-behaviors/instances
Authorization: Bearer <token>

{
  "id": "vintage-books",
  "config": {
    "visibility": "public",
    "categories": ["fiction", "non-fiction", "rare"],
    "currency": "EUR"
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
| `currency` | string | `EUR` | Currency of a listing's money price when the listing names none |

### Visibility Modes

- **public** -- Anyone signed in can browse and create listings.
- **password** -- Users must include `_password` in their request body to access the marketplace.
- **invite** -- Only GAIIs listed in `allowed_users` (and operators) can access the marketplace.

## Actions

All action endpoints are instance-scoped: `POST /v1/ext/marketplace-behaviors/:instanceId/<action>`

### create-listing

Create a new listing in the marketplace.

- Checks instance access (visibility/password/invite)
- Validates title, description, and price (a positive money amount, such as `12.5`)
- Takes `currency` (ISO 4217, such as `EUR`), or the instance's currency
- Validates category against instance-configured categories
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

Agree to buy a listing at its money price.

- Checks instance access
- Verifies listing is active and buyer is not the seller
- Creates a purchase record, private to the extension, and sets the listing to `reserved`
- Takes no payment
- Returns `{ purchaseId, price, currency, status: 'agreed' }`

### deliver

Confirm delivery. Only the seller can call this on an `agreed` purchase.

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
listing:   active  -->  reserved                      (or delisted at any point)
purchase:              agreed  -->  delivered  -->  completed
```

1. Seller creates a listing (listing: `active`)
2. Buyer agrees to buy (listing: `reserved`, purchase: `agreed`); the buyer pays the seller
3. Seller confirms delivery (purchase: `delivered`)
4. Buyer rates (purchase: `completed`)

At any point, the seller or an operator can delist a listing.

## Memory

Listings (`listing.<id>`) and ratings (`rating.<purchaseId>`) are public in the instance's namespace `ext:marketplace-behaviors.<instanceId>`, so anyone can browse them. Purchase records (`purchase.<id>`), which say who bought what, are written private.

## Global Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `currency` | string | `EUR` | Currency when neither the listing nor the instance names one |

## Federation

The manifest declares `federation.advertise: true` with the capabilities `multi-instance`, `purchase-workflow` and `ratings`. The node stores the declaration with the extension; nothing on the node reads it yet.

## Resource Limits

The extension runs within sandboxed limits:

- **Memory:** 64 MB
- **Timeout:** 5000 ms per action
- **API calls:** 50 per action invocation
