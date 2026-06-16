# User-to-User Messaging (GHII↔GHII) — Build Plan

**Date:** 2026-06-16
**Status:** Plan — not yet built
**Source idea:** `jounisideas.log` (2026-06-16)
**Scope decided:** Full feature in one go (local + federation + attachments)

---

## 1. What this is

Direct **human-to-human** messaging between AIMEAT owners, addressed by **full GHII**
(`owner@node-id`), working both **same-node** and **across federation**, with:

- A per-user **INBOX** (list inbound, unread count, mark read).
- **Conversations / threads** (reply to a message, federation replies included).
- **Notifications** on arrival (in-app bell + optional web push).
- **Media** (images, audio, video, binaries) carried as **storage objects** — referenced from
  the origin node, or **duplicated to the destination** when the destination is not a permanent
  node (private/local). Text is the message body; media are attachments.

### What it is NOT (avoid duplication)

| Existing system | Identity | Why this feature is distinct |
|---|---|---|
| `agent-messages.ts` (`aimeat_message_*` MCP tools) | keyed by `agentGaii` | agent↔owner conversation; not human↔human. |
| `boards.ts` | board-scoped | public/social discussion, not private 1:1 DMs. |
| `chat-instances.ts` | session records | multi-platform LLM session orchestration, no inter-user messages. |

→ This is a **new namespace**: human↔human DMs. It reuses transport (federation), notifications,
and storage, but gets its own record type, routes, and UI. **Do not bolt it onto agent-messages
or boards.**

---

## 2. Identity & addressing

- **Recipient** is always a human **GHII** (`owner@node-id`) — never a bare owner name. The DM
  inbox belongs to humans.
- **Sender** may be (DECISION #8 — agents & ecosystem apps may message humans):
  - a human **GHII** (`owner@node-id`) — owner session, resolved with `resolveIdentity(...)`;
  - an **agent GAII** (`agent#owner@node-id`) — agent session, requires scope `messages:send`;
  - an **ecosystem app GEAI** (`eco:{app}#{owner}@{node}`) — ecosystem token, same scope.
  The sender identity is stored verbatim in `senderGhii` (the field name stays for simplicity but
  holds whichever identity sent it). The UI labels non-human senders distinctly (🤖 agent / 🧩 app).
  - **Boundary vs. existing agent channel:** an agent messaging **its own owner** continues to use
    `agent-messages.ts`. This DM inbox is for **cross-party** delivery (agent/app → *a* human,
    possibly on another node, not necessarily its owner). Note in implementation so the two don't
    overlap confusingly.
  - First-contact consent (§9) applies to agent/app senders too — and matters more there (spam
    control). The user's **own** agents/apps auto-accept; external ones go through the request gate.
- Recipient is the full GHII string supplied by the sender. Routing target node is resolved with
  `resolveGaii(recipientGhii, config, storage, peers)` from `src/services/federation.ts`:
  - `local: true` → deliver into local inbox directly.
  - `local: false` → federation delivery to `peer.url` (see §6).
  - `null` (unresolvable) → 404 `RECIPIENT_NOT_FOUND` (message not created, or created with
    `status: 'undeliverable'` — see §5 status model).

**Note:** `resolveGaii` currently resolves by `getAgent(gaii)` and node-hint. For GHII we also need
a human-presence check on the target node. The receiving node validates the recipient exists on
**its** side (it owns the GHII record); the sender side only needs to find the **node**, which the
`@node-id` suffix already provides. So sender-side resolution = parse node suffix → find active peer
→ POST; if no peer matches the suffix, it's undeliverable. No change to `resolveGaii` required for
the common case; we add a thin `resolveNodeForGhii()` helper that reuses the peer-by-suffix logic.

---

## 3. Data model

New record (in `src/storage/interface.ts`), mirroring the shape/conventions of
`AgentMessageRecord`:

```ts
export interface DirectMessageRecord {
  id: string;                 // uuid
  conversationId: string;     // stable per (sorted pair of GHIIs); groups a thread
  senderGhii: string;         // owner@node
  recipientGhii: string;      // owner@node
  body: string;               // text content (may be empty if attachment-only)
  attachments?: DirectMessageAttachment[];
  // Delivery lifecycle (mirrors agent-message status semantics):
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable';
  direction: 'inbound' | 'outbound';   // relative to the row's owner copy (see storage model)
  replyToId?: string;         // message this is a reply to (same conversationId)
  origin: 'local' | 'federation';
  originNodeId: string;       // node that created the message
  error?: string;             // last delivery error, if failed
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface DirectMessageAttachment {
  storageKey: string;         // key in the storage-files system
  ownerGhii: string;          // who owns the storage object (origin owner)
  originNodeId: string;       // node hosting the original bytes
  mode: 'reference' | 'duplicate';  // see §7. duplicate = the norm; reference = transient,
                                    // pending-request only (bytes pulled on accept)
  // when mode === 'duplicate', the recipient node re-hosts under recipient's storage:
  localKey?: string;          // recipient-side storage key (set after duplication)
  mime: string;
  size: number;
  name?: string;              // original filename / caption
  kind: 'image' | 'audio' | 'video' | 'file';
}
```

### Storage model: two copies (sender + recipient)

To make both sides' inboxes/sent-views queryable without cross-node reads, **each side stores its
own row** of the conversation (classic mailbox model):

- Sender node stores a row with `direction: 'outbound'`, owner = sender.
- Recipient node stores a row with `direction: 'inbound'`, owner = recipient.
- Same `id` and `conversationId` on both sides (id generated by sender, carried in the federation
  payload) so read-receipts and replies correlate.

`conversationId` = deterministic hash of the sorted GHII pair (`sha256(min,max)` → short id) so
both nodes derive the same conversation without coordination.

Rows are keyed/owned by GHII via the existing owner-scoped storage path, exactly like
`AgentMessageRecord` is keyed by `agentGaii`.

### Contact / consent record (DECISION #1 — first-contact gate)

```ts
export interface ContactConsentRecord {
  ownerGhii: string;          // the human who owns this contact list (recipient side)
  contactId: string;          // the OTHER party: GHII | GAII | GEAI
  state: 'pending' | 'accepted' | 'blocked';
  firstMessageId?: string;    // the request message that opened the relationship
  createdAt: string;
  updatedAt: string;
}
```

- Stored under the recipient's namespace, keyed by `contactId`.
- Send/receive paths consult it: no record → create `pending` (request); `accepted` → flow freely;
  `blocked` → reject.
- Auto-seed `accepted` for the owner's **own** agents/apps (same owner component in the identity).
- `state` is per-pair and bidirectional once `accepted` (either side accepting opens both directions
  for that pair — implementation note: acceptance is recorded on the accepting side; the first
  outbound reply implicitly carries acceptance to the peer node, or a small `accepted` signal is
  federated alongside the receipt).

---

## 4. Storage layer changes

Follow `docs/coding-guidelines/storage-sync.md` (all backends updated together). Mirror how
`agent-message.repository.ts` + `providers/sqlite/repos/agent-message.ts` +
`providers/mongodb/index.ts` implement agent messages.

1. `src/storage/interface.ts` — add `DirectMessageRecord`, `DirectMessageAttachment`, and methods:
   - `createDirectMessage(rec)`
   - `getDirectMessage(id, ownerGhii)`
   - `listInbox(ownerGhii, { unreadOnly?, page, perPage })`
   - `listConversation(ownerGhii, conversationId, { page, perPage })`
   - `listConversations(ownerGhii)` (thread list w/ last message + unread count)
   - `markMessageRead(id, ownerGhii)` / `markConversationRead(...)`
   - `updateMessageDeliveryStatus(id, status, { deliveredAt?, error? })`
   - `markMessageRead` already above; add `setMessageReadReceipt(id, readAt)` for the federated receipt path
   - `deleteDirectMessage(id, ownerGhii)`
   - **Contact consent:** `getContact(ownerGhii, contactId)`, `setContactState(ownerGhii, contactId, state, firstMessageId?)`, `listContacts(ownerGhii, { state? })`
2. `src/storage/repositories/direct-message.repository.ts` — shared repo (if the codebase routes
   through repository classes; agent messages do).
3. `src/storage/providers/sqlite/repos/direct-message.ts` — SQLite table + queries.
4. `src/storage/providers/mongodb/index.ts` — Mongo collection + Prisma model.
5. **Prisma:** add `DirectMessage` model to `schema.prisma`. **Do not** bump the pinned Prisma
   version (see memory: prisma stays 6.19.2). Run the project's generate step.
6. SQLite migration / table creation in the schema bootstrap used by the sqlite provider.

Index on `(ownerGhii, createdAt)`, `(ownerGhii, conversationId, createdAt)`, and
`(ownerGhii, status)` for inbox/unread queries.

---

## 5. REST API (new router `src/routes/messages.ts`)

All responses use `success()`/`error()` envelope with hints. `requireAuth()` + owner role.
Static routes before parameterized ones.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/messages` | Send a message (`{ to, body, attachments?, reply_to? }`). Creates outbound row, resolves node, delivers (local or federation). |
| `GET` | `/v1/messages/inbox` | List inbound messages, `?unread=true`, paginated; includes unread count. |
| `GET` | `/v1/messages/conversations` | Thread list: one entry per `conversationId` with peer GHII, last message preview, unread count. |
| `GET` | `/v1/messages/conversations/:conversationId` | Full thread (both directions), paginated. |
| `POST` | `/v1/messages/conversations/:conversationId/read` | Mark whole thread read (fires receipt — §8). |
| `PATCH` | `/v1/messages/:id/read` | Mark one message read (fires a read-receipt back to sender node — §8). |
| `DELETE` | `/v1/messages/:id` | Delete the caller's copy. |
| `GET` | `/v1/messages/requests` | List pending first-contact requests (§9). |
| `POST` | `/v1/messages/requests/:contactId/accept` | Accept a contact → `accepted`; pending messages join the thread. |
| `POST` | `/v1/messages/contacts/:contactId/block` | Block a contact (after request **or** proactive hard block) → `blocked`. |
| `GET` | `/v1/messages/contacts` | List contacts and their states (manage/unblock). |

Sender auth: owner (GHII), agent (GAII, scope `messages:send`), or ecosystem (GEAI, scope
`messages:send`) — DECISION #8. Validation via a new `src/models/message-schemas.ts` (Zod),
mirroring `agent-message-schemas.ts`.

### Federation receive endpoint (in `src/routes/federation-sync.ts`, alongside `/v1/federation/replicate`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/federation/message` | Receive a message from a peer node. Verify peer signature, validate recipient exists locally, store inbound row, fire `notify()`. |
| `POST` | `/v1/federation/message/receipt` | (optional) Receive delivery/read receipt; update sender-side row status. |

---

## 6. Federation delivery protocol

Reuse the exact signing/verification pattern already used by `/v1/federation/replicate`:

**Outbound (sender node):**
1. Build canonical payload: `{ source_node, message: {id, conversationId, senderGhii, recipientGhii, body, attachments, replyToId, createdAt}, timestamp }`.
2. `signature = await sign(nodeKey.privateKey, JSON.stringify(payload))` (node Ed25519 key via `storage.getNodeKey()`).
3. `POST ${peer.url}/v1/federation/message` with `{ ...payload, signature }` and `x-source-node` header, `AbortSignal.timeout(config.federationTimeoutMs)`.
4. On `2xx` → set outbound row `status: 'delivered'`, `deliveredAt`. On failure → `status: 'failed'`, store `error`, enqueue retry (see retry below).

**Inbound (recipient node):** mirror `/v1/federation/replicate` verification exactly —
1. Look up peer by `source_node`; if no peer or no `publicKey` on file → `403`.
2. `verify(peer.publicKey, payload, signature)`; invalid → `401`.
3. Validate `recipientGhii` is a local GHII (owner exists on this node); else `404`.
4. Store inbound `DirectMessageRecord` (`origin: 'federation'`).
5. Handle attachments per §7 (duplicate now, or keep reference).
6. `notify(storage, recipientGhii, { type: 'direct_message', title, body, link })`.
7. Return `success`.

**Retry / durability (DECISION #6 — resolved):** failed federation sends go to a retry queue swept
by a periodic background job. Policy is **configurable** with these defaults:
- `messageRetryIntervalMs` — **60s** (try roughly once per minute).
- `messageRetryTtlHours` — **168h (7 days)**, after which the row flips to `undeliverable`.
- A send is only **attempted when the target peer is reachable** (status `active`/`degraded`); if the
  peer is `offline`/`unreachable` the row stays `queued` and the elapsed time does **not** count as a
  failed attempt — only reachable-but-failed attempts and the 7-day wall-clock TTL retire it.
- Add both config keys to `config.ts`, `.env.example`, the init wizard, and env-config display
  (per Init Wizard Maintenance checklist in CLAUDE.md).

**Consent / first-contact gate (DECISION #1 — resolved):** see §9. The receive endpoint checks the
per-pair contact state: `blocked` → reject `403 BLOCKED` (sender row → `undeliverable`); no prior
relationship → store as a **pending request** (notify recipient, do not surface as a normal inbox
thread until accepted); `accepted` → normal delivery.

---

## 7. Attachments (media as storage)

Media are **not** inlined in the message; they're storage objects referenced by the message.
This reuses `storage-files.ts` (presigned upload + presigned download tokens, Range/streaming).

**Send side:**
- Sender uploads each attachment via the existing presigned upload flow (out-of-band, never
  through the model/context), getting a `storageKey` under the sender's GHII.
- The message carries an `attachments[]` descriptor (key, owner, originNode, mime, size, kind).

**Receive side — always duplicate (DECISION #3 — resolved; supersedes the earlier permanence rule):**
The recipient **always** gets their own copy of every attachment, regardless of node type. Rationale:
once a message is accepted it is genuinely co-owned by the recipient — their copy must not break if
the origin goes offline or the sender deletes their side. DM is 1:1 so the cost ceiling is just 2
copies. This drops the node-permanence signal entirely (no longer needed) and is simpler at runtime
(no lazy per-open fetch, no repeated token re-granting, no broken media when origin is down).
- `mode: 'duplicate'` (**the norm**): at receive time (for an `accepted` contact), the recipient node
  pulls the bytes from the origin via the grant (§ below) and **re-uploads into its own storage**
  under the recipient's GHII, recording `localKey`. The message then serves bytes locally and
  survives the origin going offline.
- `mode: 'reference'` (**transient, pending requests only**): for a **first-contact request not yet
  accepted**, store only the descriptor — do **not** pull bytes yet. This prevents a stranger or
  spammy agent/app from burning the recipient's storage quota before they agree to talk. On
  **accept**, the attachment is duplicated (flips `reference` → `duplicate`). If blocked, nothing was
  pulled.
- **Visibility/consent:** the origin attachment must be readable by the recipient. Use the existing
  `PATCH /v1/storage/:key/visibility` + consent/`authorizeRead` machinery — grant the recipient GHII
  read access (visibility `group`/explicit grant) rather than making media public.

**Cross-node fetch primitive (DECISION #5 — resolved): dedicated signed `POST /v1/federation/storage/grant`.**
The recipient node calls this endpoint **on the origin node**, signed with the recipient node's
Ed25519 key. Body: `{ source_node, message_id, conversation_id, storage_key, owner_ghii,
recipient_ghii, timestamp, signature }`. The origin node — the authority over its own storage —
verifies, before issuing anything:
1. caller is an active peer with a public key on file, and the signature checks out;
2. a message with `message_id` exists, was sent **to** `recipient_ghii`, and **lists `storage_key`**
   as one of its attachments (so a peer can only ever fetch bytes for attachments actually addressed
   to one of its own users — no fishing for arbitrary files).
If valid, the origin mints a presigned download token via the existing `generateDownloadToken()`
(single-use, short TTL ~5 min, scoped to that `(owner, key)`) and returns `{ download_url,
expires_at }`. The recipient node then `GET`s `/v1/download/:token` on the origin to stream bytes —
proxy to the viewer (`reference`) or save locally + record `localKey` (`duplicate`).

Rationale (why dedicated, not reusing federation memory/file routes): no existing route does
third-party file access; the origin stays sovereign and checks the *message relationship* before
granting; it reuses (not reinvents) the presigned-download transport; and media stays private (a
narrow per-request capability, never made public). Reference mode re-grants lazily per open (tokens
are short-lived); duplicate mode pulls once at receive so the message survives the origin going
offline.

---

## 8. Notifications & real-time

- **In-app:** `notify(storage, recipientGhii, { type: 'direct_message', title: '<sender> sent you a message', body: <preview>, link: '/v1/profile#inbox' })` on every inbound message. Header bell already renders unread count + list.
- **Web push:** optionally dispatch via existing `push.ts`/`services/push.js` so the user is alerted when the SPA isn't open.
- **Live UI refresh (SSE):** the Inbox tab listens for `aimeat-live-update` (per the CLAUDE.md SSE rule) and re-fetches. Emit `emitChange('messages')` from the routes (server-side event bus) so the SSE feed pushes an update; add `messages` to the live-updating tabs list.
- **Read receipts (DECISION #4 — resolved: in v1):** when the recipient marks a message/thread read,
  POST a signed `/v1/federation/message/receipt` back to the origin node (or update locally for
  same-node) to flip the sender's row to `read` and set `readAt`. The sender's thread view shows the
  read state. Same signing/verification as the message receive endpoint.

---

## 9. Security & privacy

- **Transport:** federation calls are HTTPS + Ed25519-signed and verified per existing pattern — already covers integrity/authenticity in transit. No new transport crypto needed for v1.
- **Who can message whom (DECISION #1 — resolved): open addressing + first-contact consent.**
  Anyone — any GHII, agent GAII, or ecosystem GEAI — may *address* any human GHII across the whole
  federation using the full identifier. But the **first** message from a sender the recipient has no
  relationship with is held as a **request**, not delivered into the normal inbox:
  - **Per-pair contact state** record under the recipient's namespace: `pending | accepted | blocked`
    (key by sender identity). New record type `ContactConsentRecord` (see §3/§4).
  - **First contact** (no record) → store the message but mark the contact `pending`; surface it in a
    **"Requests"** section of the inbox + `notify()` ("X wants to message you"). The body/preview is
    shown so the recipient can decide. Conversation does **not** flow freely yet.
  - **Accept** → contact `accepted`; the pending message(s) move into the normal thread and all
    future messages (both directions) flow freely without re-asking.
  - **Block** → contact `blocked`; further messages from that sender are rejected at the receive
    endpoint (`403 BLOCKED`, sender row → `undeliverable`). Two block flavours:
    (a) **block after request** (decline this person), and (b) **hard block** (block proactively so a
    request is never even raised). Both resolve to state `blocked`; hard block can be set from a
    sender's profile/thread without a prior request.
  - **Auto-accept:** the recipient's **own** agents/apps (same owner) are auto-`accepted` (no request
    friction). External agents/apps go through the same request gate as humans.
- **Rate limiting:** apply the existing rate-limit middleware to `POST /v1/messages` and the
  federation receive endpoint (per-sender) to prevent spam/flooding — especially important for the
  open-addressing + first-contact model.
- **End-to-end encryption (DECISION #2 — resolved: deferred):** v1 ships with transport TLS +
  Ed25519-signed federation only (content readable by the nodes, email-like). True E2E (per-user
  keypairs, recipient-only decryptable, no server-side preview/search/notification bodies) is tracked
  as a **separate future effort**, not a blocker for this feature.
- **SSRF:** federation sends already go through peer URLs validated by existing SSRF guards; the
  cross-node storage fetch must use the same validation.
- **GDPR:** direct messages are personal data — include them in the existing export/delete cascade
  (Data Wallet / account deletion) on **both** sender and recipient copies.

---

## 10. Frontend (Inbox tab)

Per `docs/frontend-development-guide.md` + the profile-tab + SSE conventions.

- New tab `public/views/profile/inbox-tab.js`, registered in the profile tab list. **Placement
  (DECISION #7 — resolved): directly below "Koti" (Home), as a fixed/pinned position** that the user
  cannot drag/reorder elsewhere (like Home itself). Confirm how Home is pinned in the current tab
  list (the pinned/`KIINNITETYT` section in the sidebar) and apply the same non-movable treatment.
  Include a **Requests** sub-section/badge for pending first-contacts (§9).
- Prefix CSS classes (e.g. `inbox-` / `msg-`), styles in `public/css/views/` (or profile css),
  CSS variables only, no inline styles, existing `.btn-*` classes.
- Views: conversation list (left), thread view (right), composer (recipient GHII picker + body +
  attachment upload), unread badges. Attachment rendering by `kind` (image preview, audio/video
  player, file download link) using presigned download URLs.
- All strings via `t()`; add keys to `locales/en.json` + `locales/fi.json` **and** the frontend
  `public/locales/` files together (Rule 4).
- New shared JS modules get importmap identity entries in `public/spa.html` (cache-busting rule).
- Listen for `aimeat-live-update`; add `inbox` to the SSE live-update tab set.
- **Verify by driving the browser via Playwright MCP** (Rule 1b): log in (dev creds), send a
  message between two owners, confirm inbox + notification + thread + attachment render and persist.

---

## 11. Cross-cutting compliance (mandatory rules)

- **OpenAPI (Rule 3):** add all new `/v1/messages*` and `/v1/federation/message*` routes to
  `openapi.yaml`; run `pnpm generate:types`.
- **i18n (Rule 4):** en + fi (+ frontend locales) in lockstep.
- **File headers (Rule 2):** every new `.ts`/`.js`/`.css` gets the header block; version-bump
  touched files.
- **Tests (Rule 1):** new E2E suite `messages` (happy path local; federation delivery; ≥1 failure
  mode e.g. blocked sender / unresolvable recipient / oversized attachment). Run targeted suite on
  SQLite during iteration; full sweep on SQLite + MongoDB at end of plan.
- **Lint + typecheck (Rule 7):** `pnpm lint`, `npx tsc --noEmit`.
- **Python liaison:** no agent-facing contract change here (human↔human), so the
  `python/aimeat-crewai` package likely needs no sync — confirm before closing.
- **MCP tools:** optional human-messaging MCP tools later. **Naming collision warning:** the
  existing `aimeat_message_*` MCP tools are the agent channel — do **not** reuse those names; if we
  add human DM tools, namespace them (e.g. `aimeat_dm_*`).

---

## 12. Suggested build sequence (within "full feature in one go")

Even building the whole feature, land it in verifiable layers (each compiles + tests green):

1. **Data + storage layer** — interface, record, both backends, Prisma/SQLite, migration. Unit-level coverage.
2. **Local messaging** — routes (`/v1/messages*`), local delivery, inbox/conversations, `notify()`. E2E: same-node send→inbox→read→reply.
3. **Federation delivery** — outbound sign + `/v1/federation/message` receive + verify + retry queue. E2E: two-node send/receive (test harness sets the ed25519 sync hash hook — see CLAUDE.md pitfall).
4. **Attachments** — descriptor plumbing + cross-node storage grant + **duplicate-on-receive** (and reference-until-accept for pending requests). E2E: image round-trip survives origin offline.
5. **Frontend Inbox tab** — UI + SSE + push, browser-verified via Playwright MCP.
6. **Compliance pass** — OpenAPI, i18n, headers, lint, full dual-backend sweep.

---

## 13. Decisions — RESOLVED (2026-06-16)

1. **Messaging gate:** **Open addressing + first-contact consent.** Any GHII/GAII/GEAI may address
   any human GHII across the whole federation. First message from an unknown sender is held as a
   **request** (notify + show preview); recipient **accepts** (→ free-flowing both ways) or **blocks**
   (reject further). Two block flavours: decline-after-request and proactive **hard block**. The
   owner's **own** agents/apps auto-accept. + rate limiting. (§9, `ContactConsentRecord` §3/§4)
2. **E2E encryption:** **Deferred.** v1 = transport TLS + Ed25519-signed federation (content readable
   by nodes, email-like). True E2E tracked separately. (§9)
3. **Media duplication:** **Always duplicate** (recipient co-owns their copy; survives origin going
   offline; DM is 1:1 so cost ceiling is 2 copies). Node-permanence signal **dropped** — no longer
   needed. Refinement: for an **unaccepted first-contact request**, keep `reference` (don't pull
   bytes) until **accept**, then duplicate — protects recipient quota from spam. (§7)
4. **Read receipts:** **In v1.** Signed receipt back to origin flips sender row to `read` + `readAt`. (§8)
5. **Cross-node storage access:** **Dedicated signed `POST /v1/federation/storage/grant`** — origin is
   the authority, verifies the message relationship before minting a presigned download token. (§7)
6. **Retry policy:** **Configurable; defaults: retry ~every 60s, 7-day (168h) TTL → `undeliverable`.**
   Only attempt when the target peer is reachable; offline time doesn't count against attempts. (§6)
7. **Inbox tab placement:** **Directly below "Koti" (Home), pinned/non-movable.** (§10)
8. **Agents & ecosystem apps may message humans:** **Yes** — sender may be GHII, agent GAII, or
   ecosystem GEAI (scope `messages:send`). Agent→own-owner stays in the existing `agent-messages`
   channel; this DM inbox is for cross-party delivery. (§2)

### Remaining clarifications (non-blocking, decide during build)

- Acceptance propagation across federation: implicit (first reply) vs an explicit federated
  `accepted` signal — pick during §6/§9 implementation (noted in §3).
- Per-recipient inbound storage **quota** behaviour when duplication would exceed quota (queue,
  reject, or charge overage via existing `quota.ts`).
