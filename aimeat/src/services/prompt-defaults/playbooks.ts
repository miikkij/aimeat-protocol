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
 *   v1.0.0 — 2026-08-19 — Initial: marketplace, accounts, page, instance.
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const PLAYBOOK_SEEDS: PromptSeedEntry[] = [
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
