/**
 * @file public/views/profile/agents/scope-model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an agent's scope set IS and how the checkbox editor converts to and from it —
 *   the pure half of scope-config.js, with no imports, so it can be executed by a unit test.
 *
 *   It is separate for one reason: the editor's expand/collapse pair is a round trip, and a round
 *   trip that silently loses a member is invisible in every screenshot. `*` used to expand into
 *   every checkbox and a fully-ticked editor used to collapse back to `['*']`, so
 *   `memory:write-reserved` — which the server grants on the exact string only — always LOOKED
 *   granted and could never be SAVED. Both halves have to agree about what the wildcard carries,
 *   and now they agree here, once, under test/unit/agent-scope-model.test.ts.
 * @structure NOT_IN_WILDCARD · SCOPE_DOMAINS · SCOPE_TEMPLATES · wildcardScopes · expandScopes ·
 *   collapseScopes · bulkScopes · detectTemplate
 * @usage
 *   import { expandScopes, collapseScopes } from './scope-model.js';
 *   const checked = expandScopes(agent.default_scopes ?? ['*']);
 *   await save(collapseScopes(checked));
 * @version-history
 *   2026-10-29 — agent:permissions-add, outside every wildcard: adding permissions it holds to another
 *     of the owner's agents (wish-omistajan-ai-voi-lis-t-agenttien-oikeuksia-kun-omistaja-niin).
 *   2026-10-18 — publish:public, outside every wildcard: making something public without a request to
 *     the owner (plan doc-mvcn6c7e4e5q, V4.1).
 *   2026-10-17 — The standard preset holds messages:send (Jouni: "otetaan oletusoikeudet käyttöön").
 *   2026-10-15 — memory:read-as-owner, outside every wildcard: reading the owner's and the sibling
 *     agents' private records with owner_scope (feature-list audit #42).
 *   v1.15.0 — 2026-10-15 — connections:read-as-owner, outside every wildcard: reading what is in the
 *     owner's connected accounts (feature-list audit 128).
 *   v1.19.0 — 2026-10-13 — organism:direct, inside the wildcard and in neither preset: writing a
 *     record space directly that an app closed to agents, and changing which extensions such a space
 *     names. No permission let an agent through that rule before (Jouni, 2026-10-13).
 *   v1.18.0 — 2026-10-12 — agent:read, inside the wildcard: seeing the owner's agents, the word the agent
 *     list asks from 4.0.0; the standard preset carries it.
 *   v1.17.0 — 2026-10-12 — packages:read, inside the wildcard: seeing the packages installed for the owner,
 *     the word the install reads ask from 4.0.0 (auth/rest-scope-gate.ts).
 *   v1.16.1 — 2026-10-06 — The standard preset carries organism:read and organism:write, the words the
 *     workspace tools ask (secaudit 2026-10 last items, D4).
 *   v1.16.0 — 2026-10-02 — memory:purge, inside the wildcard: deleting shared workspace records for good.
 *   v1.15.0 — 2026-10-01 — contacts:read, inside the wildcard: listing the owner's address book. It
 *     rode messages:read on the node's MCP tool while the REST endpoint refused every agent.
 *   v1.14.0 — 2026-09-24 — connections:read-through: reading what is in a connected account (a
 *     mailbox, its attachments, its send-as addresses). It rode connections:use, which the box
 *     describes as publishing and sending (security audit A5-1).
 *   v1.13.0 — 2026-09-24 — operator:admin, outside every wildcard: node administration through an
 *     agent (the admin tools, the MCP registry, the SEO pair). Only an operator's own agent can be
 *     given it at all, and nobody was grandfathered onto it (security audit A8-1).
 *   v1.12.0 — 2026-09-24 — site:theme-write, outside every wildcard: making the node's themes.
 *   v1.11.0 — 2026-09-16 — The mcp domain: read, use and manage for the other MCP servers this
 *     account has attached. manage is outside every wildcard; the other two are not, because
 *     reaching an attached server is what the person attached it for.
 *   v1.10.0 — 2026-09-13 — messages:organize-as-owner, outside every wildcard: archiving the owner's
 *     conversations and writing the rules for their Messages list, as the owner.
 *   v1.9.0 — 2026-09-12 — messages:read-as-owner, outside every wildcard: reading the owner's own
 *     mailbox as the owner, beside send-as-owner and delete-as-owner.
 *   v1.8.0 — 2026-09-06 — secrets:manage, in its own domain and outside every wildcard: the owner's
 *     credential vault. The word is new rather than borrowed from memory: reusing memory:write
 *     would have handed every live agent and app grant the power to rotate the owner's credentials
 *     with nobody ever asked.
 *   v1.7.0 — 2026-08-29 — organism:rows: the person's half of the two-hand rule that lets an app
 *     keep an append-only trail on a row space the organism opened to it.
 *   v1.6.0 — 2026-08-26 — site:layout-write, in its own domain and outside every wildcard: which
 *     blocks the node's front page and every member's home are built from. Same operator-only gate
 *     as the two rows above it, and here for the same reason — the capability is meant to be used
 *     from a chat, and without a row an operator could not grant it from this page at all.
 *   v1.5.0 — 2026-08-15 — operator:organism-repair, in its own domain and outside every wildcard.
 *     The only word here whose effect depends on who the owner is: the node operator can put an
 *     owner back on an organism whose creator account is unreachable, and on any other account the
 *     box grants nothing, which its sentence says. Without a row an operator could not grant it from
 *     this page at all.
 *   v1.4.0 — 2026-08-13 — agent:delete, the word a fleet runtime needs to clear away the agents it
 *     created. Inside the wildcard on purpose: the route's second condition (only agents this
 *     caller registered) is the real fence, and a box nobody can find protects nothing.
 *   v1.3.0 — 2026-08-11 — account:security, a sixth word outside the wildcard: the password, the
 *     recovery address, the second factor, the identity proof, and deleting or exporting the whole
 *     account. Its own domain, because it is not a permission over the person's data but over
 *     whether they still reach it.
 *   v1.2.0 — 2026-08-11 — Five words that no wildcard carries: commerce:psp,
 *     commerce:beneficiary-verify, agent:permissions, consent:groups and social:members. Each names
 *     a call the web door reserves to a logged-in person, so it costs its own tick rather than
 *     riding along with Full access.
 *   v1.1.0 — 2026-08-10 — Three new domains (agent, app, capability) plus organism:write,
 *     organism:invite and ext:invoke. These name things an agent could already do with no
 *     permission at all, because the MCP scope table read silence as consent.
 *   v1.0.0 — 2026-08-08 — Split out of scope-config.js so the wildcard round trip is testable.
 *   v1.1.0 — 2026-08-08 — The vocabulary caught up with the node, and the round trip stopped losing
 *     things. 17 scopes the node enforces had no row — bookkeeping, outgoing email, automations,
 *     connected accounts, the marketplace — so unticking one unrelated box dropped the agent out of
 *     '*' and revoked every one of them at once, none of them named anywhere in the dialog. Four
 *     boxes granted nothing (generator:*, agent:register) and one more (task:manage) was dead too.
 *     Anything the editor does not recognise is now carried through instead of discarded, an
 *     unknown domain wildcard no longer collapses the whole grant to ['catalogue:read'], a domain
 *     wildcard the agent already held is re-emitted when that domain was untouched, and an empty
 *     scope list no longer reports itself as full access.
 */

/**
 * Scopes that `*` deliberately does NOT carry, mirroring the server: hasWriteReserved() in
 * src/routes/memory/owner-target.ts tests the EXACT string, while every other scope check honours
 * the wildcard. "Full access" is one click, and nobody clicking it is deciding that an agent may
 * point their decrypted AI key at a URL of its choosing — so that one costs its own tick.
 */
export const NOT_IN_WILDCARD = [
  'memory:write-reserved',
  // ── Added 2026-08-11 ─────────────────────────────────────────────────────────────────────────
  // Eight tool calls the web door reserves to a logged-in person and the agent surface allowed on
  // an ordinary permission. Each is the owner's money or who else sees their data. The agent is not
  // shut out — it should be able to do what a person can — but each of these costs its own tick, so
  // it cannot ride along with "Full access".
  'commerce:psp',
  'commerce:beneficiary-verify',
  'agent:permissions',
  'consent:groups',
  // Handing another account a standing right to read part of the owner's memory. Same reasoning:
  // assembling an audience and giving it a key space are separate acts, and only the second gives
  // anything away.
  'share:manage',
  'social:members',
  // ── Added 2026-08-11 ─────────────────────────────────────────────────────────────────────────
  // The account itself: the password, the recovery address, the second factor, the identity proof,
  // and deleting or exporting everything. An agent that can set the password can become the person,
  // so this one is never granted by a preset, a bulk header or Full access — only by this box.
  'account:security',
  // ── Added 2026-08-15 ─────────────────────────────────────────────────────────────────────────
  // The node operator's break-glass over an organism's ownership, on organisms the caller does not
  // own. It answers an incident an unscoped agent caused, so carrying it inside "Full access" would
  // rebuild the same hole one level up. Only an operator's own agent can be given it at all.
  'operator:organism-repair',
  // ── Added 2026-08-23 ─────────────────────────────────────────────────────────────────────────
  // The node-wide compliance report, and the register it reads. The report puts every account's AI
  // activity on this node into one document, so the read word gives away as much as the write word
  // changes, and neither rides along with "Full access". Only an operator's own agent can be given
  // them at all.
  'compliance:read',
  'compliance:write',
  // ── Added 2026-08-26 ─────────────────────────────────────────────────────────────────────────
  // Arranging the node's front page and the page every member lands on. The widest-reach write here
  // that is not money or an identity: it changes what everyone SEES on arrival. Asking your own AI
  // to take the shop off the members' home is the use it exists for, so an agent is not shut out —
  // it just costs its own tick. Only an operator's own agent can be given it at all.
  'site:layout-write',
  // ── Added 2026-09-24 ─────────────────────────────────────────────────────────────────────────
  // Making and editing the node's themes (Themes & Styles): the look of every page. Same reach and
  // the same gate as the layout above; only an operator's own agent can be given it.
  'site:theme-write',
  // ── Added 2026-09-06 ─────────────────────────────────────────────────────────────────────────
  // The owner's secrets vault: the named credentials this account holds so the things acting in its
  // name can use them without holding them. Nothing reads a value back, so the only power the word
  // grants is to set and destroy them — and destroying one silently stops whatever was using it.
  // "Full access" is one click, and nobody clicking it is deciding that an agent may rotate the key
  // their extensions call the world with.
  'secrets:manage',
  // ── Added 2026-09-07 ─────────────────────────────────────────────────────────────────────────
  // Removing a message from the owner's own mailbox, as the owner. A separate word from
  // send-as-owner and not a widening of it: replying for someone is additive and they can read what
  // was sent, while deleting destroys a piece of their correspondence and leaves nothing behind to
  // read. An agent is not shut out — asking your own AI to clear out a thread is the use it exists
  // for — but it costs its own tick rather than riding along with "Full access".
  'messages:delete-as-owner',
  // ── Added 2026-09-12 ─────────────────────────────────────────────────────────────────────────
  // Reading the owner's own mailbox, as the owner: the conversations and every message in them. The
  // plain read box is the agent's OWN messages. This is what lets "reply as me" read the thread it
  // is answering, and it costs its own tick because a read leaves nothing behind to see.
  'messages:read-as-owner',
  // ── Added 2026-09-13 ─────────────────────────────────────────────────────────────────────────
  // Organising the owner's Messages list, as the owner: archiving and restoring conversations and
  // writing the rules that fold, group or archive them. Nothing is deleted, but archiving is how a
  // message stops being seen, so it costs its own tick rather than riding along with "Full access".
  'messages:organize-as-owner',
  // ── Added 2026-09-16 ─────────────────────────────────────────────────────────────────────────
  // Attaching another MCP server to this account, or removing one. Its two siblings, mcp:read and
  // mcp:use, stay inside the wildcard on purpose: reaching an attached server is what the person
  // attached it FOR, and the whole point is that the AI they already talk to can use it. This word
  // is the one that changes WHICH servers everything acting for them can reach, and points the
  // account at an address of the agent's own choosing with a credential stored behind it. "Full
  // access" is one click, and nobody clicking it is deciding that.
  'mcp:manage',
  // ── Added 2026-09-24 ─────────────────────────────────────────────────────────────────────────
  // Node administration through an agent: minting, the SSO connections, deactivating an account,
  // resetting somebody's second factor, the CORS lists, the hooks and the MCP registry. These tools
  // asked only whether the account runs the node, so every agent an operator connected held all of
  // them. Only an operator's own agent can be given it at all.
  'operator:admin',
  // ── Added 2026-10-15 ─────────────────────────────────────────────────────────────────────────
  // Reading memory as the owner: with owner_scope, every record the owner and their other agents
  // hold, private ones included. Without it the agent sees what visibility gives it. A read leaves
  // nothing behind for the owner to see, so it costs its own tick (feature-list audit #42).
  'memory:read-as-owner',
  // Reading what is in the owner's connected accounts, as the owner: their mail and its attachments.
  // An agent's connections are its own; this is what lets the owner's AI read the mailbox the owner
  // connected, and it costs its own tick for the reason messages:read-as-owner does.
  'connections:read-as-owner',
  // ── Added 2026-10-18 ─────────────────────────────────────────────────────────────────────────
  // Making something public without asking: a record, a file, an app anyone may open. Without it the
  // agent's attempt becomes a request the owner approves. Showing data to the whole internet costs
  // its own tick (plan doc-mvcn6c7e4e5q, V4.1).
  'publish:public',
  // ── Added 2026-10-29 ─────────────────────────────────────────────────────────────────────────
  // Adding permissions to another of the owner's agents, from the ones this agent holds itself
  // (src/services/agent-scope-add.ts). Only the owner gives it, here, because no agent may pass it on.
  'agent:permissions-add',
];

/**
 * The vocabulary of the checkbox editor.
 *
 * The rule for what belongs here: **ticking or unticking it must change what THIS AGENT can do.**
 * That is stricter than "the node reads the string somewhere", and the difference is not academic —
 * an audit of all 49 scope strings the node checks found eight where the tick binds someone else or
 * nobody:
 *
 *   contract:spend      only an app session is ever refused (services/metered-access.ts:151)
 *   events:emit         requireRole('ecosystem') runs first, so never an agent
 *   organism:write      requireRoleOrScope('agent', …) — an agent passes by ROLE, tick or no tick
 *   task:manage         nothing in src/ reads it at all
 *   agent:register      nothing in src/ reads it at all
 *   generator:*         the Generator was removed 2026-07-18; three dead strings
 *
 * A box that grants nothing is worse than a missing box: it answers the owner's question wrongly.
 * The dead ones were removed rather than relabelled; an agent that still holds one now shows it in
 * the editor's "other permissions" section, where it can be unticked (see unknownScopes).
 */
export const SCOPE_DOMAINS = [
  // write-as-owner: write into the OWNER's namespace instead of the agent's own. Same shape as
  // messages:send-as-owner below — an explicit, owner-granted delegation. The agent must ALSO
  // ask for it per call, so granting it changes nothing on its own.
  // write-reserved: ALSO the keys the server itself trusts (openrouter.* / ai-usage.* /
  // profile.*). For an agent that administers the account. Not in '*' on purpose — see
  // WRITE_RESERVED_SCOPE in src/routes/memory/owner-target.ts. It is a MODIFIER on write-as-owner:
  // on its own it lifts a block on writes the agent is not making.
  // purge — delete shared workspace records for good (2026-10-02). `delete` can be undone for a grace
  //   window and `purge` cannot, so they are two ticks; an agent holding `purge` has every task wait.
  // read-as-owner — read the owner's and the sibling agents' records as the owner, private ones
  //   included (2026-10-15). `read` with owner_scope gives only what visibility allows.
  { key: 'memory',    permissions: ['read', 'write', 'delete', 'purge', 'read-as-owner', 'write-as-owner', 'write-reserved'] },
  { key: 'storage',   permissions: ['read', 'write'] },
  { key: 'ai',        permissions: ['use'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  // social:members — add or remove who may read a shared board. A different promise from posting
  //   to one, which is what social:write covers.
  { key: 'social',    permissions: ['read', 'write', 'members'] },
  // delete-as-owner — remove a message from the owner's own mailbox. Its own tick beside
  //   send-as-owner, because the two are not the same promise: one adds, the other destroys.
  // read-as-owner — read the owner's own mailbox. `read` is the agent's own messages.
  // organize-as-owner — archive the owner's conversations and write the rules for their list.
  { key: 'messages',  permissions: ['send', 'read', 'send-as-owner', 'read-as-owner', 'delete-as-owner', 'organize-as-owner'] },
  // contacts:read — list the owner's address book (GET /v1/contacts, aimeat_contact_list): names,
  //   accounts and what the owner wrote about each person. The conversations stay behind
  //   messages:read-as-owner. Inside the wildcard: a person who ticked "Full access" meant this.
  { key: 'contacts',  permissions: ['read'] },
  { key: 'wallet',    permissions: ['read'] },
  // consent:groups — create a sharing group and decide who is in it. A sharing group IS the
  //   boundary of who reads the owner's memory, so it is separated from managing consents.
  { key: 'consent',   permissions: ['manage', 'groups'] },
  // Key-space shares: what a sharing group actually reaches. The group is the audience (consent:groups);
  // this is what they may read. Without a row here an owner could not grant it in this editor at all.
  { key: 'share',     permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'task',      permissions: ['read', 'write'] },
  { key: 'workflow',  permissions: ['read', 'write'] },
  // The money and the outside world. These were enforced by the node with no row in this editor,
  // so an owner could neither grant nor revoke them here while an agent used them daily.
  { key: 'finance',   permissions: ['read', 'write'] },
  { key: 'outbound',  permissions: ['send'] },
  // signals:read is the half that names people: it answers "who opened this, and when". Kept
  // apart from write so an agent can run a campaign's counters without being handed the readers.
  { key: 'signals',   permissions: ['read', 'write'] },
  { key: 'company',   permissions: ['read', 'write'] },
  // connections:use publishes and sends THROUGH an account; connections:read-through reads what is
  // IN one, the mailbox included. Two favours, two boxes, since 2026-09-24.
  // read-as-owner — read what is in the OWNER's connected accounts; read-through alone reads the agent's own.
  { key: 'connections', permissions: ['read', 'write', 'use', 'read-through', 'read-as-owner'] },
  // The other MCP servers this account has attached — an issue tracker, a wiki, whatever the
  // person connected. Three words for the same reason connections has three: knowing WHICH servers
  // are attached, calling a tool THROUGH one, and attaching another are three different favours.
  // mcp:manage is also outside every wildcard (NOT_IN_WILDCARD below): pointing this account at a
  // server of the agent's own choosing, and storing a credential there, is a human act.
  { key: 'mcp',       permissions: ['read', 'use', 'manage'] },
  { key: 'notifications', permissions: ['send'] },
  { key: 'exchange',  permissions: ['read', 'write', 'grant', 'beneficiary'] },
  // commerce:psp — write or destroy the payment credentials money is paid out through.
  // commerce:beneficiary-verify — record a beneficiary as verified, which is what makes a payout
  //   possible. Kept apart from the rest because a provider who could open this gate for their own
  //   payee is not a gate at all.
  { key: 'commerce',  permissions: ['sell', 'buy', 'psp', 'beneficiary-verify'] },
  // organism:read   — see the organisms and workspaces this agent's owner belongs to
  // organism:write  — create a workspace, write and publish documents in one, comment, revert
  // organism:invite — hand somebody else access: invite a member, grant or revoke a workspace role.
  //                   Separate from write because it changes WHO ELSE can read the owner's knowledge,
  //                   which is a different promise than changing the knowledge.
  // organism:rows — append to, and read back, the organism row spaces that NAME the holder
  //                 (an app's event log or audit trail on a group). The person's half of a
  //                 two-hand rule: the organism names the app in the space's manifest, the person
  //                 grants this; neither alone opens anything (2026-08-29).
  // organism:direct — write a record space directly that an app closed to agents, and change which
  //                 extensions such a space names. A space whose manifest object type names
  //                 extensions takes an agent's write only through one of them
  //                 (src/services/fenced-space.ts); this word lets the agent past that, on the
  //                 owner's own tick. An ORDINARY word: inside the wildcard, so "Full access" carries
  //                 it, and in neither preset below (ruled by Jouni, 2026-10-13).
  { key: 'organism',  permissions: ['read', 'write', 'invite', 'rows', 'direct'] },
  { key: 'provenance', permissions: ['write'] },
  // cortex:write — install/activate/deactivate/delete cortex libraries (browser-side UI)
  // ext:write    — activate/deactivate/delete extensions, manage instances (server-side WASM)
  // Note: extension INSTALL is requireAuth-only at the route (agents can push code that stays
  // inert until ext:write activates it). Cortex INSTALL requires cortex:write.
  { key: 'cortex',    permissions: ['write'] },
  { key: 'ext',       permissions: ['write', 'invoke'] },
  // packages:write — install a package. That REGISTERS its app, its cortex, its extension and any
  // @activate cron the manifest declares, all under the installer's identity, so it is the widest
  // single act in this list and it asked for nothing at all until 2026-08-15. A row here is what
  // lets an owner see it and take it away.
  // packages:read — see the packages installed for the owner (GET /v1/instances and its two reads,
  //   aimeat_package_instances). New on 2026-10-12 with the REST scope gates of 4.0.0; every agent that
  //   existed then was given it once (services/rest-scope-gates-migration.ts).
  { key: 'packages', permissions: ['read', 'write'] },
  // secrets:manage — set, replace and delete the named credentials in the owner's vault. One word
  //   rather than a read and a write: the list is names and dates, and an agent that could see a
  //   name and not set it has learned nothing it can act on. Without a row here an owner could not
  //   grant it from this page at all.
  { key: 'secrets',  permissions: ['manage'] },
  // publish:public — make something public without a request to the owner (plan doc-mvcn6c7e4e5q,
  //   V4.1). Outside every wildcard (NOT_IN_WILDCARD above).
  { key: 'publish',  permissions: ['public'] },

  // ── Added 2026-08-10 (August 2026 audit, step 3a) ────────────────────────────────────────────
  // These name things an agent could already do with no permission at all, because the MCP surface
  // reads a missing entry in its scope table as permission rather than as an omission. Adding the
  // words is what lets an owner see them and take them away.
  //
  // agent:write — reconfigure ANOTHER of the owner's agents: its mode, its tags. Not its own
  //               record, which needs nothing — an agent describing itself is answering about
  //               itself. This is the one that reaches sideways, at a sibling principal with its
  //               own identity and its own trust score.
  // app:write   — publish or update an app under the owner's account, and save or publish a draft.
  // app:manage  — the destructive half: delete an app, fork one, remove a template. Split from
  //               write because publishing an update and deleting the thing are different risks.
  // capability:write — create, update, delete or vouch for a published capability. A capability is
  //               how this account offers work to others, so writing one speaks in the owner's name.
  // agent:permissions — rewrite what another of the owner's agents is allowed to do. Separate
  //   from agent:write, which is its mode and its tags: this one changes the permission set itself.
  // agent:read — see the owner's agents: the list (GET /v1/agents, aimeat_agents_list), the basic
  //   agents preview and which agents cannot sign in. Asked from 4.0.0 (auth/rest-scope-gate.ts); in
  //   the node's default agent scopes, and every agent that existed on 2026-10-12 was given it once
  //   (services/rest-scope-gates-migration.ts). Ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-
  //   suositusten-mukaan, item 11.
  // agent:delete — end another of the owner's agents for good. Its own word rather than part of
  //   agent:write, because reconfiguring a sibling and ending it are different sizes of act, and
  //   because the caller that needs it is a fleet concierge cleaning up what it created. The route
  //   adds a second condition the box cannot express: an agent may only delete an agent whose
  //   registration it authorized itself.
  // agent:permissions-add — add to another agent the permissions this agent holds itself, never to
  //   itself. Outside every wildcard; each addition reaches the owner's feed and bell (2026-10-29).
  { key: 'agent',      permissions: ['read', 'write', 'permissions', 'permissions-add', 'delete'] },
  { key: 'app',        permissions: ['write', 'manage'] },
  { key: 'capability', permissions: ['write'] },

  // ── Added 2026-08-11 (August 2026 audit, H-1/H-7) ────────────────────────────────────────────
  // account:security — the doors that decide who can sign in as this person: the password, the
  //   recovery address, the second factor, the identity proof, and deleting or exporting the whole
  //   account. Enforced by requireOwnerPrincipal() in src/auth/middleware.ts. Nobody was
  //   grandfathered onto it, so an agent has it only if the owner ticked this box.
  { key: 'account',    permissions: ['security'] },

  // ── Added 2026-08-15 ─────────────────────────────────────────────────────────────────────────
  // operator:organism-repair — install an owner on an organism this account does not own. The node
  //   operator's break-glass, and the ONLY scope here whose effect depends on who the owner is: the
  //   gate (requireOperatorPrincipal, src/auth/middleware.ts) reads the OWNER's roles first, so on a
  //   normal account this box grants nothing and the sentence says so. It exists because an
  //   organism whose creator became unreachable had no repair path on any surface, and a capability
  //   an operator cannot grant from this page is a capability with no door.
  // operator:admin — administer the node through this agent: the admin tools, the MCP registry and
  //   the search-engine announcement (2026-09-24). Same caveat as the repair word: on a normal
  //   account it grants nothing. The operator in person needs no box; the admin pages are theirs.
  { key: 'operator',   permissions: ['organism-repair', 'admin'] },

  // ── Added 2026-08-23 (BR-02) ─────────────────────────────────────────────────────────────────
  // compliance:read / compliance:write — the node-wide compliance report, and the use-case register
  //   and question set behind it. Same gate as operator:organism-repair
  //   (requireOperatorPrincipal, src/auth/middleware.ts), so the same caveat applies: it reads the
  //   OWNER's roles first, and on a normal account these boxes grant nothing. Two words rather than
  //   one because they fail differently — reading is a disclosure of every account's AI activity,
  //   writing changes what the report says about the node.
  { key: 'compliance', permissions: ['read', 'write'] },

  // ── Added 2026-08-26 ─────────────────────────────────────────────────────────────────────────
  // site:layout-write — arrange the node's front page and the page every member lands on: which
  //   blocks are shown, in what order, and the operator's own passages between them. Same gate as
  //   the two above (requireOperatorPrincipal, src/auth/middleware.ts), so the same caveat applies:
  //   it reads the OWNER's roles first, and on a normal account this box grants nothing. It is here
  //   because this is meant to be driven from a chat — "take the shop off our home page" — and a
  //   capability an operator cannot grant from this page is a capability with no door.
  //   site:theme-write (2026-09-24) — make and edit the node's themes, the look of every page; the
  //   same gate, so it grants nothing on an account that is not the operator's.
  { key: 'site',       permissions: ['layout-write', 'theme-write'] },
];

export const SCOPE_TEMPLATES = {
  readonly:  ['memory:read', 'storage:read', 'catalogue:read', 'social:read'],
  // organism:read and organism:write: the workspace tools ask them since 2026-10-06, so an agent
  // approved with this preset reads and publishes in its owner's workspaces (Jouni 2026-10-06, D4).
  // agent:read: the owner's agent list, which the node's default scopes carry too (2026-10-12).
  // organism:direct is in neither preset on purpose (Jouni, 2026-10-13): an agent approved with a
  // preset writes an app's closed space through the app's own tool; writing it directly is a tick.
  // messages:send: a person's own AI sends a message for them from the first day (Jouni, 2026-10-17).
  standard:  ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'catalogue:read', 'social:read', 'messages:send', 'work:request', 'work:read', 'organism:read', 'organism:write', 'agent:read'],
  full:      ['*'],
};

/** Every scope `*` actually carries — each box in the editor except the out-of-wildcard ones. */
export function wildcardScopes() {
  const set = new Set();
  for (const d of SCOPE_DOMAINS) {
    for (const p of d.permissions) {
      const s = `${d.key}:${p}`;
      if (!NOT_IN_WILDCARD.includes(s)) set.add(s);
    }
  }
  return set;
}

/**
 * The scopes a domain's "all" header covers. An out-of-wildcard scope is left out on purpose: it
 * costs an explicit tick precisely so it cannot ride along with a bulk gesture.
 */
export function bulkScopes(domDef) {
  return domDef.permissions.map(p => `${domDef.key}:${p}`).filter(s => !NOT_IN_WILDCARD.includes(s));
}

/** Every scope string the editor has a row for. */
export function knownScopes() {
  const set = new Set();
  for (const d of SCOPE_DOMAINS) for (const p of d.permissions) set.add(`${d.key}:${p}`);
  return set;
}

/**
 * Scopes this agent holds that the editor has no row for — an unknown domain, a scope added to the
 * node before the editor caught up, or a malformed string from a hand-written PATCH.
 *
 * They are surfaced rather than dropped. A scope the owner cannot see is one they cannot revoke,
 * and silently discarding it on save revokes it without telling them — both directions are wrong,
 * and which one hurts depends only on whether the scope was doing something.
 */
export function unknownScopes(scopeList) {
  const known = knownScopes();
  return scopeList.filter(s => s !== '*' && !known.has(s) && !isKnownDomainWildcard(s));
}

function isKnownDomainWildcard(s) {
  const [domain, perm] = s.split(':');
  return perm === '*' && SCOPE_DOMAINS.some(d => d.key === domain);
}

/** A stored scope array → the set of ticked boxes (plus any scope with no box, kept verbatim). */
export function expandScopes(scopeList) {
  // `*` first, then the explicit entries on top: an agent can hold ['*', 'memory:write-reserved'],
  // and the wildcard must not erase the extra that was granted alongside it.
  const set = scopeList.includes('*') ? wildcardScopes() : new Set();
  for (const s of scopeList) {
    if (s === '*') continue;
    const [domain, perm] = s.split(':');
    if (perm === '*') {
      const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
      // A domain wildcard carries no more than the global one does. One for a domain the editor
      // does NOT know is kept as-is: dropping it silently revoked a real grant — `['finance:*']`
      // used to open-and-save into `['catalogue:read']`.
      if (domDef) bulkScopes(domDef).forEach(sc => set.add(sc));
      else set.add(s);
    } else {
      set.add(s);
    }
  }
  return set;
}

/**
 * The ticked boxes → the scope array to store.
 *
 * Collapses to `*` only over what the wildcard carries, keeps every out-of-wildcard scope spelled
 * out beside it, and carries through anything the editor has no row for. `original` is the array
 * the dialog opened with: a domain wildcard the agent already held is re-emitted when that domain
 * was left alone, so looking at an agent and pressing Save does not quietly rewrite `memory:*` into
 * a snapshot that stops covering whatever memory scope the node adds next.
 */
export function collapseScopes(checked, original = []) {
  const known = knownScopes();
  const extras = NOT_IN_WILDCARD.filter(s => checked.has(s));
  const carried = [...checked].filter(s => !known.has(s));
  if ([...wildcardScopes()].every(s => checked.has(s))) return ['*', ...extras, ...carried];

  const out = [];
  const consumed = new Set();
  for (const d of SCOPE_DOMAINS) {
    const domainWildcard = `${d.key}:*`;
    const bulk = bulkScopes(d);
    if (original.includes(domainWildcard) && bulk.every(s => checked.has(s))) {
      out.push(domainWildcard);
      bulk.forEach(s => consumed.add(s));
    }
  }
  for (const s of checked) if (!consumed.has(s)) out.push(s);
  return out.length > 0 ? out : ['catalogue:read'];
}

export function detectTemplate(scopes) {
  // A MISSING scope list is the legacy "everything" default (both call sites read
  // `default_scopes ?? ['*']`). An EMPTY one is not the same thing, and calling it full access
  // labelled a zero-access agent as the maximum grant.
  if (!scopes) return 'full';
  if (scopes.length === 0) return 'custom';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}
