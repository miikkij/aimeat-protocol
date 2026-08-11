/**
 * @file invitations.ts
 * @description Framework-agnostic core for organism invitations, shared by the REST routes
 *   (src/routes/organisms/*) and the MCP tools (src/mcp/organisms.ts) so both entry points behave
 *   identically. Covers BOTH invitation kinds: (1) EMAIL invitations to people not yet on the node —
 *   mint a single-use, time-limited token, persist the invitation (hash only), notify an already-
 *   registered invitee in-app, send the email; the accept side (register + session) stays in the
 *   route. (2) NAME invitations + DIRECT ADDS of already-registered local owners — carry an org role
 *   and per-workspace grants chosen at invite time (membership row `role` + `invitedWorkspaces`),
 *   editable while pending, applied via applyInvitationWorkspaceGrants on accept (or immediately on
 *   a direct add).
 * @structure constants (expiry/cap); hashInviteToken/inviteEmailHash; InvitationError; invitePublic;
 *   normalizeOrgRole/normalizeInviteeName/normalizeWorkspaceGrants; findWorkspaceEntry;
 *   applyInvitationWorkspaceGrants + its inverse revokeDepartedMemberAccess;
 *   createNameInvitation/updateNameInvitation/cancelNameInvitation/
 *   acceptNameInvitation/declineNameInvitation/addOrganismMember; createEmailInvitation/
 *   cancelEmailInvitation().
 * @usage const { invitation, acceptUrl, emailSent } = await createEmailInvitation(storage, config, input);
 *   const membership = await createNameInvitation(storage, config, { organism, inviterGhii, inviteeRaw, role, workspaces });
 *   await revokeDepartedMemberAccess(storage, config, { organism, departing });
 * @version-history
 *   v1.6.0 — 2026-08-11 — SECURITY (H-29): revokeDepartedMemberAccess(), the inverse of
 *     applyInvitationWorkspaceGrants — a removed, banned or departed member's agents are detached from
 *     the organism and their workspace-role consents revoked, neither of which the membership row's
 *     deletion touched.
 *   v1.5.0 — 2026-08-11 — declineNameInvitation() + cancelEmailInvitation(): the last two invitation
 *     writes that still existed twice, once in the REST route and once in the MCP tool (August 2026
 *     MCP audit step 8).
 *   v1.4.0 — 2026-07-18 — resolveInvitationReturnTarget(): allowlist an inviter-pinned post-accept
 *     redirect (node origin + app-origin subdomains only — open-redirect guard); createEmailInvitation
 *     stores the validated returnUrl so a link invitee can land back in the inviting app after accept.
 *   v1.3.0 — 2026-07-16 — Name-invite core: role + invitedWorkspaces at invite time, direct add
 *     (addOrganismMember), pending-invite update/cancel, shared grant application
 *     (applyInvitationWorkspaceGrants extracted from the email-accept + code-mint loops).
 *   v1.2.0 — 2026-07-10 — Add normalizeInviteeName(): shared trim/lowercase/@node-strip for name-invites
 *     (REST + MCP) so memberships + notifications land on the identity the invitee actually signs in as.
 *   v1.1.0 — 2026-07-05 — Add INVITE_CODE_QUOTA_PER_MEMBER + type/provisionedOwner on the record (provisioned-code keys live in routes/organisms.ts).
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 */
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../storage/interface.js';
import type { InvitationRecord, InvitationWorkspaceGrant } from '../storage/repositories/invitation.repository.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { getActiveEmailService } from './email.js';
import { registrationInviteEmail } from './email-templates.js';
import { grantWorkspaceRole, revokeWorkspaceRole } from './workspace-roles.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export const INVITE_DEFAULT_EXPIRY_DAYS = 7;
export const INVITE_MAX_EXPIRY_DAYS = 30;
export const INVITE_MAX_PENDING_PER_ORG = 50; // abuse cap on outstanding email invites per organism
export const INVITE_CODE_QUOTA_PER_MEMBER = 3; // per-inviter cap on provisioned-code keys; org creators/admins are exempt (unlimited)
const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

/** SHA-256 of the raw invite token — only the hash is stored; the raw token lives only in the link. */
export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
/** SHA-256 of a normalized email — matches GHII.emailHash hashing (existing-user detection). */
export function inviteEmailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/**
 * Resolve + ALLOWLIST an inviter-supplied return target for the post-accept redirect. Accepts either
 * a full URL or a bare app slug ("experience-center" → https://experience-center.<appHost>). Returns
 * the normalized absolute URL ONLY when its host is the node's own origin or an app-origin host/
 * subdomain (`apps.<apex>` / `*.apps.<apex>`, plus `*.apps.localhost` on a localhost node). Returns
 * null for anything else. This is the open-redirect guard: an accept page is auth-adjacent (it sets a
 * session cookie), so an arbitrary attacker URL must never be reflected. Enforced at BOTH mint time
 * (store only a safe value) and redirect time (re-validate the stored value — the security-critical
 * check, in case the allowlist changed after mint). Plaintext http is rejected off-localhost.
 */
export function resolveInvitationReturnTarget(raw: unknown, config: AimeatConfig): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;

  let candidate = s;
  if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(s)) {
    // Bare app slug → the app's subdomain of the app-origin host (needs a configured app host).
    if (!config.appHost) return null;
    candidate = `https://${s.toLowerCase()}.${config.appHost}`;
  } else if (!/^https?:\/\//i.test(s)) {
    // A host (or host/path) without a scheme — assume https so URL() can parse it.
    candidate = `https://${s}`;
  }

  let url: URL;
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  try { url = new URL(candidate); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const isLocalHost = host === 'localhost' || host.endsWith('.localhost');
  if (url.protocol === 'http:' && !isLocalHost) return null; // no plaintext redirect off localhost

  // 1) The node's own origin (baseUrl host).
  let nodeHost = '';
  // eslint-disable-next-line aimeat/no-silent-catch -- host-less baseUrl
  try { nodeHost = new URL(config.baseUrl).hostname.toLowerCase(); } catch { /* host-less baseUrl */ }
  if (nodeHost && host === nodeHost) return url.toString();

  // 2) The app-origin host + any per-app subdomain (apps.<apex> / *.apps.<apex>).
  const appHost = (config.appHost || '').toLowerCase();
  if (appHost && (host === appHost || host.endsWith(`.${appHost}`))) return url.toString();

  // 3) Local-dev convenience: *.apps.localhost when the node itself runs on localhost.
  const nodeIsLocal = nodeHost === 'localhost' || nodeHost.endsWith('.localhost');
  if (nodeIsLocal && (host === 'apps.localhost' || host.endsWith('.apps.localhost'))) return url.toString();

  return null;
}

/** A validation/precondition failure the caller maps to its own error shape (HTTP envelope / MCP text). */
export class InvitationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

/** Safe public projection of an invitation (never leaks the token hash). */
export function invitePublic(inv: InvitationRecord) {
  return {
    id: inv.id,
    email: inv.email,
    organism_id: inv.organismId,
    org_role: inv.orgRole,
    type: inv.type,
    provisioned_owner: inv.provisionedOwner,
    workspaces: inv.workspaces,
    status: inv.status,
    invited_by: inv.invitedBy,
    message: inv.message,
    created_at: inv.createdAt,
    expires_at: inv.expiresAt,
    accepted_at: inv.acceptedAt,
  };
}

export function normalizeOrgRole(role: unknown): 'member' | 'admin' {
  return role === 'admin' ? 'admin' : 'member';
}

/**
 * Normalize a name-invite invitee the same way registration normalizes usernames (ghii.ts): trim,
 * lowercase, and accept the full local GHII form by stripping a matching `@node-id` suffix.
 * Membership rows and notifications are keyed by the bare lowercase owner name — an unnormalized
 * invitee ("Alice", "alice ") would be written under an identity nobody authenticates as and the
 * invitation would be permanently invisible to the invitee. Returns null for a remote identity
 * (`someone@other-node`), which name-invites don't support.
 */
export function normalizeInviteeName(raw: string, nodeId: string): string | null {
  let name = raw.trim().toLowerCase();
  const atIdx = name.indexOf('@');
  if (atIdx !== -1) {
    if (name.substring(atIdx + 1) !== nodeId) return null;
    name = name.substring(0, atIdx);
  }
  return name;
}

/** Normalize a raw workspaces input into de-duplicated { ws, role } grants. */
export function normalizeWorkspaceGrants(raw: unknown): InvitationWorkspaceGrant[] {
  const out: InvitationWorkspaceGrant[] = [];
  if (!Array.isArray(raw)) return out;
  for (const w of raw) {
    const ws = typeof (w as { ws?: unknown })?.ws === 'string'
      ? (w as { ws: string }).ws
      : (typeof w === 'string' ? w : '');
    if (!ws) continue;
    const role: 'viewer' | 'contributor' = (w as { role?: unknown })?.role === 'contributor' ? 'contributor' : 'viewer';
    if (!out.some(g => g.ws === ws)) out.push({ ws, role });
  }
  return out;
}

export interface CreateEmailInvitationInput {
  organism: OrganismRecord;
  inviterGhii: string; // bare owner name of the creator/admin
  email: string;
  orgRole: 'member' | 'admin';
  workspaces: InvitationWorkspaceGrant[]; // caller has authorized these (org creator/admin can grant any)
  message?: string | null;
  expiresInDays?: number;
  returnUrl?: string | null; // raw inviter-supplied return target (app slug or URL); allowlisted here
}

export interface CreateEmailInvitationResult {
  invitation: InvitationRecord;
  rawToken: string;
  acceptUrl: string;
  emailSent: boolean;
  existingUser: boolean;
}

/**
 * Validate + persist an email invitation, ping an already-registered invitee in-app, and send the
 * invitation email (best-effort). Throws InvitationError on bad email / dedupe / cap violations.
 */
export async function createEmailInvitation(
  storage: Storage,
  config: AimeatConfig,
  input: CreateEmailInvitationInput,
): Promise<CreateEmailInvitationResult> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  if (!cleanEmail || !INVITE_EMAIL_RE.test(cleanEmail)) {
    throw new InvitationError(400, 'INVALID_INPUT', 'A valid "email" is required');
  }
  const id = input.organism.id;
  const emailHash = inviteEmailHash(cleanEmail);

  const pending = await storage.listInvitationsByOrganism(id, { status: 'pending' });
  if (pending.length >= INVITE_MAX_PENDING_PER_ORG) {
    throw new InvitationError(429, 'TOO_MANY_INVITES', 'This organism has too many pending invitations — cancel some before sending more');
  }
  if (pending.some(p => p.emailHash === emailHash)) {
    throw new InvitationError(409, 'ALREADY_INVITED', 'There is already a pending invitation for that email');
  }

  const days = Number.isFinite(Number(input.expiresInDays))
    ? Math.min(INVITE_MAX_EXPIRY_DAYS, Math.max(1, Math.floor(Number(input.expiresInDays))))
    : INVITE_DEFAULT_EXPIRY_DAYS;
  const now = Date.now();
  const rawToken = randomBytes(32).toString('hex');
  // Allowlist the return target now so an unsafe value is never persisted (re-validated at redirect).
  const returnUrl = input.returnUrl != null ? resolveInvitationReturnTarget(input.returnUrl, config) : null;
  const invitation: InvitationRecord = {
    id: uuidv4(),
    tokenHash: hashInviteToken(rawToken),
    organismId: id,
    orgRole: input.orgRole,
    type: 'link',
    workspaces: input.workspaces,
    email: cleanEmail,
    emailHash,
    invitedBy: input.inviterGhii,
    provisionedOwner: null,
    message: (input.message && input.message.trim()) ? input.message.trim().slice(0, 1000) : null,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
    returnUrl,
    meta: null,
  };
  await storage.createInvitation(invitation);

  // The accept URL (same construction as the magic link) — the raw token lives ONLY here.
  const acceptUrl = `${config.baseUrl}/v1/invite?token=${rawToken}`;

  // If the email already maps to a registered user, also ping them in-app (email still sent below).
  const existing = await storage.getGHIIByEmailHash(emailHash);
  if (existing) {
    await notify(storage, existing.ghii, {
      type: 'organism_invitation',
      title: `${input.inviterGhii} invited you to join "${input.organism.name}"`,
      link: `/v1/invite?token=${rawToken}`,
    });
    emitChange('notifications');
  }

  // Send the invitation email (best-effort; a disabled transport returns false).
  const emailSvc = getActiveEmailService();
  let emailSent = false;
  if (emailSvc?.enabled) {
    emailSent = await emailSvc.sendInvite(cleanEmail, {
      orgName: input.organism.name,
      inviterName: input.inviterGhii,
      acceptUrl,
      workspaces: invitation.workspaces.map(g => ({ ws: g.ws, role: g.role })),
      message: invitation.message,
      expiresLabel: invitation.expiresAt.slice(0, 10),
    }, existing?.locale);
  }

  emitChange('organisms');
  return { invitation, rawToken, acceptUrl, emailSent, existingUser: !!existing };
}

/* ══ NODE-level invitation — the agent door (12-ai-rekisteroi.md) ══
 *
 * An AI makes one POST with a person's email address. The node emails that address a link; the
 * person clicks it, picks a username, and has an account. The AI never creates the account and
 * never chooses the username: it supplies an address, and the address's owner decides.
 *
 * This is the SAME record, the same token, the same accept endpoint and the same account-creation
 * path as an organism invitation — with organismId null. What differs is only that nothing is
 * joined at the end, and that the email has to explain itself, because nobody asked for it. */

/** The one identity string in `invitedBy` for a node-level invite. A colon cannot appear in an
 *  owner name (OWNER_RE), so this can never collide with a real inviter. */
export const AGENT_DOOR_INVITER = 'node:agent-door';

/** One live invitation per address at a time — the abuse cap on an OPEN, email-sending endpoint. */
export const REGISTRATION_INVITE_EXPIRY_HOURS = 24;

/** What the AI said about itself. Every field is its own claim and none is verified. */
export interface AgentSelfReport {
    model?: string | null;
    vendor?: string | null;
    client?: string | null;
}

/** What the SERVER saw. Unlike the self-report, this is evidence. */
export interface RequestObservation {
    ip: string;
    userAgent: string | null;
    at: string;
}

export interface RegistrationInviteInput {
    email: string;
    agent: AgentSelfReport;
    observed: RequestObservation;
    locale?: string;
}

export interface RegistrationInviteResult {
    /** Absent when the request was suppressed by the per-address cap — the caller must not learn that. */
    invitation: InvitationRecord | null;
    acceptUrl: string | null;
    emailSent: boolean;
    /** Why nothing was sent, for the node's own logs. NEVER returned to the caller. */
    suppressed: 'already-pending' | null;
}

/**
 * Mint and send a node-level registration invitation.
 *
 * Two properties this function exists to guarantee:
 *
 * 1. **The response cannot be used to test addresses.** It returns the same shape whether the
 *    address is new, already has an account, or already has a pending invite. An endpoint that
 *    said "already registered" would be an account-enumeration oracle open to the internet.
 * 2. **The email explains itself.** Nobody asked for it, so it carries what the AI claimed
 *    (model / vendor / client) beside what the server observed (IP, user agent, time), and says
 *    plainly that ignoring it means no account is created. That is what turns an open endpoint
 *    from a weakness into something traceable: every unrequested message writes a full account of
 *    itself into the mailbox of the person it concerns.
 */
export async function createRegistrationInvitation(
    storage: Storage,
    config: AimeatConfig,
    input: RegistrationInviteInput,
): Promise<RegistrationInviteResult> {
    const cleanEmail = (input.email || '').trim().toLowerCase();
    if (!cleanEmail || !INVITE_EMAIL_RE.test(cleanEmail)) {
        throw new InvitationError(400, 'INVALID_INPUT', 'A valid "email" is required');
    }
    const emailHash = inviteEmailHash(cleanEmail);

    // Per-address cap: one live invitation at a time, so repeating the call cannot bury an address
    // in mail. Expired ones do not count — the next attempt is allowed once the last has lapsed.
    const existing = await storage.listInvitationsByEmailHash(emailHash, { status: 'pending', type: 'registration' });
    const live = existing.filter(i => new Date(i.expiresAt) > new Date());
    if (live.length > 0) {
        return { invitation: null, acceptUrl: null, emailSent: false, suppressed: 'already-pending' };
    }

    const now = Date.now();
    const rawToken = randomBytes(32).toString('hex');
    const invitation: InvitationRecord = {
        id: uuidv4(),
        tokenHash: hashInviteToken(rawToken),
        organismId: null,
        orgRole: 'member',
        type: 'registration',
        workspaces: [],
        email: cleanEmail,
        emailHash,
        invitedBy: AGENT_DOOR_INVITER,
        provisionedOwner: null,
        message: null,
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + REGISTRATION_INVITE_EXPIRY_HOURS * 3600_000).toISOString(),
        acceptedAt: null,
        acceptedBy: null,
        returnUrl: null,
        // The two kinds of fact, kept apart: `agent` is a self-report, `observed` is evidence.
        meta: {
            agent: {
                model: input.agent.model ?? null,
                vendor: input.agent.vendor ?? null,
                client: input.agent.client ?? null,
            },
            observed: { ip: input.observed.ip, userAgent: input.observed.userAgent, at: input.observed.at },
        },
    };
    await storage.createInvitation(invitation);

    const acceptUrl = `${config.baseUrl}/v1/invite?token=${rawToken}`;

    const emailSvc = getActiveEmailService();
    let emailSent = false;
    if (emailSvc?.enabled) {
        const { subject, html, text } = registrationInviteEmail({
            acceptUrl,
            agent: invitation.meta!.agent as AgentSelfReport,
            observed: input.observed,
            expiresLabel: invitation.expiresAt.slice(0, 16).replace('T', ' ') + ' UTC',
            reportUrl: `${config.baseUrl}/v1/transparency`,
        }, input.locale);
        emailSent = await emailSvc.sendRaw(cleanEmail, subject, html, text);
    }

    return { invitation, acceptUrl, emailSent, suppressed: null };
}

/* ══ Name invitations + direct adds — already-registered LOCAL owners ══
 * The membership row IS the invitation (status 'invited'); `role` + `invitedWorkspaces` carry the
 * access chosen at invite time so the invitee lands with the right rights the moment they accept.
 * A direct add skips the accept round-trip entirely (product decision 2026-07-16): the member is
 * active immediately, grants applied, and they are notified (they can always leave). */

/** Find a workspace's registry entry across every member's registry copy (one key per creator).
 *  Standalone twin of routes/organisms/shared.ts findWsEntry so the service layer needs no route
 *  helper bag. */
export async function findWorkspaceEntry(
  storage: Storage, orgId: string, ws: string,
): Promise<{ id: string; name?: string; createdBy?: string; ownerGaii: string } | null> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [];
    const entry = list.find(w => w.id === ws);
    if (entry) return { ...entry, ownerGaii: rec.ownerGaii };
  }
  return null;
}

/** The bare owner behind a memory record's owner identity (`agent#owner@node` / `owner@node` → `owner`). */
function bareOwnerOf(gaii: string): string {
  return (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];
}

/**
 * Apply a set of invite-time workspace grants to a grantee: resolve each workspace's creator (= the
 * consent owner) and grant the role with source 'invite'. Skips a deleted workspace and the case
 * where the grantee IS the creator. The ONE code path behind email-invite accept, code-invite mint,
 * name-invite accept, and direct add. Returns the workspace ids actually granted.
 */
export async function applyInvitationWorkspaceGrants(
  storage: Storage,
  config: AimeatConfig,
  args: { orgId: string; grants: InvitationWorkspaceGrant[]; grantee: string; invitedBy: string },
): Promise<string[]> {
  const granted: string[] = [];
  for (const g of args.grants) {
    const entry = await findWorkspaceEntry(storage, args.orgId, g.ws);
    if (!entry) continue; // workspace deleted since the invite — skip
    const createdBy = entry.createdBy ?? bareOwnerOf(entry.ownerGaii);
    if (createdBy === args.grantee) continue; // the creator already has full access
    await grantWorkspaceRole(storage, config, {
      creatorGhii: `${createdBy}@${config.nodeId}`, orgId: args.orgId, ws: g.ws,
      grantee: args.grantee, role: g.role, source: 'invite', grantedBy: args.invitedBy,
    });
    granted.push(g.ws);
  }
  return granted;
}

/**
 * The inverse of {@link applyInvitationWorkspaceGrants}: strip an organism's access from someone whose
 * membership has just ended, whether they left, were removed, or were banned.
 *
 * Deleting the membership row and pruning members[]/admins[] was never the whole of it, because two
 * things outlive that row and both of them ARE access:
 *
 *   1. `organism.agentGaiis`. Every membership gate in the organism code treats a GAII listed there as
 *      a member in its own right (routes/organisms/shared.ts memberRole, the nine workspace read
 *      gates, the MCP workspace tools), so an ejected person kept the whole organism through their own
 *      agent's token while the roster showed them gone.
 *   2. The workspace-role consents granted to them. Those are owned by each workspace's CREATOR and
 *      keyed to the departing owner, so nothing about ending their membership reaches them — they
 *      would keep serving cross-owner reads of workspace content indefinitely.
 *
 * A workspace the departing person created themselves is skipped: those grants are theirs, on their
 * own content, and revoking them would be this function deciding what someone may do with their own
 * data. Call it after the membership write, from every door that ends a membership. Returns what it
 * removed, so a caller can log or report it.
 */
export async function revokeDepartedMemberAccess(
  storage: Storage,
  config: AimeatConfig,
  args: { organism: OrganismRecord; departing: string },
): Promise<{ detachedAgents: string[]; revokedWorkspaces: string[] }> {
  const { organism, departing } = args;

  // Agents are listed by full GAII (`claude#alice@node`); the owner segment ties one to a person.
  const detachedAgents = organism.agentGaiis.filter(g => parseGaiiLoose(g).owner === departing);
  if (detachedAgents.length) {
    await storage.updateOrganism(organism.id, {
      agentGaiis: organism.agentGaiis.filter(g => !detachedAgents.includes(g)),
      updatedAt: new Date().toISOString(),
    });
  }

  // Which consent list to look in is decided by who CREATED each workspace, and the registry is what
  // says so — one registry record per creator, each listing the workspaces they made. revokeWorkspaceRole
  // is the same call the deny and revoke routes make, so what counts as a workspace-role grant stays
  // defined in exactly one place (services/workspace-roles.ts).
  const revokedWorkspaces: string[] = [];
  const regKey = `organism.${organism.id}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  const seen = new Set<string>();
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id?: string; createdBy?: string }> } | null)?.workspaces ?? [];
    for (const w of list) {
      if (!w.id || seen.has(w.id)) continue;
      seen.add(w.id);
      const createdBy = w.createdBy ?? bareOwnerOf(rec.ownerGaii);
      if (createdBy === departing) continue;
      const revoked = await revokeWorkspaceRole(storage, config, {
        creatorGhii: `${createdBy}@${config.nodeId}`, orgId: organism.id, ws: w.id, grantee: departing,
      });
      if (revoked > 0) revokedWorkspaces.push(w.id);
    }
  }

  if (detachedAgents.length || revokedWorkspaces.length) emitChange('organisms');
  return { detachedAgents, revokedWorkspaces };
}

/** Validate that every grant's workspace exists (invite/update time — an org creator/admin may grant
 *  any existing workspace, so existence is the only per-grant precondition). */
async function assertWorkspacesExist(storage: Storage, orgId: string, grants: InvitationWorkspaceGrant[]): Promise<void> {
  for (const g of grants) {
    if (!(await findWorkspaceEntry(storage, orgId, g.ws))) {
      throw new InvitationError(404, 'WORKSPACE_NOT_FOUND', `Workspace "${g.ws}" not found in this organism`);
    }
  }
}

/** Normalize + validate a name-invite / direct-add target. Throws InvitationError on a remote name,
 *  an unknown owner, or a conflicting membership state. Returns the bare owner name + any existing
 *  membership row (for the caller to upgrade/replace where that is legal). */
async function resolveInvitee(
  storage: Storage, config: AimeatConfig, organismId: string, inviteeRaw: string,
): Promise<{ invitee: string; existing: OrganismMembershipRecord | null }> {
  // Organism members are HUMANS (owners). A GAII/GEAI would fall through to a confusing
  // OWNER_NOT_FOUND ("No owner named agent#owner") — name the real problem instead.
  if (inviteeRaw.includes('#') || inviteeRaw.trim().startsWith('eco:')) {
    throw new InvitationError(400, 'INVALID_INPUT', 'Agents and apps cannot be organism members — invite their owner instead (agents inherit the membership)');
  }
  const invitee = normalizeInviteeName(inviteeRaw, config.nodeId);
  if (!invitee) throw new InvitationError(400, 'INVALID_INPUT', 'Invitee belongs to another node — name-invites work for local owners only');
  if (!(await storage.getOwner(invitee))) throw new InvitationError(404, 'OWNER_NOT_FOUND', `No owner named "${invitee}" on this node`);
  const existing = await storage.getMembership(organismId, invitee);
  if (existing && existing.status === 'active') throw new InvitationError(409, 'ALREADY_MEMBER', 'That owner is already a member');
  if (existing && existing.status === 'banned') throw new InvitationError(409, 'BANNED', 'That owner is blocked — lift the block before inviting');
  return { invitee, existing };
}

export interface NameInviteInput {
  organism: OrganismRecord;
  inviterGhii: string;            // bare owner name of the creator/admin (caller has authorized)
  inviteeRaw: string;
  role?: unknown;                 // normalized via normalizeOrgRole
  workspaces?: unknown;           // normalized via normalizeWorkspaceGrants
}

/** Create a name invitation carrying role + workspace grants. Throws InvitationError. */
export async function createNameInvitation(
  storage: Storage, config: AimeatConfig, input: NameInviteInput,
): Promise<OrganismMembershipRecord> {
  const { invitee, existing } = await resolveInvitee(storage, config, input.organism.id, input.inviteeRaw);
  if (existing && existing.status === 'invited') throw new InvitationError(409, 'ALREADY_INVITED', 'That owner already has a pending invitation');
  const role = normalizeOrgRole(input.role);
  const grants = normalizeWorkspaceGrants(input.workspaces);
  await assertWorkspacesExist(storage, input.organism.id, grants);

  const now = new Date().toISOString();
  const membership = await storage.createMembership({
    id: uuidv4(), organismId: input.organism.id, ghii: invitee,
    role, status: 'invited', invitedBy: input.inviterGhii, joinedAt: now,
    invitedWorkspaces: grants.length ? grants : undefined,
  });
  await notify(storage, `${invitee}@${config.nodeId}`, {
    type: 'organism_invitation',
    title: `${input.inviterGhii} invited you to join "${input.organism.name}"`,
    link: '/v1/profile#organisms',
    // Accept/Decline post the invitee's own invitation endpoints (no body; keyed by org id + caller).
    actions: [
      { id: 'accept', label: 'Accept', kind: 'api', method: 'POST', endpoint: `/v1/organisms/${input.organism.id}/invitations/accept`, style: 'primary' },
      { id: 'decline', label: 'Decline', kind: 'api', method: 'POST', endpoint: `/v1/organisms/${input.organism.id}/invitations/decline`, style: 'default', confirm: true },
    ],
  });
  emitChange('notifications', `${invitee}@${config.nodeId}`);
  emitChange('organisms');
  return membership;
}

/** Edit a PENDING name invitation's role and/or workspace grants (rights stay editable before the
 *  invitee accepts — product decision 2026-07-16). Throws InvitationError. */
export async function updateNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; inviteeRaw: string; role?: unknown; workspaces?: unknown },
): Promise<OrganismMembershipRecord> {
  const invitee = normalizeInviteeName(input.inviteeRaw, config.nodeId);
  const membership = invitee ? await storage.getMembership(input.organism.id, invitee) : null;
  if (!membership || membership.status !== 'invited') {
    throw new InvitationError(404, 'NO_INVITATION', 'No pending invitation for that owner');
  }
  const updates: Partial<OrganismMembershipRecord> = {};
  if (input.role !== undefined) updates.role = normalizeOrgRole(input.role);
  if (input.workspaces !== undefined) {
    const grants = normalizeWorkspaceGrants(input.workspaces);
    await assertWorkspacesExist(storage, input.organism.id, grants);
    updates.invitedWorkspaces = grants;
  }
  const updated = await storage.updateMembership(membership.id, updates);
  emitChange('organisms');
  return updated ?? { ...membership, ...updates };
}

/** Cancel a PENDING name invitation (creator/admin). Throws InvitationError when none exists. */
export async function cancelNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; cancellerGhii: string; inviteeRaw: string },
): Promise<void> {
  const invitee = normalizeInviteeName(input.inviteeRaw, config.nodeId);
  const membership = invitee ? await storage.getMembership(input.organism.id, invitee) : null;
  if (!membership || membership.status !== 'invited') {
    throw new InvitationError(404, 'NO_INVITATION', 'No pending invitation for that owner');
  }
  await storage.deleteMembership(membership.id);
  await notify(storage, `${membership.ghii}@${config.nodeId}`, {
    type: 'organism_invitation_cancelled',
    title: `Your invitation to "${input.organism.name}" was withdrawn`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications', `${membership.ghii}@${config.nodeId}`);
  emitChange('organisms');
}

/**
 * The invitee accepts: activate the membership, sync the organism roster arrays (admins too when the
 * invite carried role 'admin'), apply the invite-time workspace grants, clear them off the row, and
 * tell the inviter. The ONE accept path shared by REST and MCP. Returns the granted workspace ids.
 */
export async function acceptNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; membership: OrganismMembershipRecord },
): Promise<string[]> {
  const { organism, membership } = input;
  const invitee = membership.ghii;
  const now = new Date().toISOString();
  await storage.updateMembership(membership.id, { status: 'active', joinedAt: now, invitedWorkspaces: [] });
  await storage.updateOrganism(organism.id, {
    members: [...new Set([...organism.members, invitee])],
    admins: membership.role === 'admin' ? [...new Set([...organism.admins, invitee])] : organism.admins,
    updatedAt: now,
  });
  const granted = await applyInvitationWorkspaceGrants(storage, config, {
    orgId: organism.id, grants: membership.invitedWorkspaces ?? [],
    grantee: invitee, invitedBy: membership.invitedBy ?? invitee,
  });
  if (membership.invitedBy) {
    await notify(storage, `${membership.invitedBy}@${config.nodeId}`, {
      type: 'organism_invitation_accepted',
      title: `${invitee} accepted your invitation to "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');
  }
  emitChange('organisms');
  return granted;
}

/**
 * The invitee declines: the membership row that WAS the invitation goes away. Throws InvitationError
 * when there is nothing pending. A roster still showing someone who declined is not a stale list, it
 * is a wrong answer about who has access, so this emits `organisms` like the accept path does.
 */
export async function declineNameInvitation(
  storage: Storage,
  input: { organismId: string; inviteeOwner: string },
): Promise<void> {
  const membership = await storage.getMembership(input.organismId, input.inviteeOwner);
  if (!membership || membership.status !== 'invited') {
    throw new InvitationError(404, 'NO_INVITATION', 'You have no pending invitation to this organism');
  }
  await storage.deleteMembership(membership.id);
  emitChange('organisms');
}

/**
 * Cancel a PENDING email invitation (creator/admin; the caller has already authorized). The record
 * is kept and flipped to `cancelled` rather than deleted, so the token stays known-dead and an
 * accept attempt with the old link resolves to a cancelled invitation instead of an unknown one.
 * Throws InvitationError when the invitation is missing, belongs to another organism, or has
 * already been used or cancelled.
 */
export async function cancelEmailInvitation(
  storage: Storage,
  input: { organismId: string; invitationId: string },
): Promise<InvitationRecord> {
  const inv = await storage.getInvitation(input.invitationId);
  if (!inv || inv.organismId !== input.organismId) {
    throw new InvitationError(404, 'NOT_FOUND', 'Invitation not found');
  }
  if (inv.status !== 'pending') {
    throw new InvitationError(409, 'INVALID_STATE', `Invitation is already ${inv.status}`);
  }
  const updated = await storage.updateInvitation(input.invitationId, { status: 'cancelled' });
  emitChange('organisms');
  return updated ?? { ...inv, status: 'cancelled' };
}

/**
 * DIRECT ADD — a creator/admin adds an existing local owner as an ACTIVE member with role +
 * workspace grants applied immediately, no accept round-trip (product decision 2026-07-16: the
 * notification + the ability to leave replace the consent step). A pending name-invite for the same
 * owner is upgraded in place. Throws InvitationError. Returns the membership + granted workspaces.
 */
export async function addOrganismMember(
  storage: Storage, config: AimeatConfig, input: NameInviteInput,
): Promise<{ membership: OrganismMembershipRecord; grantedWorkspaces: string[] }> {
  const { invitee, existing } = await resolveInvitee(storage, config, input.organism.id, input.inviteeRaw);
  const role = normalizeOrgRole(input.role);
  const grants = normalizeWorkspaceGrants(input.workspaces);
  await assertWorkspacesExist(storage, input.organism.id, grants);

  const now = new Date().toISOString();
  let membership: OrganismMembershipRecord;
  if (existing) { // status 'invited' or legacy 'pending' — upgrade in place
    membership = (await storage.updateMembership(existing.id, { status: 'active', role, joinedAt: now, invitedWorkspaces: [] }))
      ?? { ...existing, status: 'active', role, joinedAt: now };
  } else {
    membership = await storage.createMembership({
      id: uuidv4(), organismId: input.organism.id, ghii: invitee,
      role, status: 'active', invitedBy: input.inviterGhii, joinedAt: now,
    });
  }
  await storage.updateOrganism(input.organism.id, {
    members: [...new Set([...input.organism.members, invitee])],
    admins: role === 'admin' ? [...new Set([...input.organism.admins, invitee])] : input.organism.admins,
    updatedAt: now,
  });
  const grantedWorkspaces = await applyInvitationWorkspaceGrants(storage, config, {
    orgId: input.organism.id, grants, grantee: invitee, invitedBy: input.inviterGhii,
  });
  await notify(storage, `${invitee}@${config.nodeId}`, {
    type: 'organism_member_added',
    title: `${input.inviterGhii} added you to "${input.organism.name}" as ${role}`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications', `${invitee}@${config.nodeId}`);
  emitChange('organisms');
  return { membership, grantedWorkspaces };
}
