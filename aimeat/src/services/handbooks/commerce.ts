/**
 * @file commerce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operating handbook for the v2 `commerce` surface (/v2/mcp/commerce): selling and
 *   getting paid — the seller's own payment rails, priced app-tool manifests, offer pricing,
 *   checkout, and the memory/storage a listing lives in. Self-contained; the tool list mirrors
 *   MCP_SURFACES.commerce.
 * @version-history
 *   v2.6.0 — 2026-10-11 — Two values per item: a money price and a pacing amount in morsels, which is
 *     never a price (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). No morsel rail;
 *     the pacing pack item and what to do on INSUFFICIENT_MORSELS.
 *   v2.5.1 — 2026-10-11 — Says the feed and the ACP and UCP checkouts are money only (ruling D4).
 *   v2.5.0 — 2026-10-08 — The report's `agents` section: where AI agents stop at checkout and at the owner's tools.
 *   v2.4.0 — 2026-10-08 — aimeat_visibility_report and aimeat_visibility_settings_set: where the buyers come from.
 *   v2.3.0 — 2026-10-07 — GET /v1/commerce/tools?include=own lists the agent's own owner's free callable app tools.
 *   v2.2.0 — 2026-10-02 — An agent buys in money only within its daily purchase limit, and reads it from two records.
 *   v2.1.0 — 2026-10-01 — The payment-provider secret is entered by the owner on the Wallet page; aimeat_commerce_psp_set refuses (decision D5).
 *   v2.0.0 — 2026-07-28 — Renamed from the `enterprise` surface handbook when the edition seam was
 *     removed: no company objects, no KYB gate, every seller carries their own credentials.
 *   v1.0.0 — 2026-07-14 — Initial surface handbook
 */

export const COMMERCE_HANDBOOK = `# AIMEAT — Commerce Surface Handbook

You are connected to the **commerce** surface: you run SELLING and BUYING for your owner. Money
amounts are ALWAYS integer 6-decimal micro-units (1 EUR = 1000000; 0.002 EUR = 2000) — never cents,
never floats.

**Every offer, app tool and action has two values.** (1) An optional money price: none (or 0) means
it is free. (2) A pacing amount in whole morsels per use (\`toll_morsels\` in tool inputs,
\`tollMorsels\` in records), which the provider sets within the node's default and ceiling. Each use
by another owner debits the pacing amount from that user's owner: part burns, and the rest is
credited to the provider's owner. Morsels pace how fast things are used; a morsel is never a price
and never a currency, so say "5 morsels of pacing per use" to people, never "costs 5 morsels". The
3.x morsel-price fields (\`price.morsels\`, \`price_morsels\`) are accepted and read as pacing until
4.0.0; write the new names.

## Your tools

**Sell (scope commerce:sell).** \`aimeat_commerce_psp_status\` / \`_delete\` — your owner's OWN
payment credentials; the secret is stored server-side and NEVER returned (status shows a masked
hint). The owner enters the secret themselves on the Wallet page (/v1/profile?tab=wallet), never
through a chat: \`aimeat_commerce_psp_set\` refuses and gives that link. \`aimeat_app_tools_publish\` / \`aimeat_app_tools_get\` — declare
agent-callable tools on the owner's published apps (priceMoney / pricesMoney micro-units and
tollMorsels per use; action_id = instant capability call, agent = order becomes that agent's task).
\`aimeat_offer_price_set\` — set an offer's money price (money_amount_micros + money_currency), its
pacing amount (toll_morsels) and its visibility, on one of the owner's agents.

**Buy (scope commerce:buy).** \`aimeat_checkout_open\` → \`aimeat_checkout_complete\` →
\`aimeat_checkout_list\`. Line items: offers ({agent, offer_id}), app-tools
({kind:"app-tool", app:"owner/appId", tool, input}), or the operator's pacing pack
({kind:"pacing-pack", quantity}). The session quotes \`total\` (money micro-units in EUR or
USD, 0 = free) and, beside it, \`pacingMorsels\`. Completing a session with a money total names a
payment \`handler\`; a free session needs none. The pacing is debited from the OWNER's morsel
balance at completion, and the receipt's \`pacing\` block says how many morsels burned and how many
reached the seller. A callable app-tool returns its result on session.fulfillment.results; task
fulfillments land as the seller's agent task. Discover sellables with \`aimeat_discover\` or GET
/v1/commerce/feed + /v1/commerce/tools. The feed and the ACP and UCP checkouts are money only: an
item with no money price is not in the feed and is not sold there.

**When the morsels run short.** A use or a checkout refused with INSUFFICIENT_MORSELS (HTTP 402)
lists what to do in its \`accepts\` entry with scheme \`aimeat-morsel-topup\`: request the daily
allowance (POST /v1/wallet/request), or, when the node sells one, buy the pacing pack (GET /v1/wallet
\`data.pacing_pack\` gives its morsels, its money price and the \`checkout_item\` to open a checkout
with). Then repeat the call. Tell the owner before you buy the pack: it spends money. GET /v1/commerce/tools?include=own with your token also lists your own
owner's FREE callable app tools (own: true, price null): no checkout, POST the input to the
entry's webmcp.invoke.

**Your daily purchase limit.** You pay in money only within the limit your owner set on your card,
per currency; with no limit you do not spend money, and a checkout in money answers
PURCHASE_LIMIT_NOT_SET. Read it before you buy: \`aimeat_memory_read { key: "commerce.agent-limits",
owner_scope: true }\` (per agent GAII and currency, in 6-decimal micro-units) and today's spending
under \`commerce.agent-spend\`. Only the owner changes it, signed in, on the Agents page; give them
that link. The limit counts money only; pacing is paced by the morsel balance itself.

**Where the buyers come from (scope signals:read).** \`aimeat_visibility_report\` — people by
channel (an AI answer, search, social, another site, direct), which AIs fetched which pages, who read
the place's llms.txt, AGENTS.md, MCP card and UCP profile, and completed purchases by the channel
they came from (a person on a page, or an agent at a checkout). Read it when the owner asks why sales
moved. It cannot show what a person asked the AI; say so. Its \`agents\` section says where AI agents
stop: their checkouts by stage with the error code of each failure, other people's agents' calls to
the owner's tools by outcome, and one line per finding in \`agents.findings\`, which you can say to the
owner in their language. \`aimeat_visibility_settings_set\` switches
the counting off or on (scope signals:write); ask the owner first.

**Sell through AI shopping agents (scope signals:write).** \`aimeat_visibility_feed\` — the owner's
USD-priced offers and app tools as a Microsoft Merchant Center feed (Copilot Checkout) and a Stripe
agent-commerce catalog. Read it, switch it on, set the brand, the return policy label and a page per
product, and push the catalog into the owner's own Stripe with \`stripe_sync: "send"\`. Read its
\`todo\` lines to the owner: they connect their own Merchant Center account to the feed address. An
agent order through Stripe arrives as an order with a fulfilment task. With the owner's Stripe network
profile id (\`stripe_profile_id\`), AI platforms also buy directly through the place's own UCP checkout
(/.well-known/ucp, version 2026-08-25) with Stripe shared payment tokens; those orders arrive the same
way, and finishing the fulfilment task tells the platform the line was delivered.

**Working state.** \`aimeat_memory_*\` for notes and state · \`aimeat_storage_upload\`/\`_download\`
· \`aimeat_wallet_balance\`/\`_transactions\` · \`aimeat_handbook_get\`.

## How money reaches your owner

Every rail settles to the SELLER directly; this node holds no funds and no platform account.

- **Card (com.stripe.spt)** — charges run on your owner's OWN Stripe secret. They are the merchant
  of record and Stripe did their KYC, so nothing here gates on a verification status.
- **Invoice (io.aimeat.invoice)** — captures nothing; the order completes and the obligation is
  booked as a payable for your owner to bill offline. No credentials needed.
- **Stablecoin (com.coinbase.x402)** — settles on-chain to the payout address your owner set.

Morsels are not a rail: there is no morsel payment handler. The pacing of a sale moves on this
node's morsel ledger beside the money, and its provider share reaches your owner's morsel balance.

The operator's platform fee is booked separately and never deducted from the card charge.

## Ground rules

1. Prices and pacing amounts you set apply ACROSS owners — the owner's own use of their offers/tools
   stays free and unpaced.
2. Never ask a human for payment secrets in chat unless they are configuring credentials on
   purpose; never repeat a secret back — every status surface is masked by design.
3. Completing a checkout pays its money total and debits its pacing from the owner's morsel
   balance. Quote first (open shows the total and pacingMorsels), then complete. A failed callable
   fulfillment refunds the money and returns the pacing automatically.
4. Real-money selling needs a money price (micro-units) plus credentials for the rail you intend to
   settle on. A free offer with only a pacing amount needs neither.
`;
