<!--
@file package-sale-design.md
@description Design proposal: a package offer with a price, a checkout that grants the package
  entitlement, a set composer that builds an install bundle from apps that declare what they need,
  and the trust checks that must exist before a node sells somebody else's code. Written from a
  verification of the package, repository, commerce and install code on main at 31603ae7f.
@version-history
  v0.1.0 — 2026-10-01 — Proposal for review. Nothing in it is built. Session cc-jouni-packagesale.
-->

# Selling a package: verification and design

Status: **proposal for review.** Nothing here is built, and the code on `main` at `31603ae7f` is
what every statement below was checked against.

## What a person gets

A person who built apps on a node can put them together as a set, answer the setup questions once,
give the set a price, and sell it. A buyer pays, and their own AIMEAT receives the set, installs it,
and gets its updates for as long as the buyer pays for updates. The buyer sees, before anything is
installed, who made the set, which node vouches for it, and what it will be allowed to do.

This is for any node that takes the package repository role: a hosting company, a university that
keeps a shelf of apps for its departments, a company with an internal app shelf. It is not built
around one shop.

## The problem, from the code

The package side and the money side of the node both work, and they have never been connected.

- **The package side** can compose a package from an owner's apps, sign it, serve a private package
  only to the nodes entitled to it, end a node's updates at a date, and update installs every night.
  A bundle (`aimeat.install-bundle/1`) is a package whose memory component lists other packages,
  organisms, workspaces and crew agents, and an install set applies it to a node.
- **The money side** can open a checkout, collect money on the seller's own Stripe account or by
  x402, take the operator's fee, pay the seller, and book a revenue share out of the seller's cut.
- **Between them** there is a signed request: a node that the package's author named as a seller
  may grant, end and revoke entitlements on the repository. No money moves in that request. The
  only seller that exists today (aimeat-commercial's shop) collects payment in its own system and
  then sends the signed grant.

So a package has no price anywhere, a checkout cannot sell one, and nothing composes a bundle: it is
written by hand. And some of what a buyer would install from a stranger (an extension, an app's
scopes, a schema lock, memory keys) takes effect with no question asked of the buyer.

## 0. A ruling this design reopens

On 2026-09-28 Jouni ruled: "Billing, prices and the shop for install packages belong to
aimeat-commercial (store.aimeat.io, shop.apps.store.aimeat.io). The package repository grants each
sale and registers the customer node in one call, as a packages-only peer."
(`decision-install-packages-billing-belongs-to-aimeat-commercial-a-gran`, and
`decision-yritt-j-n-peruspaketti-costs-1090-once-and-14-90-a-month-for`: "The platform only grants
the sale on the package repository.")

Sections 2 and 3 put a price and a checkout into the platform. That is compatible with the ruling
only if the ruling was about **one product and one shop**, and not about **whether the platform ever
prices a package**. This design reads it the first way: aimeat-commercial keeps its own shop, its
own prices and its own billing, and keeps granting through the signed seller request, which this
design does not change. The platform adds a second way to sell, for an operator who has no shop of
their own. **This needs Jouni's answer before section 3 is built** (open question 1).

## 1. The brief's findings, checked

"Correct" means the code says what the brief says. File references are under `aimeat/src/`.

### What the brief believed exists

| # | Claim | Verdict | What the code says |
|---|---|---|---|
| 1 | A repository is multi-tenant: group id `{name}::{author}`, per-author create role, quota and ceilings, registration open/invite/closed | **Partly** | Group id and create role are right (`services/package-create.ts`). The component and size ceilings apply **per package version**, not per author. The quota **counts version rows, not groups** (`checkAuthorQuota` reads `listPackages(...).total`, a `COUNT(*)` on both providers), so every version of every package, archived ones too, uses up the room for new packages. Registration has four modes (`open`, `oauth`, `invite`, `closed`) and the default is `open`. |
| 2 | Compose reads each app's dependency map, packages the author's own cortexes once, carries bound skills, names the rest in `expects` | **Correct, with two gaps** | All four hold (`services/package-compose.ts`, `services/package-skill-component.ts`). Gap 1: compose reads only the **app's** edges, never the edges of the cortexes it packages, and an app reaches extensions through a cortex. So an extension a cortex calls is usually in neither `expects` nor the refusal. Gap 2: compose makes **one new group only**; it cannot add a version (409 when the group exists) and has no dry run. The Packages page sends only `{ name, apps }`, so any app that calls an extension is refused there. |
| 3 | Config questions come from each app's `aimeat-config` schema and each extension manifest, required and secret told apart | **Correct, two notes** | `services/package-config-needs.ts`. An app field can never be secret (publish refuses one); for an extension, `required` simply equals `secret`, because a manifest has no notion of required. It is a pre-sale reading for the author or a seller; at install the buyer is asked by the install dry run, which reads the same `planPackageConfig`, so the two cannot disagree. |
| 4 | Selling is multi-vendor by design: the author names seller nodes, the seller signs, no token | **Correct, one comment wrong** | `services/package-sellers.ts`, `services/package-sale-auth.ts`, `routes/package-sales.ts`. The signature covers method, path and the body's hash, within five minutes, with no nonce. The file header says the seller's key "is read from its /.well-known/aimeat and pinned"; the code takes the key from the request body and checks only its length (`services/package-peer-register.ts`). |
| 5 | `aimeat.install-bundle/1` is a product definition that is itself a package | **Correct, one part wrong** | `services/install-set-spec.ts`. The bundle lists packages (each with its default config), organisms with workspaces (manifest, schemas, readme) and crew agents. There is no top-level default config. **A package's `memory` component does not create organisms or workspaces**: it writes memory keys (`services/package-memory-component.ts`). Organisms and workspaces are created only by `applyInstallSet`, which is **operator-only**. |
| 6 | A discovery layer with moderation and reviews | **Partly** | `TemplateListingRecord` has screenshots, ratings, install counts, reviews and discussions, and operator routes approve, reject, suspend and relist (`routes/templates.ts`). But `POST /v1/templates` creates a listing **already `listed`**, skipping review, and **does not check that the caller wrote the package**. Suspending a listing does not stop installs. The cross-node listing sync counts what it fetched and stores nothing. |
| 7 | A complete commerce core, with the revenue share out of the provider's cut | **Correct** | `commerce/session-service.ts`, `commerce/beneficiary-split.ts`. The rake applies to every line (`commerceFeePercent`, default 5 %); for money it is booked as a receivable, never taken at the card rail. The split is taken from the seller's net, after the rake. The `distribute` hook exists and no resolver uses it. |

### What the brief believed is missing

| | Claim | Verdict | Notes |
|---|---|---|---|
| A | Nothing can put a price on a package | **Correct** | `PackageRecord` and `TemplateListingRecord` have no price, currency, licence or tax field. `PackageAppMeta` leaves out `priceMorsels` and `licenseType` on purpose: "the source owner's own commercial decisions" (`storage/types/packages.ts`). |
| B | The checkout cannot sell a package | **Correct** | `commerce/` never mentions a package. The resolver registry knows `offer`, `app-tool` and `ext-call`. The checkout also assumes the buyer is **an account on the selling node** (`POST /v1/commerce/checkout-sessions` needs `requireAuth` and `commerce:buy`), while an entitlement is granted **to a node**. That gap matters more than the missing resolver; section 3 is mostly about it. |
| C | Two commercial objects, neither the right one | **Correct** | Section 2 decides. |
| D | Subscriptions renew on use, not on a clock | **Correct for metered contracts; it does not reach packages** | `computeCharge` in `services/metered-entitlements.ts` renews when the next call comes after expiry. No job renews anything, and nothing handles a Stripe invoice. A package entitlement is a different record with a date in it (`updatesUntil`), so it ends by itself when the date passes. **The real defect is next to it:** `grantEntitlement` treats an omitted `updates_until` as `null`, which means "updates run forever", so a grant that only changes the channel or the note turns an ending subscription into an endless one. See section 6. |
| E | A pull makes the puller the author | **Correct, and deliberate** | `routes/federation-sync/packages.ts`: "what it creates is this owner's package, under this owner's quota and group id." See section 6. |
| F | Any author with `packages:write` can add a peer | **Correct, and worse than the brief says** | No cap, no operator, no check that the repository role is even on, no check that the caller has published anything, and no proof that the URL or the key belongs to the node id. Owners bypass scopes, and the default registration mode is `open`. Such a peer is refused by the catalogue, replication, routing and directory paths, but **outbound direct messages pick a peer by node id with no flag check** (`services/message-delivery.ts`, `peerForNode`), and **federated sign-in accepts any active peer as a home node** when the policy is `all_peers` (`routes/ghii/register-login.ts`). An author can register a node id that is not yet a peer, under a URL and key of their choosing: messages to people at that node id then go to that URL, and the real node can no longer be peered (`PEER_KEY_MISMATCH`). This is on `main` now, on every node, whether or not it is a repository. |
| G | Nothing composes a set | **Correct** | The only producer of a bundle in the repository is a literal in `test/e2e-install-sets.ts`. No app declares an organism or a workspace in a form the node reads; apps build the workspace manifest inside their own JavaScript and find it later by a `contract` string (`data/businesslauncher-app-back-office.ts` is an example). |
| H | No trust layer for a stranger's code | **Partly wrong, and the missing part is dangerous** | More exists than the brief saw: the node signs every package with a sha256 per component, a federation pull refuses an unsigned or changed package, a source's key is pinned, and a key change is refused. What is missing is everything **the buyer sees and decides**. Section 5 lists it. |

## 2. The commercial object: a package offer

### The decision

A **package offer** is its own record: the terms on which a package's author sells that package
group. It is neither a fourth Exchange Offering kind nor a price on the template listing.

- **Not an Offering kind.** An Exchange Offering sells metered access to a capability: per-call
  price, plans, an interface version pin, live stats read from metered contracts, and an
  accept-then-call lifecycle. A package is bought, delivered and updated; none of those fields would
  mean anything for it, and every Exchange code path would need a package branch. What the Offering
  gets right is the rule this design copies: **the price is captured at acceptance, and a later
  price change reaches only new buyers** (`services/app-tool-interfaces.ts`).
- **Not a field on the listing.** The listing is the shop window: screenshots, reviews, moderation,
  and it is meant to be synced to other nodes' galleries, where nothing can be bought. Terms that a
  buyer accepts need their own history, and a moderation state change must not touch a price.

The listing shows the current terms by reading the offer. The offer never reads the listing.

### Where it lives

One memory record per package group, `offer.<groupId>`, in the system namespace
`package-entitlements`, beside `entitlements.<groupId>` and `sellers.<author>`. No principal can
address that namespace, so the record is written only through its own endpoint, by the package's
author or an operator (the same `mayManage` rule entitlements use). It is readable by anyone through
`GET /v1/packages/:groupId/offer`, because a price is public information.

One record per group, not one per sale, so the key count does not grow with sales.

### What an offer says

```
{ groupId,
  state: 'on_sale' | 'paused' | 'ended',
  terms: [                                   // append-only; the last one is current
    { id: 't3', createdAt,
      price:   { amount, currency },         // one-time; EUR or USD micro-units (commerce/money.ts)
      updates: { included_days, renewal: { amount, currency, period_days } | null },
      channel: 'stable' | 'beta',
      licence: { subject: 'node', per: 'purchase', spdx?, terms_url?, text_sha256? },
      tax:     { prices_include_tax: boolean, category?: string },
      support: { email, security_email } } ] }
```

**It may say:** a one-time price, how many days of updates come with it, the renewal price and
period, the release channel, the licence scope (one subject per purchase; `node` is the only subject
kind today, see "The subject" in section 3), how tax is to be read, and a
support and security contact. **The security contact is required for a paid offer**: it is the one
field a buyer who finds a problem needs, and it costs the author nothing.

**It may not say:** anything about the package's content or permissions (those come from the
package and the trust summary in section 5), anything a node cannot enforce (seat counts, usage
limits), or anything that sounds like the node reviewed the code (the listing's moderation state
says that, separately). An offer is money only: a morsel is a pacer and buys nothing, so a package
priced in morsels is refused. A free private package needs no offer: the author grants it.

**When the author changes the price,** a new terms entry is appended. Buyers who already paid keep
the terms they accepted, including the renewal price (see below). `paused` stops new sales and
keeps renewals; `ended` stops both, and every entitlement runs to its date.

### What happens when a new version is published

Nothing happens to the offer. The offer belongs to the package group, and a version cannot carry a
price, because:

1. **A version is signed content.** The attestation signs the component digests; terms inside it
   would make a price change look like a code change, and a code change look like a price change.
2. **Managed installs update by themselves every night.** If a price could ride inside a version, a
   price change would reach a buyer through a job that nobody watches. Consent to a price happens
   once, at checkout, against terms the buyer saw.
3. **A pulled copy carries the version.** The reason `PackageAppMeta` drops `priceMorsels` applies
   again: one owner's commercial decision must not travel into another node's copy.

What a new version reaches is decided where it is decided today: an entitled node gets every
version on its channel created on or before its `updatesUntil` (`entitledVersion`).

### Why an accepted price must not change

The entitlement records the terms the buyer accepted:

```
PackageEntitlement += { terms?: { offerTermsId, price, renewal, licence_sha256, acceptedAt,
                                  order: <checkout session id> } }
```

A renewal charges the accepted renewal price, not the current one. The buyer may always choose the
current terms instead, in a new checkout. Without this, the author could raise the price of updates
a buyer depends on, and the buyer's only defence would be to notice.

## 3. The keystone: the purchase grants the entitlement

### Who sells, who pays, where the money lands

**Revised 2026-10-01 after Jouni's answer to open question 2:** "A buyer NEVER needs an account on
the repository. This is an invariant of the design, not a concession: the repository is a warehouse
holding every vendor's private packages, and giving it consumer accounts and a login page is the
wrong direction for the node that holds them. The buyer has an account on the SELLING node, and the
sale may create it at checkout."

So **the selling node sells, and the repository runs no checkout**. The repository holds the
packages, the offers and the entitlements, and grants on a signed request from a seller node it
knows (the path that exists since 2026-09-29, with the card check of 2026-10-01). The checkout line,
the buyer's account and the payment all live on the selling node.

Where the money lands, and how the author is paid when the shop and the author are different
people, follows from open question 1 and is open again (open question 6). The text below up to "The
checkout line" describes the order of events; the rake and revenue-share subsection was written for a
checkout on the repository and is to be redone with question 6.

### The buyer is a person, the entitlement is a subject

The checkout runs for a signed-in account on the selling node, which the checkout may create. The
entitlement is for a subject, today a node (see "The subject" below). **The selling node reads the
offer on the buyer's behalf, node to node** (Jouni: "The buyer must never have to fetch it
themselves"): a signed read beside the one for a package's questions,
`GET /v1/federation/package-sales/:groupId/offer`, so the price and terms the buyer sees are the
repository's own. Anonymous buying is out: "the install set creates an owner account regardless, and
without one there is no way to tell a buyer about a security fix, let them re-download, or refund
them." Two orders of events are both real, so both are supported:

1. **The node is known at the checkout** (the buyer has a node, or the install set names one). The
   buyer's AI asks the selling node (`aimeat_package_buy { repository, group_id, node }`). The selling
   node reads the offer, opens its own checkout, and on completion grants the entitlement on the
   repository with the signed seller grant, naming the buyer's node. The repository registers that
   node only when its own card answers with the same id and key, or keeps the registration pending
   until the node's first signed request (both since 2026-10-01).
2. **The person pays first** (a shop selling a node that does not exist yet). The checkout completes
   with no node named, and its receipt carries a one-time claim code. Later, the new node redeems it
   with a request signed by its own key (`POST /v1/federation/package-claims`, node to node; no
   person signs in on the repository), and the repository grants the entitlement then.

In both cases **the node that will be served is the one that proved its key**. That is the
difference from today's grant, where an author types in a URL and a key and nothing proves either
(finding F). The packages-only peer is registered at that moment, under the proven key, with the
same rules as now: a known peer under another key is refused, a peer the operator switched off is
refused.

Pending intents and unredeemed claims live in the group's existing `entitlements.<groupId>` record,
under `pending`, and expire after 30 days. A claim code is stored as its hash.

**The checkout opens on the selling node**, and the person signs in there or is registered there by
the checkout. No checkout link, sign-in or registration exists on the repository for a buyer
(answered 2026-10-01, open question 2).

### The subject of an offer and an entitlement

**Not hard-coded as a node** (Jouni, 2026-10-01: "do not hard-code the subject of an offer or an
entitlement as a node. An owner-subject should be addable later without rewriting those records").
An entitlement names its subject as `{ kind: 'node', id }` and its record keys it `node:<id>`; an
offer's licence names `subject: 'node'`. Only `node` exists today. An owner subject
(`{ kind: 'owner', ghii }`, key `owner:<ghii>`) is added later by adding a kind, not by rewriting
records. Today's code keeps entitlements under `nodes`, keyed by the bare node id
(`services/package-entitlements.ts`); the build of this section reads both shapes and writes the new
one.

### The checkout line

A new resolver, `kind: 'package'`, registered beside the other three in
`server-bootstrap/routes-loader.ts`:

- **Resolve** reads `offer.<groupId>` and the current terms (or, for a renewal, the terms the
  entitlement accepted). It refuses when the repository role is off, the package is not private,
  the offer is not on sale, the currency has no payment handler, or the author has no payment
  account. Seller is the package's author; `psp` is the author's `commerce.psp`. The group id and
  terms id ride in the line's `app` and `offerId`, the two fields that survive re-resolution at
  completion.
- **Fulfill** runs after the money is collected and before the payout, which is the order
  `completeSession` already guarantees. It completes the pending intent (grants the entitlement with
  `updatesUntil = now + included_days`, the channel and the terms snapshot) or writes the claim
  code, and returns `{ entitlement }` or `{ claim_code }` on the receipt. **If it throws, the
  checkout refunds the buyer and leaves the session open**: that is existing behaviour, so a
  purchase can never take money and grant nothing.
- **Renewal** is the same kind with `renew: <nodeId>`: resolve uses the accepted renewal terms,
  and fulfill moves `updatesUntil` to `max(now, updatesUntil) + period_days`.

The closed lists of kinds that must learn `package`: `routes/commerce.ts`, `mcp/commerce.ts`,
`openapi.yaml`, and the UCP and ACP SKU parsers (`routes/commerce-ucp.ts`, `routes/commerce-acp.ts`).

### The rake and the revenue share work unchanged

- **The rake.** `completeSession` computes `fee = percentFee(gross, commerceFeePercent)` for every
  line whatever its kind, and for money records it with `recordMoneyPlatformFee` as the operator's
  receivable. A package line is a money line, so nothing changes.
- **The payout.** No `distribute` is set, so the default `handler.payout(net)` runs. For Stripe it is
  a book entry: the money is already on the author's account.
- **The revenue share.** The split is read by `bookCheckoutBeneficiaries` from
  `meteredCoordinateOf(sellable)`, which returns a coordinate for `app-tool` and `ext-call` and
  `null` otherwise. **One branch is needed**: for `package` it returns
  `{ ext: 'package:<groupId>', action: 'purchase' | 'renewal' }`. The split route
  (`POST /v1/commerce/beneficiary-splits`) already accepts any `ext` and `action` and always writes
  under the caller's own GHII, so the author declares "20 % of my cut on this package goes to X" with
  the existing tool, and the share is taken from the author's net after the rake, as for every
  other sale. No route, record or tool changes.

### Renewal: the date is the clock

`updatesUntil` is already a clock that needs no job: when it passes, the repository answers
`UPDATES_ENDED` and the buyer's install stays as it is. So a buyer who goes quiet stops receiving
updates on the right day, provided **every grant writes a date**. Two changes make that hold:

1. A grant that omits `updates_until` keeps the previous value instead of resetting it to `null`.
   A paid offer never writes `null`.
2. The repository's listing already tells the buyer's node its `updates_until`, but the nightly
   update check reads only the versions. It learns to read the date: fourteen days before it, the
   owner is told once, with the renewal price and a link, and renews from chat
   (`aimeat_package_buy { renew: true }`) or from the link.

Automatic charging (a saved card, a Stripe subscription) is left out: the node stores no payment
method and handles no Stripe invoice today, and a renewal the buyer starts is the honest default for
a product that keeps working when it is not renewed. Open question 4.

### Surfaces, chat first

| Where | Endpoints and tools |
|---|---|
| Repository, the author | `GET` / `PUT /v1/packages/:groupId/offer`, `aimeat_package_offer` (`packages:write`, author or operator) |
| Repository, anyone | `GET /v1/packages/:groupId/offer`; the listing and the repository listing show the current terms |
| Repository, a seller node | `GET /v1/federation/package-sales/:groupId/offer` (signed by the seller node), beside the existing config-needs and grant |
| Repository, the buyer node | `POST /v1/federation/package-claims` (signed by the buyer node; node to node, no account) |
| Selling node, the buyer | `aimeat_package_buy` (read the offer, open the checkout, renewal) on the buyer's account there |
| Buyer node | `aimeat_package_claim` (redeem a code). Redeeming is a node act, so it needs the operator role on the buyer node; on a personal node the owner is the operator |
| Screens | the listing shows the price and a Buy button; the buyer's Packages page shows the update date and Renew. Screens come after the chat path works |

### How we know it works

E2E on both backends, three nodes in one process (repository, selling node, buyer node; the pattern
of `e2e-install-sets`): a package line completes on the selling node with the test money handler and
the buyer's node is entitled on the repository, and nobody signs in on the repository; a fulfill that throws
refunds the buyer; a price change after purchase leaves the renewal price as accepted; a renewal
moves the date; a claim signed by a key other than the one it names is refused; a claim for a node
id that is a peer under another key is refused and grants nothing; the rake receivable and a
declared split are booked on a package line.

## 4. The set composer

### Apps declare what they need, and the node reads the declaration

Today a bundle's organisms and workspaces are written by hand, or scraped out of the apps' own
JavaScript by an outside script. The apps should **declare** the workspaces they need, in the same
place they already declare their config and their crews:

```html
<script type="application/json" id="aimeat-workspace">
{ "workspaces": [
  { "contract": "aimeat.backoffice/1",
    "name": "Back office",
    "manifest": { "objectTypes": [ ... ] },
    "schemas":  { "<namespace>": { ...JSON Schema... } },
    "readme":   "..." } ] }
</script>
```

- **Why in the HTML:** for the reason `aimeat-config` and `aimeat-crews` live there. Every publish
  path, the backup, the fork and the package ZIP already carry the HTML, so none of them needs a new
  field to carry the declaration.
- **At publish** `publishApp` parses it into `manifest.workspaces` and checks each manifest with
  `checkWorkspaceManifest()`, refusing an unusable one with 422 `APP_WORKSPACE_INVALID`, as it
  refuses a bad config schema.
- **`contract` is the join key.** Apps already find their workspace by a contract string; the
  declaration makes that string the thing the node matches on. Two apps that declare the same
  contract share one workspace in a set.
- **The installed app is told where its workspace is.** The install writes the created workspace
  ids beside the app's config, and the app reads them by contract through the served data library.
  This is wish `wish-an-app-declares-its-workspace-a-bundle-refers-to-it-and-the-`.

**Organisms are not declared by apps.** An organism decides who shares what, and that is the set
author's decision, not the app's. The composer groups the declared workspaces into one organism
named after the set, and the author may split them.

**Crew agents** come from the `aimeat-crews` block each app already has.

### What compose-set does

`POST /v1/packages/compose-set` and `aimeat_package_compose_set`, with `dry_run`:

1. For each chosen app, compose its package, or **add a version** to the group it already has. This
   needs the composer to make a second version (wish
   `wish-compose-can-make-a-second-version-keeps-the-data-map-and-pac`). One package per app, so an
   update to one app does not republish the others.
2. Read the extension edges of the **cortexes** it packages as well as of the apps, so `expects`
   names what a cortex calls.
3. Build the bundle: packages, the organisms and workspaces from the declarations, the crews, and
   each package's default config from the author's answers.
4. Write the bundle as a package, or add a version to it.

The **dry run writes nothing** and answers what the author must see before anything is published:

| Part of the answer | What it tells the author |
|---|---|
| `questions` | what a buyer will be asked: each field, required or not, secret or not (from `package-config-needs.ts`, after the author's defaults) |
| `expects` | what the buyer's node must already have |
| `not_carried` | what stays behind: screenshots, app tools, data maps, saved layouts, and extensions unless allowed |
| `capabilities` | the trust summary a buyer will see (section 5) |
| `bundle` | the bundle JSON that would be published |
| `problems` | a declaration that does not parse, two workspaces with one contract and different manifests, a crew whose app is not in the set |

A bundle with a quiet mistake is refused, not passed (wish
`wish-a-bundle-with-a-quiet-mistake-is-refused-instead-of-passing`).

### The install side needs one split

`applyInstallSet` does two kinds of work in one operator-only call: **node work** (create accounts,
bring members in) and **owner work** (install packages, create organisms and workspaces, deploy
crews). A person who buys a set on a node they do not operate can install packages today, but not
the organisms and workspaces the set needs. The owner work becomes its own call that an owner may
make for themselves (`aimeat_package_install` with a bundle installs the set under the caller); the
install set stays the operator's tool and calls the owner part for the owner it names.

## 5. The trust layer

### What exists

The node signs each package version it serves, the signature covers a sha256 of every component,
a federation pull refuses an unsigned, changed or re-keyed package, an install dry run lists the
components and the config, and an agent that lacks the memory permissions files an install request
that the owner approves.

### What a buyer cannot see or decide today

Each of these was checked in the code on `main`.

| # | Gap | Where |
|---|---|---|
| T1 | **A packaged extension starts active.** It is stored `status: 'active'` and its activation jobs run at install. Nobody is shown what it reaches (its `ctx.fetch` has no host allowlist outside AI-provider runs; it can start AI jobs billed to the buyer; a vault secret binds to the first host the script names). | `services/component-registrar.ts`, `services/package-install.ts`, `services/extension-ctx.ts`, `services/owner-secrets.ts` |
| T2 | **A packaged app gets every scope it asks for, with no consent screen**, because an installed app is the buyer's own app and the silent bridge approves an owner's own app for whatever it wants. With `connect-src https:`, that app can send the buyer's memory anywhere. The file's own comment calls the own-app branch "the root" of an open escalation. | `routes/app-grants.ts` (`isOwnApp`), `utils/app-csp.ts` |
| T3 | **A memory component overwrites the buyer's own keys.** The author names the keys, and the install writes them over whatever is there, only reserved keys excepted. | `services/component-registrar.ts`, `services/package-memory-component.ts` |
| T4 | **A cortex schema component replaces another owner's schema lock.** A lock is looked up by key alone, so it applies to every owner on the node; the schema route refuses to replace another's lock (`SCHEMA_LOCKED_BY_OTHER`), and the package path writes it without that check and ignores errors. A workspace's strict schema is such a lock. | `services/component-registrar.ts`, `routes/schemas.ts`, `services/schema-validator.ts` |
| T5 | **The buyer is not shown who made it.** The install preview names no author, no signing node, no upstream and no verification result, although the data exists. An installed copy of a pulled package is labelled as the buyer's own. A package skill does not say who wrote it, and because a bare skill name resolves the user's registry first, **a package skill can take the name of a built-in node skill**. | `services/package-install.ts`, `public/views/profile/packages/rows.js`, `mcp/skills.ts` |
| T6 | **Nothing withdraws a bad version from the nodes that have it.** Archiving stops new installs; revoking deletes an entitlement; managed installs keep running what they have and keep updating from the same key. | `services/package-upstream-refresh.ts`, `services/package-entitlements.ts` |
| T7 | **Self-updates do not ask again.** A managed install takes a new version every night. A new version that adds an extension or a scope reaches the buyer with no question. | `services/package-upstream-refresh.ts` |
| T8 | **The gallery can be filled without review**: `POST /v1/templates` lists a package at once, for any caller, without checking authorship. | `routes/templates.ts` |
| T9 | **Peer registration** (finding F). | `services/package-peer-register.ts` |

### What must land before selling, in my judgement

**Do not ship section 3 without T1, T2, T3, T4, T7 and T9.** Each of them lets a package do
something to a buyer's node that the buyer did not agree to, and charging money for the package
makes it more likely, not less, that a stranger's package is installed. Concretely:

- **One consent step, on every path.** The install dry run gains `capabilities`: each extension with
  what its manifest declares (workspace reach, AI provider hosts, secrets it asks for, scheduled
  jobs), each app with the scopes it will ask for, each skill, each memory key it writes, each schema
  lock it sets. The owner approves that summary; the install records the approval and its hash.
  An agent with `packages:write` cannot approve it for the owner: a package with code in it files an
  install request, as one with memory parts does now. This covers T1.
- **A package-installed app is not the owner's own app** for the silent bridge. It asks for consent
  like any other app the first time, and on every widening after (T2). The install publishes the app
  with `source: 'package-install'`, but the app record does not keep that mark; it has to, or the
  bridge has nothing to read. The installed package's component list is the other place to read it.
- **Refuse before writing.** A memory component may not write a key the owner already has that this
  package did not write (T3). A schema component goes through the same lock check as the route, and
  a refusal stops the install (T4).
- **A managed update that adds capabilities waits** for the owner's approval, with the difference
  shown; an update that only changes code within the approved capabilities goes ahead as now (T7).
- **T9 is fixed as in section 6.**

**Ship with section 3, as display:** T5 (the author, the signing node, the verification result and
the offer's support and security contact on the preview and the installed copy; a package skill is
marked with its origin and cannot take a node skill's name), and T8 (authorship check, and
`pending_review` on a node that sells).

**Before a repository opens to authors the operator does not know:** T6. A version gets a
`withdrawn` status that the author or the operator sets with a reason; the buyer's nightly check
reports it, the owner is told, and an extension from a withdrawn version is deactivated. On a
repository where the operator is the only author, the buyer trusts the operator, and T6 can follow.

**Not needed before selling:** a signature by the author's own key. The node signs, and on a
repository the node vouches for an account it holds. An author key only matters when one author's
package is served by a node that does not hold their account, which nothing does today.

## 6. D, E and F: defects or deliberate

**D. Deliberate for metered contracts, and the wrong tool for packages.** Lazy renewal is right for
a capability somebody calls. A package entitlement must not use it, and does not: its date ends it.
**File one defect:** an omitted `updates_until` resets an entitlement to "updates forever"
(`grantEntitlement` in `services/package-entitlements.ts`). The road for packages is section 3's
renewal: a checkout that moves the date, and a notice before it passes.

**E. Deliberate, and correct.** A pull takes a copy, and the copy is the puller's. The road for a
vendor who wants a marketplace to sell their package already exists, and it is the opposite
direction: **the vendor keeps the package on a repository where they hold an account (their own
node, or a hosting provider's), and names the marketplace node a seller.** The marketplace then
sells without becoming the author. What is missing for that road to work for a stranger is T9 and
the multi-tenant fixes in section 7. A marketplace that pulls a vendor's package becomes its author
and its publisher, and the design should not offer that as a way to sell.

**F. A defect, on `main` now, to file before any of this is built.** The fix:

1. **Prove the key.** A node is registered only from a request signed by the key being registered
   (section 3's claims), or after the repository fetches the node's
   `/.well-known/aimeat` and finds the same node id and key there. The seller route does the second.
2. **Bound it.** Registering a peer through the package routes needs the repository role on, and a
   caller who has published at least one package; a node-wide cap on packages-only peers, with the
   operator told when it is reached.
3. **Keep a packages-only peer to packages.** Message delivery, federated sign-in and identity lookup
   skip a peer whose flags do not allow them, as the catalogue and routing paths already do.
4. **Clean up.** A packages-only peer that holds no entitlement and is no author's seller is removed.

**F, as built on 2026-10-01** (incident `incident-security-f-package-routes-register-any-node-id-as-an-active--mupthonu`
on the Lifecycle Central board). Two corrections to the plan above came out of building it:

- **A card does not prove the id.** The registrant names the url, so the registrant decides what card
  is served there, the real node's real key included. Reading the card refuses what cannot be true (a
  key the url does not publish, a url that says it is another node) and nothing more. A signed
  challenge proves only that the caller holds a key, which a registrant with their own key does too.
  Node ids have no authority outside each node's own peer table. What makes the remaining case
  harmless is item 3, not item 1.
- **The consequence was larger than messages.** Under `AIMEAT_FEDERATION_AUTH_POLICY=all_peers`
  (aimeat.io runs it), any active peer was a home node for federated sign-in: a password typed for
  `user@<id>` went to the registered url, and the reply was checked with the registered key, so the
  registrant could sign in as any user of that node id. Separately, the reply's own `home_node` named
  the visitor's home, so any member peer could sign a visitor in as a user of another node.

What was built: item 1 as the card check in `package-peer-register.ts` (every package path, and the
two paths that link a repository on the client side), with a grant whose node does not answer made
anyway and its registration finished by the node's first signed request (`peer_pending`); item 2
without the cap (the repository role and an author with a package, for naming a seller; a grant
already needed the package's author); item 3 for direct messages, read receipts, attachment grants and
federated sign-in (a contact-tier peer is no home node, and the home node is the peer that signed);
a record of how each such peer arrived (`peer-origin.ts`), shown on GET /v1/federation/peers and in
aimeat_admin_federation; and DELETE /v1/federation/peers/{nodeId} freeing the id. Item 4 and the cap
are not built.

## 7. Other defects found on the way

Not in the brief. Each is on `main` now; none is fixed in this pass.

| Defect | Where | Weight |
|---|---|---|
| A cortex schema component replaces another owner's lock (T4) | `services/component-registrar.ts` | security |
| A memory component overwrites the owner's existing keys (T3) | `services/component-registrar.ts` | security |
| `POST /v1/templates` lists without review or authorship check (T8) | `routes/templates.ts` | security |
| An omitted `updates_until` resets to unlimited updates | `services/package-entitlements.ts` | money |
| A seller can change or revoke any grant of the author, including grants the author or another seller made | `services/package-entitlements.ts` (`mayManage` acts as the author) | money, multi-vendor |
| The author quota counts version rows, not groups | `services/package-create.ts` | multi-tenant |
| `POST /v1/packages/:groupId/versions` asks for `app:write`, not `packages:write`, and skips the create role | `routes/packages.ts` | consistency |
| Compose does not read the extension edges of the cortexes it packages | `services/package-compose.ts` | correctness |
| The admin suspend call sends `reason`; the route reads `comment` | `public/js/services/admin.js`, `routes/templates.ts` | small |
| `openapi.yaml` still says a granted node must share its catalogue | `openapi.yaml` | docs |
| `package-sellers.ts` says the seller key is read from `/.well-known/aimeat`; it is not | `services/package-sellers.ts` | docs |

**Scale.** A repository keeps one entitlements record per package group, and a memory value holds
at most 1024 kB, so one group can hold a few thousand entitled nodes (about 250 bytes each) before
the record is full. Every signed read lists every entitlements record to find the node's
(`entitledGroupsOf`), which grows with the number of groups on the repository. Neither matters at
today's size (one repository, one bundle, a handful of customers); both matter for a hosting
provider's repository, and should be measured on a seeded repository before one opens.

## 8. Is the brief one shop's wish?

Mostly not: a priced offer, a checkout that grants, a composer and a trust summary are what any
repository operator needs. Two parts carry one product's shape, and the design widens them:

- **"One price plus a monthly fee for updates"** is the entrepreneur bundle's model. A university
  shelf or a company's internal shelf usually needs **no money at all**, but an approval: the
  department asks, the owner of the shelf says yes. That is an entitlement granted on approval, and
  the offer model can carry it as a third state beside paid and free (open question 5).
- **"Sell to other people's nodes"** assumes the buyer runs their own node. On a shared node (a
  company's, a university's) the buyer is an owner on the **same** node as the package. Answered
  2026-10-01 (open question 3): the shelf inside one node is out of this round, and its first
  problem is visibility, not money or approval. A third visibility level comes as its own change, and
  this design keeps the subject of an offer and an entitlement open for an owner (section 3).

The outside build script that scrapes app HTML is also one team's tool; section 4 replaces it with a
declaration any app author can write.

## 9. Order of the work

Each phase is usable on its own and is tested before the next starts.

1. **Fixes on `main`, independent of selling:** F (section 6), T3, T4, T8, the `updates_until` reset,
   the quota count.
2. **The trust layer before selling:** the consent step with `capabilities` (T1), no silent scopes
   for package-installed apps (T2), re-consent on a widening update (T7), and the display of author,
   signer and origin (T5).
3. **The keystone:** the offer record and the seller node's signed read of it, the `package`
   resolver on the selling node, claims with proof of the node key, the subject shape of offers and
   entitlements, renewal and its notice, and the money path open question 6 decides.
4. **The set composer:** the `aimeat-workspace` declaration, compose that adds a version, compose-set
   with its dry run, and the owner part of the set install.
5. **A repository open to strangers:** withdrawal (T6), review on a selling node, the scale
   measurement, and the offer in the Exchange's discovery for agents.

## 10. Open questions for Jouni

1. **The billing ruling of 2026-09-28.** Did it place billing for the entrepreneur bundle in
   aimeat-commercial, or did it rule that the platform never prices a package? Section 3 needs the
   first reading.
2. **A buyer with no account on the repository.** *Answered 2026-10-01:* "A buyer NEVER needs an
   account on the repository. [...] The buyer has an account on the SELLING node, and the sale may
   create it at checkout. The condition: the selling node reads the offer on the buyer's behalf,
   node to node. The buyer must never have to fetch it themselves. Anonymous buying with no account
   anywhere is out." Section 3 is revised to this.
3. **A shelf inside one node.** *Answered 2026-10-01:* out of this round. "It is a VISIBILITY problem.
   Visibility is binary and there is no 'the owners of this node' level, so owner B cannot even see
   owner A's private package." A third visibility level (visible and installable to the owners of
   this node, not outside it) is its own small change; this design does not hard-code the subject of
   an offer or an entitlement as a node (section 3).
4. **Renewal.** Buyer-started renewal with a notice, as proposed, or should the node store a payment
   method and charge by itself?
5. **Approval instead of money.** Should an offer support "granted on the owner's approval" for
   shelves that charge nothing?
6. **Who is the seller of record now that the checkout is on the selling node** (new, 2026-10-01,
   from answer 2). The shop's own payment account with the author's share booked as a beneficiary
   split, or the author's own payment account connected on the selling node? It decides where the
   money lands and how section 3's rake and revenue-share subsection is redone, and it follows from
   question 1.
