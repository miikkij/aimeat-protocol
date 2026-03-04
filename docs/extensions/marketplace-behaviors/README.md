# marketplace-behaviors Extension

Purchase workflow extension for AIMEAT nodes. Provides escrow-backed purchases, delivery confirmation, and seller ratings using the morsel economy.

## Prerequisites

- AIMEAT node running v1.5 or later
- A marketplace CSM template installed on the node (defines listing data shape, consent scopes, and directory rules)
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
  "source": "https://extensions.aimeat.io/marketplace-behaviors-1.0.0.tar.gz"
}
```

Then activate it:

```
POST /v1/extensions/marketplace-behaviors/activate
Authorization: Bearer <operator-token>
```

## Purchase Flow

The extension implements a three-step workflow:

### 1. Purchase

The buyer calls `POST /v1/ext/marketplace-behaviors/purchase` with the memory key of the listing they want to buy. The extension:

- Reads the listing from memory and verifies it is active
- Checks the buyer has granted `marketplace-listing` consent
- Calculates the total price including the transaction fee
- Places a morsel hold (escrow) on the buyer's wallet
- Creates a purchase record in memory with status `purchased`
- Updates the listing status to `purchased` so no one else can buy it

### 2. Deliver

The seller calls `POST /v1/ext/marketplace-behaviors/deliver` with the purchase ID. The extension:

- Verifies the caller is the seller listed on the purchase
- Releases the escrowed morsels to the seller's wallet
- Updates the purchase status to `delivered`

### 3. Rate

The buyer calls `POST /v1/ext/marketplace-behaviors/rate` with the purchase ID and a score from 1 to 5. The extension:

- Verifies the caller is the buyer and the purchase is delivered
- Adjusts the seller's trust score: 5 stars gives +4, 4 stars +2, 3 stars 0, 2 stars -3, 1 star -6
- Stores the rating (score and optional comment) in memory
- Marks the purchase as `completed`

## Configuration

These values can be set when activating the extension or updated via `PATCH /v1/extensions/marketplace-behaviors/config`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `listing_fee_morsels` | integer | 2 | Fee charged to create a listing |
| `transaction_fee_percent` | integer | 5 | Percentage fee added to each purchase |
| `escrow_enabled` | boolean | true | Whether to hold funds in escrow during the purchase window |

## Federation

When `federation.advertise` is enabled (the default), the node advertises the following capabilities to peers:

- `escrow` -- morsel escrow support for purchases
- `purchase-workflow` -- the full purchase/deliver/rate lifecycle
- `ratings` -- seller trust score adjustments based on buyer ratings

## Resource Limits

The extension runs within sandboxed limits:

- **Memory:** 64 MB
- **Timeout:** 5000 ms per action
- **API calls:** 50 per action invocation
