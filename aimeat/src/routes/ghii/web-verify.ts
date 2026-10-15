/**
 * @file src/routes/ghii/web-verify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GHII web-registration + email/magic-link login routes: POST /v1/ghii/register-web,
 *   POST /v1/ghii/verify-email, POST /v1/ghii/magic-link, GET /v1/ghii/magic-link/verify. Extracted
 *   from src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-16 — The emailed code comes from crypto.randomInt (utils/one-time-code.ts), not Math.random (QA audit F02a-02).
 *   2026-10-15 — The registration hooks run here too (ownerRegistrationRefusal before any row,
 *     announceOwnerRegistered after); only POST /v1/owners ran them (feature-list audit 89).
 *   2026-10-15 — register-web asks createdAccountIsOperator, the rule POST /v1/ghii asks, and writes the
 *     account_created feed row it lacked (feature-list audit 19).
 *   v1.15.0 — 2026-10-12 — The "app" agent both mailbox proofs create holds the node's default agent scopes
 *     (appAgentWithFreshKey), so its token can act; it had none and every scope gate refused it
 *     (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 10).
 *   v1.14.0 — 2026-10-12 — Both agent mints (verify-email, magic-link/verify) carry a session id and
 *     write its session row (mintVerifiedAgentToken), so deleting the agent revokes the token
 *     (Core 2026-11 ID-10).
 *   v1.13.0 — 2026-10-09 — GET /v1/ghii/magic-link/verify no longer re-keys the owner and no longer
 *     returns owner_private_key: that key signs in as the owner and operator, past two-step sign-in,
 *     which a clicked link must not grant (secrets audit 2026-10-09, S2).
 *   v1.12.0 — 2026-10-05 — GET /v1/ghii/magic-link/verify checks and spends the link with
 *     redeemLoginLink, the emailed link's own check, instead of a copy of it (secaudit 2026-10, AUTH-3).
 *   v1.11.0 — 2026-10-01 — POST /v1/ghii/verify-email applies the open app roster invitations of the
 *     address it verifies (services/app-member-invites.ts), beside the contact promotion.
 *   v1.10.0 — 2026-09-29 — POST /v1/ghii/magic-link takes `redirect`, the place the link returns to
 *     (services/login-link.ts loginReturnTarget).
 *   v1.9.0 — 2026-09-29 — The emailed sign-in link points at GET /v1/ghii/magic-link/open
 *     (login-link-open.ts), which opens a browser session and redirects; a person clicking the link
 *     used to get this file's JSON answer. POST /v1/ghii/magic-link sends through
 *     services/login-link.ts, which the install-set welcome mail uses too.
 *   v1.8.0 — 2026-09-14 — The welcome bonus is creditWelcomeBonus() from owner-provisioning, not a
 *     transaction this route writes itself.
 *   v1.7.0 -- 2026-09-06 -- Review item 2.5: both BR-04 refusals move ABOVE the writes they were
 *     standing beside. The magic-link verify used to replace the owner's pinned public key and the
 *     app agent's and THEN answer 403, so a refused sign-in destroyed the person's signing key and
 *     handed the replacement to nobody. POST /v1/ghii/magic-link stops sending a link for a
 *     deactivated account at all.
 *   v1.6.0 — 2026-08-23 — Both unauthenticated agent mints answer 403 ACCOUNT_DISABLED for a
 *     deactivated owner (BR-04): an emailed code must not outlive the account it belongs to.
 *   v1.5.0 — 2026-08-18 — Registration-mode gate (open|invite|closed): register-web is a direct door, 403 REGISTRATION_CLOSED when the node is invite-only or closed.
 *   v1.4.0 — 2026-08-11 — Security audit H-2: both unauthenticated mints issue roles ['agent'] and
 *     stop copying the owner's owner/operator roles onto the token. A verification code and a magic
 *     link prove control of a mailbox; the roles they were handing out are the ones no scope list
 *     narrows, and they clear requireRole('owner') on the PAT door.
 *   v1.3.0 — 2026-08-10 — Security audit H-1: both unauthenticated mints stamp the agent's own
 *     scopes. Omitting `scopes` made issueJWT default to ['*'], so proving control of a mailbox
 *     returned a wildcard credential over the whole account.
 *   v1.2.0 — 2026-07-19 — register-web enforces the email gate (EMAIL_REQUIRED when the operator requires a
 *     verified email) and refuses an email already verified elsewhere (EMAIL_TAKEN) at registration.
 *   v1.1.0 — 2026-07-19 — emailHash is now a VERIFIED-email binding: register-web no longer stamps it at
 *     account creation (deferred to verify-email), and verify-email refuses an email already verified on
 *     another account (EMAIL_TAKEN) — upholding one-email-per-account-per-node.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/ghii.ts (max-file-lines)
 */
import type { Router, RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../../services/email.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';
import { sendLoginLink, LOGIN_LINK_TTL_MS, redeemLoginLink } from '../../services/login-link.js';
import { registerLoginLinkOpenRoute } from './login-link-open.js';
import { validateOwnerName, buildGAII } from '../../utils/gaii.js';
import { generateSessionId, issueJWT } from '../../auth/jwt.js';
import { createHash, randomBytes } from 'node:crypto';
import { GhiiWebRegistrationSchema, validateBody } from '../../models/schemas.js';
import { promoteContactsForVerifiedEmail } from '../../services/contacts.js';
import { applyAppInvitesForVerifiedEmail } from '../../services/app-member-invites.js';
import { loginTarpit } from '../../middleware/login-tarpit.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { sixDigitCode } from '../../utils/one-time-code.js';
import { registrationRefusal, creditWelcomeBonus, createdAccountIsOperator, ownerRegistrationRefusal, announceOwnerRegistered } from '../../services/owner-provisioning.js';

/**
 * The agent credential both mailbox proofs hand out (a verified e-mail code, a clicked sign-in link):
 * the agent's own scopes (audit H-1), exactly the role 'agent' (audit H-2), and a session id with its
 * session row. The row is what makes the token revocable: deleting the agent revokes its sessions by
 * GAII (routes/agents/management.ts), and a token with no `jti` named no session, so it kept working
 * until it expired (Core 2026-11 ID-10). Device authorization and POST /v1/auth/token write the same row.
 */
async function mintVerifiedAgentToken(
    storage: Storage,
    config: AimeatConfig,
    agent: { gaii: string; defaultScopes?: string[] },
    ownerName: string,
): Promise<string> {
    const sessionId = generateSessionId();
    const issuedAt = new Date();
    const roles = ['agent'];
    const token = await issueJWT({
        sub: agent.gaii,
        owner: ownerName,
        node: config.nodeId,
        roles,
        scopes: agent.defaultScopes ?? config.defaultAgentScopes,
    }, config.jwtTtlSeconds, sessionId);
    await storage.createSession({
        sessionId,
        gaii: agent.gaii,
        owner: ownerName,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + config.jwtTtlSeconds * 1000).toISOString(),
    });
    return token;
}

/**
 * The account's "app" agent, found or created, with a fresh key pair. Both mailbox proofs call this.
 *
 * The agent holds the node's default agent scopes (config.defaultAgentScopes) from the moment it is
 * created. Without a recorded list the route layer narrows its token to nothing (auth/effective-scopes.ts
 * reads a missing list as []), so every scope-gated route refused it: SCOPE_DENIED, "Agent scopes: []"
 * (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 10). An app agent that an
 * earlier verification created without a list gets the same default list here; a list the owner has
 * set is kept as it is.
 */
async function appAgentWithFreshKey(
    storage: Storage,
    config: AimeatConfig,
    ownerName: string,
    now: string,
): Promise<{ agent: { gaii: string; defaultScopes?: string[] }; privateKey: string }> {
    const keys = await generateKeyPair();
    const existing = (await storage.getAgentsByOwner(ownerName)).find(a => a.name === 'app');
    if (existing) {
        const defaultScopes = Array.isArray(existing.defaultScopes) ? existing.defaultScopes : [...config.defaultAgentScopes];
        await storage.updateAgent(existing.gaii, { publicKey: keys.publicKey, defaultScopes });
        return { agent: { ...existing, defaultScopes }, privateKey: keys.privateKey };
    }
    const agent = await storage.createAgent({
        name: 'app',
        owner: ownerName,
        gaii: buildGAII('app', ownerName, config.nodeId),
        displayName: `${ownerName}'s App Agent`,
        description: 'Default agent for AIMEAT apps',
        capabilities: [],
        publicKey: keys.publicKey,
        trustScore: 50,
        morselBalance: 0,
        defaultScopes: [...config.defaultAgentScopes],
        createdAt: now,
        lastSeen: now,
    });
    return { agent, privateKey: keys.privateKey };
}

export function registerWebVerifyRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    emailService: EmailService | undefined,
    onDirectoryChange: (() => void) | undefined,
    registrationLimit: RequestHandler,
): void {
    // ── Phase 1.3 — Web Registration, Email Verification, Magic Link ──

    // POST /v1/ghii/register-web — Web registration (no auth required)
    // Creates owner + GHII profile with optional email verification
    router.post('/v1/ghii/register-web', registrationLimit, validateBody(GhiiWebRegistrationSchema, config.nodeId), async (req, res) => {
        let { username, display_name } = req.body ?? {};
        const { email, locale, interests } = req.body ?? {};

        // Registration mode: this is a direct door, refused in 'invite' and 'closed'.
        const modeRefusal = registrationRefusal(config, 'direct');
        if (modeRefusal) {
            res.status(403).json(error(config.nodeId, 'REGISTRATION_CLOSED', modeRefusal));
            return;
        }

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }

        // Accept full GHII -- strip @node-id
        username = username.trim().toLowerCase();
        if (username.includes('@')) {
            const atIdx = username.indexOf('@');
            const nodePart = username.substring(atIdx + 1);
            username = username.substring(0, atIdx);
            if (nodePart !== config.nodeId) {
                res.status(400).json(error(config.nodeId, 'FEDERATION_REGISTER_UNSUPPORTED',
                    `Cannot register here with a remote identity. "${username}" belongs to node ${nodePart}. Try signing in instead.`));
                return;
            }
        }

        const nameError = validateOwnerName(username);
        if (nameError) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
            return;
        }

        if (!display_name || typeof display_name !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'display_name is required'));
            return;
        }

        // Strip @node-id from display_name if it matches a GHII pattern
        if (display_name.includes('@')) {
            display_name = display_name.split('@')[0];
        }

        // Email gate: when the operator requires a verified email, an account cannot be created without one.
        if (config.emailConfirmationRequired && !(typeof email === 'string' && email.length > 0)) {
            res.status(400).json(error(config.nodeId, 'EMAIL_REQUIRED',
                'This node requires a verified email to register. Provide an "email" or sign in with Google/Microsoft/Casdoor.'));
            return;
        }

        // Check if owner name is already taken
        const existingOwner = await storage.getOwner(username);
        if (existingOwner) {
            res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`));
            return;
        }

        // Hash email if provided. This drives the verification record below; it is NOT stamped onto the
        // GHII yet. emailHash is a VERIFIED-email binding (one per account per node, DB-unique) — it is
        // claimed only once the code is confirmed in /v1/ghii/verify-email, never at account creation.
        const emailHash = (typeof email === 'string' && email.length > 0)
            ? createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
            : undefined;
        // One verified email per account per node: refuse up front if it is already verified elsewhere.
        if (emailHash) {
            const emailOwner = await storage.getGHIIByEmailHash(emailHash);
            if (emailOwner) {
                res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN', 'That email is already associated with another account.'));
                return;
            }
        }

        // Generate keypair for the owner account
        // The operator's registration gate, before any row exists (feature-list audit 89).
        const hookRefusal = await ownerRegistrationRefusal(storage, config, { name: username, displayName: display_name, via: 'direct' });
        if (hookRefusal) {
            res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookRefusal));
            return;
        }

        const keyPair = await generateKeyPair();

        // Who becomes operator is the one rule every account-creating route asks (feature-list
        // audit 19): this route asked "first owner only" while POST /v1/ghii also self-healed.
        const roles: string[] = ['owner'];
        if (await createdAccountIsOperator(storage)) roles.push('operator');

        // Create owner with role=['owner'] (+ 'operator' if first)
        const owner = await storage.createOwner({
            name: username,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Create GHII profile with verificationLevel: 0 and welcome bonus
        const now = new Date().toISOString();
        const ghii = `${username}@${config.nodeId}`;
        const ghiiRecord = await storage.createGHII({
            username,
            nodeId: config.nodeId,
            ghii,
            displayName: display_name,
            locale: typeof locale === 'string' ? locale : undefined,
            verificationLevel: 0,
            ownerName: owner.name,
            totpEnabled: false,
            // emailHash + magicLinkEnabled are set by /v1/ghii/verify-email once the email is proven.
            notificationEmail: (typeof email === 'string' && email.length > 0) ? email.toLowerCase().trim() : undefined,
            morselBalance: config.welcomeBonus,
            loginCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        // The welcome bonus, decided in one place for every door that creates an account.
        await creditWelcomeBonus(storage, config, ghii, now);
        announceOwnerRegistered(storage, config, owner, 'direct');

        // Store interest profile in memory if interests provided
        if (Array.isArray(interests) && interests.length > 0) {
            await storage.setMemory({
                key: `profile.${username}.interests`,
                ownerGaii: ghii,
                value: interests,
                visibility: 'public',
                tags: ['profile', 'interests'],
                ttlHours: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
            });
        }

        // Send verification email if email is provided and email service is enabled
        let verificationId: string | undefined;
        if (typeof email === 'string' && email.length > 0 && emailService?.enabled) {
            const code = sixDigitCode();
            const codeHash = createHash('sha256').update(code).digest('hex');
            const verId = randomBytes(16).toString('hex');
            await storage.createEmailVerification({
                id: verId,
                ownerName: username,
                emailHash: emailHash!,
                code: codeHash,
                purpose: 'registration',
                status: 'pending',
                attempts: 0,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
                createdAt: now,
                verifiedAt: null,
            });
            await emailService.sendVerificationCode(email, code, typeof locale === 'string' ? locale : undefined);
            verificationId = verId;
        }

        // Which onboarding path this account was created on (05-mittaus.md). This door is the SPA's
        // web registration and was missing the marker, so every account made here read as `legacy`
        // — the same gap that /v1/ghii and provisionOwner already closed.
        void import('../../services/onboarding-funnel.js')
            .then(m => m.recordTrack(storage, config, username))
            .catch(err => logger.warn('ghii register-web: track marker failed', { error: String(err) }));

        // The first row in this person's record, as POST /v1/ghii writes it: this route wrote none, so
        // an account made here started with an empty feed (feature-list audit 19).
        void import('../../services/account-events.js')
            .then(m => m.recordAccountEvent(storage, {
                ownerGhii: ghii, kind: 'account_created', actorGaii: ghii, link: '/v1/home',
            }, config))
            .catch(err => logger.warn('ghii register-web: first feed row failed', { error: String(err) }));

        // The operator's welcome into the new mailbox. Fire-and-forget: a greeting must never be
        // able to turn a signup into a 500.
        void import('../../services/welcome-message.js')
            .then(m => m.sendOperatorWelcome(storage, config, username))
            .catch(err => logger.warn('ghii register-web: welcome message failed', { error: String(err) }));

        // Notify directory of new profile (Phase 1.4 — event-driven refresh)
        if (onDirectoryChange) onDirectoryChange();

        // SECURITY: Prevent caching of response containing private key
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.status(201).json(success(config.nodeId, {
            ghii: {
                ghii: ghiiRecord.ghii,
                username: ghiiRecord.username,
                display_name: ghiiRecord.displayName,
                locale: ghiiRecord.locale,
                verification_level: ghiiRecord.verificationLevel,
                magic_link_enabled: ghiiRecord.magicLinkEnabled,
                created_at: ghiiRecord.createdAt,
            },
            owner: {
                name: owner.name,
                roles: owner.roles,
            },
            private_key: keyPair.privateKey,
            public_key: keyPair.publicKey,
            verification_id: verificationId ?? null,
            note: 'Store the private key securely. It cannot be retrieved again.',
        }, [
            ...(verificationId
                ? [{ description: 'Verify your email', method: 'POST' as const, url: '/v1/ghii/verify-email' }]
                : []),
            { description: 'Create an agent', method: 'POST' as const, url: '/v1/agents' },
            { description: 'View your profile', method: 'GET' as const, url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
        emitChange('ghii');
    });

    // POST /v1/ghii/verify-email — Verify email code (no auth)
    // A short emailed CODE is the most guessable credential on the node, and this door stood
    // behind nothing at all: no limiter, no delay. Both now, tarpit first so a guesser pays
    // before the node looks anything up.
    router.post('/v1/ghii/verify-email', loginTarpit(config), rateLimit(() => ({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs })), async (req, res) => {
        const { verification_id, code } = req.body ?? {};

        if (!verification_id || typeof verification_id !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'verification_id is required'));
            return;
        }
        if (!code || typeof code !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'code is required'));
            return;
        }

        const record = await storage.getEmailVerification(verification_id);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Verification record not found'));
            return;
        }

        if (record.status !== 'pending') {
            res.status(400).json(error(config.nodeId, 'ALREADY_VERIFIED', 'This verification has already been completed'));
            return;
        }

        if (new Date(record.expiresAt).getTime() < Date.now()) {
            await storage.updateEmailVerification(verification_id, { status: 'expired' });
            res.status(400).json(error(config.nodeId, 'EXPIRED', 'Verification code has expired'));
            return;
        }

        if (record.attempts >= 5) {
            res.status(429).json(error(config.nodeId, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts'));
            return;
        }

        // Hash the provided code and compare
        const codeHash = createHash('sha256').update(code).digest('hex');
        if (codeHash !== record.code) {
            await storage.updateEmailVerification(verification_id, { attempts: record.attempts + 1 });
            res.status(400).json(error(config.nodeId, 'INVALID_CODE', 'Invalid verification code'));
            return;
        }

        // REFUSE BEFORE YOU WRITE (invariant 14). The BR-04 refusal used to sit six writes further
        // down, next to the mint it guards, so a deactivated account's correct code still burned the
        // verification record, stamped emailVerifiedAt on the GHII, and ROTATED the app agent's
        // signing key before answering 403. The check costs one read and it belongs here, above the
        // first thing that changes.
        const mintOwner = await storage.getOwner(record.ownerName);
        if (mintOwner?.disabledAt) {
            res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'The account this agent acts for has been deactivated'));
            return;
        }

        // Mark as verified
        const now = new Date().toISOString();
        await storage.updateEmailVerification(verification_id, {
            status: 'verified',
            verifiedAt: now,
        });

        // Update GHII with verified email info + track login
        const ghii = `${record.ownerName}@${config.nodeId}`;
        // One-email-per-account-per-node: refuse to claim an email hash already verified elsewhere. The
        // DB partial-unique index is the hard backstop; this returns a clean 409 instead of a 500.
        const emailOwner = await storage.getGHIIByEmailHash(record.emailHash);
        if (emailOwner && emailOwner.ghii !== ghii) {
            res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN', 'That email is already verified on another account.'));
            return;
        }
        const ghiiBeforeUpdate = await storage.getGHII(ghii);
        await storage.updateGHII(ghii, {
            emailHash: record.emailHash,
            emailVerifiedAt: now,
            verificationLevel: 1,
            verificationMethod: 'email',
            magicLinkEnabled: true,
            lastLoginAt: now,
            loginCount: (ghiiBeforeUpdate?.loginCount ?? 0) + 1,
        });
        // Anyone who wrote this person into their address book before the account existed now has
        // the person, not just the address (TARGET-063). Best-effort: a contact that fails to link
        // is cosmetic, and a verification that fails to finish is an account nobody can get into.
        await promoteContactsForVerifiedEmail(storage, record.emailHash, ghii)
            .catch(err => { logger.warn('verify-email: contact promotion is best-effort', { error: String(err) }); });
        // An invitation to an app's roster sent to this address becomes a membership now
        // (services/app-member-invites.ts). Best-effort for the same reason.
        await applyAppInvitesForVerifiedEmail(storage, config.nodeId, record.emailHash, ghii)
            .catch(err => { logger.warn('verify-email: app invitations are best-effort', { error: String(err) }); });

        // Create an agent if not exists, then issue JWT
        const { agent, privateKey: agentPrivKey } = await appAgentWithFreshKey(storage, config, record.ownerName, now);

        // Issue JWT
        //
        // SECURITY (audit H-1): this token is minted on an UNAUTHENTICATED route — whoever holds the
        // verification id and the emailed code gets it. Leaving `scopes` off made issueJWT default it
        // to ['*'], so the answer to "prove you own this mailbox" was a wildcard credential over the
        // whole account. Stamp the agent's own scopes instead, the same set every other door gives it.
        //
        // SECURITY (audit H-2): and the roles are exactly ['agent']. Reading the owner record here to
        // add its 'owner' and 'operator' roles handed an emailed code the owner's ROLE, which no scope
        // limit constrains: role gates (requireRole) do not read scopes at all, and a token carrying
        // 'owner' + 'operator' mints an unscoped operator PAT at POST /v1/access/tokens. Nothing reads
        // this token as an owner session either: the SDK auth modal discards it and runs a password
        // login (src/static/sdk-libs/auth/modal.js), and no SPA view fetches this route.
        // BR-04 was asked above, before the first write. An emailed code must not resurrect a
        // credential in the name of an account the organisation has switched off.
        const token = await mintVerifiedAgentToken(storage, config, agent, record.ownerName);

        // SECURITY: Prevent caching of response containing private key
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.json(success(config.nodeId, {
            verified: true,
            ghii,
            verification_level: 1,
            token,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            agent: { gaii: agent.gaii },
            agent_private_key: agentPrivKey,
        }, [
            { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
            { description: 'View your profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
        emitChange('ghii');
    });

    // POST /v1/ghii/magic-link — Request magic link login (no auth)
    // Sending a sign-in link is sending mail on request. Unlimited, it is a way to use this node
    // to post at somebody else's address.
    router.post('/v1/ghii/magic-link', rateLimit({ max: 5, windowMs: 10 * 60 * 1000, keyBy: 'ip' }), async (req, res) => {
        const { email, redirect } = req.body ?? {};

        if (!email || typeof email !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'email is required'));
            return;
        }

        // Hash email to find user
        const emailHash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
        const ghiiRecord = await storage.getGHIIByEmailHash(emailHash);

        // A DEACTIVATED ACCOUNT IS NOT SENT A SIGN-IN LINK (sendLoginLink checks it): sending it
        // anyway means the person keeps getting login mail for an account the organisation has
        // switched off. The answer below is the same either way, so nothing is disclosed. The link
        // points at the browser endpoint GET /v1/ghii/magic-link/open (login-link-open.ts), with
        // `redirect` when it is a place the link may return to (sendLoginLink drops any other).
        // Always return 200 to not reveal if user exists
        if (ghiiRecord) await sendLoginLink(storage, config, ghiiRecord, email, LOGIN_LINK_TTL_MS, emailService, redirect);

        res.json(success(config.nodeId, {
            sent: true,
            note: 'If an account with that email exists, a magic link has been sent.',
        }));
        emitChange('ghii');
    });

    // GET /v1/ghii/magic-link/open — the emailed link: a browser session, then the front page.
    registerLoginLinkOpenRoute(router, config, storage);

    // GET /v1/ghii/magic-link/verify — Verify magic link for a program (query param: token): JSON
    // with an agent token and private keys. The emailed link no longer points here.
    router.get('/v1/ghii/magic-link/verify', async (req, res) => {
        const token = typeof req.query.token === 'string' ? req.query.token : undefined;

        if (!token) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'token query parameter is required'));
            return;
        }

        // The one check and spend of a sign-in link (services/login-link.ts redeemLoginLink), the one
        // the emailed link's endpoint runs: the account is live, its link is still on, the address the
        // link was mailed to is still the account's, and the link is spent once under concurrent
        // clicks. This endpoint had its own copy, which checked the first and spent unconditionally
        // (secaudit 2026-10, AUTH-3). Every refusal comes before anything is written: the BR-04
        // refusal once sat below the re-key, so a link for a DEACTIVATED account replaced the
        // owner's pinned public key on a request that was then refused (invariant 14).
        const redeemed = await redeemLoginLink(storage, config, token);
        if (!redeemed.ok) {
            if (redeemed.code === 'ACCOUNT_DISABLED') {
                res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'The account this agent acts for has been deactivated'));
            } else {
                res.status(401).json(error(config.nodeId, redeemed.code, redeemed.code === 'EXPIRED' ? 'Magic link has expired' : 'Invalid or expired magic link'));
            }
            return;
        }
        const record = { ownerName: redeemed.ghii.ownerName };

        // Update GHII last login (the redeem verified the address: clicking the link proves the mailbox).
        const now = new Date().toISOString();
        const ghii = redeemed.ghii.ghii;
        await storage.updateGHII(ghii, {
            lastLoginAt: now,
            loginCount: (redeemed.ghii.loginCount ?? 0) + 1,
        });

        // The owner's signing key is NOT re-keyed here and not returned. A clicked link proves a
        // mailbox; the owner key signs in as the account's owner (and its operator) at
        // POST /v1/auth/token, which is exactly what H-2 below refuses to hand over, and it skipped
        // the account's two-step sign-in (secrets audit 2026-10-09, S2). The program gets the agent
        // credential below; a person signs in through GET /v1/ghii/magic-link/open.

        // Find or create a default agent
        const { agent, privateKey: agentPrivKey } = await appAgentWithFreshKey(storage, config, record.ownerName, now);

        // Issue JWT
        //
        // SECURITY (audit H-1): same as the verify-email mint above — an unauthenticated route must
        // not hand out a wildcard credential by omission. The agent's own scopes are the grant.
        // SECURITY (audit H-2): and the same again for the roles. A clicked link proves control of a
        // mailbox; it does not make the holder the account's owner or the node's operator, and those
        // are ROLES, which no scope list narrows.
        // BR-04 was asked above, before the re-key. Same refusal as the verify-email mint.
        const jwtToken = await mintVerifiedAgentToken(storage, config, agent, record.ownerName);

        // SECURITY: Prevent caching of response containing private keys
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.json(success(config.nodeId, {
            ghii,
            token: jwtToken,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            agent: { gaii: agent.gaii },
            agent_private_key: agentPrivKey,
        }, [
            { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
            { description: 'View your profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
    });
}
