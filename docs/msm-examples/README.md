# MSM examples

A machine service manifest (MSM) is a written description of an outside service: what it does,
where it is, what it takes and what it gives back. An AI reads the description and builds the
integration. The node stores the description and never makes the call itself.

These ten examples ship with every node. The node reads them at start, serves them at
`GET /v1/msm/templates` (one at a time, as raw YAML, at `GET /v1/msm/templates/{type}`), and the
operator's MSM page shows them under "Ready-made ones that ship with this site". Each one is
complete: authentication, actions, what each action takes and returns, and a health check. The
quickest way to write your own is to open one, change the address and the fields, and register it
with `POST /v1/msm`. How to do that, and where the integration then runs, is in the
[MSM manual](../manuals/msm-manual.md).

Comments are in English, as in the code. Example data can be Finnish where the service is Finnish:
the Posti address, the content of a `description_fi` field and the weather words are Finnish on
purpose.

## Pacing, not a price

An action's `pricing` block holds one field, `toll_morsels`: the pacing amount in morsels for one
use, from 0 to 100. A morsel paces how much a person's agents do. It is never a price, a fee or a
currency. The field has the same name and range as in the node's action catalogue
(`POST /v1/actions`), so an AI that turns an MSM action into a catalogue action copies it as it is.
The node does not read the block from an MSM: it is a statement for whoever builds the integration.
Money, when a service costs money, is a money price on the offer, app tool or extension action
built from the manifest, paid through the node's checkout.

## Marketplace: product, price, payment and delivery

| File | Service | What it shows |
|----------|---------|-----------------|
| `product-image-analysis.msm.yaml` | OpenAI Vision / Google Vision | The product, its condition and a suggested description from a photo |
| `price-estimation.msm.yaml` | Price data analysis | What the market pays for a used product |
| `stripe-marketplace.msm.yaml` | Stripe Connect | A payment straight to the seller, with nobody holding the money in between |
| `coinbase-transfer.msm.yaml` | Coinbase CDP AgentKit | A crypto payment from a wallet an agent controls |
| `mobilepay-payment.msm.yaml` | MobilePay | A Nordic mobile payment from buyer to seller |
| `posti-shipping.msm.yaml` | Posti SmartShip | A shipment and its tracking code in one call |

## Services: lodging, restaurants and gig work

| File | Service | What it shows |
|----------|---------|-----------------|
| `nuki-smartlock.msm.yaml` | Nuki Smart Lock | A guest's access through a door, and taking it back |
| `weather-pricing.msm.yaml` | OpenWeather | A nightly rate that follows the weather forecast |
| `wolt-restaurant.msm.yaml` | A restaurant ordering system | An order taken and sent out for delivery |
| `ai-logo-design.msm.yaml` | AI image generation | Design as an action another AI calls |

## What an example does not promise

A manifest is a claim about someone else's service. Nothing checks that the address answers, that
the key is set or that the actions still exist, and nothing runs the health check. These ten are
written as examples of the structure, not as working integrations. The addresses, prices and
authentication were right for what each service offered when it was written, and they were not
re-checked in the documentation cleanup. Check them against the provider's current documentation
before use. MobilePay, for example, has since merged into Vipps MobilePay.
