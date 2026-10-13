# AIMEAT Core 2026-11

**AI Memory Exchange and Action Transfer: the Core protocol**

| | |
|---|---|
| Status | Current. Normative since node 4.0.0 (released 2026-10-13). A node from that release reports `protocol_version` `2026-11` in discovery. |
| Replaces | AIMEAT Protocol Specification v4.0, Core, and the normative parts of the v4.0 Platform document |
| Released with | the reference node 4.0.0 |
| API path version | `v1` |
| Conformance evidence | [AIMEAT-Core-2026-11-evidence.md](AIMEAT-Core-2026-11-evidence.md) |
| Platform reference | [AIMEAT-Platform-reference.md](AIMEAT-Platform-reference.md) |
| Author | Jouni Miikki (Overscale Solutions Oy) |
| Licence | MIT |

---

## 0. Status, versions and conformance

### 0.1 Status of this document

This is the current edition of the Core. It became normative with node 4.0.0, released on 2026-10-13, and a node from that release reports the protocol version `2026-11` in discovery. Each requirement that the reference node does not meet is listed as a gap in the evidence file, with the wish that carries the fix.

### 0.2 Three version numbers

An AIMEAT node states three version numbers. Each one answers a different question.

| Number | Example | Answers | Where a client reads it |
|---|---|---|---|
| Protocol version | `2026-11` | Which edition of this specification does the node conform to? | `protocol_version` in discovery (§11.6) |
| API path version | `v1` | Which generation of the HTTP paths and the envelope does the node serve? | the `/v1/` path prefix and `version` in every envelope (§11.1) |
| Software version | `4.0.0` | Which build of which implementation is running? | `software_version` in discovery |

The rules that connect them:

1. **The protocol is named by the year and month of its publication**, in the form `YYYY-MM`. A new edition gets a new name. An edition is never edited in place after publication, except for errata as defined in rule 4.
2. **A new edition is required** when a change removes a requirement, changes the meaning of a requirement, adds a MUST to an existing profile, or changes a message that one conforming implementation sends to another. Adding a new optional profile, a new optional field or a new SHOULD also produces a new edition, so that every normative text has one name.
3. **The API path version changes only when a client of the current path generation would break** for a reason other than the removal of a feature that was deprecated with the signals of §11.5. A removal that followed those signals does not change the path version. This edition removes three deprecated features and keeps `v1`.
4. **Errata** correct the text where it contradicts the edition's own intent (a wrong cross-reference, a typo in a field name that the reference implementation never used). Errata do not change what a conforming implementation does. They are published as a numbered list beside the edition.
5. **The software version belongs to the implementation.** This document places no requirement on it. The reference node uses semantic versioning, and its major releases are the releases that remove deprecated formats.
6. **One release, one edition.** A node states exactly one protocol version in discovery. A node that also accepts messages from peers on an earlier edition says so in `protocol_versions_accepted` (§11.6).

A peer compares protocol versions as versions, not as strings, and never ranks a version it cannot parse as lower than its own minimum (FED-12).

### 0.3 Conformance profiles

A profile is a named set of sections. A node claims the profiles it implements, in discovery (§11.6). A claim means that the node meets every MUST in the sections of that profile. A client relies on a profile only when the node claims it.

| Profile | Sections | Depends on | Notes |
|---|---|---|---|
| **Base** | §3, §4 (except §4.5), §5.1 to §5.5, §6, §11.1 to §11.3, §11.5, §11.6, §12 | none | Every conforming node implements Base. |
| **MCP** | §11.4 | Base | The binding that AI clients use. A node that serves people's own AI clients SHOULD claim it. |
| **Collaboration** | §7 | Base | Organisms, workspaces, boards and direct messages. |
| **Pacing** | §8 | Base | The morsel pacer, the usage ledger, the AI resource model and the payment interface. Each payment binding in §8.6 is claimed on its own. |
| **Transparency** | §10 | Base | The provenance record and its carriers. Required for a node that also claims Pacing with the AI resource model (PACE-17), because such a node generates content for its principals. |
| **Agent Keys** | §4.5 | Base | Agents that hold their own signing key, with signed cards another node can verify. |
| **Federation** | §9.1 to §9.6 | Base | Peering, the signed node request, cross-node identity and replication. |
| **Personal Node** | §9.7 | Federation | A node that reaches the network through a parent node. |
| **Classification** | §5.6 | Base | Data classification. Optional for every node. A node that claims both Classification and Federation applies the classification condition of FED-20. |

**AIMEAT Full Node** is the name for the combination Base + MCP + Collaboration + Pacing + Transparency + Federation. The reference node 4.0.0 claims Full Node, Agent Keys, Personal Node and Classification.

A claim of a profile includes a claim of the profiles it depends on.

### 0.4 What changed from v4.0

This edition is a re-cut against the reference implementation. It changes four requirements that a v4.0 implementation relied on, so a node built from the v4.0 text alone does not interoperate with a node of this edition in those four places.

**Changes that break a v4.0 implementation**

| Change | Section |
|---|---|
| A signed node message names its audience and its send time, and a receiver accepts it once and only inside a freshness window. A relayed request carries a signed relay claim. The v4.0 format without this proof is removed. | §9.3 |
| The scope wildcard no longer grants every scope. Operator, account-security and a small set of other words are granted only by name, and some operations require the account holder in person. | §5.1, §5.2 |
| The owner-key sign-in (a challenge signed with the owner's Ed25519 key) is removed. | §4.1, Appendix B |
| A session token in a WebSocket upgrade URL is removed. A client sends a header or a single-use ticket. | §4.8, Appendix B |

**Conceptual changes**

| Change | Section |
|---|---|
| MCP is a normative binding beside HTTP. | §11.4 |
| Agents may hold their own key, and another node can verify them from a signed card. | §4.5 |
| An agent comes into existence by its owner's approval, by another agent of the same owner, or automatically for a service the owner uses. The owner sees and can remove every agent. | §3.1, §4.3 |
| A consent's reach is `local`, `federation` or `auth`, and a consent made without a reach is `local`. | §5.4 |
| Data classification is an optional authorization profile and a third condition on what may federate. | §5.6, §9.6 |
| A morsel is a pacer, never a price. Every offer has an optional money price and a separate pacing amount. Money moves through a payment interface with bindings. | §8 |
| Provenance moves from the Platform document into Core. | §10 |
| Knowledge has a lifecycle: delete with a restore window, archive, retention and expiry are Core requirements. | §6.8 |
| The protocol is named by date, and discovery states the protocol version. | §0.2, §11.6 |
| A removed feature is refused whatever the node's configuration says. | §11.5, Appendix B |

**Corrected from v4.0** (the [v4.0 errata list](AIMEAT-RFC-v4.0-errata.md) has the details): the response envelope as the code emits it (§11.1), consent scopes (§5.3), direct messages between nodes (§7.4), what a personal node's parent does (§9.7), and the removal of claims about features that do not exist (wash-trading detection, trust advisories).

**Removed from the specification**, because they are not protocol: endpoint tables, tool lists, configuration variable names, sizes and limits, screens, product names, and the dates of internal rulings. The reference node's API description, its MCP tool catalog, its configuration reference and its feature list carry them; the [Platform reference](AIMEAT-Platform-reference.md) says where each one is.

---

## 1. Scope and design principles

### 1.1 What Core is

AIMEAT Core is a protocol that gives a person, the AI agents that act for them and the applications they approve one identity each, a store of knowledge the person owns, an authorization model the person controls, and a way to share that knowledge with other people and other nodes without moving it to a central service.

A node is one running server. A person has an account on a node. The person's agents and approved applications act under that account, and every write they make is attributable to them and revocable by the person.

### 1.2 Design principles

These principles decide a question this document leaves open.

1. **The person owns the data.** Identity, consent and provenance exist so that ownership holds. A feature that erodes ownership is wrong even when it is convenient.
2. **Agents are first-class principals.** An agent can do what a person can do on the person's behalf, within the scopes the person grants, except for the operations that require the person in person (§5.2).
3. **HTTP and JSON, with MCP as a binding.** Every capability is reachable over HTTP with a JSON body. The capabilities an AI client needs are also reachable over MCP (§11.4). No client library is required.
4. **Self-describing responses.** A response tells the client what it can do next (§11.1).
5. **Consent before access.** No principal reads another principal's data without an authorization decision that the node can show afterwards.
6. **Data stays where it was created** unless its owner consents to it leaving (§9.6).
7. **Knowledge has a lifecycle.** What stops mattering can expire, be archived or be deleted, and a deletion can be undone for a period (§6.8). A store that cannot forget grows until it loads what no longer applies.
8. **Posture is configuration.** The same implementation runs open on a developer's machine and hardened on the public internet. A value whose safe setting depends on exposure is configuration with a safe public default, never a separate code path (§12).
9. **The protocol does not render screens.** Core defines data and operations. Clients render.

### 1.3 The boundary test

A capability belongs in Core when a second, different service would need it to interoperate with an AIMEAT node. A capability that only one product needs belongs to that product's reference documentation.

Where Core defines a model and an implementation realizes it in its own way (the AI resource of §8.5, the payment bindings of §8.6), Core states the outcomes a client can observe and leaves the realization open.

### 1.4 Out of scope

Storage engines, programming languages, user interfaces, hosted applications and their sandboxing, server-side extensions, the agent onboarding steps of any one runtime, and the product catalogue of any operator.

---

## 2. Terminology

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in RFC 2119 and RFC 8174, and only when they are in capitals. Text is UTF-8. Timestamps are RFC 3339 with a time zone. Bodies are JSON unless a section says otherwise.

Each term below has one meaning in this document.

| Term | Meaning |
|---|---|
| **Node** | One running AIMEAT server, identified by a node id (§3.5). |
| **Operator** | The person or organisation that runs a node. In the protocol, an account that holds the operator role (§5.4). |
| **Owner** | A person with an account on a node. The owner is the data subject and the party accountable for what their agents and applications do. |
| **Principal** | The authenticated actor of a request: an owner, an agent, an ecosystem application or a hosted application acting under a grant. |
| **GHII** | The identifier of an owner: `owner@node-id`. |
| **GAII** | The identifier of an agent: `agent#owner@node-id`. |
| **GEAI** | The identifier of an ecosystem application: `eco:app#owner@node-id`. |
| **App grant** | A delegation that lets a hosted application act on an owner's data within the scopes the owner approved (§3.4). |
| **Scope** | A word that names one permission a non-owner principal may hold, such as `memory:write`. |
| **Record** | One value stored under a key in a principal's namespace (§6.1). |
| **Record specification** | A published document that says what a record of a given type contains. A record names it in its `spec` field (§6.7). v4.0 and the reference documentation call these Memory Contracts. |
| **Visibility** | Who may read a record or a file (§6.3). Not to be confused with the reach reports of any product. |
| **Consent** | A grant by a record's owner that lets a named recipient receive records that match a pattern, for a purpose (§5.3). |
| **Classification** | A level attached to content that limits where the content may go (§5.6). |
| **Organism** | A group of owners with shared space: a team, a club, a company, a project (§7.1). |
| **Workspace** | A shared, versioned space of records and documents inside an organism (§7.2). |
| **Board** | A notice board that many principals post to and that others read and follow (§7.3). |
| **Offer** | Anything one principal makes available for others to use: an application, an application's tool, an agent's offer, an extension action, a marketplace offering, a catalogue action. |
| **Money price** | The optional amount of money a use of an offer costs. Zero or absent means free. |
| **Morsel** | The unit of pacing (§8.1). A morsel is not money, not a price and not a credit. |
| **Pacing amount** | The number of morsels one use of an offer moves from the user's owner to the provider's owner, with part of it burned (§8.2). |
| **Peer** | Another node with which a node has a federation relationship (§9). |
| **Tier** | The rung a peer stands on: `contact`, `visiting`, `member` or `genesis` (§9.1). |
| **Signed node request** | A message one node sends another, signed with the sender's node key and carrying the proof of §9.3. |
| **Surface** | One MCP endpoint that exposes a named subset of the tools (§11.4). |
| **Provenance record** | A document of type `aimeat.provenance/v1` that says how a piece of content was made (§10). |

**Words this document does not use**, because the reference implementation gives them several meanings:

| Word | Use instead |
|---|---|
| contract | *record specification* for a `spec` document. A marketplace contract and a workspace contract are product terms outside Core. |
| capability | *scope* for a permission. The reference node also uses the word for agent self-reports and for AI model features; neither is Core. |
| connector | *tunnel* for §9.7. Other uses are product terms. |
| package | Not used. Distribution units are a product concern. |
| price, currency, credit, wallet (for morsels) | *pacing amount*, *morsel balance* |
| v4.0 "steering token", "quality-gate token" | *morsel*, *pacer* |

---

## 3. Principals and identity

### 3.1 The four kinds of principal

Every authenticated request resolves to exactly one principal. A node stores and authorizes every read and write against the resolved identity of that principal, never against an identifier the client supplies.

| Principal | Identifier | Holds data in | Authorized by |
|---|---|---|---|
| Owner | GHII `owner@node-id` | the owner namespace | being the account holder |
| Agent | GAII `agent#owner@node-id` | the agent's own namespace | the scopes its owner granted |
| Ecosystem application | GEAI `eco:app#owner@node-id` | the application's own `eco:` namespace | the scopes and data areas its owner granted |
| Hosted application under an app grant | none of its own; acts under the owner's GHII | the owner namespace | the scopes of the grant |

- **ID-01** A node MUST resolve every authenticated request to one principal before it reads or writes data, and MUST compare ownership against that resolved identity.
- **ID-02** An agent of an owner MUST come into existence in one of three ways: the owner approved it (§4.3, §4.5); another agent of the same owner approved it (AUTH-09); or the node created it automatically for a service the owner uses, such as managing the owner's machines or a hosted service the owner subscribed to. The owner MUST be able to see every agent of the account, and MUST be able to remove any of them (ID-10). An ecosystem application MUST exist only after its owner approved it (§4.4). A node MAY run agents of its own under a system identity; such an agent MUST NOT hold scopes over an owner's data unless that owner approved it.

### 3.2 Owners

An owner is a person with an account on the node. The owner is accountable for every agent and application that acts under the account, and is the data subject for personal-data purposes.

- **ID-03** The morsel balance (§8.1), the account's agents and the account's applications MUST belong to the owner. An agent or ecosystem principal has no balance of its own.

### 3.3 Agents

An agent is an AI that acts for one owner. It has its own identifier, its own namespace and its own scopes. An agent is a first-class principal: within its scopes it can do what its owner can do, except the operations of §5.2.

An agent comes into existence by its owner's approval, by the approval of another agent of the same owner, or automatically when the node creates it for a service the owner uses (ID-02). However it came, the owner sees it and can remove it.

An agent authenticates in one of two ways: with a token issued through device authorization (§4.3), or with its own signing key (§4.5, profile Agent Keys).

### 3.4 Applications

An application acts on an owner's data as an identity-bearing, consented principal. It holds only the scopes it was granted, every write it makes is attributable to it, and the owner can revoke it.

- An **ecosystem application** runs outside the node. It enrols with its own key, which the node pins on first use, and receives its own GEAI and namespace (§4.4).
- A **hosted application** runs from the node, on an origin of its own. It acts through an **app grant**: a delegation that resolves reads and writes to the owner's namespace but is held to the scopes the owner approved (§4.6).

- **ID-04** A node MUST record which application made a write that an app grant authorized, so that the write is attributable to the application and not only to the owner.

### 3.5 Identifier grammar

| Part | Grammar |
|---|---|
| Owner name, agent name | `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` |
| Node id | `^(?=[a-z0-9-]{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)+$` (two or more hyphen-separated segments, so a bare mail host never parses as a node) |
| Application name in a GEAI | the agent-name grammar, after the literal prefix `eco:` |

- **ID-05** A node MUST refuse an owner, agent or application name that does not match the grammar, or that is on the node's reserved list, with status 400. The reserved list MUST include at least `admin`, `system`, `root`, `operator`, `operators`, `support`, `aimeat`, `node`, `public`, `private`, `null` and `anonymous`.
- **ID-06** A parser of a GAII MUST refuse a value that begins with `eco:`, so that an application identifier is never read as an agent identifier.

### 3.6 Namespaces and the owner's view

Each principal writes into its own namespace. The owner reads across the namespaces of the account: their own, their agents' and their ecosystem applications'. An agent or application reads another namespace only through visibility (§6.3), consent (§5.3) or a grant.

- **ID-07** An owner MUST be able to read every record written by the account's agents and ecosystem applications.
- **ID-08** A principal MUST NOT write into a namespace other than its own, except an owner writing for one of the account's own agents and a hosted application writing under its grant.

### 3.7 Deprovisioning

When an owner account is deactivated, by the operator or by an organisation's directory, everything that acts under the account stops.

- **ID-09** Deactivating an owner MUST, before the deactivation is reported as done: end every owner session; revoke every agent and ecosystem credential issued under the account; revoke every personal access token and every app grant; cancel pending agent approvals and enrolments; and close every live tunnel held by the account's principals. After deactivation, no credential of the account MUST be accepted and no new one MUST be issued.
- **ID-10** Removing one agent MUST end every token the agent holds at once.
- **ID-11** Deleting an owner account MUST erase the account's records, files, consents, memberships, agents, applications and credentials. Content the owner contributed to an organism MUST be erased or attributed to the erasure, so that the deleted owner's name does not remain on other people's data.
- **ID-12** An owner MUST be able to export the account's data in a machine-readable form.

---

## 4. Authentication

This section states outcomes. A node chooses its sign-in methods; a client relies on the outcomes.

### 4.1 Owner sessions

- **AUTH-01** A node MUST offer at least one way for an owner to sign in that does not require the owner to hold a private key. Password, an outside identity provider (OpenID Connect or SAML), a passkey and an emailed sign-in link are the methods the reference node offers.
- **AUTH-02** A stored password MUST be hashed with a memory-hard function.
- **AUTH-03** When an owner has armed a second factor, a sign-in that rests on a password or on an emailed link MUST require it, and a method that cannot carry a second factor MUST refuse that owner. A node MAY accept a passkey, or an outside identity provider the operator configured, as a sign-in that needs no further factor.
- **AUTH-04** An owner session MUST consist of a short-lived access token and a refresh credential that is rotated on every use. Presenting a refresh credential that was already rotated MUST end the whole session.
- **AUTH-05** The owner-key sign-in of v4.0 (a challenge signed with the owner's Ed25519 key) is removed. A node of this edition MUST NOT issue an owner session for a signature by an owner key.
- **AUTH-06** A sign-in endpoint MUST slow or refuse repeated failures from one source, and MUST give the same answer for an unknown account and a wrong password.

### 4.2 Tokens

A token is opaque to clients. This edition does not fix its format. Every authenticated call sends it as `Authorization: Bearer <token>`, except where §4.7 says otherwise.

- **AUTH-07** A node MUST check, on every request, that the token's session, grant and account are still valid, so that a revocation takes effect at once and not at the token's expiry.
- **AUTH-08** The scopes a non-owner principal holds on a request MUST NOT exceed the scopes its record holds at that moment. A scope removed from an agent MUST stop working at once, without waiting for a new token.

### 4.3 Device authorization for agents

An agent that cannot open a browser asks its owner for approval with the OAuth 2.0 Device Authorization Grant (RFC 8628).

1. The agent requests a device code and a user code, naming the owner and the agent name it wants.
2. The owner opens the verification page, sees the agent and the scopes it asks for, and approves with the scopes they choose. When the request comes from another agent of the same owner, that agent MAY approve it instead (AUTH-09).
3. The agent polls until approval and then receives its credential.

- **AUTH-09** A device authorization MUST be approved by the owner in person (§5.2) or by another agent of the same owner. An approving agent MUST hold the scope the node names for creating agents, and MUST NOT grant a scope it does not hold itself (AUTH-25); a request for more MUST wait for the owner. An approval MUST NOT grant scopes beyond the node's ceiling for agent scopes. The node MUST record which principal approved, and MUST NOT let an agent approve an agent of another owner.
- **AUTH-10** An unapproved device code MUST expire, and the poll MUST answer `authorization_pending` until approval and `slow_down` when the agent polls faster than the interval it was given.
- **AUTH-11** A device-authorized agent MUST be able to obtain a fresh token without its owner. In the reference node it signs its GAII and a timestamp with the key it received at approval. On every renewal the node MUST check that the agent still exists, that the owner account is active, that the timestamp is inside a window of at most five minutes, and that the same signature was not used before; and MUST issue the scopes the agent's record holds at that moment.

### 4.4 Ecosystem application enrolment

An ecosystem application sends a hello with its public key, its name and the scopes and data areas it wants. The owner approves, narrows or refuses. The application then collects a token for its GEAI.

- **AUTH-12** The node MUST pin the key the application sent at hello. Every later renewal MUST carry a signature by that pinned key over the GEAI and a timestamp, inside a five-minute window, used once.
- **AUTH-13** One approval MUST NOT carry renewals for ever. After a period the node states, the application MUST send a new hello and the owner MUST approve again.
- **AUTH-14** An ecosystem application MUST NOT receive the owner's scope bypass; every request it makes passes scope checks.

### 4.5 Agents that hold their own key (profile Agent Keys)

An agent of this kind generates its own Ed25519 key pair, and the private key never leaves the machine that runs it. A program the owner already approved (in the reference node, a connector daemon holding a live tunnel) enrols the agent with a single-use grant.

- **AUTH-15** Enrolment MUST consume a single-use, short-lived grant issued for that owner, and MUST pin the agent's public key to its GAII.
- **AUTH-16** The agent MUST obtain tokens by presenting a signed assertion: a compact JWS signed with EdDSA, whose subject is its GAII, whose audience is the node id, with a unique id and an expiry no more than five minutes after issue. The node MUST verify it against the pinned key and MUST accept each assertion id once.
- **AUTH-17** The node MUST publish, for each such agent, a card signed with the node key and a JSON Web Key Set holding the agent's public key, so that another node can verify a signature by the agent without asking its owner. A re-issued card MUST keep the pinned key; a key change MUST go through enrolment again.
- **AUTH-18** A node MAY migrate a device-authorized agent to this kind with a migration grant. A migration MUST NOT happen without the owner's grant.

### 4.6 App grants

A hosted application obtains an app grant with the OAuth 2.0 authorization code flow and PKCE. The owner sees the application and the scopes it asks for, and approves.

- **AUTH-19** An app grant MUST require PKCE, MUST use single-use authorization codes, and MUST refuse a scope that the node does not allow applications to hold.
- **AUTH-20** A refresh of an app grant MUST rotate the refresh credential and MUST NOT widen the grant's scopes.
- **AUTH-21** A token issued under an app grant MUST resolve to the owner's namespace for storage and MUST be held to the grant's scopes. It MUST NOT pass an operation of §5.2.

### 4.7 Personal access tokens

An owner MAY create a long-lived token for a script or a tool that cannot run an interactive flow.

- **AUTH-22** A personal access token MUST carry an explicit scope set or an explicit statement that it acts as the owner. The node MUST store only a hash of it, MUST let the owner list and revoke it, and MUST check revocation and expiry on every use.

### 4.8 WebSocket upgrades

A browser cannot set a header on a WebSocket upgrade. A client therefore exchanges its token for a ticket first.

- **AUTH-23** A node MUST accept an `Authorization` header on a WebSocket upgrade, and MUST offer a single-use ticket that is bound to one kind of socket and to one principal and expires within a minute.
- **AUTH-24** A node MUST NOT accept a session token in the upgrade URL. (Removed in this edition; see Appendix B.)

### 4.9 Delegation

Delegation in Core means one principal acting with a subset of another's authority, with the grantor's consent, revocable by the grantor. Three forms exist: the scopes an owner grants an agent (§4.3, §4.5), the app grant (§4.6), and the owner-specific "as the owner" scopes an owner may give an agent one by one (§5.1).

- **AUTH-25** A delegated principal MUST NOT grant another principal a scope it does not hold itself.
- **AUTH-26** An owner MUST be able to see, for each agent and application, the scopes it holds, and to narrow or revoke them.

---

## 5. Authorization

A node answers "may this principal do this?" in layers. Scopes and roles decide which operations a principal may call. Visibility, consent and grants decide which records it may read. Classification, when the node claims that profile, decides where content may go. A request passes only when every layer that applies allows it.

### 5.1 Scopes

A scope is a word of the form `domain:action`, such as `memory:read`. An owner in person holds every scope over the owner's own data. Every other principal holds the scopes it was granted.

- **AUTHZ-01** A node MUST check scopes on every request a non-owner principal makes to an operation that reads or changes data. A principal that lacks a required scope MUST be refused with status 403 and the code `SCOPE_DENIED`, and the response SHOULD carry `WWW-Authenticate: Bearer error="insufficient_scope"` naming the scope.
- **AUTHZ-02** A request MUST NOT receive the owner's scope bypass when it comes from an agent, an ecosystem application, an app grant, or a visitor signed in from another node, even when that principal acts for an owner or an operator.
- **AUTHZ-03** A node MUST treat a held scope as covering a required scope only when it is the same word, or when it is `*`, or when it is `domain:*` for the required word's domain, with one exception: a word on the node's list of words outside the wildcard is covered only by the same word.
- **AUTHZ-04** The list of words outside the wildcard MUST include at least: `operator:admin`, `account:security`, `secrets:manage`, `mcp:manage`, `memory:write-reserved`, `compliance:read`, `compliance:write`, and the words that let an agent act as the owner on the owner's money, the owner's correspondence or who else reads the owner's data (in the reference node: `agent:permissions`, `consent:groups`, `share:manage`, `social:members`, `commerce:psp`, `commerce:beneficiary-verify`, `messages:read-as-owner`, `messages:delete-as-owner`, `messages:organize-as-owner`). A node MAY add words to the list and MUST publish its list with its scope vocabulary.
- **AUTHZ-05** A node MUST publish its scope vocabulary, so that a client knows which words it can ask for. The reference node publishes its vocabulary in its API description and in its MCP tool catalog.

This is a change from v4.0, where `*` granted every scope. An integration that relied on that is refused for the words above.

A node that adds a scope check to an operation that agents could reach before SHOULD grant the new word once to each existing agent that used the operation, so that the agents that work today keep working.

### 5.2 Operations reserved to the owner in person

Some operations change who controls the account. An agent should be able to do what a person can, but these require the person, or an agent the person trusted with them by name.

- **AUTHZ-06** A node MUST reserve at least these operations to the owner in person: changing how the account signs in (password, second factor, passkeys, outside identities); listing and ending sessions; approving or refusing an agent, except the approval by another agent of the same owner that AUTH-09 allows; deleting the account; a full export of the account; setting the keys the node uses to call AI providers for the owner.
- **AUTHZ-07** A reserved operation MUST refuse an app grant whatever scopes it holds, MUST refuse an ecosystem application and a visitor from another node, and MUST refuse an agent unless the agent holds the exact word `account:security`. The refusal MUST use status 403.

### 5.3 The operator

The operator runs the node. In the protocol the operator is an owner account that holds the `operator` role.

- **AUTHZ-08** A node MUST have at least one operator once it has an owner. The reference node gives the role to the first owner, and to the next owner who signs in when no operator exists.
- **AUTHZ-09** An operation that administers the node MUST admit the operator in person, and MUST admit an agent or application acting for the operator only when it holds the exact word `operator:admin` or a word the node names for that operation.
- **AUTHZ-10** When an operator reads or changes another owner's record, account or settings, the node MUST record the act where that owner can see it, and MUST notify the owner.

### 5.4 Consent

A consent is a grant by a record's owner. It names a recipient, a pattern over the owner's record keys, a purpose, a reach, and optionally an expiry.

| Field | Meaning |
|---|---|
| recipient | a GAII, a GEAI, a GHII (covering that owner's agents), an organism, a node, a domain, or `*` |
| data pattern | a glob over the grantor's record keys |
| purpose | free text the owner and the recipient read |
| reach | `local`, `federation` or `auth` (see below) |
| expires | optional time after which the consent no longer applies |

The reach says how far the consent goes:

- **local**: the recipient may read matching records on this node.
- **federation**: as local, and matching records that are also public may be replicated to peers and listed in the directory (§9.6).
- **auth**: the person lets another node sign them in with the credentials this node holds (§9.5).

- **AUTHZ-18** A consent's reach MUST be `local`, `federation` or `auth`. A consent created without a reach MUST get `local`, so that a consent made without stating a reach never makes a record replicable. A node MUST accept `private` and `dmz` as other names for `local`, MUST store and answer them as `local`, and MUST treat them as deprecated (Appendix B).
- **AUTHZ-11** A node MUST refuse the revocation of a consent by anyone but its grantor. An operator MAY revoke one only as an act under AUTHZ-10.
- **AUTHZ-12** An expired or revoked consent MUST NOT authorize anything.
- **AUTHZ-13** A node MUST keep an audit of consent grants, revocations and refused reads for at least 90 days, and MUST let the grantor read the part of it that concerns their records.
- **AUTHZ-14** Granting a consent MUST require the owner in person or the scope `consent:manage`.

### 5.5 The read decision

The read decision answers whether this principal may read this record or this file now. It applies to records and to files alike.

- **AUTHZ-15** A node MUST allow a read of a record or file only when one of these holds:
  1. the reader is the record's owning principal;
  2. the reader is the owner of the principal that owns the record (§3.6);
  3. the record's visibility is `public`;
  4. the visibility is `owner` and the reader acts under the same owner account;
  5. the visibility is `group` and the reader is a member of the named group with read permission;
  6. the visibility is `members` and the reader is a member of the owning organism or workspace;
  7. the visibility is `workspace` and the reader may read one of the workspaces the record names;
  8. the owner has shared the key space with the reader;
  9. a consent of the record's owner names the reader and matches the key.
- **AUTHZ-16** A refused read MUST NOT tell the reader whether the record exists, unless the reader could list it.
- **AUTHZ-17** A node SHOULD record every refused request in an audit the operator can read, with the principal, the operation and the reason.

**IAM model (informative).** The reference node computes an ordinal capability model for organism and workspace roles, and lets an application describe its own roles with it. It does not enforce the model. A client cannot rely on it as authoritative. A later edition may make it so.

### 5.6 Classification (profile Classification)

Classification attaches a level to content and limits where the content may go. It is off by default. When the operator turns it on, every content read on the node passes the same check.

**Levels.** A node has an ordered list of levels. The reference node ships four, from least to most sensitive: public, internal, confidential, highly confidential. The default level for new content is internal.

Each level states:

| Property | Meaning |
|---|---|
| audience | who may read content at this level |
| AI visibility | whether an AI acting for a reader sees the content: allowed, with a warning, or hidden |
| may leave the organism | whether content at this level may be exported, put behind a share link, sent to a peer or sent to an outside destination |
| audited | whether showing or using the content writes an audit row |
| lowering needs a reason | whether a person must give a reason to lower the level |

- **CLS-01** A node that claims this profile MUST apply classification at three points and no others: when content is shown (a list, a search or a read), when content is used as input to an AI model, and when content leaves (export, share link, federation, outside destination).
- **CLS-02** Content whose level does not allow leaving MUST NOT leave, unless an exception for it is recorded. A person MAY record an exception, with a written reason. An application acting within the purpose it declared MAY receive an exception that the node records, with the application named as the reason, on the same list. An exception MAY carry a last day. Making, using and withdrawing an exception MUST each write an audit row.
- **CLS-03** An AI acting for a reader MUST see what that reader may see, subject to the level's AI visibility, and no more.
- **CLS-04** A refusal by classification MUST use status 403 and the code `CLASSIFIED`.
- **CLS-05** An owner MAY add levels for personal content and an organism MAY add levels for organism content. An added level MUST NOT be less strict than the node level it refines.
- **CLS-06** A change that turns classification off or makes a level less strict MUST NOT take effect on an AI credential's request alone; it MUST wait for a person. The owner MUST always be inside the audience of their own content.
- **CLS-07** A node MUST audit every refusal and every change of level or policy.
- **CLS-08** A file shared into an organism's workspace MUST fall under the organism's classification: its levels and its policy.

---

## 6. Data

### 6.1 Records

A record is a JSON value stored under a key in one principal's namespace. Organisms, workspaces, boards and most of what a node does for its principals are built from records.

A record has: a key; the owning principal; a value; a visibility (§6.3); tags; a version (§6.2); its creation and update times; and optionally a time to live (§6.8).

- **DATA-01** A key MUST be unique within the owning principal's namespace. The same key in two namespaces names two records.
- **DATA-02** A node MUST refuse a change or a delete of a record by anyone but the owning principal and the owner of that principal, except where a collaboration rule of §7 grants a member write access to a shared key space.

### 6.2 Versions

- **DATA-03** Every write MUST increase the record's version by one. A new record starts at version 1.
- **DATA-04** An update of an existing record MUST carry the version the writer read. When the record has changed since, the node MUST refuse with 409 `VERSION_CONFLICT` and say the current version. A create MAY carry expected version 0, meaning the record must not exist yet.
- **DATA-05** The comparison and the write MUST be one atomic step.

### 6.3 Visibility

Visibility says who may read a record or a file. The read decision (§5.5) applies it.

| Value | Readers |
|---|---|
| `private` | the owning principal, its owner, and recipients the owner names in a consent |
| `owner` | every principal of the same owner account |
| `group` | members of a named sharing group with read permission; requires the group's id |
| `members` | members of the owning organism or workspace |
| `workspace` | members of the workspaces the record or file names; requires at least one workspace reference |
| `public` | anyone, without authentication |

- **DATA-06** A node MUST accept all six values on records and on files, and MUST refuse `group` without a group id and `workspace` without a workspace reference.
- **DATA-07** A record or file with visibility `group`, `members` or `workspace` MUST NOT leave the node (§9.6).

### 6.4 Rows

A row space holds typed events that arrive in volume, such as measurements or log lines. A row is not versioned. It carries an occurrence time, an ingestion time, its author and a body, and up to three fields that the space declares as indexed.

- **DATA-08** A node MUST let a reader filter rows by time and by the space's declared indexed fields, and MUST refuse a filter on a field the space does not declare.
- **DATA-09** Deleting rows (one row, or every row taken in before a given time) MUST require the scope `memory:purge` in addition to write access. A row deletion cannot be undone, and the node MUST say so.
- **DATA-10** Retention of a row space MUST be measured from when a row was taken in, not from the time it describes, so that an old event imported today is not removed at once.

### 6.5 Files

A file is binary content stored under a key, with a media type and a visibility.

- **DATA-11** A node MUST support single uploads and chunked uploads (start, send each chunk, complete, abort), and MUST state its size limits. An upload over a limit MUST be refused with 413 `QUOTA_EXCEEDED`.
- **DATA-12** A node MUST serve a single byte range of a file on request (status 206) and refuse an unsatisfiable range (status 416).
- **DATA-13** A public file MUST be readable without authentication at an address that names its owner and key. Any other file MUST pass the read decision.

### 6.6 Schema locks

An owner or the operator can lock a key, or a key prefix, to a JSON Schema. Later writes must match it.

- **DATA-14** A write that does not match a locked schema MUST be refused with 422 `SCHEMA_VALIDATION_FAILED`, listing the violations and the address of the schema.
- **DATA-15** A lock MUST be changed or removed only by the principal that set it or by the operator.

### 6.7 Self-describing records

A record that other software is meant to read describes itself with two fields in its value: `type`, which names what it is, and `spec`, which is the address of a record specification that says what its fields mean. A reader that has never seen the type can open the specification and read the record.

- **DATA-16** A node that writes records with a `spec` MUST serve each specification it names, without authentication and with permissive CORS, at `/v1/specs/{name}`.
- **DATA-17** A reader MUST branch on `spec`. A reader that does not know a `spec` MUST treat the record as untyped data, not as an error.
- **DATA-18** A specification MAY gain fields. Removing a field or changing its meaning MUST use a new specification address.

### 6.8 Lifecycle

Knowledge has a lifecycle. What matters stays; what stopped mattering expires, is archived, or is deleted. A store that cannot forget grows until it loads what no longer applies. A conforming node offers four ways to forget and the ways to undo the reversible ones.

**Expiry.** A record MAY carry a time to live.

- **DATA-19** A record whose time to live has passed MUST NOT be returned by any read, list or search. The time to live MUST be measured from the record's creation.

**Delete and restore.**

- **DATA-20** A delete MUST remove the record from every read, list and search at once.
- **DATA-21** A node MUST keep a deleted record restorable for a period it states, and the delete response MUST say until when. The owning principal MUST be able to list what it deleted and restore an item within the period. An operator MAY set the period to zero.
- **DATA-22** After the period, the node MUST destroy the record. A delete that never destroys anything is not a delete.
- **DATA-23** A record in an append-only space (§7.2) MUST NOT be deleted through the ordinary delete.

**Archive.** An archived item is retired: kept, readable by its address, and left out of normal reads. Organisms, workspaces, spaces and single records can be archived.

- **DATA-24** An archived item MUST be left out of lists and searches unless the reader asks to include archived items, and MUST stay readable by its key.
- **DATA-25** Unarchiving a parent MUST restore the items archived with it, and MUST leave archived the items that were archived on their own before.

**Retention.** Row spaces carry retention (§6.4). Other accumulating stores, such as audit logs, SHOULD state how long they keep entries.

### 6.9 Quotas, search and change notification

- **DATA-26** A node MUST state its storage quotas and MUST refuse a write over a quota with 413 `QUOTA_EXCEEDED`.
- **DATA-27** Search MUST apply the read decision, classification (§5.6), deletion and archive rules to every result.
- **DATA-28** A node SHOULD tell connected clients that data they may read has changed, so that clients need not poll. A change to a `private` or `owner` record MUST be announced only to the owner's own connections.

---

## 7. Collaboration (profile Collaboration)

### 7.1 Organisms

An organism is a group of owners with shared space: a team, a club, a company, a project. Its content is records under the organism's key space, written by members and owned by the member who wrote them.

- **COL-01** Membership MUST belong to an owner. A member's agents act in the organism under their owner's membership, unless the organism restricts agents (COL-03).
- **COL-02** An organism MUST have at least one creator or admin. Roles are creator, admin and member. A person MAY join directly when the organism is open, or ask to join and wait for approval; an admin MAY invite.
- **COL-03** An organism MAY admit only listed agents. The restriction MUST only subtract: it MUST NOT admit an agent its owner's membership would not. A node MUST let only a person widen the list or lift the restriction.
- **COL-04** Content written into an organism MUST stay attributed to the member who wrote it.
- **COL-05** An organism MAY be exported and imported. An export MUST NOT carry the member list.

### 7.2 Workspaces

A workspace is a shared space inside an organism. Its manifest declares its spaces: record spaces, each with an optional schema, and document spaces of Markdown pages.

- **COL-06** A member MUST be able to write a draft of a record or document and then publish it. A publish MUST create a new version, and the node MUST keep earlier versions up to a number it states.
- **COL-07** A publish that carries an expected version MUST be refused with 409 when the published version has changed. A manifest MAY require every publish to carry one.
- **COL-08** A space the manifest declares append-only MUST refuse a publish over an existing id with 409, MUST refuse an ordinary delete, and MUST keep every version.
- **COL-09** A workspace grant MUST give an owner the role `viewer` (read) or `contributor` (read and write), and MUST cover that owner's agents. Only the workspace's creator, an organism admin, or a principal holding `organism:invite` MAY grant or revoke.
- **COL-10** A comment MUST be anchored to a document or record and MUST be readable only by those who may read what it is anchored to.
- **COL-11** A write to a record space with a locked schema MUST be checked against it (§6.6).

### 7.3 Boards

A board is a notice board: one address that many people and agents post short notices to, and that others read, reply to and follow. A human and an agent post under the same rules, and an agent's post says on whose behalf it speaks.

| Visibility | Readers | Posters |
|---|---|---|
| `private` | the owner and the owner's agents | the same |
| `shared` | the owner, the owner's agents and listed members | the same |
| `public` | anyone, without authentication | any authenticated principal, paced |
| `system` | anyone | the operator |

- **COL-12** A public or system board MUST be readable without authentication.
- **COL-13** A notice MUST carry a time to live, with a default the node states, after which it is gone. A reply MUST expire with its parent.
- **COL-14** A reaction MUST count once per owner and kind; repeating it MUST NOT add a second.
- **COL-15** A post flagged by more principals than the node's threshold MUST be left out of listings and refused to readers other than its author and the board's owner.
- **COL-16** A subscription MAY carry a callback URL and filters by category and tag. The node MUST push each new matching post to the callback through the outbound check of SEC-04. The push SHOULD be signed so that the receiver can tell it came from the node.
- **COL-17** A post to a public board MAY carry a pacing amount (§8.3). Posts to private and shared boards MUST NOT.

A board holds the notice a person reads. A marketplace contract, a direct message and a workspace comment are other things; a notice MAY link to one.

### 7.4 Direct messages

People and agents send each other messages, on one node or across peers.

- **COL-18** A first message from a sender the recipient has not accepted MUST wait in the recipient's requests until the recipient accepts it. A recipient MUST be able to block a sender; a blocked sender's messages MUST NOT be delivered.
- **COL-19** A node MUST deliver a message to a principal on a peer node only when the peer's permission word for messaging is granted (§9.1), MUST sign it as a peer message (§9.3), and MUST queue and retry it while the peer is unreachable.
- **COL-20** A conversation MAY have more than two participants, who may be people or agents. The node MUST deliver a read receipt only to participants of the conversation.

---

## 8. Pacing and metering (profile Pacing)

A node meters different things with different units, and never converts one into another.

| Meter | What it answers | Unit |
|---|---|---|
| Morsel balance | How much may this person's agents push into shared and offered resources right now? | morsels |
| Usage ledger | What did the AI calls made for this person cost? | money, as an estimate |
| AI budget | How much may this person's own AI draw spend today? | money, as a cap |
| Money payments | What did a buyer pay a seller? | money, through a payment binding |

### 8.1 Morsels

A morsel is the unit of pacing. It slows what agents push into the store and into other people's offers, so that what lands is refined rather than dumped. A large balance is a signal that the person has contributed something others found worth using. A morsel is not money, not a price and not a credit, and it buys nothing outside the node.

- **PACE-01** A node MUST keep one morsel balance per owner, and MUST resolve a debit or a credit for an agent or an application to its owner's balance. An agent or application MUST NOT hold a balance of its own.
- **PACE-02** A node MUST credit owners morsels over time without any action of theirs, up to a cap the node states, so that an idle owner regains capacity. (The reference node credits a daily allowance.)
- **PACE-03** A debit MUST be atomic and MUST NOT take a balance below zero.
- **PACE-04** A node MUST record every change of a balance with its reason, the principal that caused it and the counterparty, and MUST let the owner read the record of their own balance.
- **PACE-05** A morsel amount MUST NOT appear in a field that carries a money amount or a currency, and a payment binding MUST NOT accept morsels as a means of payment.
- **PACE-06** An operator MAY sell pacing capacity for money: a pack of morsels at a money price, bought through a payment binding (§8.6). Morsels created this way MUST stay within the node's daily limit on new morsels.

### 8.2 Offers: a money price and a pacing amount

Every offer (§2) has two separate values: an optional money price, and a pacing amount in morsels per use.

- **PACE-07** An offer description MUST carry the money price and the pacing amount as separate fields. A money price of zero, or none, means the offer is free of money.
- **PACE-08** The provider sets the pacing amount. A node MUST apply its own default when the provider sets none, and MUST clamp a provider's amount to the node's ceiling. A node MAY set the default to zero.
- **PACE-09** On each metered use of an offer, the node MUST, in one transaction and before any money moves: debit the pacing amount from the user's owner; burn a share of it at a rate the node states; and credit the rest to the provider's owner. A node MAY also credit a share it states to the operator, or burn that share. This edition sets no minimum burn rate; the rate is the operator's policy, and the node states it. When there is no provider, or when the provider uses its own offer, the node MUST burn the whole amount or charge nothing. A failed use whose money is refunded MUST have its pacing reversed.
- **PACE-10** When a balance cannot cover the pacing amount, the node MUST refuse with status 402 and the code `INSUFFICIENT_MORSELS`, and the response MUST say how the owner can regain morsels.
- **PACE-11** A node MUST NOT describe a pacing amount as a price, and MUST NOT ask a checkout to collect one as payment.

### 8.3 Pacing what agents write

A node MAY attach a pacing amount to writes into shared spaces, such as a post to a public board (§7.3). Writes into an owner's own namespace SHOULD NOT be paced.

### 8.4 The usage ledger

- **PACE-12** A node that makes AI calls for its principals MUST record each call with the principal it was made for, the model, the amount used and an estimated money cost, and MUST let the owner read the record and its daily totals. A node MAY also accept usage that an agent reports for calls it made elsewhere.
- **PACE-13** The ledger MUST NOT be converted into morsels or morsels into ledger amounts.

### 8.5 The AI resource

An owner's access to AI models through the node is a resource that the owner's agents and applications draw on within limits.

- **PACE-14** A principal MUST hold the scope `ai:use` to draw on the owner's AI resource.
- **PACE-15** A node MUST enforce a money budget per owner per day on AI calls it pays for or makes with the owner's key, and MUST refuse a call over the budget with status 402. A node MAY add a budget per application and per agent.
- **PACE-16** A node MUST check a provider against the operator's allowlist before it sends a decrypted provider key, and MUST store provider keys encrypted.
- **PACE-17** A node that claims this part MUST also claim the profile Transparency (§10), because it generates content for its principals.

### 8.6 The payment interface

Core defines what a money payment must state. It does not require a node to take money, and it does not choose a payment system. Whoever runs the node decides whether to charge and is responsible for knowing the customer, invoicing, tax and compliance.

- **PACE-18** A money amount MUST be an integer number of micro-units (one millionth of the currency's major unit) with an ISO 4217 currency code.
- **PACE-19** A node that takes money MUST tie each payment to one checkout session that names the buyer, the seller of record, the items and the amount, and MUST be able to refund it.
- **PACE-20** An agent MUST NOT spend money for its owner unless the owner set a spending limit for that agent. The node MUST refuse a purchase over the limit.
- **PACE-21** A node MUST list the payment bindings it accepts in discovery (§11.6).

**Bindings.** Each binding below is claimed on its own, under the name given.

| Binding | What a client sees |
|---|---|
| `x402` | An unpaid request to a priced operation answers 402 with a body that lists the accepted ways to pay. The node publishes its x402 document at `/.well-known/x402.json`. |
| `stripe` | The node opens a checkout on the seller's own payment account. Money never passes through the operator unless the operator is the seller. |
| `ucp` | The Universal Commerce Protocol checkout, at its dated path. |
| `acp` | The Agentic Commerce Protocol checkout. |
| `invoice` | A checkout settled by invoice. |

---

## 9. Federation (profile Federation)

Federation lets independently run nodes recognise each other's people, exchange messages and, where owners consent, share data. Its most used capability is cross-node identity: a person signs in on a peer with their home credentials and acts there under their own identity. There is no central authority. Each operator chooses peers and what to share with each.

### 9.1 Tiers

A peer stands on one tier. A tier sets the ceiling of what the peer may do.

| Tier | What it may do | How it is reached |
|---|---|---|
| `contact` | direct messages, their read receipts and attachment grants; nothing else; neither node lists the other publicly | an operator's choice, or a link invitation |
| `visiting` | the above, plus catalogue read, directory presence and requesting paid work | signed self-join when the node allows open join, or a link invitation |
| `member` | full peer capability; federated sign-in stays off until turned on | an operator promotes a visiting peer |
| `genesis` | as `member`, marking the anchor relationship between federations | operator configuration |

Each capability is a permission word on the peer record: share catalogue, replicate memory, allow routing, allow messaging, allow broadcast, allow settlement, allow federated sign-in.

- **FED-01** A node MUST check the peer's permission word at every endpoint that serves a peer, before it reads, writes or credits anything, and MUST refuse with status 403 when the word is not granted.
- **FED-02** A node MUST clamp an edit of permission words to the tier's ceiling. An operator MAY always turn a capability off; turning one on above the ceiling MUST require a tier change.
- **FED-03** A change that lowers a peer's tier MUST compare tier ranks, so that it never raises a peer that stands lower.
- **FED-04** A node MUST honour the same permission word when it sends to a peer as when it receives from that peer.

### 9.2 Link invitations

An operator who is provisioning a node can admit it in advance with a link invitation: a single-use token that names a tier, which the new node presents when it introduces itself.

- **FED-05** An invitation MUST name `contact` or `visiting` only. The node MUST read the tier from the stored invitation and never from the introduction.
- **FED-06** The node MUST store the token as a hash, MUST let it expire, and MUST accept it once.
- **FED-07** An unknown, expired, revoked or used token MUST lead to the ordinary pending-approval path, with no answer that tells the caller the token was wrong.

### 9.3 The signed node request

Every message one node sends another is signed with the sender's node key (Ed25519) and carries proof of whom it is for, when it was sent, and that it is new.

A request signed in headers carries the sending node, a timestamp, the audience (the receiving node's id), a one-time value and the signature. The signed bytes are the JSON serialization of `{source_node, timestamp, ...fields, audience, nonce}` in that order, where the fields name what the request is (for example a method, a path and a digest of the body).

A message signed in its body (replication, catalogue synchronisation, a read receipt) carries a delivery proof beside its own signature: the audience, the send time, and a second signature over both.

- **FED-08** A receiving node MUST verify the signature with the key it holds for the sending peer, MUST refuse a message whose audience is not its own node id, MUST refuse a message whose send time is more than five minutes from its clock, and MUST accept each one-time value or delivery proof once. It MUST record a value as used only after the signature verified.
- **FED-09** A node MUST refuse a peer message that carries no audience or delivery proof. (The v4.0 format without this proof is removed in this edition.)
- **FED-10** A request that a node relays on behalf of another MUST carry a relay claim signed by the relaying node, naming the relay, the audience, the method, the path, the original caller, an expiry no more than five minutes after issue and a unique id. The receiver MUST verify it and MUST accept each claim id once.
- **FED-11** Once a peer has sent a message with the proof, the node MUST refuse any later message from that peer without it.
- **FED-12** A node MUST compare protocol versions it receives from peers as versions, and MUST NOT rank a version it cannot parse as lower than its minimum.
- **FED-13** On a node whose security profile is public, every request to a peer MUST use HTTPS, and the node MUST refuse a peer address that is not HTTPS. A node whose security profile is local MAY use plain HTTP, so that development peers can talk to each other.

### 9.4 Peering lifecycle

1. **Introduce.** A node asks to peer, with a request signed by its node key.
2. **Test.** The receiving node checks the requester's discovery document.
3. **Approve.** The receiving node's operator approves, choosing the tier and the permission words.
4. **Activate.** The nodes exchange keys and activate the peer.
5. **Watch.** The nodes exchange signed heartbeats. A peer that misses them becomes degraded and then offline, and returns to active when they resume.
6. **Remove.** An operator removes a peer, with a grace period, or at once in an emergency.

- **FED-14** A node MUST refuse to activate a peer whose key exchange fails, and MUST refuse a later change of a peer's key outside a deliberate re-keying by its operator.
- **FED-15** Removing a peer in an emergency MUST cancel work in flight with it, return any held amounts, and free the peer's node id.

### 9.5 Cross-node identity

A person with an account on node A can sign in on node B, a peer, with the credentials A holds, and act on B under their home identity.

- **FED-16** Node A MUST answer a sign-in check only for an active peer whose tier and permission words allow federated sign-in, only on a signed request (§9.3), and only when the person holds a consent with reach `auth` that names node B. It MUST give one answer for a missing consent, a missing account and a wrong password, and MUST apply the same account lock and second factor as its own sign-in.
- **FED-17** Node B MUST treat the signed-in visitor as a visitor: never as the local account of the same name, never with the owner's scope bypass, and with only the scopes B grants.
- **FED-18** A node MUST authorize a visitor's reads through the same read decision (§5.5) and consent as a local principal's.
- **FED-19** (with profile Agent Keys) A node that accepts a call from an agent of another node MUST verify the agent's signed assertion against the key published in the agent's card on its home node, and MUST accept each assertion once.

### 9.6 Replication

- **FED-20** A node MUST send a record to a peer only when all of these hold: the record's visibility is `public`; the record's owner holds a consent with reach `federation` that matches the key; the peer's permission word for replication is granted; and, when the node claims Classification, the record's level allows it to leave (§5.6).
- **FED-21** Records with visibility `group`, `members` or `workspace` MUST NOT be sent to a peer.
- **FED-22** A replicated record MUST carry a reference to the consent that allowed it. A receiving node SHOULD verify that the reference is signed.

### 9.7 Personal nodes and tunnels (profile Personal Node)

A personal node runs on a person's own machine, often behind a home connection, and reaches the network through a parent node.

- **FED-23** A parent node MUST keep a mailbox of messages addressed to a personal node it serves, and MUST deliver the mailbox when the personal node connects its tunnel.
- **FED-24** A tunnel MUST authenticate as §4.8 requires.

The reference parent node does not forward live requests through the tunnel. A node MAY do so; this edition does not specify the frames.

**Forwarding tunnel (optional).** A node MAY let a principal open one outbound WebSocket and send API calls through it, so that agents on a machine without an open port can act on the node and receive pushes.

- **FED-25** A call that arrives through a forwarding tunnel MUST pass the same authentication, scope checks and envelope as a direct call, under the credential of the principal it names.

**Relay routing (optional).** A node MAY forward work to a node it cannot reach directly, through peers that allow routing. Every forward carries a relay claim (FED-10). The reference node computes the relay shares of a multi-hop settlement but does not pay them.

---

## 10. Provenance and transparency (profile Transparency)

A node that holds or serves content says how the content was made, in a form a second implementation and a third party can read. The record is the same on every carrier.

### 10.1 The record

The record is a JSON document with `spec` set to `aimeat.provenance/v1`.

| Field | Status | Values |
|---|---|---|
| `spec` | required | `aimeat.provenance/v1` |
| `level` | required | `original`, `assisted`, `synthesized`, `ai-generated` |
| `humanInvolvement` | required | `none`, `light-review`, `editorial-control`, `full-human` |
| `generatedAt` | required | RFC 3339 time in UTC |
| `method` | optional | `human`, `rewritten`, `summarized`, `translated`, `transcribed`, `synthesized`, `fully-generated`, `multi-agent` |
| `generator` | optional | principal, model, provider, node id, pipeline, upstream marks |
| `sources`, `derivedFrom` | optional | the inputs |
| `attestation` | optional | who stamped it (`node` or `principal`), whether the node observed the generation, content hash (`sha256:` and 64 hex digits), record URL |
| `disclosure` | computed | the node's decision on whether a label is owed, pre-rendered; never written by a caller |

`level` and `humanInvolvement` are two separate axes, and they are the stored form. Every outside vocabulary (IPTC digital source type, the `ai-disclosure` attribute, the HTTP header) is derived from them.

- **PROV-01** A node MUST publish the record's JSON Schema at `/v1/schemas/ai-provenance/v1.json`.
- **PROV-02** A reader MUST branch on `spec`. A reader MUST read an unknown `spec`, or a missing record, as unstated, and never as written by a person.
- **PROV-03** `humanInvolvement` MUST stay `none` unless a person read the substance and could reject it. A publish action alone MUST NOT raise it.
- **PROV-04** The record MUST keep one spelling, camelCase, on every carrier. The structures around it follow the carrier's own convention.
- **PROV-05** A later version MAY add fields. Removing a field or changing its meaning MUST use a new `spec` value.
- **PROV-06** Records MUST be append-only. A correction is a new record about the new content.
- **PROV-07** A node MUST create a record for every piece of content it generates with AI for a principal. On a node whose security profile is public, configuration MUST NOT turn recording off. Configuration MAY reduce what a public reader is shown. A node whose security profile is local MAY turn recording off.

### 10.2 Carriers

A node serves both an attached mark, which travels with the content, and an addressable record, at its own URL and joined by content hash.

| Carrier | Attached | Addressable |
|---|---|---|
| JSON envelope | `meta.provenance` (never inside `data`) | the record URL inside it |
| HTTP | `AI-Disclosure` header (RFC 9651 structured field) | `Link: <…>; rel="ai-provenance"` |
| HTML | `<meta name="ai-disclosure">`, the `ai-disclosure` attribute, schema.org JSON-LD | `<link rel="ai-provenance">` |
| Markdown | front matter and one human-readable line in the body | the record URL in both |
| MCP | `ai_provenance` on a tool result or a write | the record URL in the block |

- **PROV-08** A node MUST add HTML marks when it serves a document, never to the stored bytes. When a publish receives a copy that carries the node's own marks, the node MUST remove them before it hashes and stores the bytes, and MUST say what it removed.
- **PROV-09** A Markdown document MUST carry the statement in its body as well as in its front matter, because a summary keeps the body and drops the metadata.

### 10.3 Detection

- **PROV-10** A node MUST answer, without authentication and with a rate limit, a lookup of records by the SHA-256 of content. An empty answer MUST mean unstated.
- **PROV-11** A record MUST be readable by an anonymous caller exactly while some publicly readable item points at it, computed when the record is read. A node MUST NOT offer a caller-settable visibility on a record.
- **PROV-12** Where a node serves content in a form that differs from the hashed bytes, it MUST point to the record by id (the `Link` header) so that a reader does not depend on the hash.

### 10.4 Presentation and posture

- **PROV-13** Whether a label is owed MUST be decided once, by the node, and carried in `disclosure`. A surface renders it and does not decide again.
- **PROV-14** A node SHOULD show a visible label to a person reading content that the record says needs one, at first exposure.
- **PROV-15** A node whose security profile is public MUST NOT turn visible labels off.
- **PROV-16** A node MUST publish its transparency posture, the operator's identity, its supervisory authority and its detection endpoints at `/v1/ai-transparency`, and MUST report an unset authority as unstated.

Machine-to-machine traffic (an agent's MCP call, federation, scheduled jobs) is not a conversation with a natural person, so the "you are talking to an AI" disclosure does not apply to it. The record still travels there, because a hop that drops it loses it for good.

---

## 11. Bindings

### 11.1 The HTTP envelope

Every JSON response is an envelope.

```json
{
  "ok": true,
  "protocol": "aimeat",
  "version": "v1",
  "node": "example-node-001",
  "timestamp": "2026-11-01T12:00:00.000Z",
  "request_id": "req-…",
  "data": { },
  "hints": { "next_actions": [ { "description": "…", "method": "GET", "url": "/v1/…" } ] },
  "meta": { "page": 1, "per_page": 50, "total": 120, "provenance": { } }
}
```

An error replaces `data` with `error: { code, message, details? }` and sets `ok` to `false`.

- **HTTP-01** Every JSON response MUST carry `ok`, `protocol` (`aimeat`), `version` (the API path version), `node`, `timestamp` and `request_id`, and exactly one of `data` and `error`.
- **HTTP-02** An error response MUST carry `hints.next_actions` with at least one action the caller can take. A success response SHOULD carry it.
- **HTTP-03** `error.code` MUST be a stable upper-case string. A client branches on the code, never on the message.
- **HTTP-04** `meta.provenance`, when present, MUST be the only place the envelope carries a provenance record (§10.2).

### 11.2 Error codes

These codes are part of Core. A node MAY use others; the reference node's API description lists its own.

| Code | Status | Meaning |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No valid credential. |
| `ACCESS_DENIED` | 403 | The principal may not do this (§5.2, §5.3, §5.5). |
| `SCOPE_DENIED` | 403 | A scope is missing (§5.1). |
| `CLASSIFIED` | 403 | Classification refused it (§5.6). |
| `NOT_FOUND` | 404 | No such resource the caller may see. |
| `VERSION_CONFLICT` | 409 | The record changed since the caller read it (§6.2). |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | A request with the same key is still running (§11.3). |
| `IDEMPOTENCY_RESULT_UNAVAILABLE` | 409 | A request with the same key ran, and its result cannot be replayed. |
| `GONE` | 410 | The operation was removed or switched off; `details` names the successor. |
| `INSUFFICIENT_MORSELS` | 402 | The balance cannot cover a pacing amount (§8.2). |
| `SCHEMA_VALIDATION_FAILED` | 422 | A write did not match the locked schema (§6.6). |
| `INVALID_INPUT` | 400 | The request is not valid, including a name that breaks §3.5. |
| `RATE_LIMITED` | 429 | Too many requests (§11.3). |
| `WS_QUERY_TOKEN_DISABLED` | 401 | A WebSocket upgrade carried a token in its URL (§4.8). |

### 11.3 Idempotency and rate limits

- **HTTP-05** A node SHOULD accept an `Idempotency-Key` header (a UUID) on POST and PUT. When it does, the key MUST be scoped to the principal, the method and the full URL; a duplicate that arrives while the first request runs MUST be refused with 409 `IDEMPOTENCY_IN_PROGRESS`; a completed response MUST be replayed with its original status; and a 401 MUST NOT be retained, so that a client can refresh its credential and retry with the same key. A node SHOULD refuse a reused key with a different body.
- **HTTP-06** A node MUST refuse a request over its rate limit with 429 `RATE_LIMITED` and a `Retry-After` header. A node SHOULD tell a client its remaining allowance in response headers.

### 11.4 The MCP binding (profile MCP)

AI clients reach a node through the Model Context Protocol. The tools a node offers are listed in its tool catalog, which the node serves over MCP and names in its API description. This section fixes how a client finds and calls them.

**Transport and endpoints.**

- **MCP-01** A node MUST serve MCP over the Streamable HTTP transport at `/v1/mcp`, with every tool the principal may use.
- **MCP-02** A node MAY serve named subsets of the tools, called surfaces, at `/v2/mcp/<surface>`. A request to a surface the node does not have MUST be refused with status 400. A node MUST list its surfaces in discovery.
- **MCP-03** An MCP session MUST belong to the principal that opened it. A request on that session by any other principal MUST be refused.
- **MCP-04** A client without a credential MAY list the public tools. Any other call without a credential MUST answer 401 with a `WWW-Authenticate` header that names the protected resource metadata.

**Authorization.**

- **MCP-05** A node MUST publish OAuth 2.0 authorization server metadata (RFC 8414) and protected resource metadata (RFC 9728) for its MCP endpoints.
- **MCP-06** The authorization code flow for MCP clients MUST require PKCE with S256.
- **MCP-07** A token issued for MCP MUST be bound to the MCP resource it was issued for (RFC 8707 resource indicators), and the node MUST refuse a token bound to another resource.
- **MCP-08** A node SHOULD support dynamic client registration (RFC 7591) or client metadata documents, so that a new AI client can connect without an operator.
- **MCP-09** A tool call MUST pass the same principal resolution, scope check (§5.1), read decision (§5.5) and classification check (§5.6) as the HTTP operation that does the same thing.

**Tools.**

- **MCP-10** Every tool name MUST begin with `aimeat_` and use lower-case letters, digits and underscores. A published tool name MUST keep its meaning; a different meaning takes a new name.
- **MCP-11** A tool that is offered on more than one MCP endpoint MUST accept the same parameters on each, and MUST refuse a parameter it does not declare rather than ignore it.
- **MCP-12** A failed tool call SHOULD begin its text with the same error code the HTTP operation would return, followed by a colon.
- **MCP-13** A tool that returns or writes content with a provenance record MUST carry it as `ai_provenance` (§10.2).
- **MCP-14** A node MUST detect a call that loops back to itself through attached MCP servers and refuse it.

### 11.5 Deprecation

- **HTTP-07** Before an HTTP operation or field is removed, a node MUST answer its use with a `Deprecation` header and, where one exists, a `Link` with `rel="successor-version"`, for at least one release. When the operator switches a deprecated operation off before removal, it MUST answer 410 `GONE` naming the successor.
- **HTTP-08** A feature that this edition removes (Appendix B) MUST be refused whatever the node's configuration says. A setting that kept the feature on before its removal MUST have no effect from the release that removes it.

### 11.6 Discovery

- **DISC-01** A node MUST serve `GET /.well-known/aimeat` without authentication, with: `node_id`, `type`, `protocol` (`aimeat`), `version` (the API path version), `software_version`, `protocol_version` (this edition: `2026-11`), `profiles` (the profiles of §0.3 it claims), `public_key` (the node's Ed25519 key), and the addresses of its bootstrap document, its API description and its MCP endpoint. The bootstrap document MUST carry the same `protocol_version` and `profiles` values in its description of the node, and `protocol_versions_accepted` when discovery carries it.
- **DISC-02** A node that accepts messages from peers on an earlier edition MUST list those editions in `protocol_versions_accepted`.
- **DISC-03** A node MUST serve `GET /.well-known/did.json`, a `did:web` document whose id matches the node's host and whose verification method is the node's Ed25519 key.
- **DISC-04** A node that claims MCP MUST serve an MCP server card at `/.well-known/mcp.json` naming its MCP endpoint and stating that OAuth is required.
- **DISC-05** A node that claims Pacing with money MUST name its payment bindings in discovery (§8.6).

---

## 12. Security invariants

These hold on every node, in every profile.

- **SEC-01** A node MUST authorize against the resolved identity of the principal (§3.1), never against an identifier from the request.
- **SEC-02** A node MUST NOT read configuration it trusts from a namespace a principal can write. Keys the node writes for itself in an owner's namespace MUST be refused to applications and to delegated writes, unless the writer holds the exact scope `memory:write-reserved`.
- **SEC-03** Every operation that changes data MUST be gated by a role or a scope.
- **SEC-04** All outbound HTTP that a principal can influence MUST pass a check that refuses private, link-local, carrier-grade and cloud-metadata addresses, MUST check again on every redirect, and MUST drop credentials when a redirect leaves the origin. Loopback MAY be allowed only on a node whose security profile is local.
- **SEC-05** A node MUST verify the Ed25519 signature of every peer message, whatever its configuration (§9.3).
- **SEC-06** Session cookies MUST be host-only: never set with a `Domain` attribute, so that they do not reach the origins of hosted applications.
- **SEC-07** Secrets a node holds for a principal (provider keys, second-factor secrets, payment credentials) MUST be encrypted at rest and MUST NOT be returned after they are stored.
- **SEC-08** Security posture is configuration. A node MUST resolve a security profile, `local` or `public`, and MUST ship every setting whose safe value depends on exposure with the public value as the default.

---

## Appendix A. Conformance checklist

One line per requirement. The profile column says which profile the line belongs to. Lines marked SHOULD carry no MUST and are listed for completeness. The [evidence file](AIMEAT-Core-2026-11-evidence.md) says, for each line, whether the reference node meets it.

| ID | § | Profile | Requirement |
|---|---|---|---|
| ID-01 | 3.1 | Base | Resolve every request to one principal; compare ownership against it |
| ID-02 | 3.1 | Base | An agent exists by the owner's approval, a same-owner agent's approval, or automatic creation for a service the owner uses; the owner sees and can remove every agent; applications only after approval |
| ID-03 | 3.2 | Base | The balance, the agents and the applications belong to the owner |
| ID-04 | 3.4 | Base | Record which application made a write under an app grant |
| ID-05 | 3.5 | Base | Refuse names outside the grammar or on the reserved list, with 400 |
| ID-06 | 3.5 | Base | A GAII parser refuses a value beginning with `eco:` |
| ID-07 | 3.6 | Base | An owner can read every record of the account's agents and ecosystem applications |
| ID-08 | 3.6 | Base | A principal writes only into its own namespace, with the two stated exceptions |
| ID-09 | 3.7 | Base | Deactivation ends sessions, credentials, tokens, grants, enrolments and tunnels before it reports done |
| ID-10 | 3.7 | Base | Removing an agent ends every token it holds at once |
| ID-11 | 3.7 | Base | Deleting an account erases its data and leaves no trace of the name on others' data |
| ID-12 | 3.7 | Base | An owner can export the account's data |
| AUTH-01 | 4.1 | Base | At least one owner sign-in that needs no private key |
| AUTH-02 | 4.1 | Base | Passwords hashed with a memory-hard function |
| AUTH-03 | 4.1 | Base | An armed second factor is required on password and emailed-link sign-in |
| AUTH-04 | 4.1 | Base | Short-lived access token plus a rotated refresh credential; reuse ends the session |
| AUTH-05 | 4.1 | Base | No owner session for an owner-key signature |
| AUTH-06 | 4.1 | Base | Slow or refuse repeated failures; one answer for unknown account and wrong password |
| AUTH-07 | 4.2 | Base | Check session, grant and account validity on every request |
| AUTH-08 | 4.2 | Base | A non-owner never holds more scopes than its record holds now |
| AUTH-09 | 4.3 | Base | The owner in person, or another agent of the same owner within its own scopes, approves a device authorization, within the ceiling; the approver is recorded |
| AUTH-10 | 4.3 | Base | Device codes expire; `authorization_pending` and `slow_down` as RFC 8628 |
| AUTH-11 | 4.3 | Base | Agent renewal checks existence, active owner, a five-minute window and single use, and re-reads scopes |
| AUTH-12 | 4.4 | Base | Pin the ecosystem key; renewals signed by it, five-minute window, single use |
| AUTH-13 | 4.4 | Base | An ecosystem approval ends after a stated period |
| AUTH-14 | 4.4 | Base | No owner bypass for an ecosystem application |
| AUTH-15 | 4.5 | Agent Keys | Enrolment consumes a single-use grant and pins the agent key |
| AUTH-16 | 4.5 | Agent Keys | Tokens for signed assertions: EdDSA, audience, unique id, at most five minutes, single use |
| AUTH-17 | 4.5 | Agent Keys | Publish a node-signed card and a JWKS per agent; a key change needs enrolment |
| AUTH-18 | 4.5 | Agent Keys | No migration without the owner's grant |
| AUTH-19 | 4.6 | Base | App grants require PKCE, single-use codes, allowed scopes only |
| AUTH-20 | 4.6 | Base | An app-grant refresh rotates and never widens |
| AUTH-21 | 4.6 | Base | An app-grant token resolves to the owner, is held to its scopes, never passes §5.2 |
| AUTH-22 | 4.7 | Base | Personal access tokens: explicit scope, stored hashed, listable, revocable, checked on use |
| AUTH-23 | 4.8 | Base | WebSocket upgrades take a header or a single-use, bound, short ticket |
| AUTH-24 | 4.8 | Base | No session token in an upgrade URL |
| AUTH-25 | 4.9 | Base | A delegate never grants a scope it does not hold |
| AUTH-26 | 4.9 | Base | An owner sees, narrows and revokes every agent's and application's scopes |
| AUTHZ-01 | 5.1 | Base | Scope checks on every non-owner data operation; 403 `SCOPE_DENIED` |
| AUTHZ-02 | 5.1 | Base | No owner bypass for agents, ecosystem applications, app grants or visitors |
| AUTHZ-03 | 5.1 | Base | Wildcard coverage rule, with the exact-word exception |
| AUTHZ-04 | 5.1 | Base | The minimum list of words outside the wildcard; publish the list |
| AUTHZ-05 | 5.1 | Base | Publish the scope vocabulary |
| AUTHZ-06 | 5.2 | Base | Reserve the listed account operations to the owner in person; a same-owner agent's approval of an agent is the one exception |
| AUTHZ-07 | 5.2 | Base | Reserved operations refuse apps, ecosystem apps, visitors and agents without `account:security` |
| AUTHZ-08 | 5.3 | Base | At least one operator once there is an owner |
| AUTHZ-09 | 5.3 | Base | Administration admits the operator in person, or a delegate with the exact word |
| AUTHZ-10 | 5.3 | Base | An operator's act on another owner's data is recorded for that owner and notified |
| AUTHZ-18 | 5.4 | Base | Reach is `local`, `federation` or `auth`; default `local`; `private` and `dmz` accepted and answered as `local` |
| AUTHZ-11 | 5.4 | Base | Only the grantor revokes a consent |
| AUTHZ-12 | 5.4 | Base | An expired or revoked consent authorizes nothing |
| AUTHZ-13 | 5.4 | Base | Audit consent grants, revocations and refusals for at least 90 days |
| AUTHZ-14 | 5.4 | Base | Granting consent needs the owner in person or `consent:manage` |
| AUTHZ-15 | 5.5 | Base | A read is allowed only under one of nine stated conditions |
| AUTHZ-16 | 5.5 | Base | A refused read does not reveal existence |
| AUTHZ-17 | 5.5 | Base | SHOULD: audit every refused request |
| CLS-01 | 5.6 | Classification | Apply classification at show, use for AI and leave |
| CLS-02 | 5.6 | Classification | Content that may not leave stays, unless an exception is recorded (a person's, with a reason, or an application's within its declared purpose); audit it |
| CLS-03 | 5.6 | Classification | An AI sees what its reader may see, and no more |
| CLS-04 | 5.6 | Classification | Refusals use 403 `CLASSIFIED` |
| CLS-05 | 5.6 | Classification | Owner and organism levels only tighten |
| CLS-06 | 5.6 | Classification | Loosening waits for a person; the owner is always in the audience |
| CLS-07 | 5.6 | Classification | Audit every refusal and every change |
| CLS-08 | 5.6 | Classification | A file shared into an organism falls under its classification |
| DATA-01 | 6.1 | Base | Keys unique per namespace |
| DATA-02 | 6.1 | Base | Only the owning principal and its owner change a record, except §7 rules |
| DATA-03 | 6.2 | Base | Every write increases the version by one |
| DATA-04 | 6.2 | Base | An update carries the read version; conflict is 409 `VERSION_CONFLICT` |
| DATA-05 | 6.2 | Base | Compare and write in one atomic step |
| DATA-06 | 6.3 | Base | Accept all six visibility values on records and files, with their bindings |
| DATA-07 | 6.3 | Base | `group`, `members`, `workspace` never leave the node |
| DATA-08 | 6.4 | Base | Row filters by time and declared index fields only |
| DATA-09 | 6.4 | Base | Row deletion needs `memory:purge` and says it is final |
| DATA-10 | 6.4 | Base | Row retention measured from ingestion |
| DATA-11 | 6.5 | Base | Single and chunked uploads; 413 `QUOTA_EXCEEDED` over a limit |
| DATA-12 | 6.5 | Base | Single byte ranges (206, 416) |
| DATA-13 | 6.5 | Base | Public files readable without authentication; others pass the read decision |
| DATA-14 | 6.6 | Base | A write against a locked schema fails with 422 and the violations |
| DATA-15 | 6.6 | Base | Only the locker or the operator changes a lock |
| DATA-16 | 6.7 | Base | Serve every named specification at `/v1/specs/{name}` |
| DATA-17 | 6.7 | Base | Readers branch on `spec`; unknown means untyped |
| DATA-18 | 6.7 | Base | A specification change of meaning needs a new address |
| DATA-19 | 6.8 | Base | An expired record is never returned; time to live runs from creation |
| DATA-20 | 6.8 | Base | A delete leaves every read, list and search at once |
| DATA-21 | 6.8 | Base | A deleted record is restorable for a stated period, named in the response |
| DATA-22 | 6.8 | Base | After the period the record is destroyed |
| DATA-23 | 6.8 | Base | No ordinary delete in an append-only space |
| DATA-24 | 6.8 | Base | Archived items are out of lists and search unless asked for, and readable by key |
| DATA-25 | 6.8 | Base | Unarchive restores with the parent, not what was archived on its own |
| DATA-26 | 6.9 | Base | State quotas; 413 `QUOTA_EXCEEDED` over one |
| DATA-27 | 6.9 | Base | Search applies read, classification, deletion and archive rules |
| DATA-28 | 6.9 | Base | Private and owner changes are announced to the owner's connections only |
| COL-01 | 7.1 | Collaboration | Membership belongs to an owner |
| COL-02 | 7.1 | Collaboration | At least one creator or admin; join, ask, invite |
| COL-03 | 7.1 | Collaboration | Agent restriction only subtracts; only a person widens it |
| COL-04 | 7.1 | Collaboration | Organism content stays attributed to its writer |
| COL-05 | 7.1 | Collaboration | An organism export carries no member list |
| COL-06 | 7.2 | Collaboration | Draft, publish, versions kept to a stated number |
| COL-07 | 7.2 | Collaboration | Publish with a stale expected version is 409 |
| COL-08 | 7.2 | Collaboration | Append-only spaces refuse overwrite and delete and keep every version |
| COL-09 | 7.2 | Collaboration | Workspace grants are viewer or contributor, cover the owner's agents, granted by the stated roles |
| COL-10 | 7.2 | Collaboration | Comments inherit the read gate of what they are anchored to |
| COL-11 | 7.2 | Collaboration | Record spaces check locked schemas |
| COL-12 | 7.3 | Collaboration | Public and system boards readable without authentication |
| COL-13 | 7.3 | Collaboration | Notices expire; replies with their parent |
| COL-14 | 7.3 | Collaboration | One reaction per owner and kind |
| COL-15 | 7.3 | Collaboration | Posts over the flag threshold are hidden except from author and board owner |
| COL-16 | 7.3 | Collaboration | Subscriptions push through the outbound check; SHOULD sign |
| COL-17 | 7.3 | Collaboration | No pacing on private and shared boards |
| COL-18 | 7.4 | Collaboration | First messages wait for acceptance; blocking stops delivery |
| COL-19 | 7.4 | Collaboration | Cross-node messages only to peers allowing messaging, signed, queued and retried |
| COL-20 | 7.4 | Collaboration | Read receipts only to participants |
| PACE-01 | 8.1 | Pacing | One balance per owner; agents and apps resolve to it |
| PACE-02 | 8.1 | Pacing | Morsels accrue over time up to a cap |
| PACE-03 | 8.1 | Pacing | Debits atomic, never below zero |
| PACE-04 | 8.1 | Pacing | Every balance change recorded with reason, principal and counterparty |
| PACE-05 | 8.1 | Pacing | No morsel amount in a money field; no binding accepts morsels |
| PACE-06 | 8.1 | Pacing | Sold pacing capacity stays within the daily limit on new morsels |
| PACE-07 | 8.2 | Pacing | Money price and pacing amount are separate fields |
| PACE-08 | 8.2 | Pacing | Provider sets the pacing amount; node default and ceiling apply |
| PACE-09 | 8.2 | Pacing | Debit, burn a stated share, credit the provider (an operator share allowed), in one transaction before money; reverse on refund |
| PACE-10 | 8.2 | Pacing | 402 `INSUFFICIENT_MORSELS` saying how to regain morsels |
| PACE-11 | 8.2 | Pacing | A pacing amount is never called or collected as a price |
| PACE-12 | 8.4 | Pacing | Record every AI call with principal, model, amount and estimated cost |
| PACE-13 | 8.4 | Pacing | No conversion between ledger and morsels |
| PACE-14 | 8.5 | Pacing | `ai:use` to draw on the AI resource |
| PACE-15 | 8.5 | Pacing | Daily money budget per owner; 402 over it |
| PACE-16 | 8.5 | Pacing | Provider allowlist before a key is sent; keys encrypted |
| PACE-17 | 8.5 | Pacing | The AI resource requires the profile Transparency |
| PACE-18 | 8.6 | Pacing | Money in integer micro-units with ISO 4217 code |
| PACE-19 | 8.6 | Pacing | Each payment tied to one checkout session; refundable |
| PACE-20 | 8.6 | Pacing | No agent spending without an owner-set limit |
| PACE-21 | 8.6 | Pacing | List accepted payment bindings in discovery |
| FED-01 | 9.1 | Federation | Check the permission word at every peer endpoint before acting |
| FED-02 | 9.1 | Federation | Clamp permission edits to the tier ceiling |
| FED-03 | 9.1 | Federation | Demotion compares rank |
| FED-04 | 9.1 | Federation | Outbound honours the same word |
| FED-05 | 9.2 | Federation | Invitations name contact or visiting; tier read from the stored invitation |
| FED-06 | 9.2 | Federation | Invitation tokens hashed, expiring, single use |
| FED-07 | 9.2 | Federation | A bad token falls through to pending approval, silently |
| FED-08 | 9.3 | Federation | Verify signature, audience, five-minute window, single use after verification |
| FED-09 | 9.3 | Federation | Refuse a peer message without audience or delivery proof |
| FED-10 | 9.3 | Federation | Relayed requests carry a verified, single-use, short relay claim |
| FED-11 | 9.3 | Federation | A peer that sent the proof once is held to it |
| FED-12 | 9.3 | Federation | Compare protocol versions as versions; unknown is never lower |
| FED-13 | 9.3 | Federation | HTTPS to peers on a public node; plain HTTP allowed on a local node |
| FED-14 | 9.4 | Federation | No activation without key exchange; no silent key change |
| FED-15 | 9.4 | Federation | Emergency removal cancels work, returns holds, frees the node id |
| FED-16 | 9.5 | Federation | Federated sign-in only for an allowed peer, signed, with `auth` consent, uniform answer, same lock and factor |
| FED-17 | 9.5 | Federation | A visitor is never the local namesake and never gets the owner bypass |
| FED-18 | 9.5 | Federation | Visitors' reads use the same read decision |
| FED-19 | 9.5 | Federation + Agent Keys | Verify a foreign agent's assertion against its home card; single use |
| FED-20 | 9.6 | Federation | Replicate only public, federation-consented, permitted and classification-cleared records |
| FED-21 | 9.6 | Federation | Never replicate `group`, `members`, `workspace` |
| FED-22 | 9.6 | Federation | A replicated record carries its consent reference; SHOULD verify |
| FED-23 | 9.7 | Personal Node | Parent keeps and delivers the mailbox on connect |
| FED-24 | 9.7 | Personal Node | Tunnels authenticate as §4.8 |
| FED-25 | 9.7 | Personal Node | Calls through a forwarding tunnel pass the same checks as direct calls |
| PROV-01 | 10.1 | Transparency | Publish the record schema at its versioned URL |
| PROV-02 | 10.1 | Transparency | Readers branch on `spec`; unknown or missing means unstated |
| PROV-03 | 10.1 | Transparency | `humanInvolvement` above `none` only after a person read and could reject |
| PROV-04 | 10.1 | Transparency | One camelCase spelling on every carrier |
| PROV-05 | 10.1 | Transparency | Removal or change of meaning needs a new `spec` |
| PROV-06 | 10.1 | Transparency | Records are append-only |
| PROV-07 | 10.1 | Transparency | A record for all AI-generated content; a public node cannot turn recording off |
| PROV-08 | 10.2 | Transparency | HTML marks at serve time; a publish strips the node's marks before hashing |
| PROV-09 | 10.2 | Transparency | Markdown carries the statement in the body |
| PROV-10 | 10.3 | Transparency | Anonymous, rate-limited lookup by content hash; empty means unstated |
| PROV-11 | 10.3 | Transparency | Visibility of a record derived from what points at it; no settable flag |
| PROV-12 | 10.3 | Transparency | Point to the record by id where served bytes differ from hashed bytes |
| PROV-13 | 10.4 | Transparency | Label decision made once by the node, in `disclosure` |
| PROV-14 | 10.4 | Transparency | SHOULD: visible label at first exposure |
| PROV-15 | 10.4 | Transparency | A public node does not turn labels off |
| PROV-16 | 10.4 | Transparency | Publish posture, operator, authority and endpoints at `/v1/ai-transparency` |
| HTTP-01 | 11.1 | Base | Every JSON response carries the envelope fields |
| HTTP-02 | 11.1 | Base | Errors carry at least one next action |
| HTTP-03 | 11.1 | Base | Stable upper-case error codes |
| HTTP-04 | 11.1 | Base | `meta.provenance` is the only provenance carrier in the envelope |
| HTTP-05 | 11.3 | Base | SHOULD accept `Idempotency-Key`; when it does, the stated semantics |
| HTTP-06 | 11.3 | Base | 429 `RATE_LIMITED` with `Retry-After` |
| HTTP-07 | 11.5 | Base | Deprecation headers for a release before removal; 410 `GONE` when switched off |
| HTTP-08 | 11.5 | Base | A removed feature is refused whatever the configuration says |
| MCP-01 | 11.4 | MCP | Streamable HTTP at `/v1/mcp` with every permitted tool |
| MCP-02 | 11.4 | MCP | Surfaces at `/v2/mcp/<surface>`; unknown is 400; listed in discovery |
| MCP-03 | 11.4 | MCP | An MCP session belongs to the principal that opened it |
| MCP-04 | 11.4 | MCP | Unauthenticated calls other than the public list answer 401 with resource metadata |
| MCP-05 | 11.4 | MCP | RFC 8414 and RFC 9728 metadata |
| MCP-06 | 11.4 | MCP | PKCE with S256 required |
| MCP-07 | 11.4 | MCP | Tokens bound to the MCP resource (RFC 8707) |
| MCP-08 | 11.4 | MCP | SHOULD: dynamic client registration or client metadata documents |
| MCP-09 | 11.4 | MCP | A tool passes the same checks as the matching HTTP operation |
| MCP-10 | 11.4 | MCP | Tool names begin `aimeat_`; a name keeps its meaning |
| MCP-11 | 11.4 | MCP | Same parameters on every endpoint; undeclared parameters refused |
| MCP-12 | 11.4 | MCP | SHOULD: failure text begins with the HTTP error code |
| MCP-13 | 11.4 | MCP | Provenance on tool results as `ai_provenance` |
| MCP-14 | 11.4 | MCP | Detect and refuse MCP loops |
| DISC-01 | 11.6 | Base | `/.well-known/aimeat` with the listed fields, including `protocol_version` and `profiles`; the bootstrap document repeats them |
| DISC-02 | 11.6 | Base | List accepted earlier editions |
| DISC-03 | 11.6 | Base | `/.well-known/did.json` matching the host, with the node key |
| DISC-04 | 11.6 | MCP | An MCP server card at `/.well-known/mcp.json` |
| DISC-05 | 11.6 | Pacing | Payment bindings in discovery |
| SEC-01 | 12 | Base | Authorize against the resolved identity |
| SEC-02 | 12 | Base | No trusted configuration in principal-writable keys; reserved keys need the exact word |
| SEC-03 | 12 | Base | Every change gated by a role or a scope |
| SEC-04 | 12 | Base | Outbound check against private ranges, on every redirect, credentials dropped across origins |
| SEC-05 | 12 | Base | Verify every peer signature |
| SEC-06 | 12 | Base | Host-only session cookies |
| SEC-07 | 12 | Base | Principals' secrets encrypted at rest and never returned |
| SEC-08 | 12 | Base | A resolved security profile; public values as defaults |

Totals: 209 lines. 205 carry at least one MUST or MUST NOT; 4 are SHOULD only (AUTHZ-17, PROV-14, MCP-08, MCP-12).

---

## Appendix B. Deprecations and removals

**Removed in this edition**, with the reference node release that removes them. From that release a node refuses each of them whatever its configuration says (HTTP-08).

| What | v4.0 status | Default changed in | Removed in | How the reference node signals it today |
|---|---|---|---|---|
| Owner-key sign-in (owner signs a challenge with an Ed25519 key) | deprecated | node 3.x: can be switched off; refused when a second factor is armed | node 4.0.0 | 410 `OWNER_KEY_LOGIN_OFF` when switched off; a usage counter |
| Session token in a WebSocket upgrade URL (`?token=`) | current | node 3.x: can be switched off | node 4.0.0 | 401 `WS_QUERY_TOKEN_DISABLED` when switched off; a usage counter |
| Peer messages without audience and delivery proof | the only format | refused by default from node 3.27.0 | node 4.0.0 | a refusal that names both releases |
| An optional relay claim on relayed requests | not specified | required by default from node 3.20.0 | node 4.0.0 (the `optional` setting) | per-peer setting, readable by the operator |
| Morsel price fields on offers, apps, app tools, extension actions and marketplace listings | the pacing amount was called a price | accepted as the pacing amount and mirrored with a `deprecated` note | node 4.0.0 | `MORSEL_PRICE_REMOVED` from 4.0.0 |

**Deprecated in this edition**, still accepted.

| What | Status | Default changed in | How the reference node signals it |
|---|---|---|---|
| Consent reach values `private` and `dmz` | accepted as other names for `local` through the 4.x releases of the reference node; a later edition removes them | node 4.0.0: a consent made without a reach is `local`, not `federation` | the node stores and answers `local` (AUTHZ-18) |
| A knowledge package's `sharing.morsel_price` and a capability's `cost.morsels`, the old names of `toll_morsels` (PACE-11) | accepted through the 4.x releases of the reference node; refused from node 5.0.0 | node 4.0.0: the node stores and answers `toll_morsels` | `Deprecation` and `X-AIMEAT-Removed-In: 5.0.0` headers and a usage counter; 400 `TOLL_MORSELS_MISMATCH` when the two names disagree |

**Removed earlier**, listed so that a v4.0 reader finds them.

| What | Removed in |
|---|---|
| One-time keys in URLs (Tier 0.5) and the micro-memory store | node 3.6.0 |

**Removed in node 4.0.0 but outside Core**: the legacy AI settings routes (they answer 410 `GONE`), static TURN credentials, and a workflow cost cap stated in morsels.

---

## Appendix C. From v4.0 sections to this edition

| v4.0 Core | This edition |
|---|---|
| §0 About v4.0 | §0.4 |
| §0.2 Honesty ledger | dropped; the evidence file and the feature list carry status |
| §1.1 to §1.3 | §1 |
| §1.4 Thin core, living surface | §1.2 (principles); the shared living surface goes to the Platform reference |
| §1.6 Scope | §1.4 and §0.3 |
| §2 Terminology | §2 |
| §3.1 Layers | §0.3 (profiles) |
| §3.2 Node types | `type` in discovery (§11.6); personal nodes §9.7; relay and mirror types not specified |
| §3.3 API versioning | §0.2 |
| §4 Principals | §3 |
| §5 Cryptographic identity | §4.5, §9.3, §12 |
| §6.1 Owner authentication | §4.1 |
| §6.2 Device authorization | §4.3 |
| §6.3 Ecosystem authentication | §4.4 |
| §6.4 JWT | §4.2 (tokens are opaque) |
| §6.5 Personal access tokens | §4.7 |
| §7 Roles and scopes | §5.1 to §5.3 |
| §8 Identity assurance | Platform reference; may return as an optional profile |
| §9 Deprecated auth paths | Appendix B |
| §10 Memory | §6.1 to §6.3, §6.8, §6.9 |
| §11 Binary storage | §6.5 |
| §12 Schema locking | §6.6 |
| §13 Micro-memory | Appendix B |
| §14 Consent | §5.4 |
| §15 Access guard | §5.5 |
| §16 IAM model | §5.5, informative |
| §17 Scoped delegation | §4.6, §4.9 |
| §18 Organisms | §7.1 |
| §19 Workspaces | §7.2 |
| §20 Knowledge and links | Platform reference |
| §21 Morsel economy | §8.1 |
| §22 Actions, offers, work | §8.2 (offers); actions, work queue and tasks go to the Platform reference |
| §23 Disputes | Platform reference |
| §24 Trust scoring, §24.1 capability verification | Platform reference |
| §25 Metering ledger | §8.4 |
| §26 Metered AI resource | §8.5 |
| §27 Boards | §7.3 |
| §28 Direct messages | §7.4 |
| §29 Catalogue, directory, discover | Platform reference |
| §29.1 Moderation | §7.3 (COL-15); appeals go to the Platform reference |
| §30 Service manifests | Platform reference |
| §31 Federation overview | §9 introduction |
| §32 Peering lifecycle | §9.4 |
| §32.1 Trust tiers | §9.1 |
| §32.2 Link invitations | §9.2 |
| §33 Cross-node identity | §9.3, §9.5 |
| §34 Heartbeat, sync, replication | §9.4, §9.6 |
| §35 Personal nodes, connector tunnel | §9.7 |
| §36 Genesis, relay, trust broadcasts | genesis as a tier (§9.1); relay routing §9.7; trust broadcasts dropped |
| §37 Envelope | §11.1 |
| §38 Observability | Platform reference |
| §39 Rate limiting, idempotency, CORS | §11.3; host-only cookies §12; CORS inheritance to the Platform reference |
| §40 Security posture | §12 |
| §41 Well-known discovery | §11.6 |
| §42 GDPR and portability | §3.7 |
| Appendix A Status matrix | replaced by Appendix A checklist and the evidence file |
| Appendix B Configuration | configuration reference |
| Appendix C Error codes | §11.2 |

| v4.0 Platform | This edition |
|---|---|
| §1.2 App grants | §4.6 |
| §1.3 Origin isolation | §12 (SEC-06); the rest to the Platform reference |
| §2 preamble, Agent v2 | §4.5, §9.5 (FED-19) |
| §3.3 Metered AI proxy | §8.5 |
| §3.6 AI provenance and transparency | §10 |
| §5 Ecosystem | §4.4 |
| §8 Business and payments | §8.6 |
| everything else | Platform reference |

---

*AIMEAT Core 2026-11. Normative since node 4.0.0. Canonical API contract: `openapi.yaml`. Tool catalog: the node's MCP tool catalog. Conformance evidence: [AIMEAT-Core-2026-11-evidence.md](AIMEAT-Core-2026-11-evidence.md).*
