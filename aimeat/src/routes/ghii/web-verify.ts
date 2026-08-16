/**
 * @file src/routes/ghii/web-verify.ts
 * @description GHII web-registration + email/magic-link login routes: POST /v1/ghii/register-web,
 *   POST /v1/ghii/verify-email, POST /v1/ghii/magic-link, GET /v1/ghii/magic-link/verify. Extracted
 *   from src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
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
import { validateOwnerName, buildGAII } from '../../utils/gaii.js';
import { issueJWT } from '../../auth/jwt.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GhiiWebRegistrationSchema, validateBody } from '../../models/schemas.js';
import { promoteContactsForVerifiedEmail } from '../../services/contacts.js';
import { loginTarpit } from '../../middleware/login-tarpit.js';
import { rateLimit } from '../../middleware/rate-limit.js';

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
        const keyPair = await generateKeyPair();

        // First real owner gets operator role (same logic as /v1/owners)
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        const roles: string[] = ['owner'];
        if (realOwners.length === 0) {
            roles.push('operator');
        }

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

        // Record welcome bonus transaction
        if (config.welcomeBonus > 0) {
            await storage.addTransaction({
                id: `tx-${randomUUID()}`,
                gaii: ghii,
                type: 'welcome_bonus',
                amount: config.welcomeBonus,
                timestamp: now,
            });
        }

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
            const code = String(Math.floor(100000 + Math.random() * 900000));
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
    router.post('/v1/ghii/verify-email', loginTarpit(config), rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }), async (req, res) => {
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

        // Create an agent if not exists, then issue JWT
        const agents = await storage.getAgentsByOwner(record.ownerName);
        let agent = agents.find(a => a.name === 'app');
        let agentPrivKey: string;

        if (!agent) {
            const agentKeyPair = await generateKeyPair();
            const gaii = buildGAII('app', record.ownerName, config.nodeId);
            agent = await storage.createAgent({
                name: 'app',
                owner: record.ownerName,
                gaii,
                displayName: `${record.ownerName}'s App Agent`,
                description: 'Default agent for AIMEAT apps',
                capabilities: [],
                publicKey: agentKeyPair.publicKey,
                trustScore: 50,
                morselBalance: 0,
                createdAt: now,
                lastSeen: now,
            });
            agentPrivKey = agentKeyPair.privateKey;
        } else {
            const agentKeyPair = await generateKeyPair();
            await storage.updateAgent(agent.gaii, { publicKey: agentKeyPair.publicKey });
            agentPrivKey = agentKeyPair.privateKey;
        }

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
        const roles = ['agent'];
        const token = await issueJWT({
            sub: agent.gaii,
            owner: record.ownerName,
            node: config.nodeId,
            roles,
            scopes: agent.defaultScopes ?? config.defaultAgentScopes,
        }, config.jwtTtlSeconds);

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
        const { email } = req.body ?? {};

        if (!email || typeof email !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'email is required'));
            return;
        }

        // Hash email to find user
        const emailHash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
        const ghiiRecord = await storage.getGHIIByEmailHash(emailHash);

        // Always return 200 to not reveal if user exists
        if (ghiiRecord && ghiiRecord.magicLinkEnabled && emailService?.enabled) {
            const token = randomBytes(32).toString('hex');
            const codeHash = createHash('sha256').update(token).digest('hex');
            const now = new Date().toISOString();
            await storage.createEmailVerification({
                id: token,
                ownerName: ghiiRecord.ownerName,
                emailHash,
                code: codeHash,
                purpose: 'login',
                status: 'pending',
                attempts: 0,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
                createdAt: now,
                verifiedAt: null,
            });

            const loginUrl = `${config.baseUrl}/v1/ghii/magic-link/verify?token=${token}`;
            await emailService.sendMagicLink(email, loginUrl, ghiiRecord.locale);
        }

        res.json(success(config.nodeId, {
            sent: true,
            note: 'If an account with that email exists, a magic link has been sent.',
        }));
        emitChange('ghii');
    });

    // GET /v1/ghii/magic-link/verify — Verify magic link (query param: token)
    router.get('/v1/ghii/magic-link/verify', async (req, res) => {
        const token = typeof req.query.token === 'string' ? req.query.token : undefined;

        if (!token) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'token query parameter is required'));
            return;
        }

        const record = await storage.getEmailVerification(token);
        if (!record || record.status !== 'pending' || record.purpose !== 'login') {
            res.status(401).json(error(config.nodeId, 'INVALID_TOKEN', 'Invalid or expired magic link'));
            return;
        }

        if (new Date(record.expiresAt).getTime() < Date.now()) {
            await storage.updateEmailVerification(token, { status: 'expired' });
            res.status(401).json(error(config.nodeId, 'EXPIRED', 'Magic link has expired'));
            return;
        }

        // Mark verification as used
        const now = new Date().toISOString();
        await storage.updateEmailVerification(token, {
            status: 'verified',
            verifiedAt: now,
        });

        // Update GHII last login + auto-verify email (clicking magic link IS email verification)
        const ghii = `${record.ownerName}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        if (ghiiRecord) {
            await storage.updateGHII(ghii, {
                lastLoginAt: now,
                loginCount: (ghiiRecord.loginCount ?? 0) + 1,
                verificationLevel: Math.max(ghiiRecord.verificationLevel ?? 0, 1) as 0 | 1 | 2 | 3,
            });
        }

        // Re-key owner
        const ownerKeyPair = await generateKeyPair();
        await storage.updateOwner(record.ownerName, { publicKey: ownerKeyPair.publicKey });

        // Find or create a default agent
        const agents = await storage.getAgentsByOwner(record.ownerName);
        let agent = agents.find(a => a.name === 'app');
        let agentPrivKey: string;

        if (agent) {
            const agentKeyPair = await generateKeyPair();
            await storage.updateAgent(agent.gaii, { publicKey: agentKeyPair.publicKey });
            agentPrivKey = agentKeyPair.privateKey;
        } else {
            const agentKeyPair = await generateKeyPair();
            const gaii = buildGAII('app', record.ownerName, config.nodeId);
            agent = await storage.createAgent({
                name: 'app',
                owner: record.ownerName,
                gaii,
                displayName: `${record.ownerName}'s App Agent`,
                description: 'Default agent for AIMEAT apps',
                capabilities: [],
                publicKey: agentKeyPair.publicKey,
                trustScore: 50,
                morselBalance: 0,
                createdAt: now,
                lastSeen: now,
            });
            agentPrivKey = agentKeyPair.privateKey;
        }

        // Issue JWT
        //
        // SECURITY (audit H-1): same as the verify-email mint above — an unauthenticated route must
        // not hand out a wildcard credential by omission. The agent's own scopes are the grant.
        // SECURITY (audit H-2): and the same again for the roles. A clicked link proves control of a
        // mailbox; it does not make the holder the account's owner or the node's operator, and those
        // are ROLES, which no scope list narrows.
        const roles = ['agent'];
        const jwtToken = await issueJWT({
            sub: agent.gaii,
            owner: record.ownerName,
            node: config.nodeId,
            roles,
            scopes: agent.defaultScopes ?? config.defaultAgentScopes,
        }, config.jwtTtlSeconds);

        // SECURITY: Prevent caching of response containing private keys
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.json(success(config.nodeId, {
            ghii,
            token: jwtToken,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            owner_private_key: ownerKeyPair.privateKey,
            agent: { gaii: agent.gaii },
            agent_private_key: agentPrivKey,
        }, [
            { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
            { description: 'View your profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
    });
}
