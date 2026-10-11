# Bookkeeping: what the operator sets

Invoices, the voucher journal, VAT and profit reports work on every node without any setting. A
person's AI learns to use them from the built-in skill `aimeat-bookkeeping`
(`GET /v1/skills/aimeat-bookkeeping?scope=node`). This page is what an operator sets around them.

## E-invoice delivery

An invoice sent with `delivery_method: "finvoice"` goes to an e-invoice operator. The node needs one:

| Setting | What it is |
|---|---|
| `AIMEAT_FINVOICE_OPERATOR` | `rest` for a real operator's REST interface, `mock` for testing; unset means no e-invoice delivery |
| `AIMEAT_FINVOICE_OPERATOR_URL` | the operator's address |
| `AIMEAT_FINVOICE_OPERATOR_KEY` | the key the operator gave you |

These are read from the environment at start (they are not on the admin Config page). Without them,
sending as an e-invoice answers 503 `FINVOICE_OPERATOR_NOT_CONFIGURED`, and the person can still send
by email or by hand. Formats and the adapter: `aimeat/src/services/finance/finvoice-operator.ts`.

## Email delivery

An invoice sent by email goes through the node's outgoing mail (`POST /v1/outbound/send` with the
invoice), so the node's SMTP settings, or the sending company's own SMTP settings
(`/v1/companies/{id}/smtp`), must work. The node's own are on the admin Email tab.

## Payments that mark an invoice paid

A seller who takes payments with their own Stripe account sets their payment provider credentials
(`aimeat_commerce_psp_set`), and points their Stripe webhook at `POST /v1/commerce/webhooks/stripe/{owner}`. A payment that
carries the invoice's reference marks the invoice paid and books the voucher. The node needs no Stripe
setting of its own for this; it uses each seller's own keys.

## Company addresses

A person registers their company once, and its invoices take the seller's details from it. When the
node gives companies a public front page of their own (`<company>.co.<your domain>`), the operator sets
the company host: `AIMEAT_CO_HOST` and `AIMEAT_CO_ORIGIN_ENABLED`, with the wildcard name and
certificate described in [production deployment](production-deployment.md#names-and-certificates).

## The open data feed

A published data package answers as an OData feed at `/v1/odata/{owner}/{name}`. **The feed needs no
sign-in** and allows any origin to read it, because a package is published to be read. It reads at
most a fixed number of rows per request. Nothing to set; know that it is public when you decide what
your node offers.

## What the operator does not set

There is no node-wide company identity, VAT setting, currency or numbering: identity comes from each
company record, the currency is euro, the VAT codes are Finland's (dated, so a rate change takes effect
on its day), and numbering is per owner and per company.
