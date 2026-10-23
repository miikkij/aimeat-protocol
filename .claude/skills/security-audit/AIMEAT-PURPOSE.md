# AIMEAT purpose guard for the security-audit skill

A local companion to Cloudflare's skill (see `UPSTREAM.md`). Every hunter, verifier, critic and fix
agent in an AIMEAT audit reads this file next to its own brief. It exists because the October 2026
audit's second wave fixed 21 confirmed holes and, in the same change, removed more than a dozen
designed uses; the suites stayed green because no test covered those uses, and the developer found
the loss himself. The record is that audit's `BEHAVIOUR-CHANGES-wave2.md` in the Security register
(below), the upstream feedback is https://github.com/cloudflare/security-audit-skill/issues/88, and
the trap is `docs/pitfalls.md` §126.

## The Security register: look up first, write after

Every AIMEAT security record lives in one place on aimeat.io: organism **AIMEAT SECURITY**
(`ec7a728f-ad61-4b05-b6f0-e5bf9b47c16c`), workspace **Security register** (`ws-mvkjtfqtfgn`). It
holds every earlier audit's report and findings with their status, the fixes and their commits, the
accepted exceptions with their expiry dates, the security and dependency changes, and the CVE rounds,
whichever Claude account or machine did the work. Its tools are the app tools of
`tietoturvakartta.html` (`aimeat_app_tool_invoke { owner: "happydude500001", app:
"tietoturvakartta.html", tool }`; skill `user:happydude500001/tietoturvakartta`), and the map for people
is https://tietoturvakartta.apps.aimeat.io/. Its guide document "How to use the Security register"
gives the ids, the statuses and the import script.

- **Before a candidate becomes a finding,** look it up there by CVE, package, file, rule or the
  finding's id: tool `security_lookup`. A finding already `fixed`, `by-design` or `dismissed`, or covered by an active
  exception, is linked rather than filed again; a regression of a `fixed` one says so.
- **The run writes there, not to a disk.** The report goes in as `report` documents in the
  workspace Security reports, the run with `run_add`, every finding with `finding_set`, and every
  fix updates its finding with `fixCommits` and the two proofs (`proofs.attackRefused`,
  `proofs.useKept`) through `finding_set`, and is recorded with `change_add`. A local folder is a
  working copy until the import, never the record: on 2026-10-23 three accounts' audits sat on three
  disks and no session could tell what had been done or why.

## The rule

**A fix makes a use safe. It never removes the use.** Every use that worked before keeps working
after the fix, unchanged or through a one-press consent the owner gives where they already are. A
behaviour changes only where a confirmed hole requires it, and then in the safest form that keeps the
use. Removing a designed capability is a design change for the developer to decide, never a fix
(Jouni, 2026-10-21).

## What AIMEAT is for: the uses a fix must keep

Treat these as standing rulings, beside the ones in the run's brief. A remediation that contradicts
one of them is wrong even when it closes the hole.

1. **People own their data and their secrets.** A key stays in its owner's vault and is used on the
   owner's behalf; nobody else holds it. A shared extension uses each caller's own key toward the
   address that key is bound to ("bring your own key"). An extension's author never collects other
   people's keys in the extension's own settings: that would move ownership.
2. **Extensions are a service other accounts call.** Calling another owner's extension is intended.
   Safety comes from transparency, not refusal: readable source, declared secrets and addresses
   (`uses_secrets`, `network: { hosts }`), and a one-press approval that shows the person what goes
   where and why.
3. **The owner's agents and apps act for the owner.** They must never read less of the owner's data
   than another account's agent may. A narrowing for them is a permission word the owner can tick,
   named in the refusal.
4. **A published app's permissions change only when its author republishes it.** A new permission
   requirement breaks every app already published unless the update keeps those apps working (a
   once-only allowance, or the person's one-press consent at the moment of need; wish
   `wish-sovellus-pyyt-puuttuvan-luvan-k-ytt-j-lt-yhdell-painalluksel`).
5. **Anonymous mode and visitors without registration are a supported path.** Landing pages and
   no-sign-in apps read public content, write their own `anonymous.*` data and run public extension
   actions.
6. **What exists at the update keeps working.** Installed extensions, schedules, workflow runs in
   flight, download links already given out, records written by an older rule. Mark existing state at
   the update with a once-only boot step (awaited before the node serves); new rules govern new
   writes. Code written after the update follows the new rules.
7. **The docs and prompts are the product's instructions.** Read what `build-extension-prompt.ts`,
   the served library `aiDoc`s, the skills and the handbooks tell people and AIs to do. A rule that
   contradicts them breaks everyone who followed them; change both, and keep the old way working.
8. **A refusal the owner cannot answer is a break.** Every refusal names what to do, in plain words,
   and the control it names exists. Where the owner should decide, give the one-press approval
   (`services/permission-ask.ts`, `services/secret-approvals.ts`) instead of an error.

## For hunters and verifiers

- A candidate's `intended_behavior` says what the path is FOR, not only what it must prevent.
- `remediation.strategy` names the legitimate users of the refused path (the served libraries, the
  bundled extensions and cortexes, the SPA, the CrewAI package, the apps in `C:/dev/apps`, the docs
  and prompts above, anonymous mode) and how each keeps working. "Refuse X" alone is not a
  remediation.

## For fix agents (the fix contract)

1. **Two proofs per refusal.** The attack is refused, with a fail-first proof against the unfixed
   code. And each legitimate use of the same path still works, with a test that passes before and
   after the fix. A green suite proves only what it asserts.
2. **List the users before writing the refusal:** grep the served libraries, the prompts, the
   skills, the bundled extensions and the apps for the path.
3. **Never change an existing assertion** to make a fix pass, and never move a suite off the node's
   default setting (add a second node for the non-default case). An existing assertion that must
   change is a behaviour change: it goes on the list below with its record.
4. **Never decide a product trade-off.** When keeping a use safe needs a choice, stop and report it.

## Before the round goes to main

1. **Capability-loss review.** Fresh read-only agents, one per area, take every new refusal in the
   diff and answer "who did this before, and do they still work": SAFE, BREAKS (with the smallest
   change that keeps the fix and restores the use) or UNSURE.
2. **Behaviour-change list.** One row per observable change: before, now, the record that requires
   it, who could notice. Rows tied to no record go back to the old behaviour. The developer approves
   the list.
3. **Tests in this order.** The suites the change reaches, on both backends; then `pnpm gate`; then,
   only when everything is green, the full E2E sweep on both backends once, before the push. The
   purpose suites (wish `wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni`) run in
   the gate on every change that reaches `src/`.

**The purpose tier** is the automated form of the list above: `PURPOSE_SUITES` in
`aimeat/test/run-e2e-ci.ts` (`pnpm test:e2e:purpose:sqlite`, `:postgres-kysely`), which `pnpm gate`
runs wherever it runs the guard tier. A red purpose test is a designed use gone; what belongs in the
tier is `docs/coding-guidelines/testing-requirements.md` Rule 1c.
