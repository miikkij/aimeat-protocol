<!--
@file secretary-decision-contract.md
@description The Secretary decision-log Memory Contract — the self-describing record the Secretary
  writes when it (or the owner) commits to a choice, and the scheduled-review state machine that scores
  it actual-vs-expected. Part of the Secretary learning loop (Phase 5).
@version-history
  v1.0.0 — 2026-06-24 — Initial: decision-log contract shape + review sweep rules.
-->

# Secretary Decision-Log Contract

A **decision** is one self-describing memory record under the owner's namespace. It captures a choice
the Secretary made or recommended, **stays open after the choice**, and is revisited by a scheduled
review that records what actually happened and scores the decision quality. Without the revisit step
it would be a list, not a learning loop (see `docs/plans/2026-06-23-secretary-feature.md` §7).

This is a **Memory Contract** (`docs/coding-guidelines/memory-contracts.md`): the record *is* the
interface; the "reaction" is the Secretary's scheduled review **sweep** (the safety-net reconciler
form — there is no per-key write hook because decisions are advanced by time, not by a watched key
changing).

## Record

- **Key:** `secretary.decision.{id}` (owner memory, `visibility: "private"`, off the `organism.` prefix).
- **Tags:** `["secretary", "decision", <status>, <contextId>]` — so the master directory / FTS can
  surface prior decisions on a topic (the Secretary discovers them before repeating work, §163).

```jsonc
{
  "type": "secretary.decision",                 // discriminator
  "spec": "docs/specs/secretary-decision-contract.md",
  "id": "uuid",
  "decision": "Switch the cabin booking to the lakeside cottage",
  "goalRef": "secretary.goal.{id}" ,            // optional link to a goal, or null
  "options": ["Lakeside cottage", "Forest cabin", "Stay home"],
  "chosen": "Lakeside cottage",
  "rationale": "Closer to family, within budget",
  "expectedOutcome": "Everyone attends; under 800€",

  // Condition (declarative): review once now >= revisitWhen.
  "revisitWhen": "2026-07-01T00:00:00.000Z",

  // Filled by the scheduled review:
  "actualOutcome": null,
  "score": null,                                // 0–100, 100 = excellent decision
  "verdict": null,                              // one-line human-readable assessment
  "status": "open",                             // open → reviewed

  // Observability / idempotency:
  "reviewedAt": null,
  "attempts": 0,
  "lastError": null,
  "contextId": "ctx-...",
  "contextName": "LifeDesk",
  "createdAt": "2026-06-24T..."
}
```

## State machine

1. **open** — created with a choice + `expectedOutcome` + `revisitWhen`. The record is now part of the
   learning loop.
2. **reviewed** — the scheduled review (the `secretary` tick's review sweep) found `now >= revisitWhen`,
   asked the model to assess actual-vs-expected on the owner's key, and wrote `actualOutcome` + `score`
   + `verdict` + `reviewedAt`. `attempts` is incremented; on AI/parse failure the record stays **open**
   with `lastError` set and is retried on the next sweep (the reconciler safety net).

## Who honors it
- **The Secretary review sweep** (`src/services/scheduler.ts` `executeSecretaryJob` → `reviewOpenDecisions`)
  advances open→reviewed. It is **cost-guarded**: `policy.stopSpending` skips the whole tick, so no
  review spends while stop-spending is on. At most a few decisions are scored per tick to bound cost.
- **The Secretary view** (`public/views/secretary/use-learning.js`) creates decisions, lists them with
  their score, and can trigger a review immediately (Run-now on the tick).
- **Any other system** may read a decision to continue prior work, or write the same shape — the record
  is the contract.
