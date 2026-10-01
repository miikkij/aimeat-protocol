/**
 * @file src/data/screen-only.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The actions a person does on the screen, signed in themselves, and why: one text for
 *   the whole-node handbook (services/handbooks/full.ts) and the guided-journey skill
 *   (data/builtin-skills.guided-journey.ts), so the two cannot list different things (guided journey
 *   P6, brief doc-mupor242l3cq).
 *
 *   WHY IT IS WRITTEN DOWN. The rule lived only in the routes: requireOwnerPrincipal() refuses an
 *   agent on each of these, and some refusals explain themselves well. An AI met them one refusal at
 *   a time and could not tell the person in advance "this one you do on the page, here is the link".
 *   The list follows the routes; a new requireOwnerPrincipal() door that a person meets belongs here.
 * @structure SCREEN_ONLY_MD (Markdown, links relative to the node)
 * @usage `${SCREEN_ONLY_MD}` inside a handbook or a skill's text
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */

export const SCREEN_ONLY_MD = `## On the screen, and why

Almost everything here is done from the chat. A few things the person does themselves, signed in on
the web, because they decide who can get into the account, move money or give rights. When the
person asks for one of them, give the exact link and say why in one sentence. Do not look for
another way round: the node refuses an agent on each of these.

- **Signing in:** two-step sign-in, passkeys, open sessions, the password and the email address.
  /v1/profile?tab=security . Why: they decide who can get into the account.
- **Money:** the payment provider's secret key and the payout accounts. /v1/profile?tab=wallet .
  Why: a key that moves money never passes through a chat.
- **Giving rights:** approving an agent and choosing what it may reach (/v1/profile?tab=agents),
  letting an agent read mail (on that agent's card), and approving an app's access. Why: the person
  gives rights in their own name, so they give them themselves.
- **AI keys and rules:** the AI provider keys, the model policy and the decision rules.
  /v1/profile?tab=ai . Why: a key spends the person's money, and a rule decides on their behalf.
- **The account itself:** exporting everything in it (/v1/profile?tab=dataWallet) and deleting it.
  Why: both act on the whole account at once.
- **Looking:** the dashboards, the fleet and the history are pages. The chat reads the same data;
  the page is where a person looks at it.
`;
