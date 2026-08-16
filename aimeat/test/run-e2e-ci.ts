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
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cleanDatabase,
    pinnedEnv,
    reportEnvLeaks,
    resolveTarget,
    startServer,
    stopServer,
} from './run-e2e-server.js';

const ALL_SUITES = [
    'test/api-full.ts',
    'test/e2e-admin-features.ts',
    'test/e2e-agent-activity.ts',
    'test/e2e-agent-capabilities.ts',
    'test/e2e-anonymous.ts',
    'test/e2e-auth-lib.ts',
    'test/e2e-account-security-gate.ts',
    'test/e2e-oauth-login.ts',
    'test/e2e-session-refresh.ts',
    'test/e2e-access-tokens.ts',
    'test/e2e-apps.ts',
    'test/e2e-app-agent-deploy.ts',
    'test/e2e-app-draft.ts',
    'test/e2e-app-draft-edit.ts',
    'test/e2e-app-screenshot-capture.ts',
    'test/e2e-app-publish-gate.ts',
    'test/e2e-app-fork.ts',
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
    'test/e2e-federation-policy.ts',
    'test/e2e-federation-nodeinfo.ts',
    'test/e2e-federation-book.ts',
    'test/federation-mesh.ts',
    'test/federation-multinode.ts',
    'test/federation-messages.ts',
    'test/e2e-memory-full.ts',
    'test/e2e-hello-mcp.ts',
    'test/e2e-device-token-grace.ts',
    'test/e2e-agent-reapproval.ts',
    'test/e2e-agent-health.ts',
    'test/e2e-open-items.ts',
    'test/e2e-app-access-code.ts',
    'test/e2e-onboarding-funnel.ts',
    'test/e2e-remake-funnel.ts',
    'test/e2e-remake-home.ts',
    'test/e2e-operator-welcome.ts',
    'test/e2e-registration-invites.ts',
    'test/e2e-login-by-email.ts',
    'test/e2e-owner-usage.ts',
    'test/e2e-owner-home.ts',
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
    'test/e2e-notifications.ts',
    'test/e2e-hooks.ts',
    'test/e2e-knowledge.ts',
    'test/e2e-libs.ts',
    'test/e2e-library-packs.ts',
    'test/e2e-appdev-pitfalls.ts',
    'test/e2e-appdev-overview.ts',
    'test/e2e-appdev-flow.ts',
    'test/e2e-mcp.ts',
    'test/e2e-mcp-scopes.ts',
    'test/e2e-mcp-v2.ts',
    // Self-spawns its own server with the app origin ON (the shared one pins it OFF), the same
    // way e2e-app-origin does: an app's public address only exists when that flag is set.
    'test/e2e-mcp-orientation.ts',
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
    'test/e2e-invitations.ts',
    'test/e2e-invite-grants.ts',
    'test/e2e-contact-picker.ts',
    'test/e2e-contacts.ts',
    'test/e2e-agent-offers.ts',
    'test/e2e-commerce.ts',
    'test/e2e-commerce-holds.ts',
    'test/e2e-attestations.ts',
    'test/e2e-finance.ts',
    'test/e2e-outbound.ts',
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
    'test/e2e-workspace-activity.ts',
    'test/e2e-workspace-update.ts',
    'test/e2e-workspace-kpi.ts',
    'test/e2e-workspace-revert.ts',
    'test/e2e-workspace-publish-guard.ts',
    'test/e2e-workspace-retention.ts',
    'test/e2e-workspace-backing-gate.ts',
    'test/e2e-workspace-public-sharing.ts',
    'test/e2e-workspace-public-records.ts',
    'test/e2e-workspace-member-records.ts',
    'test/e2e-signage-agent-faced.ts',
    'test/e2e-mcp-catalogue.ts',
    'test/e2e-mcp-memory-extended.ts',
    'test/e2e-mcp-wallet-extended.ts',
    'test/e2e-mcp-companies.ts',
    'test/e2e-mcp-consent.ts',
    'test/e2e-mcp-chat-instances.ts',
    'test/e2e-mcp-flags.ts',
    'test/e2e-mcp-commerce.ts',
    'test/e2e-mcp-prompts.ts',
    'test/e2e-packages.ts',
    'test/e2e-micro-memory.ts',
    'test/e2e-personal-node.ts',
    'test/e2e-connect-tunnel.ts',
    'test/e2e-connect-tunnel-delivery.ts',
    'test/e2e-connect-tunnel-records.ts',
    'test/e2e-connect-serve-loopback.ts',
    'test/e2e-phase0.ts',
    'test/e2e-projects.ts',
    'test/e2e-portal.ts',
    'test/e2e-header-nav.ts',
    // Every API call the profile tabs make, 111 assertions of it. Registered in no runner since it
    // was written, which is also why 13 `assert(status < 500)` lines survived inside it.
    'test/e2e-profile-tabs.ts',
    'test/e2e-security.ts',
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

// ── Run a single test suite ──
function runTest(suitePath: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((settle) => {
        // The suite gets the SAME pins as the server. A suite derives what it expects from its own
        // environment, so any pin it cannot see is a place where the two can disagree about what is
        // being tested: e2e-x402-testnet skips when the off-chain double is in use, could not see
        // that it was, and so ran its real-network acceptance cases against the double.
        const child = spawn('node', ['--import', 'tsx', suitePath], {
            env: { ...process.env, ...pinnedEnv(TARGET), E2E_BASE: BASE_URL },
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd(),
        });

        let output = '';
        child.stdout?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            process.stdout.write(s);
        });
        child.stderr?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            process.stderr.write(s);
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
    console.log(`  Suites: ${suites.length}`);
    console.log(`${'='.repeat(50)}\n`);

    let server: ChildProcess | null = null;

    reportEnvLeaks(pinnedEnv(TARGET));

    // Empty the database BEFORE the first suite, by the same call the loop makes between suites.
    // The version that ran only between them left suite one on whatever the previous run wrote,
    // so a solo run of any suite was a run against stale data.
    if (!TARGET.external) {
        try {
            await cleanDatabase(TARGET);
            console.log(`Cleaned ${TARGET.dbType} test database before the first suite.`);
        } catch (e) {
            console.error(`Could not empty the test database: ${(e as Error).message}`);
            process.exit(1);
        }

        console.log('Starting server...');
        try {
            server = await startServer(TARGET);
            console.log('Server ready.\n');
        } catch (e) {
            console.error(`Failed to start server: ${(e as Error).message}`);
            process.exit(1);
        }
    }

    const results: { name: string; passed: number; failed: number; total: number; time: string; exitCode: number }[] = [];
    let anyFailed = false;

    try {
        for (let i = 0; i < suites.length; i++) {
            const suite = suites[i];
            const name = basename(suite, '.ts');

            // Clean DB and restart server between suites for isolation. stopServer does not return
            // until the old process is gone and its port is free, so the delete below cannot fail
            // on a live file handle and the next suite cannot reach the previous server.
            if (i > 0 && server && !TARGET.external) {
                await stopServer(server, TARGET);
                server = null;
                await cleanDatabase(TARGET);
                server = await startServer(TARGET);
            }

            console.log(`\n${'─'.repeat(40)}`);
            console.log(`  ${name}`);
            console.log(`${'─'.repeat(40)}`);

            const t0 = Date.now();
            const { output, exitCode } = await runTest(suite);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            const parsed = parseResults(output);

            if (parsed.failed > 0 || exitCode !== 0) anyFailed = true;
            results.push({ name, ...parsed, time: `${elapsed}s`, exitCode });
        }
    } finally {
        if (server) {
            // Reported, not thrown: a failure to shut down must not replace whatever error brought
            // us into this block, which is the thing the reader needs.
            await stopServer(server, TARGET).catch((e: unknown) => {
                console.error(`Could not stop the test server: ${(e as Error).message}`);
            });
        }
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log('  SUMMARY');
    console.log(`${'='.repeat(50)}`);
    console.log('');
    console.log('Suite'.padEnd(30) + 'Passed'.padEnd(10) + 'Failed'.padEnd(10) + 'Total'.padEnd(10) + 'Time');
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
        console.log(`${status} ${r.name.padEnd(28)}${String(r.passed).padEnd(10)}${String(r.failed).padEnd(10)}${String(r.total).padEnd(10)}${r.time}${note}`);
    }

    const totalPassed = results.reduce((s, r) => s + r.passed, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);
    const totalTests = results.reduce((s, r) => s + r.total, 0);
    console.log('-'.repeat(70));
    console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed out of ${totalTests}`);
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
