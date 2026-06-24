# Secretary P3 — deferred niceties (doc/image intake + auto-create decisions) — handoff prompt

Two parts: (1) framing line, (2) self-contained task prompt. Source audit:
`docs/plans/2026-06-24-secretary-gap-closure.md`. Design ref: `docs/plans/2026-06-23-secretary-feature.md` §2, §7.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Before touching anything, read `CLAUDE.md` in full and follow every MANDATORY
> RULE exactly — especially Rule 1 (E2E on SQLite, happy + ≥1 failure mode, 0 failures in suites you ran), Rule 1b
> (verify finished frontend by driving the real browser via the Playwright MCP, never the `.spec.ts` suite), Rule 2
> (headers), Rule 4 (i18n en+fi together), Rule 7 (lint + typecheck + typecheck:frontend + check:importmap green),
> Rule 8 (frontend styling rules), Rule 9 (never add known-gaps yourself). Work in small verified steps. Never claim
> anything works without showing the test/browser evidence. Do not invent APIs — grep and confirm every endpoint/field/
> function you call. Do exactly P3-A and P3-B, nothing more, and report what you actually observed.

---

## PART 2 — the task prompt

### Mission
The AIMEAT per-user **Secretary** is built (Phases 0–6). Two designed niceties were deferred and never shipped: (A)
the Secretary chat is **text-only** — no document/image intake into the self-organism; and (B) the **learning loop only
measures manually-logged decisions** — choices the user actually makes via Ask cards or guided plans are never recorded
as decisions, so the loop misses the real signal. Add both. Do ONLY P3-A and P3-B.

### Repo orientation (verify each path before relying on it)
- Run dev server: `pnpm dev` (port 40050); restart after backend OR `public/*` changes. Dev login: `happyadmin` /
  `Zorlox0x#`. Browser-verify via the Playwright MCP.
- Frontend Secretary: `aimeat/public/views/secretary.js` — chat is `sendChat` + `chatCard` in
  `aimeat/public/views/secretary/cards.js` (a textarea + `/v1/ai/complete`, no upload). Hooks: `use-learning.js`
  (decisions: `addDecision`, the manual form), `use-guided-plan.js` (`runPlan`). `applyDecision` (in `secretary.js`)
  applies an answered Ask card.
- Decision contract: `secretary.decision.{id}`, shape + state machine in `docs/specs/secretary-decision-contract.md` —
  `{ type:'secretary.decision', spec, id, decision, goalRef, options[], chosen, rationale, expectedOutcome, revisitWhen,
  actualOutcome, score, verdict, status:'open'|'reviewed', reviewedAt, attempts, lastError, contextId, contextName,
  createdAt }`. The tick's review sweep (`reviewOpenDecisions` in `aimeat/src/services/scheduler.ts`) scores `open`
  decisions whose `revisitWhen` has passed.
- Storage uploads: grep for the existing upload route(s) (`aimeat/src/routes/storage-files.ts` or similar) and the
  presigned-upload pattern; the note→workspace classifier lives in `aimeat/src/services/notebook-classify.ts` /
  `tracked-classify.ts`. Self-organism content is keyed `organism.{id}.w.{wsId}.{namespace}.{recordId}` and owned by the
  member GHII.
- Vision: `/v1/ai/complete` runs on the owner's OpenRouter key; confirm how to pass an image (model + message content)
  and pick a vision-capable model. (Long calls: use low-level `api()` with a long timeout, never `apiPost`.)
- `secretary.config` = `{ contexts:[{ id, name, brain, organismId, organismName, workspaces, policy }], activeContextId,
  pendingDecisions }`. Active context = the one whose `id === activeContextId`.
- Tests: `aimeat/test/e2e-secretary.ts`; run `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx
  test/run-e2e-ci.ts --test=secretary`. The E2E owner has NO OpenRouter key — assert deterministic logic in E2E
  (records written, classification routing, decision auto-creation), verify live AI/vision in the browser. Runner forces
  `AIMEAT_EE_DISABLED=true`.

### What to build (both)

**P3-A — Doc/image intake.** Add file/image upload to the Secretary chat (`chatCard` + `sendChat`): upload the file via
the existing storage route, then file it into the right workspace of the active context's self-organism (reuse the
note→workspace classifier + the existing save-note path), and for images run a vision-capable model via `/v1/ai/complete`
to extract a structured summary that gets stored alongside. Respect the active context. **Acceptance:** browser — upload
a document and an image in the Secretary chat → each is filed into a sensible workspace and is discoverable via
`aimeat_discover`; E2E — the upload+file path writes the expected `organism.{}.w.{}.*` record (you can stub the
classify/vision result in E2E since there's no key).

**P3-B — Auto-create decisions from Ask cards / guided plans.** When an Ask card is answered (`applyDecision`) or a
guided plan is approved/run (`use-guided-plan.js` `runPlan`), auto-create a `secretary.decision.{id}` contract with
`chosen` + `rationale` + a reasonable `expectedOutcome` + a default `revisitWhen` (e.g. now + N days), `status:'open'`,
tagged to the active context — so the learning loop's review sweep later scores real choices, not only manually-logged
ones. Don't duplicate if the source already created one. **Acceptance:** E2E — answering an Ask card creates an `open`
reviewable decision with the right shape; running a guided plan creates one; browser — the new decision appears in the
decision-log card and is later scored by Run-now (review sweep).

### Acceptance — not done until all pass AND you show the evidence
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` all green.
- Targeted E2E green (extend `e2e-secretary.ts`): happy + ≥1 failure mode for each; don't assert live AI/vision output
  in E2E.
- Browser verification (Rule 1b) on the dev server for the upload+intake and the auto-decision flow; report what you
  observed (screenshot if useful). If you can't drive the browser, say so.
- New strings in BOTH `en.json` + `fi.json`. Headers on touched files. OpenAPI synced for any new route.

### Gotchas
- Long AI/vision calls from the SPA MUST use `api(path, { method, body, timeoutMs: 1_800_000, retries: 0 })`, never
  `apiPost`.
- New server-data surfaces must subscribe to the `aimeat-live-update` window event.
- `GET /v1/memory?prefix=...` can be browser-cached — cache-bust when reading right after a write.
- `secretary.js` is near the file-length lint limit — new logic in hooks/helpers, presentational bits in `cards.js`.
- Don't touch the Enterprise `ee/` module (P3 is the personal Secretary). Backend stays protocol-only (no SSR).

Do P3-A and P3-B, verify, and report results with evidence. If anything here contradicts the code you find, trust the
code and say what differed.
