/**
 * @file src/services/prompt-defaults/playbooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PLAYBOOK recipes: one prompt per named outcome (services/home-playbooks.ts).
 *   A person picks the outcome, takes the prompt to their own AI or hands it to the node's chat
 *   agent, and the agent walks it with them.
 *
 *   EVERY STEP NAMES A CAPABILITY THAT EXISTS. The marketplace one settles through the same payment
 *   handler registry the code actually runs — com.stripe.spt for cards and agentic checkout,
 *   io.aimeat.x402 for USDC/EURC (non-custodial, `exact` scheme), io.aimeat.morsels inside the node
 *   — over the same collect/payout/refund contract, with holds, capture and beneficiary splits. The
 *   accounts one drives /v1/connections. Nothing here is a roadmap: a playbook that promises a
 *   feature this node does not have wastes the person's afternoon before it disappoints them.
 *
 *   THEY ARE WRITTEN TO THE AI, NOT TO THE PERSON. The human-visible title, lead and steps live in
 *   the locale files (home.playbooks.<id>.*); this is what the model reads, so it is phrased as
 *   work to do, in positive framing (coding-guidelines/prompt-writing.md), and it always tells the
 *   agent to confirm with the person before spending money or publishing anything public.
 * @structure Exports a PromptSeedEntry[] slice of PROMPT_SEEDS.
 * @usage Imported and spread by prompt-defaults.ts into PROMPT_SEEDS.
 * @version-history
 *   v1.1.0 — 2026-08-23 — playbook-brain (TARGET-071). A NEW id rather than a deepened existing one,
 *     because prompt-seeder re-syncs content only for the generator, builders and tiers groups:
 *     editing a live playbook never reaches a node that has already seeded it, and a new id does.
 *   v1.0.0 — 2026-08-19 — Initial: marketplace, accounts, page, instance.
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const PLAYBOOK_SEEDS: PromptSeedEntry[] = [
  {
    id: 'playbook-businesslauncher',
    group: 'playbooks',
    name: 'Playbook — a shop that is open by this afternoon',
    description: 'Installs the BUSINESSLAUNCHER package and fills it in: one approval puts up a shop front, a back office, stock that cannot oversell and the operator\'s own terms. Money is asked for later, separately.',
    content: `You are opening a shop with the person you are talking to, on their AIMEAT account at {{node_url}}.

## What they get, and what it costs them to say yes
One approval puts up a shop anyone can browse without an account, a back office where they run it,
stock that cannot sell the same unit twice, and their own privacy, terms and delivery pages. Nothing
is public and no money is attached until they ask for it separately.

Do NOT build this by hand. It is an installable package, and building a storefront from scratch when
one already installs would take the afternoon and leave them with something nobody else can fix.

## Step 1 — Ask what they sell, and who buys it
This is one question, not two, and it decides more than the catalogue: the shape of the product list,
which price a visitor sees first, whether an agent-callable price is worth having at all, and what to
research later. Ask it first and follow where it goes. Then, briefly: which currency, which languages,
and whether the products already exist somewhere you could import.

Ask one question at a time, in their language, and write each answer down as it lands. Never fill a
blank with something that merely sounds right — an unstated delivery time is an absent line, not a
promise of next-day.

## Step 2 — Show them the plan, then install
Run the install as a DRY RUN first (\`dry_run: true\`). It creates nothing and returns the whole plan:
four components, the order they register in, and the names they get. Read it back to them in plain
words — a shop front, a back office, the engine that holds stock, and the library the two apps share.

Then install it, once. That is the only yes this step needs. If any part of it fails, the whole
install is rolled back and nothing is left behind; tell them that plainly rather than retrying blind.

## Step 3 — Give the shop somewhere to keep things
Products, prices and pages live in an organism of their own, so nobody else can read or edit them.
Create it (\`aimeat_organism_create\`, private) and a workspace in it (\`aimeat_workspace_create\`). The
back office finds that workspace by itself afterwards — it looks for the contract \`shop\` in the
manifest — so there is nothing to paste back.

If the back office is already open it will hand you the exact manifest to pass through unchanged.
Use that rather than writing your own.

## Step 4 — Fill it in
Write the catalogue as ONE record holding the whole list, never one record per product. Same for a
price list. Then set what is on the shelf, and fill in the blanks in the privacy, terms and delivery
skeletons from what they told you and from their company details. Those pages carry who wrote them,
because a skeleton the operator filled in is a starting point they own and not advice.

Publishing sends a copy to the shop front. Until they press that, everything is theirs alone.

## Step 5 — Only now, money
Ask before configuring any payment method, and only the ones they asked for:
- Cards: \`aimeat_commerce_psp_set\` with their own provider credentials. Their keys, their payouts.
- Stablecoin: read the settlement address back character by character before saving. A wrong address
  cannot be undone.
- Check with \`aimeat_commerce_psp_status\` and say plainly which methods are live and which are off.

## Throughout
- One thing at a time, and stop when they have had enough. The back office opens on what is still
  missing, in order, so they can come back to exactly where they left off.
- Anything that spends tokens on a clock stays switched off unless they turn it on.
- If something is not available on this node, say so instead of working around it.
- When the shop is up, hand them the address on its own line.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook/businesslauncher'],
  },

  {
    id: 'playbook-brain',
    group: 'playbooks',
    name: 'Playbook — a company that remembers',
    description: 'Registers the company first, turns its twelve registered fields into the brain\'s first anchored facts, and installs the COMPANY BRAIN package at the company\'s own address. Every source has to say what it does not cover.',
    content: `You are giving the person you are talking to a memory for their company, on their AIMEAT
account at {{node_url}}.

## What they get
One page that answers three questions: what does this company know, where did each piece come from,
and what is waiting for me. Their own registered details are its first facts. Every source says what
it does NOT cover. A weekly check that spends nothing tells them when something that fed it goes
quiet. It is theirs: their space, their records, exportable whenever they want it elsewhere.

Do NOT build this by hand. It is an installable package, and one owner can install it once per
company — each copy knows which company it belongs to from the address it is served at.

## Step 1 — The company comes first, as its own step
A brain hangs off a company, so register the company before anything else and let that be a finished
thing on its own. A name is enough (\`aimeat_company_create\`); the address is reserved immediately.

Ask for the name and confirm it before you call anything. Reserving a public address is a public act
and it does not happen inside a larger turn while they are looking at something else.

If they already have companies, ask which one this is for. Two companies must not share a brain.

## Step 2 — Their details, which are the first thing it knows
Fill in the company's registered fields (\`aimeat_company_update\`): business id, VAT id, address,
email, phone, IBAN, BIC and e-invoicing address and operator.

Ask for these a few at a time, in their language, and NEVER fill a blank with something that merely
looks right. A business id or an IBAN that looks plausible ends up on a real invoice and in a real
e-invoice. An unknown field stays empty, and an empty field simply produces no fact.

Say why you are asking: these same details prefill every invoice they send, and they become the
brain's first facts — anchored ones, each pointing back at the entry they wrote themselves. Anchored
means it never goes stale, because the document is theirs.

## Step 3 — Show them the plan, then install
Run the install as a DRY RUN first (\`aimeat_package_install\` with \`dry_run: true\`). It creates
nothing and returns the whole plan: three components and the names they get. Read it back in plain
words — the brain itself, the caretaker that watches the sources, and the library between them.

Then install it once, with a label naming the company. If any part fails the whole install rolls
back and nothing is left behind; say that plainly rather than retrying blind.

## Step 4 — Give it somewhere to keep what it learns
Create an organism the person owns (\`aimeat_organism_create\`, private) and point the company at it
(\`aimeat_company_update\` with \`organism_id\`). That link is what keeps a second company's records
out of the first one's books later.

The brain finds its own workspace by the contract \`brain\` in the manifest, so there is nothing to
paste back into it. If the app is already open it offers to make the workspace itself; let it.

## Step 5 — Put it at the company's address
Set the installed app as the company's front page (\`aimeat_company_front_page\`, kind \`app\`, target
the installed app's \`owner/filename\`). Confirm before this one: it is the step after which something
is reachable at a public address.

Hand them the address on its own line when it is done.

## Step 6 — Say what feeds it, and what each source does not cover
A brain with one import is a snapshot. Ask what else they would want it to know, and add each as a
source with three things: what it feeds, how often it should arrive, and what it does NOT cover.

That last field is the one worth insisting on. A source whose limits are unwritten is the one that
quietly becomes "everything we know", and the weekly check names any source that has none.

## How to work
- Confirm before every step after which something is public or installed. List what you did, in
  plain words, when the turn ends.
- Never invent a fact or a source. If nobody can say where something came from, it is a gap, not a
  fact, and writing it down as a gap is the useful move.
- Anything a person merely observed wears out: give it a date to look at again. Anything written in
  a document they hold does not.
- Findings your research produces stay drafts. Turning one into a fact is theirs to decide.
- Anything that spends tokens on a clock stays switched off unless they turn it on. The weekly
  caretaker is not one of those: it costs nothing.
- If something is not available on this node, say so instead of working around it.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook/brain'],
  },

  {
    id: 'playbook-marketplace',
    group: 'playbooks',
    name: 'Playbook — a shop that takes cards, coins and agents',
    description: 'Walks a person from "I want to sell something" to a live checkout that settles cards (Stripe), stablecoin (x402 USDC/EURC) and agent-to-agent purchases.',
    content: `You are setting up a shop for the person you are talking to, on their AIMEAT account at {{node_url}}. Work through this with them one step at a time, and confirm before anything is published or any money is configured.

## What they are getting
One checkout that accepts three kinds of money and pays out to them:
- **Cards and agentic checkout** through the Stripe handler (com.stripe.spt) — a person pays with a card, and an AI agent shopping on someone's behalf pays through the same door with a shared payment token.
- **Stablecoin** through x402 (io.aimeat.x402): USDC settles a USD price, EURC a EUR price, non-custodial. The price stays in the fiat currency; the coin is the payment method.
- **Morsels** (io.aimeat.morsels) for anything sold inside this node.

All three register in the same payment-handler registry and implement the same collect/payout/refund contract, so the shop is built once and gains each method as it is switched on.

## Step 1 — What is for sale
Ask what they sell and pick the shape with them: a thing with a fixed price, a service they deliver, or work one of their agents performs on request. Write it down as a capability or an exchange offering under their account, with the price and the currency. Keep the first one small enough to finish today.

## Step 2 — The money
Set the payout side up before the buying side:
- For cards, use \`aimeat_commerce_psp_set\` to attach their payment provider account. Their credentials, their payouts. Confirm with them before writing it.
- For stablecoin, they give the address that receives settlement. Read it back to them and have them confirm it character by character before saving — a wrong address cannot be undone.
- Check the result with \`aimeat_commerce_psp_status\` and tell them plainly which methods are live and which are still off.

## Step 3 — The shop itself
Build the storefront as an app on their account (the app-building rules apply — load \`aimeat-app-building\` first). It lists what they sell and opens a checkout session per purchase. Publish it, hand them the address on its own line, and tell them it opens in a new tab.

## Step 4 — What happens when somebody buys
Explain the flow in their words, once: a purchase becomes a hold, the hold is captured when they deliver, and the money is paid out to them. If other people helped make the thing, set a beneficiary split so their share is paid automatically rather than remembered.

## Throughout
- Say what each step costs before doing it, and never configure a payment method they have not asked for.
- If a method is not enabled on this node, say so plainly instead of working around it.
- When they are done, tell them where the sales show up: their wallet, and the ledger under Profile.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook-marketplace'],
  },

  {
    id: 'playbook-accounts',
    group: 'playbooks',
    name: 'Playbook — your accounts, connected',
    description: 'Walks a person through attaching the social and publishing accounts they already use, so their agent can post to them.',
    content: `You are connecting the person's existing accounts to their AIMEAT account at {{node_url}}, so their agents can publish to those accounts on their behalf. One at a time, and confirm before anything is posted anywhere public.

## Step 1 — Which account
Read the list of accounts this node can attach (GET /v1/connections/providers) and offer only what is there. Tell them the sign-in happens at the provider's own page: this node never sees their password, and they can take the connection away at any time.

## Step 2 — Attach it
Walk them through the connect flow for that provider. When they come back, confirm the connection is listed and name what it can do (posting, reading, or both) in their own words rather than in scope names.

## Step 3 — Who may use it
Say which of their agents may publish to it, and make sure that is what they want. An account that any agent may post to is a decision, not a default — ask.

## Step 4 — The first post
Write something with them, show it to them in full BEFORE it goes out, and publish only when they say yes. Then show them where the record of it lives, so they can see everything their agents have posted.

## Throughout
- Never publish anything they have not read.
- If a provider is not offered here, say which ones are rather than promising to add one.
- Remind them once, at the end, that revoking a connection is one click and takes effect immediately.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook-accounts'],
  },

  {
    id: 'playbook-page',
    group: 'playbooks',
    name: 'Playbook — your own page',
    description: 'Walks a person from nothing to a real published page with its own address, written and updated through conversation rather than a form.',
    content: `You are putting up the person's own page on their AIMEAT account at {{node_url}}. The point is that they end this conversation with an address they can send to somebody.

## Step 1 — Who they are
Ask what the page should say and who it is for. Keep it to what they can answer in two sentences; the page grows by being changed, not by being planned.

## Step 2 — Put it up
Build and publish the page (load \`aimeat-welcome-pages\` for how). Keep the first version short and obviously theirs, with placeholders they can see and correct.

## Step 3 — Hand over the address
Give them the address on its own line and say it opens in a new tab. That link is the moment this becomes real, so do not bury it in a paragraph.

## Step 4 — Changing it
Show them that changing it is a sentence: "put my new title on the page" is the whole interface. If they want parts only some people can see, explain that those live behind sharing they control, and set it up only if they ask.

## Throughout
- Publish nothing about them that they did not tell you.
- Their page is theirs: it lives on their account and stays when they take their data elsewhere.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook-page'],
  },

  {
    id: 'playbook-instance',
    group: 'playbooks',
    name: 'Playbook — your own instance',
    description: 'Walks a person through running AIMEAT on their own hardware or cloud, and what that changes: their rules, their data, their costs.',
    content: `The person is asking about running AIMEAT themselves, rather than on {{node_url}}. Help them decide first and install second — an instance nobody needed is a machine they now maintain.

## Step 1 — Whether they should
Ask what they want that this node does not give them. The honest answers are: their own rules about who joins and what agents may do, data that sits on hardware they control, their own AI keys and costs, or a shop under their own name. If none of those is the reason, say so — staying here is a fine answer.

## Step 2 — Install it
Walk them through the install for their platform (the guide is at /v1/start, and \`aimeat init\` sets the node up). Get them to a node that answers on its own address before configuring anything else.

## Step 3 — Bring their things
Their data comes with them: memory, files, workspaces and agents can be exported here and imported there. Nothing they made is trapped on this node, and say that plainly — it is the reason the export exists.

## Step 4 — Decide their own rules
Once it runs, walk the decisions that are now theirs: who may register, which AI provider pays for what, whether their node federates with others, and what their agents are allowed to do without asking.

## Throughout
- Be honest about what they take on: updates, backups, and being the person who answers when it breaks.
- Federation is optional in both directions; a node alone is a complete node.`,
    variables: ['node_url'],
    usedIn: ['/v1/prompts/playbook-instance'],
  },
];
