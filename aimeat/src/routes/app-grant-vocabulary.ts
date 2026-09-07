/**
 * @file app-grant-vocabulary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scope vocabulary an app may ask an owner for, each with the sentence the consent
 *   screen falls back to when a locale has no line for it. Moved out of routes/app-grants.ts by pure
 *   extraction when that file passed 800 lines; nothing else changed, and the route still owns every
 *   decision made WITH this list.
 * @structure APP_GRANTABLE_SCOPES — the one list, keyed by scope word.
 * @usage import { APP_GRANTABLE_SCOPES } from './app-grant-vocabulary.js';
 * @version-history
 *   v1.3.0 -- 2026-09-07 -- Document the enforced publishing scope and existing migration.
 *   v1.2.0 -- 2026-09-06 -- secrets:manage: the owner's credential vault, askable by an app.
 *   v1.1.0 -- 2026-08-29 -- organism:rows: the person's half of the two-hand rule that lets an app
 *     keep an append-only trail on a row space the organism opened to it.
 *   v1.0.0 -- 2026-08-18 -- Extracted verbatim from routes/app-grants.ts (max-file-lines).
 */
/**
 * Scopes an app may request, each with a short description key for the consent UI. Drawn from the
 * scope vocabulary the node actually enforces (auth/middleware.ts requireScope). Deliberately a
 * curated subset — not operator/admin or destructive-by-default scopes.
 */
export const APP_GRANTABLE_SCOPES: Record<string, string> = {
  'memory:read': 'Read your stored memories and data',
  'memory:write': 'Create and update your memories and data',
  'memory:delete': 'Delete your memories and data',
  'storage:read': 'Read your stored files (images, documents)',
  'storage:write': 'Save and update your stored files (images, documents)',
  'catalogue:read': 'Read the public catalogue/directory',
  'social:read': 'Read boards you can access',
  'social:write': 'Post to boards on your behalf',
  'messages:send': 'Send direct messages on your behalf across the federation',
  'messages:read': 'Read direct messages addressed to you across the federation',
  'wallet:read': 'See your morsel balance and transactions',
  'knowledge:read': 'Read your knowledge packages',
  // Installing a package REGISTERS an app, a cortex, an extension and any @activate cron the
  // manifest declares, under the installer's identity. Until 2026-08-15 that door asked for nothing,
  // so it arrived inside whatever single scope the owner had approved. Named here so the consent
  // screen can say what it is and the owner can uncheck it.
  'packages:write': 'Install packages for you (registers their apps, extensions and scheduled jobs)',
  // The app-grantable half of a two-hand rule (2026-08-29). A row space on an organism workspace
  // names the apps it is open to (manifest objectTypes[].apps); this scope is the person's half.
  // Only both together let the app append to and read that one space, and only while the person
  // is an active member. Nothing else on the organism opens: no other space, no records, no
  // documents, no membership.
  'organism:rows': 'Append to, and read back, the organism row spaces that name this app — an event log or audit trail the app keeps on a group you belong to',
  // task:* and workflow:* let a control-plane app (e.g. AGENCY) orchestrate the owner's OWN
  // agents on their behalf. The task routes enforce an owner-match (an app may only create/read
  // tasks for agents whose owner is the app's own owner) and workflow routes already resolve to
  // the owner's memory namespace, so a granted app never reaches another owner's agents/data.
  'task:read': "See your agents' tasks, runs, and results",
  'task:write': 'Create and start tasks for your own agents on your behalf',
  'workflow:read': 'See your automations (workflows) and their runs',
  'workflow:write': 'Create, save, and run your automations (workflows)',
  'ai:use': 'Use AI on your behalf with your configured key (spends your AI budget)',
  // TARGET-057. Deliberately NOT connections:write: an app that may publish to an account you
  // already connected is a different favour from one that may attach new accounts to your name.
  // Attaching is a human act at the provider's own consent screen and no app performs it.
  'connections:use': 'Publish to accounts you have already connected (never see or change the accounts themselves)',
  // TARGET-058. Recording what the node OBSERVED needs no permission — that happens whether anyone
  // asks or not. Asserting how content was made is different: a declaration can say a person wrote
  // or reviewed something, which is exactly the statement that decides whether a visible AI label is
  // owed. So the assertion is the thing an owner grants, and staying silent is always free.
  'provenance:write': 'State how content it creates was made (whether AI wrote it, and whether a person reviewed it)',
  // Spending is its own permission. Reading your memory and buying on your behalf are not the same
  // favour, and until this existed the narrowest grant there is was enough to draw on any contract
  // its owner held — the app presented the owner's own GHII, so the money layer could not tell them
  // apart. Paired with a per-app ceiling (`spend_cap_units`) so the answer can be an amount rather
  // than a yes.
  'contract:spend': 'Buy on your behalf using contracts you hold (spends your morsels or money)',
  // The other side of the same coin: an app that manages who may use ITS owner's capability.
  // A membership gate that approves someone and cannot open the door for them is decoration, and
  // the owner is the one paying for what it gives away — so it is asked for, never assumed.
  // Handing another account a standing right to read part of your memory is not something
  // memory:write covers, and reading it that way would be the wrong bargain: an app allowed to
  // write your records would silently also be allowed to publish them to people you never named.
  // So it is asked for on its own, exactly as exchange:grant is for giving away what you sell.
  'share:manage': 'Share parts of your memory with people and groups you have set up (and stop sharing)',
  'exchange:grant': 'Give and withdraw free access to capabilities you sell (you carry the cost)',
  // Declaring that part of your revenue goes to someone else, and paying it out, both move value out
  // of the owner's own pocket. That is a spending decision even though nobody is being charged for it,
  // so an app that arranges revenue sharing asks for it rather than inheriting it from selling.
  'exchange:beneficiary': 'Share part of what you earn with other accounts, and pay those shares out',
  // The owner's secrets vault. An app may set and remove the named credentials this account holds,
  // and can never read one back — no door returns a value. Its own word rather than a memory one:
  // handing this to memory:write would have given it to every grant already live, and deleting a
  // secret silently stops whatever was using it, which is a decision the owner makes per app.
  'secrets:manage': 'Store and remove the named keys and passwords in your vault (it can never read one back)',
  'notifications:send': 'Send you notifications (bell + browser push) that open this app',
  'organism:read': 'Read the published content of workspaces you are a member of (e.g. gated curriculum an app renders for you)',
  'organism:invite': 'Invite people into organisms you belong to (send email invitations / access keys on your behalf)',
  'organism:write': 'Create organisms and workspaces on your behalf (an app that provisions its own structured data space)',
  // Company-in-a-box. Reading the books and writing them are different favours: TILIT (the
  // accountant app) reads; an invoicing surface writes. Neither implies the other, and neither
  // implies outbound:send — sending a message to a customer is a third, separate favour.
  'finance:read': 'Read your bookkeeping: invoices, vouchers, VAT reports and exports',
  'finance:write': 'Create and send invoices and book accounting vouchers on your behalf',
  'outbound:send': 'Send email/messages to your saved outbound contacts on your behalf (opt-outs and daily limits always apply)',
  // Measuring what was reached. Split in two because they are different favours: setting up a
  // counter is housekeeping, while READING one tells you who opened what and when — the closest
  // thing this node holds to watching a named person, even though it stores no address and no IP.
  // An app that measures its own campaign needs the first; handing over the second is a decision.
  'signals:write': 'Set up counters for what you send and publish (campaigns, links, pages)',
  'signals:read': 'Read what those counters collected, including which recipients opened or clicked',
  // A company is an addressable public identity, so claiming one and pointing its address
  // somewhere are separate from reading the registry.
  'company:read': 'See the companies you have registered and their addresses',
  'company:write': 'Register companies in your name and set what their address serves',
  // Publishing under the owner's name requires app:write on inline publishing, presigned URL
  // issuance and draft promotion, as well as fork/patch. Deletion uses app:manage instead.
  // Owner sessions retain their bypass.
  // Apps declare this word in aimeat-scopes and obtain the owner's approval; updating HTML alone
  // does not expand an existing grant. scope-vocabulary-migration.ts handles eligible legacy
  // credentials and preserves deliberately narrowed grants. A scoped reader cannot publish.
  'app:write': 'Publish and update apps in your name (each one gets a public address anyone with the link can open)',
};
