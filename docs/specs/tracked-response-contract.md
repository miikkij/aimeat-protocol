<!--
@file tracked-response-contract.md
@description Self-describing spec for the Tracked Response memory contract: the JSON shape, the
  state machine, and the rules any human/AI system must honor when reading or advancing one. A
  Tracked Response's `spec` field points here so external agents know how to handle the structure.
@version-history
  v1.0.0 — 2026-06-21 — Initial spec (Tracked Response = first Memory Contract instance).
-->

# Tracked Response — contract spec (v1)

**One line:** *an important inbox message that is owed a response once a linked follow-up has been completed.*

A Tracked Response is a single self-describing memory record that binds an inbound message ↔ a work item ↔ a completion condition ↔ a reply policy ↔ delivery state. When the watched work item satisfies the condition, the system sends (or drafts, for approval) a reply back to the original message — across federation if the sender is on another node. It is the reference implementation of the **Memory Contract** pattern (see `docs/coding-guidelines/memory-contracts.md`).

## Where it lives
Owner-scoped memory key: `tracked-response.{id}.latest`, `visibility: 'private'`. It is deliberately **off** the `organism.` prefix so the Living Documents pulse never picks it up.

## JSON shape
```jsonc
{
  "type": "tracked-response",          // contract discriminator — never change
  "spec": "<url/key of this doc>",      // self-description pointer
  "specVersion": 1,
  "id": "tr_ab12cd",
  "ownerGaii": "alice@node",            // the human who owes the reply (the reply sender)
  "title": "googleSub self-host migration bug",
  "state": "watching",                  // see state machine

  "source": {                            // the SINGLE message we reply to
    "kind": "message",
    "messageId": "<direct_messages.id>",
    "conversationId": "<conversationId>",
    "peerGhii": "omnituinen-agent#omnituinen@aimeat-ogmiskate-001-prod",  // reply recipient
    "ownerGhii": "alice@node",          // reply sender (= ownerGaii here)
    "originNodeId": "aimeat-ogmiskate-001-prod",
    "preview": "Self-host node crashes: no such column: googleSub..."
  },

  "watch": {                             // the memory key tracked + the completion test
    "key": "organism.{org}.w.{ws}.bug.{bugId}.latest",
    "condition": { "field": "status", "equals": "done" }   // shallow equality on the watched value
  },

  "references": {                        // everything this involves (for humans + AIs)
    "organismId": "{org}", "workspaceId": "{ws}",
    "records": [ { "namespace": "bug", "id": "{bugId}" } ],
    "documents": [], "notes": []
  },

  "response": {
    "channel": "message.reply",          // v1: only message.reply
    "mode": "auto",                      // 'auto' = send immediately | 'approve' = draft for human
    "template": "Done — {{title}}. {{result}}",
    "inject": { "from": "watch.value", "field": "resolution" }  // pull this field into {{result}}
  },

  "tracking": { "lastUpdatedAt": null, "lastTriggeredAt": null, "attempts": 0, "lastError": null },
  "delivery": { "sentMessageId": null, "sentAt": null, "draftKey": null },
  "ledger": [ { "at": "...", "event": "created" } ],
  "createdAt": "...", "updatedAt": "..."
}
```

### Template substitutions
- `{{title}}` → the contract `title`.
- `{{result}}` → the `response.inject.field` plucked from the watched value (`watch.value`), e.g. the bug record's `resolution`. Empty string if absent.
- `{{sourcePreview}}` → `source.preview`.

## State machine
```
watching          — created; watched key registered, condition not yet met
sent              — (mode=auto, transient) reply dispatched
replied           — terminal happy path; delivery.sentMessageId set
awaiting-approval — (mode=approve) condition met; suggested reply in delivery.draftKey, owner notified
error             — a send attempt failed; the reconciler retriggers it
cancelled         — owner cancelled; deregistered
```

## Rules any system MUST honor
1. **Never delete the `source` message** — it is the reply target. A Tracked Response without its source can never fulfil.
2. **Only `watch.key` + `watch.condition` drive firing.** To make a Tracked Response fulfil, an external system simply advances the watched record so the condition becomes true (e.g. publishes the bug with `status: "done"`). It does **not** need to know this contract exists.
3. **Inject the result, don't fabricate it.** The reply carries `response.inject.field` from the watched value verbatim. If you want a richer reply, write a richer field (e.g. `resolution`) on the watched record before it goes `done`.
4. **Idempotency is sacred.** A contract with `delivery.sentMessageId` set has already replied — never re-send. The system guards on this before every send.
5. **Editing is allowed; the shape is the contract.** Any field may be edited by an authorized human/AI as long as the shape above is preserved and `type` stays `tracked-response`. Add data under `references` freely.

## How an external AI advances the work (the common case)
> Read the bug at `watch.key`, do the work, then write it back with `status: "done"` and a `resolution` field, and publish. That's all — the reply to the original reporter is sent automatically.
