/**
 * @file src/routes/agents/device-auth-approve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approve step of the RFC 8628 device authorization flow, shared by the /verify
 *   consent submission and same-owner auto-approval: registration hooks, create the agent or rotate
 *   the keys of one that exists, issue its JWT, stash the credentials for the device-token poll, and
 *   start Hello Integration onboarding. Extracted from device-auth.ts to satisfy max-file-lines; the
 *   routes themselves, and the eligibility test that decides whether auto-approval may run at all,
 *   stay there.
 * @structure scopesExceedNodeMax(config, scopes) · approveDeviceAuth(...)
 * @usage import { approveDeviceAuth, scopesExceedNodeMax } from './device-auth-approve.js';
 * @version-history
 *   v1.3.0 — 2026-10-27 — A new agent under a name whose earlier agent left schedules or saved workflows
 *     tells the owner it takes them over (secaudit2026oct26, deleted-agent-authority-revived-by-same-name-agent).
 *   v1.2.0 — 2026-10-25 — `opts`: an existing agent approved without proof that it is coming back is a
 *     takeover and records the account event agent_device_takeover; `endOtherSessions` signs the
 *     agent's other sessions out first, as a key rotation does (secaudit2026oct22,
 *     unbound-reapproval-of-existing-agent).
 *   v1.1.0 — 2026-10-25 — An agent approver passes on no looser a clearance than its own: a new agent
 *     gets the stricter of the node default and the approver's clearance, and a re-approved agent is
 *     lowered to the approver's when it held more (secaudit2026oct22,
 *     agent-approver-sibling-skips-clearance).
 *   v1.0.0 — 2026-10-20 — Extracted from device-auth.ts (max-file-lines). The code is unchanged by
 *     the move; its history up to v1.14.0 is in that file's header.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, DeviceAuthorizationRecord } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { buildGAII } from '../../utils/gaii.js';
import { executeHooks } from '../../services/hooks.js';
import { recordAccountEvent } from '../../services/account-events.js';
import { fireHook } from '../../utils/fire-hook.js';
import { issueJWT, generateSessionId } from '../../auth/jwt.js';
import { emitChange } from '../../services/event-bus.js';
import { getActiveConnectTunnelManager } from '../../services/connect-tunnel.js';
import { emitToolListChanged } from '../../mcp/index.js';
import { createDefaultSteps } from '../../models/agent-onboarding-schemas.js';
import { createOnboardingTestTask } from '../../services/onboarding-test-task.js';
import { detectPlatform } from '../../services/platform-detector.js';
import { scopeIsCovered, SCOPES_OUTSIDE_WILDCARD, exceedsCeiling } from '../../utils/scope-coverage.js';
import { recordAgentScopeRequest } from '../../services/agent-refusals.js';
import { agentListingTags } from '../../services/content-defaults.js';
import { newAgentClearance, clearanceBoundByApprover } from '../../services/agent-clearance.js';
import { closeMcpSessionsForGaii } from '../../mcp/session-registry.js';
import { logger } from '../../utils/logger.js';
import { standingWorkOf, noticeStandingWork } from '../../services/agent-standing-work.js';

/** Validate requested scopes against the node maximum (shared by consent + auto-approve). */
export function scopesExceedNodeMax(config: AimeatConfig, finalScopes: string[]): string[] {
  return exceedsCeiling(config.maxAgentScopes, finalScopes);
}

/**
 * The APPROVE flow shared by the /verify consent submission and same-owner auto-approval:
 * registration hooks → create agent (or rotate keys on an existing one) → issue the agent
 * JWT → stash credentials on the device-auth record for the poll → auto-start onboarding.
 * Scope validation happens BEFORE this is called (the two callers differ in how).
 */
export async function approveDeviceAuth(
  config: AimeatConfig,
  storage: Storage,
  request: DeviceAuthorizationRecord,
  approvedBy: string,
  finalScopes: string[],
  userAgent: string | undefined,
  /**
   * Whether `finalScopes` is a real choice or the node default standing in for silence. Re-running
   * device auth is a NORMAL event — a token expires, a machine is reinstalled — and it used to
   * replace an existing agent's scopes wholesale either way. An agent that reconnected without
   * naming any scopes was quietly cut down to config.defaultAgentScopes, losing in a refresh what
   * the owner had granted in the editor. Silence is not a request to revoke.
   */
  scopesRequested = true,
  /**
   * The scopes the approving AGENT's own token carries, or undefined when the account holder
   * approved in person. An agent passes on only what it already holds: the second half of the
   * sibling-takeover fix (secaudit 2026-10), independent of the authority check at the
   * device-authorize door, because either alone leaves the other open.
   *
   * It bites on the EXISTING-agent branch only, where the grant is built from what the TARGET
   * holds rather than from what was asked for. An owner approver is unfiltered: the account holder
   * may grant anything, and the v1.5.0 rule that an outside-wildcard scope survives a reconnect is
   * theirs to keep.
   */
  approverAgentScopes?: readonly string[],
  /**
   * An existing agent only. `takeover`: the request did not prove it is the agent coming back
   * (services/device-return-proof.ts), so the approval records an account event. `endOtherSessions`:
   * the owner chose to sign the agent's other sessions out, as a key rotation does, before the new
   * credential is issued.
   */
  opts: { takeover?: boolean; endOtherSessions?: boolean } = {},
): Promise<{ ok: true; gaii: string; existing: boolean; otherSessionsEnded: boolean } | { ok: false; status: number; code: string; message: string }> {
  // Pre-registration hook
  const hookResult = await executeHooks(config, storage, 'pre_agent_registration', {
    name: request.agentName,
    owner: request.ownerName,
    display_name: request.displayName,
  });
  if (!hookResult.allowed) {
    return { ok: false, status: 403, code: 'HOOK_REJECTED', message: hookResult.reason ?? 'Agent registration denied by extension hook' };
  }

  // Check if agent already exists — if so, issue new JWT for existing agent
  const gaii = buildGAII(request.agentName, request.ownerName, config.nodeId);
  const existing = await storage.getAgent(gaii);
  let keyPair: { privateKey: string; publicKey: string };
  const now = new Date().toISOString();

  /**
   * What this approval actually grants, which for an EXISTING agent is not `finalScopes`.
   *
   * The token, the stored `defaultScopes` and the device-auth record must all say the same thing.
   * Until 2026-08-14 only the storage write used the corrected list and the other two used
   * `finalScopes`, so re-approval wrote the right scopes and issued a credential without them. It
   * cost two capabilities, in both directions:
   *
   *   - A scope no wildcard carries never reached a running agent AT ALL. Re-approval is the only
   *     path that mints the long-lived token (`agentJwtTtlSeconds`), and it was the path that
   *     dropped it. Measured on aimeat.io on 2026-08-14: agent `postman#happydude500001` had
   *     defaultScopes `["*","share:manage"]` and a ninety-day token whose claim read `["*"]`, so
   *     `aimeat_share_create` answered SCOPE_DENIED for a scope its owner had granted.
   *   - Re-approving with NO scopes at all issued the NODE DEFAULT rather than what the owner had
   *     chosen, because `finalScopes` falls back to `config.defaultAgentScopes` when the approver
   *     sends no array. Storage kept the owner's decision and the token silently narrowed to the
   *     node's, which is the same shape as the 1.33.1 outage.
   *
   * `POST /v1/auth/refresh` mints from `defaultScopes` correctly, so the stored value was never
   * wrong; it is a one-hour token and the connector does not auto-refresh, so that was not a way
   * out for anyone.
   */
  let grantedScopes = finalScopes;

  // An AGENT approver passes on no more clearance than it holds, the clearance half of the rule
  // above for scopes: an agent the owner limited to a classification made an unlimited sibling and
  // collected its token from the device-token poll (secaudit2026oct22,
  // agent-approver-sibling-skips-clearance). An approver with no clearance passes none on, and the
  // owner in person keeps the node default.
  const ownerGhii = `${request.ownerName}@${config.nodeId}`;
  const approverClearance = approverAgentScopes ? (await storage.getAgent(approvedBy))?.clearance ?? null : null;
  const bound = (current: string | null) => clearanceBoundByApprover({ storage, config }, ownerGhii, current, approverClearance);

  if (existing) {
    // Existing agent: generate new keypair (rotate keys) and issue JWT
    keyPair = await generateKeyPair();
    const held = existing.defaultScopes ?? [];
    // Nothing was asked for → keep what the owner already decided, rather than resetting to the
    // node default. And a scope no wildcard carries survives either way: it cannot be expressed by
    // the consent card's templates or by an agent's request, so re-approval is never the place it
    // was meant to be dropped — the owner removes it in the editor, deliberately, as they added it.
    const preserved = SCOPES_OUTSIDE_WILDCARD.filter(s => held.includes(s) && !finalScopes.includes(s));
    grantedScopes = scopesRequested ? [...finalScopes, ...preserved] : held;
    // An AGENT approver grants no word its own token does not carry, whichever of the two branches
    // above produced the list. Both of them read the TARGET's held scopes, so without this an agent
    // holding `agent:write` and `memory:read` re-approved a sibling and was handed that sibling's
    // `memory:write-reserved` and `secrets:manage` in a ninety-day token (secaudit 2026-10,
    // sibling-reapproval-takeover). The device-authorize route refuses that request before it
    // reaches here; this is the same rule at the place the grant is built, so a later caller cannot
    // reopen it.
    if (approverAgentScopes) {
      grantedScopes = grantedScopes.filter(s => scopeIsCovered(approverAgentScopes, s));
    }
    const heldClearance = existing.clearance ?? null;
    const clearance = await bound(heldClearance);
    await storage.updateAgent(gaii, {
      publicKey: keyPair.publicKey,
      defaultScopes: grantedScopes,
      lastSeen: now,
      ...(clearance !== heldClearance ? { clearance } : {}),
      // Every credential issued before now stops, the new one below is issued after (auth/agent-alive.ts).
      ...(opts.endOtherSessions ? { credentialsValidAfter: now } : {}),
    });
    if (opts.endOtherSessions) {
      // As a key rotation does (routes/agents/rekey.ts): the sessions, the MCP OAuth refresh tokens,
      // the open tunnel and the open MCP sessions of the agent end before the new credential exists.
      await storage.revokeSessionsByGaii(gaii);
      await storage.deleteOAuthRefreshTokensByGaii(gaii);
      try { getActiveConnectTunnelManager()?.closeForGaii(gaii, 'rekeyed'); } catch (err) { logger.warn('device approve: tunnel close failed', { gaii, error: String(err) }); }
      closeMcpSessionsForGaii(gaii);
    }
    // Re-approval is the other door that changes what an agent may do, and an agent being
    // re-approved is exactly the one likely to have a session open — an open MCP session AND an
    // open tunnel, whose credential the node pinned at attach and will keep honouring until told.
    emitToolListChanged(gaii);
    getActiveConnectTunnelManager()?.notifyScopesChanged(gaii);
  } else {
    // New agent: create from scratch
    keyPair = await generateKeyPair();
    const startClearance = await bound(newAgentClearance(config).clearance ?? null);

    await storage.createAgent({
      name: request.agentName,
      owner: request.ownerName,
      gaii,
      displayName: request.displayName ?? request.agentName,
      description: request.description,
      capabilities: [],
      defaultScopes: finalScopes,
      publicKey: keyPair.publicKey,
      trustScore: 50,
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
      mode: request.mode ?? 'interactive',
      // Tagged `unlisted` when new agents are listed nowhere (visibility.agent_listed_default, plan V5.8).
      ...agentListingTags(config),
      ...(startClearance ? { clearance: startClearance } : {}),
      // Who asked for this agent: the owner's name when a person approved on the consent screen,
      // the approving sibling's GAII when same-owner auto-approval did. The same value goes on the
      // device-authorization record as `approvedBy`, and that record is swept when it expires — so
      // without this line the answer to "where did this agent come from" survives half an hour.
      // Written here and nowhere else: re-approval is an ordinary event, and letting a later
      // approver take the entry over would move the right to delete this agent with it.
      registeredBy: approvedBy,
    });

    // Post-registration hook
    fireHook(config, storage, 'post_agent_registration', { gaii, owner: request.ownerName });
  }

  // Issue long-lived JWT for the agent
  const sessionId = generateSessionId();
  const agentJwt = await issueJWT({
    sub: gaii,
    owner: request.ownerName,
    node: config.nodeId,
    roles: ['agent'],
    scopes: grantedScopes,
  }, config.agentJwtTtlSeconds, sessionId);

  const expiresAt = new Date(Date.now() + config.agentJwtTtlSeconds * 1000).toISOString();

  // Track the session, which is what makes this credential REVOCABLE. The token has always carried
  // a `jti` and requireAuth has always checked it against the session table, but this path wrote no
  // row — and isSessionRevoked answers "not revoked" for a session it has never heard of. So the
  // ninety-day bearer handed out here could be ended only by its exact hash, a string the owner
  // never sees, and deleting the agent left it authenticating. POST /v1/auth/token has written this
  // row since P3-7; device authorization is how real agents connect, and it was the path without it.
  await storage.createSession({
    sessionId,
    gaii,
    owner: request.ownerName,
    issuedAt: now,
    expiresAt,
  });

  // Store credentials + JWT for agent to poll
  await storage.updateDeviceAuth(request.deviceCode, {
    status: 'approved',
    scopes: grantedScopes,
    approvedBy,
    agentCredentials: {
      gaii,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      token: agentJwt,
      expires_at: expiresAt,
    },
  });
  // What was asked for beside what was granted, kept after the device-auth row goes, for the card.
  await recordAgentScopeRequest(storage, { gaii, requested: request.requestedScopes, granted: grantedScopes, approvedBy });
  emitChange('agents');

  // ── Auto-start Hello Integration onboarding ──
  const onboardingSteps = createDefaultSteps(request.mode ?? 'interactive');
  onboardingSteps[0].status = 'passed';
  onboardingSteps[0].validatedAt = now;
  onboardingSteps[0].validationMethod = 'automatic';
  onboardingSteps[0].details = { createdAt: existing?.createdAt ?? now };

  const detectedPlatform = detectPlatform(userAgent);
  const platformStepDA = onboardingSteps.find(s => s.id === 'identify_platform');
  if (detectedPlatform && platformStepDA) {
    platformStepDA.status = 'passed';
    platformStepDA.validatedAt = now;
    platformStepDA.validationMethod = 'automatic';
    platformStepDA.details = { platform: detectedPlatform.id, version: detectedPlatform.version };
    await storage.updateAgent(gaii, {
      platform: detectedPlatform.id,
      platformVersion: detectedPlatform.version,
      platformDetectedBy: detectedPlatform.detectedBy,
    });
  }

  const existingOnboarding = await storage.getOnboarding(gaii);
  if (!existingOnboarding) {
    // Test task only when the agent's Hello Integration includes accept_test_task. The shared
    // helper creates it 'active' (this path built its own 'queued' copy until 2026-08-24): the
    // owner-approval gate guards real tasks, and the smoke test is not one.
    await createOnboardingTestTask(storage, gaii, `${request.ownerName}@${config.nodeId}`, onboardingSteps);
    await storage.createOnboarding({
      agentGaii: gaii,
      status: 'in_progress',
      startedAt: now,
      steps: onboardingSteps,
      detectedPlatform: detectedPlatform?.id,
    });
    emitChange('agent-onboarding');
  }

  // The owner's own "what has happened". Approving an agent is a permission decision they made, and
  // one of the few things they would want a durable record of without going looking for it. A
  // RE-approval is not news — the same agent reconnecting after a token expiry is routine — so only
  // a genuinely new agent gets a row.
  if (!existing) {
    void recordAccountEvent(storage, {
      ownerGhii: `${request.ownerName}@${config.nodeId}`,
      kind: 'agent_connected',
      actorGaii: approvedBy,
      subject: gaii,
      link: '/v1/profile?tab=agents',
      data: { name: request.agentName },
    }, config);
    // A new agent under a name an earlier agent had runs that agent's schedules and saved workflows
    // again; the owner is told what it takes over (services/agent-standing-work.ts; secaudit2026oct26).
    const ownerGhii = `${request.ownerName}@${config.nodeId}`;
    await noticeStandingWork(storage, ownerGhii, request.agentName, await standingWorkOf(storage, ownerGhii, gaii), 'resumed')
      .catch(err => logger.warn('device-auth approve: standing work not counted', { gaii, error: String(err) }));
  } else if (opts.takeover) {
    // A new device took the agent over (no proof that it is the agent coming back): that is news.
    void recordAccountEvent(storage, {
      ownerGhii: `${request.ownerName}@${config.nodeId}`,
      kind: 'agent_device_takeover',
      actorGaii: approvedBy,
      subject: gaii,
      link: '/v1/profile?tab=agents',
      data: { name: request.agentName, other_sessions_ended: opts.endOtherSessions ? 'yes' : 'no' },
    }, config);
  }

  return { ok: true, gaii, existing: !!existing, otherSessionsEnded: !!existing && !!opts.endOtherSessions };
}
