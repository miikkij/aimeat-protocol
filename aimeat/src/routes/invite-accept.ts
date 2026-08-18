/**
 * @file src/routes/invite-accept.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PUBLIC invitation token flow: GET /v1/invitations/:token (what this link is)
 *   and POST /v1/invitations/:token/accept (redeem it — sign in or create the account).
 *
 *   This is the ONE place where "click an emailed link, pick a username, get an account" happens,
 *   and it serves BOTH invitation variants:
 *     - an ORGANISM invitation (organismId set) also joins the organism and applies the workspace
 *       grants the inviter chose;
 *     - a NODE invitation (organismId null — the agent door, 12-ai-rekisteroi.md) stops at the
 *       account and sends the person to their home.
 *
 *   Everything up to the account is identical between them: the token, the expiry, the single-use
 *   check, the recipient binding, and provisionOwner with the invited address already verified —
 *   which is what makes "no code to type" true, since the link itself proves the address.
 *
 *   It lives here rather than under routes/organisms/ because it stopped being organism-only the
 *   day the node-level variant joined it, and because that file passed its size cap.
 * @structure inviteAcceptRouter(config, storage, deps): the two public routes
 * @usage app.use(inviteAcceptRouter(config, storage, { findWsEntry }));
 * @version-history
 *   v1.1.0 — 2026-08-18 — Registration-mode gate (open|invite|closed): redeeming an invitation stays open in 'invite' mode and answers 403 only on a fully closed node; the invite is never consumed by the refusal.
 *   v1.0.0 — 2026-08-07 — Extracted from routes/organisms/workspace-access.ts when the node-level
 *     registration invite (remake 4b) made the flow shared. No behaviour change for organism
 *     invitations; the node variant is the added branch.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { optionalAuth } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateOwnerName } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { notify } from '../services/notify.js';
import { hashPassword } from '../services/password.js';
import { validatePasswordStrength } from '../utils/password-validation.js';
import { provisionOwner, ProvisionEmailTakenError, registrationRefusal } from '../services/owner-provisioning.js';
import { establishOwnerSession } from '../services/owner-session.js';
import { hashInviteToken, applyInvitationWorkspaceGrants, resolveInvitationReturnTarget } from '../services/invitations.js';
import { logger } from '../utils/logger.js';

/** The one organism helper this flow needs: resolve a workspace's registry entry for display. */
export interface InviteAcceptDeps {
  findWsEntry(orgId: string, ws: string): Promise<{ id: string; name?: string; createdBy?: string; ownerGaii: string } | null>;
}

export function inviteAcceptRouter(config: AimeatConfig, storage: Storage, deps: InviteAcceptDeps): Router {
  const router = Router();
  const { findWsEntry } = deps;

  /* GET /v1/invitations/:token — PUBLIC: invite details for the accept page (token carried in the URL).
   * optionalAuth so a signed-in visitor gets a `viewer` verdict (does MY verified email match the
   * invited address?) and the accept page can warn BEFORE the button instead of after a 403. */
  router.get('/v1/invitations/:token', optionalAuth(), rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
    const token = req.params.token as string;
    const inv = await storage.getInvitationByHash(hashInviteToken(token));
    if (!inv || inv.status === 'cancelled' || (inv.type !== 'link' && inv.type !== 'registration')) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status === 'accepted') { res.status(410).json(error(config.nodeId, 'INVITE_USED', 'This invitation has already been accepted')); return; }
    if (inv.status === 'expired' || new Date(inv.expiresAt) <= new Date()) {
      if (inv.status === 'pending') await storage.updateInvitation(inv.id, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'INVITE_EXPIRED', 'This invitation has expired'));
      return;
    }
    // A NODE-level invitation (the agent door) has no organism and no workspaces. Everything else
    // on this page — the address it was sent to, whether that address already has an account, the
    // expiry — is identical, which is why the two share this endpoint instead of forking it.
    const organism = inv.organismId ? await storage.getOrganism(inv.organismId) : null;
    if (inv.organismId && !organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const registered = !!(await storage.getGHIIByEmailHash(inv.emailHash));
    const wsDisplay: Array<{ ws: string; name: string; role: string }> = [];
    if (inv.organismId) {
      for (const g of inv.workspaces) {
        const entry = await findWsEntry(inv.organismId, g.ws);
        wsDisplay.push({ ws: g.ws, name: entry?.name || g.ws, role: g.role });
      }
    }
    // Signed-in visitor: report whether accepting as THIS account is allowed (verified email matches),
    // so the page shows the mismatch warning up front. Never leak the account's email — only a verdict.
    let viewer: { owner: string; email_matches: boolean; has_verified_email: boolean } | undefined;
    if (req.auth && req.auth.anonymous !== true) {
      const owner = req.auth.owner as string;
      const g = await storage.getGHII(`${owner}@${config.nodeId}`);
      const hash = g?.emailVerifiedAt ? g.emailHash : undefined;
      viewer = { owner, has_verified_email: !!hash, email_matches: !!hash && hash === inv.emailHash };
    }
    res.json(success(config.nodeId, {
      invitation: {
        kind: inv.organismId ? 'organism' : 'node',
        email: inv.email,
        org_role: inv.orgRole,
        workspaces: wsDisplay,
        message: inv.message,
        invited_by: inv.invitedBy,
        expires_at: inv.expiresAt,
        registered,
        organism: organism
          ? { id: organism.id, name: organism.name, description: organism.description, type: organism.type, visibility: organism.visibility }
          : null,
        // What caused this email, for a NODE invitation: what the AI said about itself, and what
        // the server saw. Shown to the recipient so an unrequested email is judgeable rather than
        // mysterious. Never used to decide anything.
        requested_by: inv.organismId ? null : (inv.meta ?? null),
      },
      viewer,
    }));
  });

  /* POST /v1/invitations/:token/accept — PUBLIC: register (or use current session) + join org + workspaces */
  router.post('/v1/invitations/:token/accept', optionalAuth(), rateLimit({ max: 10, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const token = req.params.token as string;
    const inv = await storage.getInvitationByHash(hashInviteToken(token));
    if (!inv || inv.status === 'cancelled') { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    // Only magic-link invites are redeemable via a token. A 'code' invite provisions its account at
    // mint time and its uuid tokenHash is never surfaced anywhere — defence in depth: refuse to run the
    // grant-applying accept path against a code invite even if its token were somehow presented.
    if (inv.type !== 'link' && inv.type !== 'registration') { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status === 'accepted') { res.status(410).json(error(config.nodeId, 'INVITE_USED', 'This invitation has already been accepted')); return; }
    if (inv.status === 'expired' || new Date(inv.expiresAt) <= new Date()) {
      if (inv.status === 'pending') await storage.updateInvitation(inv.id, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'INVITE_EXPIRED', 'This invitation has expired'));
      return;
    }
    // A NODE-level invitation (the agent door) has no organism. Everything up to here — the token,
    // the expiry, the single-use check, the recipient binding and the account creation below — is
    // shared verbatim; only the joining is skipped. That sharing is the point: there is ONE place
    // where "click a link, pick a username, get an account" happens.
    const organismId = inv.organismId;
    const organism = organismId ? await storage.getOrganism(organismId) : null;
    if (organismId && !organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }

    // Who is accepting: a real (non-anonymous) session, else create a fresh account from the register form.
    const authed = req.auth && req.auth.anonymous !== true ? (req.auth.owner as string) : null;
    let ownerName: string;
    let createdAccount = false;
    if (authed) {
      ownerName = authed;
      // RECIPIENT BINDING (invite-hijack guard): an invitation is a rights-bearing capability minted
      // for one specific email (inv.emailHash). A signed-in session may absorb it ONLY when its OWN
      // verified email matches that address — otherwise any logged-in visitor who opens the link would
      // inherit the operator-curated org role + workspace grants. No match (or no verified email at
      // all) → 403 and the invite is NOT consumed, so the right party can still use it. The legit
      // "put this on my other account" case is served by the operator's direct-add / name-invite.
      const acceptor = await storage.getGHII(`${ownerName}@${config.nodeId}`);
      const acceptorHash = acceptor?.emailVerifiedAt ? acceptor.emailHash : undefined;
      if (!acceptorHash || acceptorHash !== inv.emailHash) {
        res.status(403).json(error(config.nodeId, 'EMAIL_MISMATCH',
          'This invitation was sent to a different email address. Sign out and open the invitation link again, or ask the inviter to add your account directly.'));
        return; // do NOT consume the invite
      }
    } else {
      // Registration mode: redeeming a member-minted invitation is the 'invitation' road — it
      // stays open in 'invite' mode and closes only when the node is fully closed. A signed-in
      // acceptance above creates no account and is never gated.
      const modeRefusal = registrationRefusal(config, 'invitation');
      if (modeRefusal) {
        res.status(403).json(error(config.nodeId, 'REGISTRATION_CLOSED', modeRefusal));
        return; // the invite is NOT consumed — it works again if the node reopens
      }
      let { username } = req.body ?? {};
      const { password, display_name, locale } = req.body ?? {};
      if (!username || typeof username !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required')); return; }
      username = username.trim().toLowerCase();
      if (username.includes('@')) username = username.split('@')[0];
      const nameErr = validateOwnerName(username);
      if (nameErr) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameErr)); return; }
      if (!password || typeof password !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required')); return; }
      const pwErr = validatePasswordStrength(password);
      if (pwErr) { res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwErr)); return; }
      if (await storage.getOwner(username)) { res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`)); return; }
      const passwordHash = await hashPassword(password);
      let owner;
      try {
        ({ owner } = await provisionOwner(storage, config, {
          via: 'invitation',
          username,
          displayName: (typeof display_name === 'string' && display_name.trim()) ? display_name.trim() : username,
          passwordHash,
          locale: typeof locale === 'string' ? locale : undefined,
          verifiedEmail: inv.email, // the invite proves reachability → the new account's email is verified
          enableMagicLink: true,
        }));
      } catch (e) {
        // The invited email already backs an account — accept from THAT account, don't fork it.
        if (!(e instanceof ProvisionEmailTakenError)) throw e;
        res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN',
          'An account already exists for this email. Sign in with it, then open the invitation link again.'));
        return; // do NOT consume the invite
      }
      ownerName = owner.name;
      createdAccount = true;
      emitChange('ghii');
    }

    const nowIso = new Date().toISOString();

    // ── NODE-level invitation: the account IS the whole outcome. ──
    if (!organismId || !organism) {
      await storage.updateInvitation(inv.id, { status: 'accepted', acceptedAt: nowIso, acceptedBy: ownerName });
      // A durable mark on the account: an agent started this, and with which model (12-ai-rekisteroi.md).
      // Part of the account's history, not only a statistic — the home greets a person whose AI has
      // already been here differently.
      void import('../services/onboarding-funnel.js').then(async (m) => {
        const agent = (inv.meta as { agent?: Record<string, unknown> } | null)?.agent ?? {};
        const K = m.ONBOARDING_KEYS;
        // The durable mark on the account, and the two halves of the door's own funnel: when the
        // AI asked, and how long the person took to finish. They land on the account rather than
        // on the invitation because until now there was no account to attach them to.
        await m.recordOnboardingEvent(storage, config, ownerName, K.startedByAgent, { ...agent });
        await m.recordOnboardingEvent(storage, config, ownerName, K.agentDoorStarted, { at: inv.createdAt });
        await m.recordOnboardingEvent(storage, config, ownerName, K.inviteSentByAgent, { ...agent, at: inv.createdAt });
        await m.recordOnboardingEvent(storage, config, ownerName, K.inviteCompleted, {
          minutesToComplete: Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(inv.createdAt)) / 60000)),
        });
        // The agent door is its own branch value, so these never blur into branch A's numbers.
        await m.recordOnboardingEvent(storage, config, ownerName, K.branchTaken, { branch: 'agent' });
      }).catch(err => logger.warn('registration invite: funnel markers failed', { error: String(err) }));
      emitChange('ghii');

      const nodeOwner = await storage.getOwner(ownerName);
      const nodeSession = await establishOwnerSession(storage, config, req, res, {
        owner: ownerName, roles: nodeOwner?.roles ?? ['owner'],
      });
      res.set('Cache-Control', 'no-store');
      res.json(success(config.nodeId, {
        status: 'registered',
        organism_id: null,
        created_account: createdAccount,
        workspaces: [],
        token: nodeSession.token,
        expires_in: nodeSession.expiresIn,
        // Straight to the home's first step. The chain does not end at the account: the welcome mat
        // and the first agent still come, exactly as they do for anyone who registered themselves.
        redirect: '/v1/home',
      }));
      return;
    }

    // Join the organism: membership row + roster arrays kept in sync (mirrors the accept handler above).
    const existingMembership = await storage.getMembership(organismId, ownerName);
    if (existingMembership) {
      if (existingMembership.status !== 'active') {
        await storage.updateMembership(existingMembership.id, { status: 'active', role: inv.orgRole, joinedAt: nowIso });
      }
    } else {
      await storage.createMembership({
        id: uuidv4(), organismId, ghii: ownerName,
        role: inv.orgRole, status: 'active', invitedBy: inv.invitedBy, joinedAt: nowIso,
      });
    }
    const nextMembers = [...new Set([...organism.members, ownerName])];
    const nextAdmins = inv.orgRole === 'admin' ? [...new Set([...organism.admins, ownerName])] : organism.admins;
    await storage.updateOrganism(organismId, { members: nextMembers, admins: nextAdmins, updatedAt: nowIso });

    // Apply the workspace grants (resolve each workspace's creator = the consent owner — shared core).
    const grantedWs = await applyInvitationWorkspaceGrants(storage, config, { orgId: organismId, grants: inv.workspaces, grantee: ownerName, invitedBy: inv.invitedBy });

    // Consume the invite (single-use) + tell the inviter.
    await storage.updateInvitation(inv.id, { status: 'accepted', acceptedAt: nowIso, acceptedBy: ownerName });
    await notify(storage, `${inv.invitedBy}@${config.nodeId}`, {
      type: 'organism_invitation_accepted',
      title: `${ownerName} accepted your invitation to "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    emitChange('organisms');

    // Log the accepting user straight in (fresh roles), so the SPA lands authenticated.
    const ownerRecord = await storage.getOwner(ownerName);
    const roles = ownerRecord?.roles ?? ['owner'];
    const session = await establishOwnerSession(storage, config, req, res, { owner: ownerName, roles });

    // Land the accepter on the inviter's chosen return target (e.g. back in the Experience Center
    // app, already signed in), else inside the invited-to organism. Re-validate the stored value
    // against the allowlist at redirect time — the security-critical open-redirect check.
    const returnTarget = inv.returnUrl ? resolveInvitationReturnTarget(inv.returnUrl, config) : null;
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, {
      status: 'joined',
      organism_id: organismId,
      created_account: createdAccount,
      workspaces: grantedWs,
      token: session.token,
      expires_in: session.expiresIn,
      // ?joined=1 = fresh join; the generic profile is what an invited member measurably bounced off (UX-remake v3, P8).
      redirect: returnTarget ?? `/v1/profile?tab=organisms&org=${encodeURIComponent(organismId)}&joined=1`,
    }));
  });

  return router;
}
