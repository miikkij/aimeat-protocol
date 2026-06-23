# Plan: Inbox evolution — send-to-many (mass posts + polls), drafts, inbox-links

> Status: direction set with the developer 2026-06-23. **Group chat is DEFERRED to an app** (not core).
> Focus: "send to many" — announcements, broadcasts, and polls — then drafts + inbox-links. Contacts
> picker is DONE. Supersedes the earlier group-chat plan.

## Context & the key call

We explored group chat as a core feature and hit ownership/federation edge cases (whose group owns the
thread, which node resolves the ACL, silent self-deletion of one's own messages). That friction is the
signal that **group chat is a client/app concern, not protocol.** AIMEAT's architecture is protocol-only
core → generic APIs → apps render UX; the primitives a chat app needs (memory, `visibility:'group'`,
Share Groups, consent, the interactive-message payload) **already exist**, so a realtime group-chat **app**
can store/gate messages however it likes without baking chat into the core. **Decision: drop core group
chat; revisit as an app later.**

Higher-value and mostly already-built: **send-to-many** — operator announcements, broadcasts that collect
replies, and **polls/structured questions to a group** (the AskUserQuestion we already shipped, fanned out
+ an aggregated results view). Share Groups get their natural job here: a **reusable audience /
distribution list**, not a chat ACL.

---

## 1. Send-to-many (the focus)

One compose flow, three content modes, to N recipients. **Fan-out copies are correct here** (unlike a
shared chat) — a broadcast genuinely IS N separate 1:1s, so reuse the existing `direct_messages` per-copy
model + delivery + federation.

### Recipients (audience)
- **Ad-hoc list** — the contacts picker (multi-select; reuse the datalist work).
- **A Share Group** — "send to the 'Beta testers' group". Reuse `SharingGroupRecord.members` as an audience
  (read the members, fan out to each). No new ACL semantics — just an address list.
- **Operator: "all node GHII users"** — admin-only audience (list node owners). For node-wide notices.

### Content modes
- **Announcement** (non-respondable) — read-only; the reply composer is hidden. Operator → all users about
  node changes. (A `respondable:false` flag on the message; broadcast id groups the copies.)
- **Broadcast** (respondable) — each recipient gets a normal 1:1 DM; replies are ordinary 1:1 threads.
- **Poll** — fan out an **interactive message** (`interactive.role:'questions'`, already built) to each
  recipient. Each answers in their inbox via the existing form; the sender gets a **results view** that
  aggregates `interactive.answers` across all the fanned-out copies (counts per option + the "Other"
  free-text list). Works for **people and agents** (an agent answers a poll via `aimeat_dm_thread` +
  reply, exactly like a 1:1 interactive question).

### Model
- Reuse `sendDirectMessage` per recipient; add a `broadcastId` to group the copies (one nullable column on
  `direct_messages`, additive, both backends) + a `respondable` flag (or derive from the mode).
- A small **broadcast record** (owner memory) holds the audience + mode + (for polls) the question spec, so
  the results view can find all copies: `broadcast.{id}.latest`.
- **Results/aggregation:** the sender lists the broadcast's copies (by `broadcastId`) + reads each reply's
  `interactive.answers` (poll) or read/reply status (announcement/broadcast). Read-only summary view.

### Routes (generic)
- `POST /v1/messages/broadcast` — `{ to:[…] | group_id | audience:'node-users', mode, body?, interactive?,
  respondable }` → fan out, return `{ broadcastId, sent }`.
- `GET /v1/messages/broadcast/{id}` — the aggregated results (counts, responders, poll tallies).

### Phasing
1. **Announcement + broadcast (ad-hoc list + Share-Group audience)** — fan-out + respondable flag + the
   compose UI (multi-recipient, mode selector). E2E both backends + browser.
2. **Poll** — fan out the interactive question + the results-aggregation view. (Biggest reuse of the
   interactive feature.)
3. **Operator "all node users" audience** + announcement read stats.

---

## 2. Drafts
- Phase 1: **localStorage auto-draft** keyed by conversationId/`new` (debounced save, restore on reopen).
- Phase 2: explicit **Saved Drafts** (a `message-draft.{id}.latest` memory record → a Drafts section in the
  list; click to reopen pre-filled).

## 3. Inbox-links (mailto-style)
- SPA route/param `/v1/profile?tab=messages&to=<id>[,<…>]&subject=<s>` → opens compose pre-filled.
- A reusable `<InboxLink to=… subject=…>` component to drop next to any person/agent (directory, organism
  members, agent cards). Phase 2: multi-recipient prefill (ties into send-to-many).

## 4. Contacts picker — DONE (commit d0f95708)
Compose "to" autocompletes with your agents (GAIIs) + people you've messaged. Reused by send-to-many
(ad-hoc audience) and inbox-links.

## 5. Group chat — DEFERRED to an app
Not core. The primitives an app would use (memory + `visibility:'group'` + Share Groups + consent +
interactive payload) already exist and already federate for reads. If/when we build it, it's an AIMEAT
**app**, not a protocol change.

---

## Recommended build order
1. **Send-to-many Phase 1** — announcement + respondable broadcast (ad-hoc list + Share-Group audience).
2. **Send-to-many Phase 2** — **polls** (fan out interactive question + results view). *The headline.*
3. **Drafts Phase 1** (localStorage auto-draft) — quick.
4. **Inbox-links Phase 1** (`?to=&subject=` + `<InboxLink>`) — quick.
5. **Send-to-many Phase 3** — operator "all node users" + announcement read stats.

Each phase: E2E both backends (Rule 1), OpenAPI (Rule 3), i18n both locales (Rule 4), headers (Rule 2),
lint/typecheck/frontend/importmap (Rule 7), Frontend Guide (Rule 8), storage-sync (additive only). Generic
routes, no SSR.
