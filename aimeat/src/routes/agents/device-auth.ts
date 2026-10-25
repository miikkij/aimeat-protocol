/**
 * @file src/routes/agents/device-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description RFC 8628 device authorization flow routes (authorize, token poll, consent info, verify submit). Extracted from agents.ts to satisfy max-file-lines. The approve step the authorize and verify routes share lives in device-auth-approve.ts, extracted for the same reason.
 * @version-history
 *   2026-10-25 — The email form of device-authorize is counted per network address
 *     (auth.device_authorize_email_max in 10 minutes, default 20; auth.device_authorize_email_limit
 *     turns it off), answered 429 RATE_LIMITED with the setting and the account-name form named; and
 *     GET /v1/agents/verify/info names the owner only to that owner signed in in person
 *     (secaudit2026oct22, device-authorize-email-owner-oracle).
 *   2026-10-25 — The ten-pending cap per owner refuses only requests that do not come from the owner:
 *     the owner's own request and one from an agent of the owner go through when strangers' rows fill
 *     it (secaudit2026oct22, pending-cap-per-owner-unauthenticated).
 *   2026-10-21 — autoApprovePrincipal asks isAnonymousPrincipal, so the minted anonymous token is no
 *     approver of the anonymous account's agents (secaudit 2026-10, anonymous-claim-not-signed).
 *   v1.15.0 — 2026-10-20 — approveDeviceAuth and scopesExceedNodeMax move to
 *     device-auth-approve.ts (max-file-lines). A move only: no behaviour changed with it.
 *   v1.14.0 — 2026-10-20 — Same-owner auto-approval of an EXISTING agent is fenced two ways
 *     (secaudit 2026-10, sibling-reapproval-takeover). An AGENT approver that names an agent which
 *     already exists must be authorized over that agent (mayActOnAgent, or `registeredBy` naming
 *     the approver), and the escalation filter is measured against the TARGET's held scopes as well
 *     as the requested list. approveDeviceAuth takes the approving agent's own scopes and grants no
 *     word outside them, the target's outside-wildcard scopes included. The 2026-09-01 work read
 *     `agent:write` on the path that creates a NEW name and left re-approval of an existing sibling
 *     open: any agent of the owner holding `agent:write` rotated a sibling's key, overwrote its
 *     stored scopes and collected its ninety-day token and private key from the unauthenticated
 *     device-token poll, with the sibling's `memory:write-reserved` and `secrets:manage` carried
 *     into the grant. Every other route that changes a sibling is fenced: PATCH
 *     /v1/agents/:name/scopes narrows only and needs `agent:permissions`, rekey needs the owner
 *     role, delete reads `registeredBy`. Both refusals are fall-throughs: the row stays pending and
 *     the owner approves in their profile, so a genuine reconnect still works.
 *   v1.13.0 — 2026-10-18 — A new agent gets the node's classification.agent_clearance_default as its clearance (plan doc-mvdipuyqraas, L2.1).
 *   v1.12.0 — 2026-10-18 — A new agent is tagged `unlisted` when visibility.agent_listed_default is off (plan doc-mvcn6c7e4e5q, V5.8).
 *   v1.11.3 — 2026-10-09 — A device-token poll on an expired row clears its credentials and deletes
 *     it, approved rows included (secrets audit 2026-10-09, 1.3).
 *   v1.11.2 — 2026-10-05 — The approving owner token must be the owner in person (isOwnerInPerson;
 *     secaudit 2026-10, C4).
 *   v1.11.1 — 2026-10-05 — The node's scope ceiling is exceedsCeiling (utils/scope-coverage.ts; secaudit 2026-10, C3).
 *   v1.11.0 — 2026-09-30 — An approval records what was asked for and granted (services/agent-refusals.ts).
 *   v1.10.2 — 2026-09-26 — POST /v1/agents/verify asks credentialRevoked of the owner token in its
 *     body, as every authenticated route asks of a bearer token: revoked, signed out, or of an account
 *     that no longer holds the name, it answers 401 AUTH_REQUIRED.
 *   v1.10.1 — 2026-09-24 — The same-owner shortcut names the caller's account with localAccountName,
 *     so a visitor's home GHII is never the requested owner, and a visitor holds no owner role to
 *     approve with in the first place (secaudit 2026-09, A4-1).
 *   v1.10.0 — 2026-09-06 — Re-approval pushes scopes_changed down the live tunnel as well as
 *     emitting the tool-list change. It was one of three doors that change what an agent may do and
 *     the only one wired, which is the half-working kind this file's own comment warns about.
 *   v1.9.0 — 2026-09-01 — An agent approver must hold `agent:write`. This route's same-owner branch
 *     is the ONLY way an agent creates an agent, and the permission word for it was read by nobody:
 *     any same-owner agent qualified, so `concierge` and `workflow-manager` made agents as readily
 *     as `crew-forge` and an owner who granted the three different permissions was shown a
 *     distinction the node did not keep. Refusing is a fall-through, not a failure: the row stays
 *     pending, the note names the missing scope, and the owner approves in their profile.
 *   v1.8.0 — 2026-08-24 — The onboarding test task comes from services/onboarding-test-task.ts
 *     like every other creation path, which changes its status from 'queued' to 'active' and adds
 *     the 'started' event: the smoke test needs no owner approval, and the onboarding validator
 *     was auto-activating it on the first todos anyway.
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — Same-owner auto-approval (Agent-Bundled Apps): a device-authorize call
 *     authenticated as the SAME owner (owner session or that owner's agent, e.g. crew-forge
 *     spawning a deployed sibling) is approved immediately — no manual consent step. Guards:
 *     never cross-owner, an agent approver cannot grant scopes beyond its own token's, and the
 *     approval is attributed (approvedBy). Config gate: sameOwnerAutoApprove (default on).
 *     Approve flow extracted to approveDeviceAuth(), shared with the /verify consent path.
 *   v1.2.0 — 2026-07-19 — device-authorize `owner` accepts the account's verified EMAIL as well as
 *     the handle: an `owner` containing '@' is resolved (case-insensitive, verified-email only) to the
 *     bare handle before anything downstream. Email only selects the target account — not an auth
 *     factor — so the RFC 8628 approval semantics are unchanged.
 *   v1.3.0 — 2026-08-07 — device-token retrieval grace window: the first credential poll no longer
 *     clears the credentials; it shortens the request expiry to 120 s so a client that mis-parsed
 *     the flat OAuth-style response can re-poll instead of redoing the whole owner-approval round.
 *     Net credential lifetime in storage goes DOWN (was: until the 30 min expiry when unpolled).
 *     (UX-remake v3, P9 / measured in the Jussi run.)
 *   v1.4.0 — 2026-08-08 — The auto-approve escalation filter no longer exempts a '*' approver, and
 *     no longer reads `memory:*` as covering memory:write-reserved. Both shortcuts were right until
 *     that scope existed; after it, a wildcard agent could auto-approve a sibling holding the grant
 *     that reaches openrouter.settings and then collect the sibling's JWT from the unauthenticated
 *     device-token poll — no owner step anywhere. Coverage now comes from utils/scope-coverage.ts.
 *   v1.5.0 — 2026-08-08 — Re-running device auth on an EXISTING agent no longer replaces its stored
 *     scopes with the node defaults. Reconnecting after a token expires or a machine is reinstalled
 *     sends no `scopes` at all, so a '*' agent was cut down to the four defaults with no owner
 *     action and no notice — and it stuck, since every later JWT is minted from defaultScopes.
 *     Absent an explicit choice the agent keeps what it holds; an explicit set still applies
 *     verbatim, narrowing included, except that a scope no wildcard carries survives either way
 *     (the consent card's templates cannot express it, so re-approval is not where it was meant to
 *     be dropped).
 *   v1.7.0 — 2026-08-13 — The created agent records WHO authorized it (`registeredBy`), and
 *     `expires_in` comes from the shared constant now that the window is two hours.
 *   v1.9.0 — 2026-08-29 — The `scopes` an agent sends to device-authorize are KEPT (`requestedScopes`
 *     on the record) instead of being read by same-owner auto-approval and dropped for everyone
 *     else. Three consequences, all of them the point: the authenticated pending listing can show
 *     the owner what is being asked for, the consent surfaces can preselect it, and an approval that
 *     names no scopes for a NEW agent grants what was requested rather than the node default. An
 *     agent that asked for task:read/task:write used to arrive holding catalogue:read + memory:*,
 *     unable to take work at all and looking perfectly connected. Re-approval of an EXISTING agent
 *     is untouched: silence there still means "keep what it holds". The node-maximum check also
 *     moved ahead of the record write, so an over-broad request is refused before anything is
 *     stored rather than after. Covered by test/e2e-device-auth-requested-scopes.ts.
 *   v1.6.0 — 2026-08-08 — /verify/info reports `existing_agent`, so the consent screen can tell a
 *     RETURN from a first approval and preselect "keep its current access" instead of Standard. A
 *     boolean only — that endpoint is unauthenticated and rate-limited against user-code
 *     enumeration, so it says THAT the agent exists and never what it may do. Covered by
 *     test/e2e-agent-reapproval.ts.
 */
import type { Router, Request } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, DeviceAuthorizationRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { validateAgentName, buildGAII, generateUserCode, localAccountName, isOwnerInPerson, mayActOnAgent } from '../../utils/gaii.js';
import { verifyJWT } from '../../auth/jwt.js';
import { credentialRevoked, optionalAuth } from '../../auth/middleware.js';
import { rateLimit, ipRateKey } from '../../middleware/rate-limit.js';
import { rateBuckets } from '../../services/rate-buckets.js';
import { emitChange } from '../../services/event-bus.js';
import { resolveOwnerByVerifiedEmail } from '../../services/contacts.js';
import { DEVICE_AUTH_EXPIRY_MS, DEVICE_AUTH_EXPIRY_SECONDS, VALID_MODES } from './constants.js';
import { uncoveredScopes, scopeIsCovered } from '../../utils/scope-coverage.js';
import { approveDeviceAuth, scopesExceedNodeMax } from './device-auth-approve.js';

/**
 * Same-owner auto-approval eligibility: the request must be authenticated (never anonymous)
 * as the SAME owner the registration is for — either the owner session itself, or one of
 * that owner's agents. App grants and ecosystem principals never qualify. An agent approver
 * additionally may not grant scopes beyond its own token's, and may not re-approve an agent that
 * already exists unless it is authorized over it (both checked by the caller).
 *
 * AN AGENT APPROVER MUST HOLD `agent:write`. This is the door that creates an agent — there is no
 * other, and `registeredBy` has named the creating agent all along — so it is where the permission
 * word for making agents has to be read. Until 2026-09-01 it was read by nobody: ANY same-owner
 * agent qualified, so `concierge` and `workflow-manager` made agents exactly as readily as
 * `crew-forge`, and an owner who granted the three of them different permissions was shown a
 * distinction the node did not keep. `agent:write` is inside the wildcard, so an agent the owner
 * gave full access to still qualifies; one given a narrower grant does not.
 *
 * Not holding it is not a failure. It returns `mayApprove: false` and the registration takes the
 * ordinary pending path, where the owner decides — the same fall-through the scope-escalation
 * check already uses, because both are "this agent may not settle this on its own".
 */
const APPROVER_SCOPE = 'agent:write';

/** The email form of device-authorize, counted per network address in 10 minutes (per process, like every limiter). */
const takeEmailForm = rateBuckets(10 * 60 * 1000);

function autoApprovePrincipal(req: Request, owner: string): { kind: 'owner' | 'agent'; scopes: string[]; mayApprove: boolean } | null {
  const auth = req.auth;
  if (!auth || isAnonymousPrincipal(auth)) return null;
  const roles = auth.roles as string[];
  if (roles.includes('app') || roles.includes('ecosystem')) return null;
  const bare = localAccountName(auth.owner);
  if (bare !== owner) return null;
  if (roles.includes('agent')) {
    const scopes = (auth.scopes ?? []) as string[];
    return { kind: 'agent', scopes, mayApprove: scopeIsCovered(scopes, APPROVER_SCOPE) };
  }
  // The owner is not an agent and holds no scopes: their session IS the permission.
  if (roles.includes('owner')) return { kind: 'owner', scopes: [], mayApprove: true };
  return null;
}

export function registerDeviceAuthRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // POST /v1/agents/device-authorize — start device authorization flow (RFC 8628).
  // optionalAuth: an UNAUTHENTICATED call gets the standard pending flow (owner approves in
  // the profile Agents tab); a call authenticated as the SAME owner is auto-approved below.
  router.post('/v1/agents/device-authorize', optionalAuth(), async (req, res) => {
    const { agent_name, display_name, description, owner, mode, scopes } = req.body ?? {};

    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner is required'));
      return;
    }
    if (!agent_name) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent_name is required'));
      return;
    }

    // `owner` may be the account HANDLE (as today) or the account's verified EMAIL. An email only
    // NAMES which account this device request targets — it is never an auth factor (the human still
    // approves the device code while logged in). Everything downstream keys off the resolved bare
    // handle, so resolve up front, before rate-limit/auto-approval/GAII construction.
    let ownerName: string = owner;
    if (typeof owner === 'string' && owner.includes('@')) {
      // The answer tells whether an address has an account here, and this route takes no credential,
      // so the email form is counted per network address (auth.device_authorize_email_max in 10
      // minutes, off with auth.device_authorize_email_limit). The account-name form is not counted.
      if (config.deviceAuthEmailLimit) {
        const counted = takeEmailForm(ipRateKey(req.ip ?? req.socket.remoteAddress), config.deviceAuthEmailMax);
        if (!counted.ok) {
          res.setHeader('Retry-After', counted.retryAfterSec);
          res.status(429).json(error(config.nodeId, 'RATE_LIMITED',
            `This network address has named ${config.deviceAuthEmailMax} accounts by email address in the last 10 minutes, the most this node allows `
            + `(auth.device_authorize_email_max). Try again in ${counted.retryAfterSec} seconds, or name the account by its account name, which is not counted.`,
            undefined, { retry_after_sec: counted.retryAfterSec, setting: 'auth.device_authorize_email_max' }));
          return;
        }
      }
      const resolved = await resolveOwnerByVerifiedEmail(storage, owner);
      if (!resolved.ok) {
        const status = resolved.code === 'INVALID_EMAIL' ? 400 : resolved.code === 'AMBIGUOUS' ? 409 : 404;
        res.status(status).json(error(config.nodeId, resolved.code, resolved.message));
        return;
      }
      ownerName = resolved.ownerName;
    }
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `mode must be one of: ${VALID_MODES.join(', ')}`));
      return;
    }

    const nameError = validateAgentName(agent_name);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    // What the agent is ASKING FOR. Undefined when it named nothing, which the approval fallback
    // below reads as "no request", not as "an empty request".
    const requestedScopes: string[] | undefined = Array.isArray(scopes)
      ? scopes.filter((s: unknown) => typeof s === 'string')
      : undefined;

    // Refuse an over-broad request BEFORE the record is written. This check used to sit inside the
    // auto-approval branch, after createDeviceAuth, so a rejected registration left a pending row
    // behind — and on the manual path the same over-broad list was accepted and then silently
    // replaced by the node default at approval time. One ceiling, one place, one answer.
    if (requestedScopes) {
      const invalid = scopesExceedNodeMax(config, requestedScopes);
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Your assistant asked for more than this node allows. Choose fewer permissions, or ask whoever runs this node.`));
        return;
      }
    }

    // Rate limit: max 10 pending per owner name, for requests that do not come from the owner. Anyone
    // can write such a row by naming the owner, so the cap applied to the owner's own request and to
    // an agent of the owner too, and ten strangers' rows stopped both for two hours
    // (secaudit2026oct22, pending-cap-per-owner-unauthenticated). A request authenticated as this
    // owner, or as one of this owner's agents, is not refused by it; it still counts as a row.
    const fromOwner = autoApprovePrincipal(req, ownerName) !== null;
    const pendingCount = fromOwner ? 0 : await storage.countPendingDeviceAuthByOwner(ownerName);
    if (pendingCount >= 10) {
      res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'Too many pending authorization requests for this owner'));
      return;
    }

    // Cleanup expired requests lazily
    await storage.cleanupExpiredDeviceAuth();

    // Generate codes
    const deviceCode = randomBytes(32).toString('hex');
    let userCode = generateUserCode();

    // Ensure user code uniqueness
    let attempts = 0;
    while (await storage.getDeviceAuthByUserCode(userCode) && attempts < 10) {
      userCode = generateUserCode();
      attempts++;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_AUTH_EXPIRY_MS);

    const authRequest: DeviceAuthorizationRecord = {
      deviceCode,
      userCode,
      ownerName,
      agentName: agent_name,
      displayName: display_name,
      description,
      status: 'pending',
      requestedScopes,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pollInterval: 5,
      mode: mode ?? 'interactive',
    };
    await storage.createDeviceAuth(authRequest);

    // ── Same-owner auto-approval (Agent-Bundled Apps friction-killer) ──
    // A request authenticated as the owner it registers FOR — the owner session, or one of
    // that owner's already-approved agents (crew-forge registering the agent it just
    // deployed) — skips the manual consent step: the agent is created and the credentials
    // are staged so the very first device-token poll returns them. Hard limits: never
    // cross-owner (a foreign or anonymous caller falls through to the normal pending flow),
    // an AGENT approver can only grant scopes its own token already holds (no escalation),
    // an AGENT approver naming an agent that ALREADY EXISTS must be authorized over that agent,
    // and approvedBy records who approved. The cross-owner case keeps RFC 8628 semantics
    // untouched — Slice 1 forbids it anyway.
    let autoApproved = false;
    let autoApproveNote: string | undefined;
    // Auto-approval grants what was asked for; an agent that asked for nothing gets the node
    // default, because there is no owner here to choose. The ceiling was checked above, before the
    // record was written.
    const autoScopes: string[] = requestedScopes ?? config.defaultAgentScopes;
    // Whether this name is already an agent, and what that agent holds. A device-authorize on an
    // existing name is a RE-APPROVAL: it rotates the agent's key, overwrites its stored scopes and
    // mints a ninety-day token that the unauthenticated device-token poll hands to whoever started
    // the request. So the two checks below need the target, not only the request.
    const targetGaii = buildGAII(agent_name, ownerName, config.nodeId);
    const existingTarget = await storage.getAgent(targetGaii);
    const targetScopes: string[] = existingTarget?.defaultScopes ?? [];
    const principal = config.sameOwnerAutoApprove ? autoApprovePrincipal(req, ownerName) : null;
    if (principal) {
      // An AGENT approver may pass on only what it already holds. The filter used to exempt a '*'
      // approver outright, and to read `memory:*` as covering everything under it — both correct
      // until memory:write-reserved became the one scope no wildcard carries. Either shortcut let a
      // sibling be auto-approved with the grant that reaches openrouter.settings, with no owner
      // step: the requester then collects the sibling's JWT from the unauthenticated
      // /v1/agents/device-token poll. Coverage is decided in utils/scope-coverage.ts, so this
      // surface and the guard cannot disagree again. An OWNER approver may still grant anything.
      //
      // For an EXISTING agent the list to measure is not only what was asked for. The grant is
      // built from what the TARGET holds (approveDeviceAuth keeps those scopes, and appends its
      // outside-wildcard ones), so an approver whose request is a subset of its own token still
      // walked away with everything the sibling had: measured on 2026-10-20, an approver holding
      // `agent:write` and `memory:read` collected a sibling's token carrying
      // `memory:write-reserved` and `secrets:manage`.
      const escalating = principal.kind === 'agent'
        ? uncoveredScopes(principal.scopes, [...new Set([...autoScopes, ...targetScopes])])
        : [];
      // Re-approval changes an agent that already exists, and every other route that does so is
      // fenced: PATCH /v1/agents/:name/scopes may only narrow and needs `agent:permissions`, rekey
      // needs the owner role, delete reads `registeredBy`. mayActOnAgent is the one answer to "may
      // this caller act on that agent": the agent itself, or its owner in person. `registeredBy`
      // adds the deliberate case this route exists for, a crew-forge reconnecting the agent it made.
      const mayActOnTarget = principal.kind !== 'agent' || !existingTarget
        || mayActOnAgent(req.auth, targetGaii, config.nodeId)
        || existingTarget.registeredBy === req.auth!.sub;
      if (!principal.mayApprove) {
        // An agent of this owner, but not one the owner allowed to make agents. Same landing as an
        // escalating request: the row stays pending and the owner decides, so nothing is lost —
        // only the settling-it-alone part is refused.
        autoApproveNote = `Making an agent needs the ${APPROVER_SCOPE} permission, which this one does not have. The owner can approve this agent in their profile under Agents.`;
      } else if (!mayActOnTarget) {
        // An agent of this owner, but not this agent and not the agent that registered it. Same
        // landing as the two notes beside it: the row stays pending and the owner decides, so a
        // genuine reconnect still goes through — only settling it alone is refused.
        autoApproveNote = `An agent called ${agent_name} already exists, and only its owner can connect it again. The owner can approve this request in their profile under Agents.`;
      } else if (escalating.length > 0) {
        // No escalation via a sibling: fall through to the manual consent flow where the
        // OWNER decides — the request stays pending rather than failing the registration.
        autoApproveNote = `Scopes beyond the approving agent's own (${escalating.join(', ')}) need the owner's manual approval.`;
      } else {
        const approvedByGaii = principal.kind === 'agent' ? req.auth!.sub : ownerName;
        const result = await approveDeviceAuth(
          config, storage, authRequest, approvedByGaii, autoScopes,
          req.headers['user-agent'] as string | undefined,
          !!requestedScopes,
          principal.kind === 'agent' ? principal.scopes : undefined,
        );
        if (!result.ok) {
          await storage.updateDeviceAuth(deviceCode, { status: 'denied' });
          res.status(result.status).json(error(config.nodeId, result.code, result.message));
          return;
        }
        autoApproved = true;
      }
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const verificationUri = `${baseUrl}/v1/agents/verify`;
    const verificationUriComplete = `${baseUrl}/v1/agents/verify?code=${userCode}`;

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: DEVICE_AUTH_EXPIRY_SECONDS,
      interval: 5,
      status: autoApproved ? 'approved' : 'pending',
      auto_approved: autoApproved,
      user_instructions: autoApproved
        ? `Auto-approved (same-owner registration). Fetch your credentials now: POST /v1/agents/device-token with { "device_code": "${deviceCode}", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } — the first poll returns your token.`
        : `Tell your owner to approve this request. They can find it in their AIMEAT profile under Agents (${baseUrl}/v1/profile -> Agents tab). The verification code is: ${userCode}. Once approved, poll POST /v1/agents/device-token with { "device_code": "${deviceCode}", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } every 5 seconds until you receive your token.${autoApproveNote ? ` NOTE: ${autoApproveNote}` : ''}`,
    }, [
      ...(autoApproved ? [] : [{ description: 'Owner approves in AIMEAT profile -> Agents tab', method: 'GET' as const, url: `${baseUrl}/v1/profile` }]),
      { description: 'Poll for authorization result', method: 'POST', url: '/v1/agents/device-token' },
    ]));
    emitChange('agents');
  });

  // POST /v1/agents/device-token — poll for device authorization result (RFC 8628)
  router.post('/v1/agents/device-token', async (req, res) => {
    const { device_code, grant_type } = req.body ?? {};

    if (grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
      res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only device_code grant type is supported.' });
      return;
    }
    if (!device_code) {
      res.status(400).json({ error: 'invalid_request', error_description: 'device_code is required.' });
      return;
    }

    const request = await storage.getDeviceAuthByDeviceCode(device_code);
    if (!request) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown device code.' });
      return;
    }

    // Check expiry. An expired row is removed here rather than left for the next sweep: an approved
    // one still holds the agent's private key and JWT in plain text. The credentials are cleared by
    // device_code first, then the sweep deletes this row and every other expired one. A later poll
    // with the same device_code gets invalid_grant (unknown device code).
    if (new Date(request.expiresAt) <= new Date()) {
      await storage.updateDeviceAuth(device_code, { status: 'expired', agentCredentials: undefined });
      await storage.cleanupExpiredDeviceAuth();
      res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
      return;
    }

    // Rate limiting: enforce poll interval
    if (request.lastPolledAt) {
      const elapsed = Date.now() - new Date(request.lastPolledAt).getTime();
      if (elapsed < request.pollInterval * 1000) {
        // Increase interval by 5s on slow_down
        await storage.updateDeviceAuth(device_code, {
          pollInterval: request.pollInterval + 5,
          lastPolledAt: new Date().toISOString(),
        });
        res.status(400).json({ error: 'slow_down', error_description: `Polling too frequently. Wait ${request.pollInterval + 5} seconds between requests.` });
        return;
      }
    }

    // Update last polled time
    await storage.updateDeviceAuth(device_code, { lastPolledAt: new Date().toISOString() });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');

    switch (request.status) {
      case 'pending':
        res.status(400).json({ error: 'authorization_pending', error_description: 'The user has not yet approved this request.' });
        return;

      case 'denied':
        res.status(400).json({ error: 'access_denied', error_description: 'The user denied this authorization request.' });
        return;

      case 'approved': {
        if (!request.agentCredentials) {
          // Credentials already consumed
          res.status(400).json({ error: 'expired_token', error_description: 'Credentials have already been retrieved.' });
          return;
        }
        // Retrieval grace window: the response is flat OAuth-style JSON (unlike the AIMEAT
        // envelope every other endpoint uses), and a client that parses it wrong loses the
        // credentials forever — forcing a whole new authorize + owner approval round. So the
        // first retrieval does NOT clear the credentials; it shortens the request's expiry to
        // a short grace window instead. A re-poll with the same device_code inside the window
        // returns the same credentials. After it, the row is deleted, private key included, by
        // whichever comes first: a poll with this device_code (the expiry check above deletes it)
        // or cleanupExpiredDeviceAuth, which removes every expired row whatever its status. That
        // sweep runs on each POST /v1/agents/device-authorize, not on a timer. An approved row
        // nobody polls goes the same way at its original expiry (DEVICE_AUTH_EXPIRY_MS). Only the
        // device_code holder, who could have polled first anyway, can re-read within the window.
        const RETRIEVAL_GRACE_MS = 120_000;
        const creds = request.agentCredentials;
        const remainingMs = new Date(request.expiresAt).getTime() - Date.now();
        if (remainingMs > RETRIEVAL_GRACE_MS) {
          await storage.updateDeviceAuth(device_code, {
            expiresAt: new Date(Date.now() + RETRIEVAL_GRACE_MS).toISOString(),
          });
        }

        const baseUrl = config.baseUrl;
        const agentName = request.agentName;
        res.json({
          access_token: creds.token,
          token: creds.token,
          token_type: 'Bearer',
          gaii: creds.gaii,
          name: agentName,
          owner: request.ownerName,
          expires_at: creds.expires_at,
          privateKey: creds.privateKey,
          publicKey: creds.publicKey,
          scopes: request.scopes,
          morselBalance: 0,
          next_steps: {
            message: 'Authentication successful. Next steps below.',
            step_1_skill_bundle: {
              action: 'Fetch your configuration and API reference. Read SKILL.md for your role on this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/skill-bundle`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_2_handbook: {
              action: 'Fetch additional operating context for this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/me/handbook`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_3_onboarding: {
              action: 'Check for pending requests from your owner.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/onboarding`,
              auth: 'Authorization: Bearer <your token from above>',
            },
          },
        });
        return;
      }

      default:
        res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
    }
  });

  // GET /v1/agents/verify/info/:userCode — device auth request details for consent page
  // Rate limited by IP (10/min) to prevent user code enumeration per spec
  router.get('/v1/agents/verify/info/:userCode', rateLimit({ max: 10, windowMs: 60_000 }), async (req, res) => {
    const userCode = (req.params.userCode as string).toUpperCase();

    const request = await storage.getDeviceAuthByUserCode(userCode);
    if (!request || new Date(request.expiresAt) <= new Date()) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found or expired'));
      return;
    }

    const remainingMs = new Date(request.expiresAt).getTime() - Date.now();

    // Whether this is a RETURN, not a first approval. The consent screen used to preselect
    // "Standard" either way, so bringing a full-access agent back after its token expired — the
    // ordinary way an agent comes back — silently narrowed it, on a click that meant "yes, this is
    // my agent". A boolean only: this endpoint is unauthenticated and rate-limited against user-code
    // enumeration, so it says THAT the agent exists, never what it may do.
    const existing = await storage.getAgent(
      buildGAII(request.agentName, request.ownerName, config.nodeId));

    // The account a request names, only to that account signed in in person. A code is all this
    // endpoint asks for, and the email form of device-authorize resolves an address to the account,
    // so naming it to anyone mapped an address to an account name (secaudit2026oct22). The consent
    // page checks the owner through the owner's own pending list.
    const caller = req.auth;
    const isTheOwner = !!caller && !isAnonymousPrincipal(caller) && isOwnerInPerson(caller)
      && localAccountName(caller.owner) === request.ownerName;

    res.json(success(config.nodeId, {
      user_code: request.userCode,
      agent_name: request.agentName,
      display_name: request.displayName,
      description: request.description,
      ...(isTheOwner ? { owner: request.ownerName } : {}),
      status: request.status,
      existing_agent: !!existing,
      expires_in: Math.ceil(remainingMs / 1000),
    }));
  });

  // POST /v1/agents/verify — consent form submission (approve/deny)
  router.post('/v1/agents/verify', async (req, res) => {
    const { user_code, action, scopes, owner_token } = req.body ?? {};

    if (!user_code || !action || !owner_token) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'user_code, action, and owner_token are required'));
      return;
    }

    // Verify owner JWT. It arrives in the body, where the global auth middleware does not look, so it
    // takes here the credential check every authenticated route takes (credentialRevoked): a revoked
    // token, a signed-out session, and a token of an account that no longer holds the owner name are
    // refused.
    // Approving an agent is the account holder's act in person: isOwnerInPerson, the one test, also
    // refuses a token that carries the owner role beside an agent, ecosystem or app role, or that a
    // visitor from another node holds (secaudit 2026-10, C4).
    const ownerPayload = await verifyJWT(owner_token);
    if (!ownerPayload || !isOwnerInPerson(ownerPayload) || await credentialRevoked(owner_token, ownerPayload)) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid or expired owner token'));
      return;
    }

    const request = await storage.getDeviceAuthByUserCode(user_code);
    if (!request) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found'));
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PROCESSED', `This request has already been ${request.status}`));
      return;
    }

    if (new Date(request.expiresAt) <= new Date()) {
      await storage.updateDeviceAuth(request.deviceCode, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'EXPIRED', 'This authorization request has expired'));
      return;
    }

    // Verify owner matches
    if (ownerPayload.owner !== request.ownerName) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only approve requests for your own account'));
      return;
    }

    if (action === 'deny') {
      await storage.updateDeviceAuth(request.deviceCode, { status: 'denied' });
      res.json(success(config.nodeId, { status: 'denied' }));
      emitChange('agents');
      return;
    }

    if (action !== 'approve') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action must be "approve" or "deny"'));
      return;
    }

    // === APPROVE FLOW ===

    // What this approval grants when the owner named nothing. Order matters: an explicit choice
    // wins; failing that, what the AGENT asked for at authorize time; failing that, the node
    // default. The middle step is the fix — an agent that asked for task:read/task:write used to be
    // handed the node default (catalogue:read + memory:read/write/delete) and could take no work
    // at all, while looking perfectly connected.
    //
    // For an EXISTING agent this list is only checked against the ceiling and then ignored:
    // approveDeviceAuth reads `scopesRequested` (below, `Array.isArray(scopes)` — the OWNER's
    // silence, not the agent's) and keeps what the agent already holds. Re-approval is unchanged.
    const finalScopes = scopes ?? request.requestedScopes ?? config.defaultAgentScopes;
    const invalid = scopesExceedNodeMax(config, finalScopes);
    if (invalid.length > 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Your assistant asked for more than this node allows. Choose fewer permissions, or ask whoever runs this node.`));
      return;
    }

    const result = await approveDeviceAuth(
      config, storage, request, ownerPayload.owner, finalScopes,
      req.headers['user-agent'] as string | undefined,
      Array.isArray(scopes),
    );
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }

    res.json(success(config.nodeId, {
      status: 'approved',
      gaii: result.gaii,
      agent_name: request.agentName,
      existing_agent: result.existing,
    }));
  });
}
