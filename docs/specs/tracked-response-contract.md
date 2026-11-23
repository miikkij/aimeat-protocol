<!--
@file tracked-response-contract.md
@description Self-describing spec for the Tracked Response memory contract: the JSON shape, the
  state machine, and the rules any human/AI system must honor when reading or advancing one. A
  Tracked Response's `spec` field points here so external agents know how to handle the structure.
@version-history
  v1.1.1 - 2026-11-15 - The example watches a record in the owner's own memory, `{{result}}` names
    the classified case, and "How an AI advances the work" says that only the owner or an agent of
    the owner fires the contract. No change to the contract.
  v1.1.0 - 2026-11-15 - Rules 2 and 5 match the node since 2026-10-14: the watched key is read only
    from the owner's own account (the owner's records and their agents' records), and the account,
    sender, recipient and conversation come from storage, not from the record's own fields. A
    classified result can be left out of the reply.
  v1.0.1 - 2026-10-12 - The example uses made-up identities (example-node, helper#bob) instead of a
    real peer node and a real bug title. No change to the contract.
  v1.0.0 — 2026-06-21 — Initial spec (Tracked Response = first Memory Contract instance).
-->

# Tracked Response — contract spec (v1, revision 1.1.1)

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
  "title": "Sign-in fails after the upgrade",
  "state": "watching",                  // see state machine

  "source": {                            // the SINGLE message we reply to
    "kind": "message",
    "messageId": "<direct_messages.id>",
    "conversationId": "<conversationId>",
    "peerGhii": "helper#bob@example-node",  // reply recipient
    "ownerGhii": "alice@node",          // reply sender (= ownerGaii here)
    "originNodeId": "example-node",
    "preview": "After the upgrade my node refuses every sign-in..."
  },

  "watch": {                             // the memory key tracked + the completion test
    "key": "bug.{bugId}.latest",         // read from the owner's own account only (rule 2)
    "condition": { "field": "status", "equals": "done" }   // shallow equality on the watched value
  },

  "references": {                        // everything this involves (for humans + AIs)
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
- `{{result}}` → the `response.inject.field` plucked from the watched value (`watch.value`), e.g. the bug record's `resolution`. Empty string if absent, and also when the watched record's classification label may not leave its organism (rule 6).
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
2. **Only `watch.key` + `watch.condition` drive firing, and only in the owner's own account.** The node reads the watched key from the account that stores the contract: the owner's own record first, then a record with that key stored by one of the owner's agents. A record with the same key in any other account never fires the contract. To make a Tracked Response fulfil, the owner or one of the owner's agents advances that record so the condition becomes true (for example, writes the bug with `status: "done"`). The writer does **not** need to know this contract exists.
3. **Inject the result, don't fabricate it.** The reply contains `response.inject.field` from the watched value verbatim. If you want a richer reply, write a richer field (e.g. `resolution`) on the watched record before it goes `done`.
4. **Idempotency is sacred.** A contract with `delivery.sentMessageId` set has already replied — never re-send. The system guards on this before every send.
5. **Editing is allowed; the shape is the contract.** Any field may be edited by an authorized human/AI as long as the shape above is preserved and `type` stays `tracked-response`. Add data under `references` freely. Four fields are not taken from the record when the node evaluates it: `ownerGaii` and `source.ownerGhii` become the account that stores the record (it must be a person, not an agent or an app), and `source.peerGhii` and `source.conversationId` come from that account's own copy of the message `source.messageId` names. A record that names no message of that account is skipped.
6. **A classified result stays home.** When the watched record's classification label may not leave its organism, `{{result}}` is empty, the reply still goes, and the ledger records a `result-withheld` event with the key and the reason.

## How an AI advances the work (the common case)
> Only the owner, or an agent of the owner, can make the contract fire. Such an AI reads the record at `watch.key` in the owner's account, does the work, then writes the record back with `status: "done"` and a `resolution` field. The node then sends the reply to the original reporter.

An AI of any other account cannot fire the contract. When it writes a record with the same key, that record is in its own account, and the node never reads it (rule 2). A record in an organism workspace fires the contract only when the owner or one of the owner's agents wrote it; a record another member wrote does not.
