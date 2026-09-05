/**
 * @file run-e2e-ci.ts
 * @description Cross-platform E2E test runner with automatic server lifecycle and backend cleanup.
 * @structure Suite list, the reconciliation that holds it against the directory, argument parsing,
 *   per-suite execution, and summary reporting. The node under test -- its environment, its
 *   lifecycle and its database -- lives in run-e2e-server.ts.
 * @usage
 *   node --import tsx test/run-e2e-ci.ts
 *   node --import tsx test/run-e2e-ci.ts --test=e2e-mcp
 *   node --import tsx test/run-e2e-ci.ts --guards
 * @version-history
 *   v1.31.0 -- 2026-09-05 -- Add e2e-ai-jobs.ts (written 2026-08-31 on branch feat/ai-jobs, merged
 *            today): background model calls with a handle. It owns its server, because every refusal
 *            it measures is a boot-time number, and it follows the runner's backend so what it proves
 *            it proves on both.
 *   v1.30.0 -- 2026-09-05 -- Add e2e-extension-workspace.ts, in ALL_SUITES and in the guard tier:
 *            ctx.workspace, a sandboxed script acting on a workspace as its caller. Seven of its
 *            assertions are refusals (membership, scope, the manifest flag, schema, version, budget,
 *            the unattended road), which is the tier's question.
 *   v1.29.0 -- 2026-09-05 -- Parallel lanes: `--workers=N` (or AIMEAT_E2E_WORKERS) runs N nodes at
 *            once, each on its own port and database, every suite still on an empty node. Suites
 *            that bind a port of their own stay in lane 0. The summary says where the wall clock
 *            went: suites versus restarts, and the mean restart. Measured before: 285 suites, 38
 *            minutes, 20 of them restarts. Also registers e2e-admin-security-page.ts (the Security
 *            page in the poster face, another session's suite, carried here by agreement).
 *   v1.28.0 -- 2026-09-03 -- Add e2e-federation-relay-claim.ts, in ALL_SUITES and in the guard tier:
 *            eleven of its seventeen assertions are a refusal, and the capability it proves did not
 *            exist before (a receiving node could not refuse a relay). It spawns its own node on
 *            40293 with its own sqlite file, so it neither needs nor disturbs the shared server
 *            (40291 is e2e-sealed-config's; see docs/pitfalls.md §38).
 *   v1.27.0 -- 2026-09-02 -- Add e2e-workspace-doc-edit.ts: in-place document edits, the byte-identity
 *            of everything they do not touch, and two concurrent appends both surviving.
 *   v1.26.0 -- 2026-09-02 -- Add e2e-app-playtest.ts: the game playtest bench through the audit door.
 *   v1.25.0 -- 2026-08-29 -- Add e2e-app-rows.ts: an app on an organism row space, the two-hand rule.
 *   v1.24.0 -- 2026-08-29 -- Add e2e-app-legal.ts: the app's own legal pages and its audit log.
 *   v1.23.0 -- 2026-08-29 -- Add e2e-app-marks.ts: the badge and install switches and the named reviewer.
 *   v1.22.0 -- 2026-08-27 -- Add e2e-mcp-install.ts: the downloadable MCP config file per client,
 *            the name sanitizing on its query, and the promise that every install shortcut the
 *            tool table advertises actually resolves.
 *   v1.21.0 -- 2026-08-21 -- Add e2e-static-hardening.ts to ALL_SUITES and the guard tier: the node
 *            refuses any dotfile path (.env, .env~, .git/) with a 403 before every static handler,
 *            so a leftover secrets backup cannot be read even without the apex nginx dotfile deny.
 *   v1.20.0 -- 2026-08-17 -- Add e2e-living-pulse.ts (the due-scan on the meta projection).
 *   v1.19.0 -- 2026-08-17 -- Add e2e-auth-refusals.ts (the refusal log's operator surface),
 *            with AIMEAT_AUTH_LOG_PATH pinned to a test-local file in run-e2e-server.
 *   v1.17.0 -- 2026-08-15 -- GUARD_SUITES and --guards: the tier CI blocks on. Both E2E steps in
 *            .github/workflows/ci.yml were `continue-on-error: true`, so no red suite has ever
 *            stopped a merge and every improvement to this directory was optional. The full sweep
 *            stays advisory -- two hours, and §18's cleanup race makes it occasionally wrong -- and
 *            fourteen suites that assert a refusal or an isolation boundary block instead. 407
 *            assertions, both backends, measured before it was wired up.
 *   v1.16.0 -- 2026-08-14 -- Add e2e-capability-webhook-update.ts, and stop the list drifting from
 *            the directory it describes. The list cannot notice its own gaps, so the runner now
 *            reads test/ and compares: a suite file on no list is fatal on a full run and a warning
 *            on a filtered one, and every non-suite file in test/ is named in NOT_SUITES with the
 *            reason it is out. Registering the file once fixes today; reconciling fixes the class,
 *            and this list has now been found short twice (2026-08-10, 2026-08-14).
 *   v1.15.0 -- 2026-08-14 -- Add e2e-organism-scope-gate.ts (August 2026 audit: organism:write on the
 *            three organism write doors, plus the boot migration that keeps an existing agent from
 *            losing the capability).
 *   v1.15.0 -- 2026-08-18 -- Add e2e-sealed-config.ts (settings the node's host set and its
 *            operator cannot move). It owns its server because sealing is a boot-time decision,
 *            and it follows the runner's backend rather than hardcoding sqlite like the other
 *            four self-spawning suites, so what it proves it proves on both.
 *   v1.14.0 -- 2026-08-14 -- Fix the instrument, in the three ways the August 2026 audit measured.
 *            (1) The database is emptied before the FIRST suite, not only between suites: the clean
 *            sat under `if (i > 0 …)`, so a solo run started on whatever the last run left, and
 *            three audit conclusions came out backwards. (2) Between suites the runner now waits
 *            for the old server to have EXITED and for its port to be free, bounded and fatal,
 *            instead of sleeping one second and hoping; when that second was short the file delete
 *            failed or the next suite talked to a server still up on the old data, which reads as
 *            hundreds of unrelated 403s. (3) Every variable that changes behaviour is pinned, each
 *            suite process is handed the same pins as the server, and any key the developer's own
 *            aimeat/.env still gets to decide is printed by name. Lifecycle, environment and
 *            cleanup moved to run-e2e-server.ts by pure extraction: this file was at 789 lines
 *            against a cap of 800, and the fixes needed room.
 *   v1.13.0 -- 2026-08-14 -- Add e2e-capability-trust-guard.ts (August 2026 audit NEW-2: the fields
 *            of a capability record that only the node may write).
 *   v1.12.0 -- 2026-08-12 -- Pin AIMEAT_AI_COP_SECTIONS / _SIGNED_ON on the shared server. The server
 *            fills any unset key from ./aimeat/.env, so the developer's own Code of Practice signature
 *            reached the test node while the test process could not see it, and e2e-ai-provenance
 *            failed on the backend whose .env.test.* file lacked the pair. Same class as the
 *            AIMEAT_SMTP_HOST pin below.
 *   v1.0.0 -- 2026-05-28 -- Add redacted MongoDB cleanup error details.
 *   v1.0.1 -- 2026-06-14 -- Disable e2e-email suite (no SMTP credentials to send mail).
 *   v1.1.0 -- 2026-07-01 -- Pin AIMEAT_SECRETARY_ENABLED=true on the shared server (feature is off by
 *            default in prod) so the secretary/specialist/organism-template suites keep exercising it;
 *            add e2e-secretary-disabled.ts (self-spawns a flag-off server) for the hidden-by-default path.
 *   v1.2.0 -- 2026-07-10 -- Remove the deleted Secretary/Specialists/use-case-Template suites
 *            (e2e-secretary, e2e-secretary-disabled, e2e-specialists, e2e-organism-templates,
 *            e2e-b2b-sales-hub-template) and the AIMEAT_SECRETARY_ENABLED env pin.
 *   v1.3.0 -- 2026-07-19 -- Add e2e-appdev-pitfalls.ts (AppDev Knowledge Base Phase 1).
 *   v1.4.0 -- 2026-07-26 -- Add e2e-agent-file-handoff.ts (giving an agent a file: owner-visibility
 *            read via /v1/pub, DM attachment refs, task attachments).
 *   v1.5.0 -- 2026-07-29 -- --test= resolution: exact suite name wins over substring, and an
 *            ambiguous substring exits non-zero instead of silently picking the first match
 *            (--test=security ran e2e-zip-security and never ran e2e-security).
 *   v1.7.0 -- 2026-08-07 -- Add e2e-remake-funnel.ts (remake phase 0: onboarding.track separation)
 *            e2e-remake-home.ts (remake phases 2-3: the welcome mat gate) and
 *            e2e-registration-invites.ts (remake phase 4b: the agent door).
 *   v1.11.0 -- 2026-08-11 -- Add e2e-account-security-gate.ts: the doors that decide who can sign in
 *            as the person (password, recovery address, TOTP, identity proof, account delete and
 *            export), probed with an agent JWT, an app-grant token and a second owner. None of them
 *            carried a role gate before the August 2026 audit, and all of them key off the owner
 *            name that every one of those tokens carries.
 *   v1.10.0 -- 2026-08-11 -- Add e2e-group-sharing.ts: the half of sharing groups that e2e-sharing-groups
 *            never touched. That suite manages a group in 17 assertions and never reads a record with
 *            one, which is how the sharing itself stayed broken on both backends under a green run.
 *   v1.9.0 -- 2026-08-11 -- Add e2e-app-publish-gate.ts (the build-spec token + the publish-time
 *            artifact check: what refuses a publish, and what merely warns).
 *   v1.8.0 -- 2026-08-10 -- Register the three suites that were in no runner at all: cortex-e2e.ts,
 *            e2e-profile-tabs.ts and e2e-audio-speech.ts. Between them 160 assertions had been
 *            executing nowhere, in one case for a month, and each was a handful of stale
 *            expectations away from green. Nothing here was "disabled": there is one list, and a
 *            file that is not on it is silent rather than skipped, which is why nobody noticed.
 *            e2e-email.ts stays out, with its documented reason below.
 *   v1.6.0 -- 2026-07-30 -- A suite that never RAN no longer renders as a tick. One with a syntax
 *            error exits non-zero having reported nothing, so `failed` was 0 and the row printed
 *            "OK 0 0 0" -- which reads as "nothing to test here" rather than "this never compiled".
 *            The overall exit code was already correct; the human-readable report was not, and the
 *            report is what anyone actually reads. Now marked "!  DID NOT RUN (exit N)" with a
 *            count under the totals.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cleanDatabase,
    ensureDatabase,
    laneTarget,
    pinnedEnv,
    reportEnvLeaks,
    resolveTarget,
    startServer,
    stopServer,
    type RunnerTarget,
} from './run-e2e-server.js';

const ALL_SUITES = [
    'test/api-full.ts',
    'test/e2e-admin-features.ts',
    'test/e2e-agent-activity.ts',
    'test/e2e-agent-capabilities.ts',
    'test/e2e-anonymous.ts',
    'test/e2e-auth-lib.ts',
    'test/e2e-account-security-gate.ts',
    'test/e2e-totp-lifecycle.ts',
    'test/e2e-passkeys.ts',
    'test/e2e-auth-tarpit.ts',
    'test/e2e-oauth-login.ts',
    'test/e2e-session-refresh.ts',
    'test/e2e-access-tokens.ts',
    'test/e2e-apps.ts',
    'test/e2e-app-agent-deploy.ts',
    'test/e2e-app-draft.ts',
    'test/e2e-app-draft-edit.ts',
    'test/e2e-app-screenshot-capture.ts',
    'test/e2e-app-publish-gate.ts',
    'test/e2e-app-playtest.ts',
    'test/e2e-app-ui.ts',
    'test/e2e-designbook.ts',
    'test/e2e-app-fork.ts',
    'test/e2e-app-marks.ts',
    'test/e2e-app-legal.ts',
    'test/e2e-app-rows.ts',
    'test/e2e-app-store-license.ts',
    'test/e2e-catalogue-identity.ts',
    'test/e2e-app-protect.ts',
    'test/e2e-app-descriptions.ts',
    'test/e2e-app-copyscan.ts',
    'test/e2e-apps-moderation.ts',
    // Self-spawns its own server with the app-origin flag ON (the shared server keeps it
    // OFF), so it owns its lifecycle rather than running against BASE_URL.
    'test/e2e-app-origin.ts',
    // Self-spawns its own server with the portfolio-origin flag ON (same pattern).
    'test/e2e-portfolio-origin.ts',
    'test/e2e-app-grants.ts',
    'test/e2e-app-grants-tasks.ts',
    'test/e2e-app-members.ts',
    'test/e2e-app-silent.ts',
    // Self-spawns with the app-origin flag ON: it needs a real app-grant token to prove the
    // SSE change domains are scope-gated (an app must not learn what it has no scope for).
    'test/e2e-sse.ts',
    'test/e2e-apps-backup.ts',
    'test/e2e-board-access.ts',
    'test/e2e-board-ttl.ts',
    'test/e2e-calibrator.ts',
    'test/e2e-concurrency.ts',
    // Starts a REAL OAuth provider on a fixed loopback port (agreed with the server env above) that
    // rotates its refresh token, so the concurrency assertions test the guard rather than a stub.
    'test/e2e-connections.ts',
    'test/e2e-disputes.ts',
    // DISABLED: e2e-email.ts always fails locally/CI because there are no SMTP
    // credentials configured to actually send email. Re-enable once a test mail
    // sender (or credentials) is available. -- disabled 2026-06-14
    // 'test/e2e-email.ts',
    // Self-spawns its own server with AIMEAT_EMAIL_CONFIRMATION_REQUIRED=true (the shared server keeps
    // it OFF) to exercise the login email-gate + /v1/ghii/login/attach-email recovery flow. No SMTP needed.
    'test/e2e-login-attach-email.ts',
    'test/e2e-extensions.ts',
    'test/e2e-ext-paywall.ts',
    'test/e2e-ext-files.ts',
    // ctx.workspace: an extension acting on its CALLER's organism workspace, as the caller, through
    // the same functions the MCP tools run. One happy path and seven refusals, each a door.
    'test/e2e-extension-workspace.ts',
    // The same capability on the road that did not have it: an extension on a clock, writing bytes
    // into the INSTALLER's namespace so a scheduled producer and a hand-run one land at one address.
    'test/e2e-scheduled-ext-files.ts',
    // TARGET-063 slice 1 end to end: a package produced by a run with nobody present, read by a
    // program with no session, and read back by an agent that is never told the columns.
    'test/e2e-datapackage-slice1.ts',
    // The OData v4 feed: the three documents a native connector fetches, the query subset, and
    // above all the refusals — an ignored query option returns the wrong rows and looks like data.
    'test/e2e-datapackage-odata.ts',
    // The gates the August 2026 audit added around extensions: what a manifest may declare,
    // and who may read an action's source. Each test names the thing that used to be possible.
    'test/e2e-ext-hardening.ts',
    // Two owners, two MCP sessions, and owner B trying every door that was open until
    // 2026-08-11. Every one of those gates passed the existing suites on its first run, which is
    // the finding rather than the reassurance: nothing had ever asked.
    'test/e2e-mcp-cross-owner.ts',
    // The organism namespace rule, which lived in an Express middleware the MCP write path could
    // not call — so the consent layer, the meta.* admin rule and the member.* self-write rule held
    // on the browser and not on the agent.
    'test/e2e-mcp-organism-namespace.ts',
    // The MCP task lifecycle, which nothing exercised — which is why five differences from the REST
    // routes survived every green run.
    'test/e2e-mcp-agent-tasks.ts',
    'test/e2e-mcp-crew.ts',
    // Running a schedule NOW from the surface that creates them. Creating a 07:00 job over MCP has
    // always worked; proving it works could only be done over HTTP, so nobody did.
    'test/e2e-mcp-schedule-trigger.ts',
    // Where an agent's HOST manages it: a sibling may report the address (that is the whole point),
    // and the scheme check, because the stored value becomes a link in the owner's own session.
    'test/e2e-agent-console-url.ts',
    // Deleting an agent has to end its sessions. Nothing asked until this suite, and the answer was
    // no: the record went and every 90-day credential it held kept authenticating.
    'test/e2e-agent-token-revocation.ts',
    // A fleet concierge ending the agents it created, and the three conditions that let it — each
    // one proven load-bearing on its own, because two of them are individually far too wide.
    'test/e2e-agent-delete-by-sibling.ts',
    // Agent v2: the key-and-card identity and the one button it exists to make work. Opens a REAL
    // tunnel socket, because the whole point of the enrolment path is that the daemon is ALREADY
    // connected — a mock would prove the handler and not the thing. Carries the cross-owner,
    // scope-escalation, replay, forged-card and grant-reuse refusals.
    'test/e2e-agent-v2.ts',
    // Agent v2 V2: the two primitives (discover + invoke) and, as much of the suite as the feature
    // itself, the proof that the old door is unchanged — the same call refused by scope directly is
    // refused through invoke, and nothing reachable before stopped being reachable.
    'test/e2e-agent-v2-primitives.ts',
    // Agent v2 V4: the turn between two principals, and the delivery target that reaches one
    // which is not connected. Starts a REAL loopback listener and reads what actually left the
    // node: the envelope, the echoed token, the Authorization header. Half the suite asserts
    // that the five message kinds which already existed answer exactly what they answered.
    'test/e2e-agent-v2-messaging.ts',
    // Agent v2 V5: the task handle, in MCP's task shape. Reads every A2A state off a real task,
    // including the three recovered from what sits beside the status, and RUNS the race the
    // conditional update exists for: a worker completing while the caller cancels.
    'test/e2e-agent-v2-tasks.ts',
    // Agent v2 V6a: this node's agents answering A2A. Speaks real JSON-RPC at the real door,
    // and asserts the crossings rather than the round trips — work made over A2A is in the V5
    // roster, work made over REST reads over A2A. Also measures the per-method scope gate the
    // route-scope exemption for this door promises.
    'test/e2e-agent-v2-a2a.ts',
    // Agent v2 V6b: an AIMEAT agent presented to a code editor over ACP. The editor in the
    // suite is the SDK's own client on the other end of an in-memory stream pair, so what is
    // expected of our side is decided by the protocol rather than by us; everything below
    // session/prompt is the real node and a real task settled by a real worker.
    'test/e2e-agent-v2-acp.ts',
    // Agent v2 V6d: a front end watching an agent work, over AG-UI. Reads the event STREAM and
    // drives the task from the other side while it is open, because a test that waited for the
    // response to finish would pass on a door that sent everything at the end.
    'test/e2e-agent-v2-agui.ts',
    // Does an open page hear about work an agent does? 21 of the 31 writing tool files emitted no
    // SSE change domain at all, so the write landed and the screen stayed as it was.
    'test/e2e-mcp-sse-parity.ts',
    // Self-spawns its own node with AIMEAT_PACING_TOLL_DEFAULT set: the feature IS the node-wide
    // default, so it cannot be proven on the shared server.
    'test/e2e-pacing.ts',
    'test/e2e-exchange.ts',
    'test/e2e-exchange-projection.ts',
    // The MCP half of EXCHANGE (act-on-exchange tools). It existed unregistered, so nothing was
    // guarding the metered app-tool call an MCP client makes — which is how a stale session token
    // silently broke every one of them.
    'test/e2e-exchange-mcp.ts',
    // The second rake: revenue a provider shares with third parties, out of their own cut.
    'test/e2e-beneficiary-split.ts',
    // The agent surface for the same thing: the REST routes shipped without one.
    'test/e2e-mcp-beneficiary.ts',
    'test/e2e-extension-secrets.ts',
    'test/e2e-iam-extension.ts',
    'test/e2e-upsert.ts',
    'test/e2e-federation.ts',
    'test/e2e-presence.ts',
    'test/e2e-federation-visiting.ts',
    'test/e2e-federation-contact-link.ts',
    'test/federation-support.ts',
    'test/e2e-federation-policy.ts',
    'test/e2e-federation-relay-claim.ts',
    'test/e2e-federation-nodeinfo.ts',
    'test/e2e-federation-book.ts',
    'test/federation-mesh.ts',
    'test/federation-multinode.ts',
    'test/federation-messages.ts',
    'test/e2e-memory-full.ts',
    'test/e2e-hello-mcp.ts',
    'test/e2e-device-token-grace.ts',
    'test/e2e-agent-reapproval.ts',
    // What the agent ASKED FOR reaching the person who approves it — and not reaching the
    // unauthenticated door, and not rewriting a grant already made.
    'test/e2e-device-auth-requested-scopes.ts',
    'test/e2e-agent-health.ts',
    'test/e2e-open-items.ts',
    'test/e2e-app-access-code.ts',
    'test/e2e-onboarding-funnel.ts',
    'test/e2e-remake-funnel.ts',
    'test/e2e-remake-home.ts',
    // The account's own record, and the mount-order collision that made its window unreadable.
    'test/e2e-account-events.ts',
    'test/e2e-operator-welcome.ts',
    'test/e2e-registration-invites.ts',
    'test/e2e-login-by-email.ts',
    'test/e2e-owner-usage.ts',
    'test/e2e-owner-home.ts',
    // BR-04: deactivation ends every credential family, now; each assertion is a refusal.
    'test/e2e-owner-deactivation.ts',
    // BR-04: SAML organisation sign-in over live HTTP — doors, discovery, invite/disable refusals.
    'test/e2e-saml-login.ts',
    // BR-04: SCIM provisioning — the directory's lifecycle, and every isolation boundary as a refusal.
    'test/e2e-scim-users.ts',
    'test/e2e-ai-jobs.ts',
    'test/e2e-ai-usage-history.ts',
    'test/e2e-ai-provenance.ts',
    'test/e2e-ai-provenance-surfaces.ts',
    'test/e2e-ai-provenance-agent-plane.ts',
    // Spawns the real `aimeat connect serve --http` daemon: the CONNECTOR's two tool surfaces
    // (MCP + shell-callable) are separate code from src/mcp/, and they carried no provenance at all.
    'test/e2e-ai-provenance-connector.ts',
    // Every publish door, because for a while the answer to "did the declaration survive?" depended
    // on which one you came through — and three of the four said no, in silence.
    'test/e2e-app-publish-provenance-doors.ts',
    'test/e2e-app-ai-posture.ts',
    // Where a published app says it puts what, the draft the node makes when it says nothing, and
    // the check that reports the difference — asserting at every door that it WARNS and never blocks.
    'test/e2e-data-map.ts',
    'test/e2e-notifications.ts',
    'test/e2e-hooks.ts',
    'test/e2e-knowledge.ts',
    'test/e2e-libs.ts',
    'test/e2e-library-packs.ts',
    'test/e2e-appdev-pitfalls.ts',
    'test/e2e-appdev-overview.ts',
    'test/e2e-dependency-map.ts',
    'test/e2e-component-versions.ts',
    'test/e2e-appdev-flow.ts',
    'test/e2e-mcp.ts',
    'test/e2e-mcp-scopes.ts',
    'test/e2e-mcp-v2.ts',
    // Self-spawns its own server with the app origin ON (the shared one pins it OFF), the same
    // way e2e-app-origin does: an app's public address only exists when that flag is set.
    'test/e2e-mcp-orientation.ts',
    // Spawns its own servers: the operator switch is a config flag, so proving it takes a node
    // started with the feature off.
    'test/e2e-proactive-mode.ts',
    'test/e2e-mcp-boards.ts',
    'test/e2e-mcp-extensions.ts',
    'test/e2e-mcp-knowledge.ts',
    'test/e2e-mcp-appdev-pitfalls.ts',
    'test/e2e-app-template-proposals.ts',
    'test/e2e-appdev-proofs.ts',
    'test/e2e-mcp-organisms.ts',
    'test/e2e-mcp-workspaces.ts',
    'test/e2e-organism-workspace-access.ts',
    'test/e2e-organism-provision.ts',
    // organism:write on the three organism WRITE doors. They used requireRoleOrScope('agent', …),
    // whose role path runs before it reads a scope, so the word bound the MCP tool surface and let
    // the same agent create organisms over HTTP. Includes the boot migration that keeps an existing
    // agent from losing the capability, run against the real backend.
    'test/e2e-organism-scope-gate.ts',
    // The trap an admin is left in when ownership moves, and the operator break-glass that is the
    // only way out of it. Four refusals guard the door, including an operator's own '*' agent.
    'test/e2e-organism-owner-repair.ts',
    'test/e2e-intake.ts',
    'test/e2e-organism-workspace-engagements.ts',
    'test/e2e-write-guards.ts',
    'test/e2e-wallet-page.ts',
    'test/e2e-data-wallet-page.ts',
    'test/e2e-access-page.ts',
    'test/e2e-invitations.ts',
    'test/e2e-invite-grants.ts',
    'test/e2e-contact-picker.ts',
    'test/e2e-contacts.ts',
    'test/e2e-agent-offers.ts',
    'test/e2e-commerce.ts',
    'test/e2e-commerce-holds.ts',
    'test/e2e-compliance-report.ts',
    'test/e2e-attestations.ts',
    'test/e2e-finance.ts',
    'test/e2e-finance-per-company.ts',
    'test/e2e-outbound.ts',
    'test/e2e-signals.ts',
    'test/e2e-outbound-organism-sender.ts',
    'test/e2e-companies.ts',
    'test/e2e-money-audit.ts',
    'test/e2e-x402.ts',
    'test/e2e-x402-testnet.ts',
    'test/e2e-organism-membership.ts',
    'test/e2e-organism-member-visibility.ts',
    'test/e2e-anonymous-identity-leaks.ts',
    'test/e2e-organism-search.ts',
    'test/e2e-organism-dangling-refs.ts',
    'test/e2e-librarian.ts',
    'test/e2e-discover.ts',
    'test/e2e-agent-readiness.ts',
    'test/e2e-transparency-page.ts',
    'test/e2e-notebook-plan.ts',
    'test/e2e-organism-overview.ts',
    'test/e2e-organism-structure.ts',
    'test/e2e-organism-decision-cap.ts',
    'test/e2e-admin-storage-stats.ts',
    'test/e2e-metrics.ts',
    'test/e2e-auth-refusals.ts',
    'test/e2e-admin-security-page.ts',
    'test/e2e-living-pulse.ts',
    'test/e2e-registration-mode.ts',
    'test/e2e-mcp-session-expiry.ts',
    'test/e2e-usage-telemetry.ts',
    'test/e2e-organism-delete-cascade.ts',
    'test/e2e-organism-bulk-delete.ts',
    'test/e2e-organism-bulk-publish.ts',
    'test/e2e-organism-bulk-app-origin.ts',
    'test/e2e-organism-comments.ts',
    'test/e2e-organism-batch.ts',
    'test/e2e-organism-archive.ts',
    'test/e2e-workspace-export-import.ts',
    'test/e2e-zip-security.ts',
    'test/e2e-static-hardening.ts',
    'test/e2e-surface-layout.ts',
    'test/e2e-workspace-activity.ts',
    'test/e2e-workspace-update.ts',
    'test/e2e-workspace-kpi.ts',
    'test/e2e-workspace-revert.ts',
    'test/e2e-workspace-publish-guard.ts',
    'test/e2e-workspace-retention.ts',
    'test/e2e-workspace-backing-gate.ts',
    'test/e2e-workspace-rows.ts',
    'test/e2e-workspace-doc-edit.ts',
    'test/e2e-workspace-public-sharing.ts',
    'test/e2e-workspace-public-records.ts',
    'test/e2e-workspace-member-records.ts',
    'test/e2e-signage-agent-faced.ts',
    'test/e2e-mcp-catalogue.ts',
    'test/e2e-mcp-memory-extended.ts',
    'test/e2e-mcp-wallet-extended.ts',
    'test/e2e-mcp-companies.ts',
    'test/e2e-mcp-packages.ts',
    'test/e2e-mcp-consent.ts',
    'test/e2e-mcp-chat-instances.ts',
    'test/e2e-mcp-flags.ts',
    'test/e2e-mcp-commerce.ts',
    'test/e2e-mcp-prompts.ts',
    'test/e2e-mcp-install.ts',
    'test/e2e-packages.ts',
    'test/e2e-package-compose.ts',
    'test/e2e-businesslauncher.ts',
    'test/e2e-company-brain.ts',
    'test/e2e-personal-node.ts',
    'test/e2e-connect-tunnel.ts',
    'test/e2e-connect-tunnel-multiplex.ts',
    'test/e2e-connect-tunnel-delivery.ts',
    'test/e2e-connect-tunnel-records.ts',
    'test/e2e-agent-crew.ts',
    'test/e2e-connect-serve-loopback.ts',
    'test/e2e-phase0.ts',
    'test/e2e-projects.ts',
    'test/e2e-portal.ts',
    'test/e2e-header-nav.ts',
    // Every API call the profile tabs make, 111 assertions of it. Registered in no runner since it
    // was written, which is also why 13 `assert(status < 500)` lines survived inside it.
    'test/e2e-profile-tabs.ts',
    'test/e2e-security.ts',
    // Owns its server, twice: sealing is decided at boot from the environment, so it cannot be
    // switched on against the shared node here. It follows THIS runner's backend rather than
    // hardcoding sqlite, so the both-backends claim is real.
    'test/e2e-sealed-config.ts',
    'test/e2e-memory-namespaces.ts',
    'test/e2e-presigned-meta.ts',
    'test/e2e-memory-file-presigned.ts',
    'test/e2e-storage-visibility.ts',
    'test/e2e-subdomains.ts',
    'test/e2e-capabilities.ts',
    // The other side of the capability record: the fields the NODE writes about it. PUT merged the
    // whole body, so an owner could award themselves the operator's review.
    'test/e2e-capability-trust-guard.ts',
    // Updating the webhook a capability is invoked through, which is the field that decides where a
    // paying caller's payload is delivered.
    'test/e2e-capability-webhook-update.ts',
    'test/e2e-upload.ts',
    'test/cortex-ui-e2e.ts',
    // The cortex CORE suite, as opposed to cortex-ui above. Left out on 2026-07-10 over "2
    // pre-existing unrelated fails" and never picked back up, so 43 assertions about install,
    // lifecycle, schemas, prompts and cross-owner refusal ran nowhere for a month. One of those
    // two fails was real: a schema key_pattern of the form `chart:*` matched nothing, so every
    // schema a cortex pack declared validated nothing.
    'test/cortex-e2e.ts',
    'test/openrouter.ts',
    // The audio/speech served libs and their sample files — also registered nowhere until now.
    'test/e2e-audio-speech.ts',
    'test/e2e-ai-transcribe.ts',
    'test/e2e-ai-image.ts',
    'test/e2e-chat.ts',
    'test/e2e-llm-proxy.ts',
    'test/e2e-message-transcript.ts',
    'test/ai.ts',
    'test/e2e-sharing-groups.ts',
    // The other half of the same feature: e2e-sharing-groups proves a group can be MANAGED,
    // this proves it grants a cross-owner read (and that removing a member takes it away).
    'test/e2e-group-sharing.ts',
    // Sharing a KEY SPACE rather than one record at a time: a pattern covers keys written later,
    // one record can be in several shares, and both sides can see what was given.
    'test/e2e-key-space-shares.ts',
    'test/e2e-agent-tasks.ts',
    'test/e2e-agent-file-handoff.ts',
    'test/e2e-agent-schedules.ts',
    'test/e2e-agent-quality.ts',
    'test/e2e-agent-directives.ts',
    'test/e2e-agent-messages.ts',
    'test/e2e-messages.ts',
    'test/e2e-agent-dm.ts',
    'test/e2e-dm-send-as-owner.ts',
    'test/e2e-interactive-messages.ts',
    'test/e2e-broadcast.ts',
    'test/e2e-chat-capabilities.ts',
    'test/e2e-members.ts',
    'test/e2e-tracked-response.ts',
    'test/e2e-attachment-sweep.ts',
    'test/e2e-agent-services.ts',
    'test/e2e-prompt-modules.ts',
    'test/e2e-integration-kit.ts',
    'test/e2e-inbox-cursor.ts',
    'test/e2e-unfurl.ts',
    'test/e2e-agent-telemetry.ts',
    'test/e2e-ledger.ts',
    'test/e2e-ledger-admin.ts',
    'test/e2e-agent-webhook.ts',
    'test/e2e-agent-skill-bundle.ts',
    'test/e2e-skills.ts',
    'test/e2e-agent-onboarding.ts',
    'test/e2e-agent-connect-email.ts',
    'test/e2e-agent-runtime-source.ts',
    'test/e2e-memory-bin.ts',
    'test/e2e-agent-me-and-discovery.ts',
    'test/e2e-ecosystem-app-foundation.ts',
    'test/e2e-ecosystem-automation.ts',
    'test/e2e-ecosystem-automation-recipe.ts',
    'test/e2e-ecosystem-events.ts',
    'test/e2e-ecosystem-capabilities.ts',
    'test/e2e-ecosystem-validation.ts',
    'test/e2e-agent-governance.ts',
    'test/e2e-workflows.ts',
    'test/e2e-workflows-human.ts',
    // The step kind a workflow was missing: an extension action, run on this node with no agent
    // online and no model in the path, gated by the same success_signal as every other step.
    'test/e2e-workflow-extension-step.ts',
    'test/e2e-public-activity.ts',
    'test/e2e-public-totals.ts',
    'test/e2e-cortex-upload-ownership.ts',
];

/**
 * THE GUARD TIER — the suites CI refuses to merge without.
 *
 * Both E2E steps in .github/workflows/ci.yml carried `continue-on-error: true` from the day they were
 * added, so a red sweep has never blocked anything: the whole suite was advisory, and improving it
 * was volunteer work. Removing that flag from the full sweep is not the fix — it takes about two
 * hours, the runner's own database-cleanup race can hand one suite the previous one's data
 * (docs/pitfalls.md §18), and a gate that is slow and occasionally wrong gets switched off again
 * within a week.
 *
 * So a small tier blocks instead. Membership is one question: does a failure here mean a principal
 * can reach money, an identity, or another account's data that they must not? Everything below either
 * asserts a refusal or asserts an isolation boundary. Measured 2026-08-15 on both backends: 407
 * assertions, under a minute — cheap enough that nobody has a reason to skip it.
 *
 * A suite named here that is not in ALL_SUITES exits 1 rather than running fewer tests quietly, which
 * is what a rename would otherwise do. Adding to this list is welcome; removing from it is a decision
 * to stop guarding something, and the reason belongs in the commit that does it.
 *
 * THE TWO THAT WERE HELD BACK ARE IN. e2e-money-audit and e2e-zip-security were kept out on
 * 2026-08-15 because their result depended on what had run before them: both need an operator, and
 * both get one by registering the first owner on the node, which routes/ghii/register-login.ts
 * promotes only while no operator exists yet.
 *
 * That was not the flake it looked like. e2e-money-audit boots a node of its OWN, and nothing pinned
 * AIMEAT_SQLITE_PATH, whose default in config.ts is `./data/aimeat.db` — so on the sqlite backend
 * that node never touched the test database at all. It ran against the DEVELOPER'S working node:
 * 242 owners measured in that file, 241 of them from past runs of this one suite, and the seed
 * account of its first ever run still holding the operator role, which is why every run after that
 * one failed the same 18 assertions. run-e2e-server.ts pins the path now and the suite takes a
 * private file of its own; both suites are green repeatedly on both backends.
 */
const GUARD_SUITES = [
    'test/e2e-account-security-gate.ts',    // the doors back INTO the account: password, recovery, 2FA, deletion
    'test/e2e-organism-scope-gate.ts',      // organism:write means the same thing on the HTTP door and the tool surface
    'test/e2e-write-guards.ts',             // which principal may write into which namespace
    'test/e2e-security.ts',                 // the cross-cutting refusals: auth, injection, traversal, rate limits
    'test/e2e-mcp-cross-owner.ts',          // one owner's agent reaching another owner's data through MCP
    'test/e2e-app-grants.ts',               // the scope fence around an app grant, the one principal requireScope stops
    'test/e2e-agent-token-revocation.ts',   // revoking a credential actually ends it
    'test/e2e-memory-namespaces.ts',        // owner, ext: and eco: namespaces stay apart
    'test/e2e-anonymous-identity-leaks.ts', // what an unauthenticated caller can learn about who exists here
    'test/e2e-mcp-scopes.ts',               // the tool surface is filtered by the words the owner ticked
    'test/e2e-board-access.ts',             // reading, posting and replying on a board you were not let into
    'test/e2e-storage-visibility.ts',       // private, shared and public files, and who may fetch which
    'test/e2e-money-audit.ts',              // no path mints, double-spends or bills the wrong account
    'test/e2e-zip-security.ts',             // an uploaded archive cannot write outside where it was unpacked
    'test/e2e-federation-contact-link.ts',  // a contact link carries messages and refuses every other door
    'test/e2e-federation-relay-claim.ts',   // a receiving node refuses a relay from a peer it demoted
    'test/e2e-static-hardening.ts',         // a dotfile (.env, .env~, .git/) is refused before any static handler
    'test/e2e-owner-deactivation.ts',       // deactivating an account ends every credential family, now (BR-04)
    'test/e2e-saml-login.ts',               // the organisation sign-in doors: who signs in, and every refusal (BR-04)
    'test/e2e-scim-users.ts',               // a directory drives accounts; connection isolation and the operator fence (BR-04)
    // ── Promoted 2026-09-04, each one earned by §18: alone, on a freshly deleted database, three
    // consecutive identical green runs on BOTH backends. The tier's question is unchanged — does a
    // failure here mean a principal can reach money, an identity, or another account's data that
    // they must not? Everything below answers yes.
    'test/e2e-app-members.ts',              // who is approved into an app, and who is handed free access to what its owner sells
    'test/e2e-invitations.ts',              // an invitation is a capability: the email binding, and who may spend it
    'test/e2e-invite-grants.ts',            // what an accepted invitation actually grants, and what it must not
    'test/e2e-registration-mode.ts',        // open, invite-only, closed: which road into this node is open right now
    'test/e2e-access-tokens.ts',            // a PAT is a credential the human minted; its scopes, its ceiling, its end
    'test/e2e-auth-lib.ts',                 // the sign-in library itself: what a wrong credential gets
    'test/e2e-auth-tarpit.ts',              // repeated failures slow down instead of answering faster
    'test/e2e-knowledge.ts',                // the operator's moderation record, and whose packages a caller may read
    'test/e2e-app-store-license.ts',        // buying spends the human's morsels; who may, and what a licence follows
    'test/e2e-commerce.ts',                 // the checkout rail: who pays, how much, and who is refused
    'test/e2e-exchange.ts',                 // what a seller sells, what a contract entitles, and what it does not
    'test/e2e-beneficiary-split.ts',        // where the money goes after a sale, and who may change that
    'test/e2e-finance.ts',                  // the ledger a person reads about their own money
    'test/e2e-mcp-commerce.ts',             // the same money doors over MCP, which is a different surface with the same rules
    'test/e2e-mcp-beneficiary.ts',          // …and the payout half of it
    'test/e2e-catalogue-identity.ts',       // a published action carries the RESOLVED identity, never the raw sub
    'test/e2e-app-origin.ts',               // an app's own subdomain is a security boundary, not a convenience
    'test/e2e-app-fork.ts',                 // forking someone else's app: what comes with it and what must not
    'test/e2e-subdomains.ts',               // which host serves what, and what a wrong host must not reach
    'test/e2e-contacts.ts',                 // who may see that a person exists here, and who they know
    'test/e2e-key-space-shares.ts',         // a share is a key-prefix grant; its edges are the whole of it
    'test/e2e-organism-membership.ts',      // membership decides every organism read; joining, leaving and being removed
    'test/e2e-workspace-public-sharing.ts', // what "public" means for a workspace, one object at a time
    'test/e2e-mcp-workspaces.ts',           // the same workspace fences over MCP
    'test/e2e-mcp-organism-namespace.ts',   // an organism's namespace stays its own on the tool surface
    'test/e2e-mcp-knowledge.ts',            // knowledge packages over MCP, including whose a caller may reach
    'test/e2e-mcp-extensions.ts',           // installing and invoking an extension through the tool surface
    'test/e2e-mcp-agent-tasks.ts',          // an agent's tasks are its own; the tool surface must agree
    'test/e2e-agent-tasks.ts',              // …and the HTTP door that says the same thing
    'test/e2e-agent-v2.ts',                 // the Agent v2 identity: enrolment, run mode, and what each is allowed
    'test/e2e-agent-v2-tasks.ts',           // v2 task lifecycle across principals
    'test/e2e-agent-v2-a2a.ts',             // an agent on ANOTHER node, and what a cross-node caller may do here
    'test/e2e-workflows-human.ts',          // a parked question waits for a person; who may answer it
    'test/e2e-iam-extension.ts',            // the permission model an app runs on, and the admin surface behind it
    'test/e2e-skills.ts',                   // a published skill is readable by design; what stays private is the point
    'test/e2e-designbook.ts',               // proposing and adopting shared design decisions across owners
    'test/e2e-packages.ts',                 // a package crosses an owner boundary; every edge of that crossing
    'test/e2e-companies.ts',                // a company record and who may speak for it
    'test/e2e-connections.ts',              // an outside account connected to this one: tokens, scopes and revocation
    'test/e2e-compliance-report.ts',        // the report reaches every account, so the word for it is outside the wildcard
    'test/e2e-admin-features.ts',           // the operator surface, and every non-operator refused at it
    'test/e2e-ai-provenance.ts',            // what a record claims about who wrote something
    'test/e2e-ai-provenance-agent-plane.ts',// …as an agent sees it
    'test/e2e-ai-provenance-surfaces.ts',   // one record read four ways, and the identical 404 that hides the rest
    'test/e2e-extension-workspace.ts',      // a sandboxed script reaching a workspace as its caller: membership, scope, schema, version, budget
];

// Every other .ts file in test/, with the reason it is not a suite. The reason is the point: someone
// reading this a year from now needs to tell a file that was judged and left out from one nobody
// ever noticed, and the list above cannot make that distinction on its own.
const NOT_SUITES = new Map<string, string>([
    ['run-e2e-ci.ts', 'this runner'],
    ['run-e2e-server.ts', "the runner's server lifecycle, environment pins and database cleanup: imported, never spawned"],
    ['run-playwright-ci.ts', 'the Playwright runner; that suite is not run here, frontend changes are verified by driving a real browser'],
    ['manual-dm-helper.ts', 'manual helper for browser verification: it needs a person watching the Inbox tab, and it writes to whichever node DM_BASE names'],
    ['pg-kysely-memory.ts', 'storage-provider integration test: it drives a live Postgres over AIMEAT_TEST_PG_URL with no HTTP server, so it has nothing to say to BASE_URL'],
    ['e2e-email.ts', 'disabled; the reason and the date are on the commented-out entry in ALL_SUITES'],
]);

// Filled by reconcileSuiteList so the summary can repeat the finding. A warning printed before a
// two-hour run has scrolled well out of sight by the time anyone reads the result.
let unregistered: string[] = [];

/**
 * Hold ALL_SUITES against the directory it claims to describe.
 *
 * A suite on no list does not report as skipped. It produces no row, no assertion count and no exit
 * code, so the run looks complete and the file looks fine. Six suites were in that state on
 * 2026-08-10, one of them for a month and several assertions away from green, and every one was
 * found by reading the directory rather than the list. A list cannot notice its own gaps, so the
 * check has to come from the other side.
 *
 * Drift is fatal on a full run and a warning on a filtered one. Only a full run claims to have
 * tested everything, and an unregistered file is exactly what makes that claim false; a run of one
 * named suite claims nothing else, so it says its piece and continues, which also keeps a
 * half-written file from blocking every other run in the tree. AIMEAT_E2E_ALLOW_UNREGISTERED=1
 * downgrades the fatal case for whoever needs the sweep while a new suite is still being written.
 *
 * The reverse drift, registered with no file, is reported and not fatal. It is already loud: the
 * suite exits non-zero having reported nothing, which the summary prints as DID NOT RUN and which
 * fails the run. Registering a suite slightly before it lands is the safer order of the two, because
 * late is visible and absent is not.
 *
 * This runs here rather than in a pre-commit check because the runner is the file that owns the
 * list. A check script would catch drift earlier, at commit time, and is worth adding whenever
 * scripts/ is being touched anyway.
 */
function reconcileSuiteList(filtered: boolean): void {
    const testDir = fileURLToPath(new URL('.', import.meta.url));
    const onDisk = readdirSync(testDir).filter(f => f.endsWith('.ts'));
    const registered = new Set(ALL_SUITES.map(s => basename(s)));

    for (const suite of ALL_SUITES) {
        if (!onDisk.includes(basename(suite))) {
            console.warn(`Registered suite has no file yet: ${suite}. It reports DID NOT RUN until the file lands.`);
        }
    }

    unregistered = onDisk.filter(f => !registered.has(f) && !NOT_SUITES.has(f)).sort();
    if (unregistered.length === 0) return;

    console.error(`\n${unregistered.length} file(s) in test/ are on no list, so they run nowhere:`);
    for (const f of unregistered) console.error(`  test/${f}`);
    console.error('Put each one in ALL_SUITES, or in NOT_SUITES with the reason it is not a suite.');

    if (filtered || process.env.AIMEAT_E2E_ALLOW_UNREGISTERED === '1') {
        console.error('Continuing: this run does not claim to have covered everything.\n');
        return;
    }
    process.exit(1);
}

const TARGET = resolveTarget();
const BASE_URL = TARGET.baseUrl;

/**
 * GUARD_SUITES, held against ALL_SUITES first. A guard suite that has been renamed or deleted must
 * be re-pointed here; without this it would reach parseArgs as an unknown name, and the gate would
 * quietly guard one thing less than the list says it does.
 */
function guardSuites(): string[] {
    const known = new Set(ALL_SUITES);
    const missing = GUARD_SUITES.filter(s => !known.has(s));
    if (missing.length > 0) {
        console.error(`\nGUARD_SUITES names ${missing.length} suite(s) that ALL_SUITES does not:`);
        for (const s of missing) console.error(`  ${s}`);
        console.error('Re-point the entry, or take it out deliberately and say why in the commit.\n');
        process.exit(1);
    }
    console.log(`\nGuard tier: ${GUARD_SUITES.length} suites that block a merge. A failure here is a hole, not a flake.`);
    return [...GUARD_SUITES];
}

// ── Parse CLI args ──
function parseArgs(): string[] {
    const args = process.argv.slice(2);
    if (args.includes('--guards')) return guardSuites();
    const tests: string[] = [];
    for (const arg of args) {
        if (arg.startsWith('--test=')) {
            const name = arg.slice(7);
            // Exact match wins over substring. Without this ordering `--test=security`
            // matched `e2e-zip-security` (first in ALL_SUITES) and `e2e-security` never
            // ran — silently, exit code 0. An ambiguous substring is an error, not a
            // first-match guess, for the same reason.
            const exact = ALL_SUITES.find(s =>
                basename(s, '.ts') === name || basename(s, '.ts') === `e2e-${name}`
            );
            const fuzzy = ALL_SUITES.filter(s => s.includes(name));
            if (!exact && fuzzy.length > 1) {
                console.error(`Ambiguous test filter "${name}" matches ${fuzzy.length} suites: ${fuzzy.map(s => basename(s, '.ts')).join(', ')}`);
                console.error('Spell the suite out, e.g. --test=e2e-security');
                process.exit(1);
            }
            const match = exact ?? fuzzy[0];
            if (!match) {
                console.error(`Unknown test suite: ${name}`);
                console.error(`Available: ${ALL_SUITES.map(s => basename(s, '.ts')).join(', ')}`);
                process.exit(1);
            }
            tests.push(match);
        }
        // --all is default behavior (run everything)
    }
    return tests.length > 0 ? tests : ALL_SUITES;
}

// ── Parallel lanes ──
//
// One run, several nodes. `--workers=N` (or AIMEAT_E2E_WORKERS) splits the suites over N lanes,
// each with its own server, its own port and its own database, so every suite still starts on an
// empty node and the tier's promise ("alone, on a freshly deleted database") is unchanged; what
// changes is that four of those nodes live at once. Measured before this existed (2026-09-05): 285
// suites took 38 minutes of which 17.5 were the suites and 20 the restarts between them, and 241
// of the 285 finish in under five seconds each — the restart was most of what a suite cost.
//
// Lane 0 keeps the base port and takes every suite that binds a port of its own (a second node, a
// mesh, the fake connection provider on 40388): two lanes on one fixed port would collide, and the
// runner cannot move a port a suite wrote down. Those are the heavier suites, so lane 0 gets fewer
// of the rest. A lane's suite output is buffered and printed when the suite ends, whole; with one
// lane it streams as before.

function parseWorkers(): number {
    const arg = process.argv.find(a => a.startsWith('--workers='));
    const raw = arg ? arg.slice('--workers='.length) : (process.env.AIMEAT_E2E_WORKERS ?? '1');
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 16) {
        console.error(`--workers must be a whole number from 1 to 16, got "${raw}"`);
        process.exit(1);
    }
    // A server somebody else started is one server.
    return TARGET.external ? 1 : n;
}

/** Every port number a suite has written down, base port excluded: what no lane may be given. */
function fixedPorts(suites: string[]): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const suite of suites) {
        let src: string;
        try { src = readFileSync(suite, 'utf-8'); } catch { continue; }
        // 40251 is the runner's own default and 40050 the dev server's: a suite mentioning either
        // has not claimed a port of its own. Excluding only TARGET.port was wrong the moment a
        // caller overrode it — with AIMEAT_PORT=40512 every suite that so much as names 40251
        // counted as pinned, all 65 landed in lane 0, and a four-lane run silently became one
        // (measured 2026-09-05: "Suites: 65", one lane, 611 s instead of about 300).
        const ports = [...src.matchAll(/\b(40[0-9]{3})\b/g)].map(m => Number(m[1]))
            .filter(p => p !== Number(TARGET.port) && p !== 40050 && p !== 40251);
        if (ports.length > 0) out.set(suite, [...new Set(ports)]);
    }
    return out;
}

/**
 * A lane's own port, from a range no suite writes down. It also has to avoid the port the RUNNER was
 * given: a caller who says AIMEAT_PORT=40512 to keep out of another session's way would otherwise
 * have a lane bind the same number (`taken` covers it, and this comment is why that matters).
 */
function lanePort(lane: number, taken: Set<number>): string {
    for (let p = 40500 + lane; p < 40600; p++) {
        if (taken.has(p)) continue;
        taken.add(p);
        return String(p);
    }
    throw new Error('No free port for a lane between 40500 and 40599.');
}

function planLanes(suites: string[], workers: number, pinned: Map<string, number[]>): string[][] {
    if (workers <= 1) return [suites];
    const lanes: string[][] = Array.from({ length: workers }, () => []);
    const fixed = suites.filter(s => pinned.has(s));
    lanes[0].push(...fixed);
    // A fixed-port suite boots a node of its own and costs about three ordinary suites, so lane 0
    // is weighted accordingly when the next suite looks for the shortest queue.
    const weight = (k: number): number => lanes[k].length + (k === 0 ? 2 * fixed.length : 0);
    for (const s of suites) {
        if (pinned.has(s)) continue;
        let best = 0;
        for (let k = 1; k < workers; k++) if (weight(k) < weight(best)) best = k;
        lanes[best].push(s);
    }
    return lanes.filter(l => l.length > 0);
}

interface SuiteResult {
    name: string; passed: number; failed: number; total: number; time: string; exitCode: number;
    lane: number;
    /** Stop + clean + start before this suite, ms; 0 for a lane's first suite. */
    cycleMs: number;
}

async function runLane(lane: number, target: RunnerTarget, suites: string[], stream: boolean): Promise<SuiteResult[]> {
    const tag = stream ? '' : `[lane ${lane}] `;
    const results: SuiteResult[] = [];
    let server: ChildProcess | null = null;

    // Empty the database BEFORE the first suite, by the same call the loop makes between suites.
    // The version that ran only between them left suite one on whatever the previous run wrote,
    // so a solo run of any suite was a run against stale data.
    if (!target.external) {
        await cleanDatabase(target);
        console.log(`${tag}Cleaned ${target.dbType} test database before the first suite.`);
        server = await startServer(target);
        console.log(`${tag}Server ready on :${target.port}.\n`);
    }

    try {
        for (let i = 0; i < suites.length; i++) {
            const suite = suites[i];
            const name = basename(suite, '.ts');

            // Clean DB and restart server between suites for isolation. stopServer does not return
            // until the old process is gone and its port is free, so the delete below cannot fail
            // on a live file handle and the next suite cannot reach the previous server.
            let cycleMs = 0;
            if (i > 0 && server && !target.external) {
                const c0 = Date.now();
                await stopServer(server, target);
                server = null;
                await cleanDatabase(target);
                server = await startServer(target);
                cycleMs = Date.now() - c0;
            }

            if (stream) {
                console.log(`\n${'─'.repeat(40)}`);
                console.log(`  ${name}`);
                console.log(`${'─'.repeat(40)}`);
            }

            const t0 = Date.now();
            const { output, exitCode } = await runTest(suite, target, stream);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            const parsed = parseResults(output);
            const red = parsed.failed > 0 || exitCode !== 0;
            if (!stream) {
                console.log(`${tag}${red ? '✗' : '✓'} ${name}  ${parsed.passed}/${parsed.total} in ${elapsed}s`);
                // A green suite's output is what the summary already says; a red one's is the point.
                if (red) console.log(output.trimEnd());
            }
            results.push({ name, ...parsed, time: `${elapsed}s`, exitCode, lane, cycleMs });
        }
    } finally {
        if (server) {
            // Reported, not thrown: a failure to shut down must not replace whatever error brought
            // us into this block, which is the thing the reader needs.
            await stopServer(server, target).catch((e: unknown) => {
                console.error(`${tag}Could not stop the test server: ${(e as Error).message}`);
            });
        }
    }
    return results;
}

// ── Run a single test suite ──
function runTest(suitePath: string, target: RunnerTarget, stream: boolean): Promise<{ output: string; exitCode: number }> {
    return new Promise((settle) => {
        // The suite gets the SAME pins as the server. A suite derives what it expects from its own
        // environment, so any pin it cannot see is a place where the two can disagree about what is
        // being tested: e2e-x402-testnet skips when the off-chain double is in use, could not see
        // that it was, and so ran its real-network acceptance cases against the double.
        const child = spawn('node', ['--import', 'tsx', suitePath], {
            env: { ...process.env, ...pinnedEnv(target), E2E_BASE: target.baseUrl },
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd(),
        });

        let output = '';
        child.stdout?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            if (stream) process.stdout.write(s);
        });
        child.stderr?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            if (stream) process.stderr.write(s);
        });

        child.on('close', (code) => {
            settle({ output, exitCode: code ?? 1 });
        });
    });
}

// ── Parse results from test output ──
function parseResults(output: string): { passed: number; failed: number; total: number } {
    const lines = output.split('\n');
    // Try to find a summary line first (most reliable)
    const resultLine = lines.filter(l => /\d+ passed.*\d+ failed/.test(l)).pop();
    if (resultLine) {
        const m = resultLine.match(/(\d+) passed.*?(\d+) failed/);
        if (m) {
            const passed = +m[1];
            const failed = +m[2];
            const totalMatch = resultLine.match(/(?:out of |of |total.*?)(\d+)/);
            const total = totalMatch ? +totalMatch[1] : passed + failed;
            return { passed, failed, total };
        }
    }
    // Fallback: count ✅ and ❌ emoji lines (handles crashes before summary)
    let passed = 0;
    let failed = 0;
    for (const line of lines) {
        if (/^\s*✅/.test(line)) passed++;
        if (/^\s*❌/.test(line)) failed++;
    }
    const total = passed + failed;
    return { passed, failed, total };
}

// ── Main ──
async function main() {
    const suites = parseArgs();
    // parseArgs hands back the ALL_SUITES array itself when no --test was given, so identity is the
    // exact test for "this is the full sweep". If that ever becomes a copy, the check degrades to a
    // warning rather than to a false pass.
    reconcileSuiteList(suites !== ALL_SUITES);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  AIMEAT E2E Test Runner`);
    console.log(`  Server: ${TARGET.external ? BASE_URL + ' (external)' : `auto-start on :${TARGET.port}`}`);
    console.log(`  Storage: ${TARGET.dbType}${TARGET.dbType === 'sqlite' ? ` (${TARGET.dbPath})` : ''}`);
    const workers = parseWorkers();
    const pinned = fixedPorts(suites);
    const lanes = planLanes(suites, workers, pinned);
    console.log(`  Suites: ${suites.length}${lanes.length > 1 ? ` over ${lanes.length} lanes (${lanes.map(l => l.length).join(' + ')}; ${lanes[0].filter(s => pinned.has(s)).length} bind their own port and stay in lane 0)` : ''}`);
    console.log(`${'='.repeat(50)}\n`);

    reportEnvLeaks(pinnedEnv(TARGET));

    // Lane 0 is the base target. Every other lane gets a port no suite has written down and a
    // database of its own, created first for Postgres.
    const taken = new Set<number>([Number(TARGET.port), ...[...pinned.values()].flat()]);
    let targets = lanes.map((_, k) => k === 0 ? TARGET : laneTarget(TARGET, k, lanePort(k, taken)));
    const wall0 = Date.now();
    let results: SuiteResult[] = [];
    try {
        if (!TARGET.external) {
            try {
                for (let k = 1; k < targets.length; k++) await ensureDatabase(TARGET, targets[k]);
            } catch (e) {
                // A role without CREATEDB (the developer's local appuser, as opposed to CI's
                // superuser) cannot have lane databases. One lane on the base database is still a
                // correct run, only slower, so that is what happens, said out loud.
                console.warn(`\n⚠ ${(e as Error).message}\n  Falling back to one lane.\n`);
                lanes.splice(0, lanes.length, suites);
                targets = [TARGET];
            }
        }
        // allSettled, not all: a lane that dies must not leave the others' servers running.
        const settled = await Promise.allSettled(lanes.map((s, k) => runLane(k, targets[k], s, lanes.length === 1)));
        const dead = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
        if (dead.length > 0) {
            for (const d of dead) console.error(`Lane failed: ${(d.reason as Error).message}`);
            process.exit(1);
        }
        results = settled.flatMap(s => (s as PromiseFulfilledResult<SuiteResult[]>).value);
    } catch (e) {
        console.error(`Runner failed: ${(e as Error).message}`);
        process.exit(1);
    }
    // Reported in the order the suites were asked for, whichever lane ran them.
    const order = new Map(suites.map((s, i) => [basename(s, '.ts'), i]));
    results.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    const anyFailed = results.some(r => r.failed > 0 || r.exitCode !== 0);
    const wallMs = Date.now() - wall0;

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log('  SUMMARY');
    console.log(`${'='.repeat(50)}`);
    console.log('');
    console.log('Suite'.padEnd(30) + 'Passed'.padEnd(10) + 'Failed'.padEnd(10) + 'Total'.padEnd(10) + 'Time'.padEnd(10) + (lanes.length > 1 ? 'Lane' : ''));
    console.log('-'.repeat(70));
    let crashed = 0;
    for (const r of results) {
        // A suite that never RAN is not a suite that passed. One with a syntax error exits non-zero
        // having reported nothing, so `failed` is 0 and the row used to render as a tick beside
        // "0 0 0" — which reads as "nothing to test here" rather than "this never compiled".
        const didNotRun = r.exitCode !== 0 && r.total === 0;
        const status = didNotRun ? '!' : r.failed === 0 ? '✓' : '✗';
        const note = didNotRun ? `  DID NOT RUN (exit ${r.exitCode})` : '';
        if (didNotRun) crashed++;
        console.log(`${status} ${r.name.padEnd(28)}${String(r.passed).padEnd(10)}${String(r.failed).padEnd(10)}${String(r.total).padEnd(10)}${r.time.padEnd(10)}${lanes.length > 1 ? String(r.lane) : ''}${note}`);
    }

    const totalPassed = results.reduce((s, r) => s + r.passed, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);
    const totalTests = results.reduce((s, r) => s + r.total, 0);
    console.log('-'.repeat(70));
    console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed out of ${totalTests}`);
    // Where the wall clock went: the suites themselves, and the restarts between them. The second
    // number is the runner's own cost, and it is what --workers divides.
    const suiteMs = results.reduce((s, r) => s + parseFloat(r.time) * 1000, 0);
    const cycles = results.filter(r => r.cycleMs > 0);
    const cycleMs = cycles.reduce((s, r) => s + r.cycleMs, 0);
    console.log(`  Wall ${(wallMs / 1000).toFixed(0)}s over ${lanes.length} lane${lanes.length === 1 ? '' : 's'}: suites ${(suiteMs / 1000).toFixed(0)}s, restarts ${(cycleMs / 1000).toFixed(0)}s across ${cycles.length}${cycles.length ? ` (${(cycleMs / cycles.length / 1000).toFixed(1)}s each)` : ''}`);
    if (crashed > 0) {
        console.log(`  ${crashed} suite(s) DID NOT RUN — they exited non-zero without reporting a single test.`);
    }
    // Repeated from the start of the run, because the summary is the part anyone reads.
    if (unregistered.length > 0) {
        console.log(`  ${unregistered.length} file(s) in test/ are on no list and ran nowhere: ${unregistered.join(', ')}`);
    }

    process.exit(anyFailed ? 1 : 0);
}

main();
