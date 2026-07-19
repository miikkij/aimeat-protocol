/**
 * @file src/routes/ghii/register-login.ts
 * @description GHII human-identity registration + password login routes: POST /v1/ghii (register),
 *   POST /v1/ghii/login (password + federated + TOTP), POST /v1/ghii/login/attach-email. Extracted
 *   from src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-19 — POST /v1/ghii accepts an optional email and, when the node runs with the email
 *     gate on (AIMEAT_EMAIL_CONFIRMATION_REQUIRED), REQUIRES one (EMAIL_REQUIRED) — a supplied email is
 *     recorded + a verification code sent, and a duplicate is refused (EMAIL_TAKEN). OAuth accounts are
 *     verified at sign-in, so they satisfy the gate without this path.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/ghii.ts (max-file-lines)
 */
import type { Router, RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../../services/email.js';
import type { PeerInfo } from '../../services/federation.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { validateOwnerName } from '../../utils/gaii.js';
import { issueJWT } from '../../auth/jwt.js';
import { establishOwnerSession } from '../../services/owner-session.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { validateTotpCode, validateBackupCode } from '../../services/totp.js';
import type { TotpConfig } from '../../services/totp.js';
import { hashPassword, verifyPassword, isLegacyHash } from '../../services/password.js';
import { issueFirstLoginKeyCredentials } from '../../services/key-credentials.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';
import { validatePasswordStrength } from '../../utils/password-validation.js';
import { GhiiRegistrationSchema, GhiiLoginSchema, validateBody } from '../../models/schemas.js';

/** Create a pending 'registration' email-verification (15-min code) + dispatch it when email is enabled.
 *  Shared by POST /v1/ghii and attach-email; /v1/ghii/verify-email finalises it (emailHash + level 1). */
async function startRegistrationEmailVerification(
    storage: Storage, emailService: EmailService | undefined,
    ownerName: string, email: string, locale?: string,
): Promise<{ verificationId: string; emailSent: boolean }> {
    const clean = email.toLowerCase().trim();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const verificationId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    await storage.createEmailVerification({
        id: verificationId, ownerName,
        emailHash: createHash('sha256').update(clean).digest('hex'),
        code: createHash('sha256').update(code).digest('hex'),
        purpose: 'registration', status: 'pending', attempts: 0,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), createdAt: now, verifiedAt: null,
    });
    let emailSent = false;
    if (emailService?.enabled) { await emailService.sendVerificationCode(clean, code, locale); emailSent = true; }
    return { verificationId, emailSent };
}

export function registerRegisterLoginRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    emailService: EmailService | undefined,
    peers: Map<string, PeerInfo> | undefined,
    registrationLimit: RequestHandler,
): void {
    // POST /v1/ghii — Register a new human identity (no auth required)
    // Creates an owner account + GHII profile in one step
    router.post('/v1/ghii', registrationLimit, validateBody(GhiiRegistrationSchema, config.nodeId), async (req, res) => {
        let { username, display_name } = req.body ?? {};
        const { bio, avatar, locale, password, email } = req.body ?? {};
        const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }

        // Accept full GHII (e.g. "alice@node-id") -- strip @node-id for local registration
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

        // Strip @node-id from display_name if it matches a GHII pattern (old frontend fallback)
        if (display_name.includes('@')) {
            display_name = display_name.split('@')[0];
        }

        // SECURITY: Validate password strength if provided
        if (password !== undefined && password !== null) {
            if (typeof password !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Password must be a string'));
                return;
            }
            const pwErr = validatePasswordStrength(password);
            if (pwErr) {
                res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwErr));
                return;
            }
        }

        // Hash password if provided (validation already done above)
        const passwordHash = (typeof password === 'string' && password.length >= 8)
            ? await hashPassword(password)
            : undefined;

        // Check if owner name is already taken
        const existingOwner = await storage.getOwner(username);
        const ghii = `${username}@${config.nodeId}`;

        // Preserve old roles before re-registration (so operator isn't lost)
        let preservedRoles: string[] | null = null;
        if (existingOwner) {
            if (config.testMode) {
                // Test mode: wipe old account entirely and re-create (E2E test isolation)
                preservedRoles = existingOwner.roles;
                const oldAgents = await storage.getAgentsByOwner(username);
                for (const agent of oldAgents) {
                    await storage.deleteAgent(agent.gaii);
                }
                const oldGhii = await storage.getGHII(ghii);
                if (oldGhii) await storage.deleteGHII(ghii);
                await storage.deleteOwner(username);
            } else if (config.devMode) {
                // Dev mode: reset credentials only, preserve all data (agents, memory, etc.)
                preservedRoles = existingOwner.roles;
            } else {
                res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`));
                return;
            }
        }

        // Generate keypair for the owner account
        const keyPair = await generateKeyPair();

        // Dev-mode credential reset: update password + key, preserve everything else
        if (existingOwner && config.devMode && !config.testMode) {
            await storage.updateOwner(username, { publicKey: keyPair.publicKey });
            const existingGhii = await storage.getGHII(ghii);
            if (existingGhii) {
                await storage.updateGHII(ghii, {
                    passwordHash,
                    ...(display_name ? { displayName: display_name } : {}),
                    updatedAt: new Date().toISOString(),
                });
            }

            const token = await issueJWT({
                sub: username,
                owner: username,
                node: config.nodeId,
                roles: preservedRoles ?? ['owner'],
            }, config.jwtTtlSeconds);

            res.set('Cache-Control', 'no-store');
            res.set('Pragma', 'no-cache');
            res.status(200).json(success(config.nodeId, {
                ghii: {
                    ghii,
                    username,
                    display_name: display_name || existingGhii?.displayName,
                },
                owner: { name: username },
                token,
                expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
                owner_private_key: keyPair.privateKey,
                owner_public_key: keyPair.publicKey,
                dev_mode_reset: true,
            }));
            return;
        }

        // Email gate: with AIMEAT_EMAIL_CONFIRMATION_REQUIRED an account cannot be created without an email
        // (OAuth users satisfy this — their IdP email is verified at sign-in); a supplied email must be free.
        if (config.emailConfirmationRequired && !cleanEmail) {
            res.status(400).json(error(config.nodeId, 'EMAIL_REQUIRED',
                'This node requires a verified email to register. Provide an "email" (a code will be sent to confirm it) or sign in with Google/Microsoft/Casdoor.'));
            return;
        }
        if (cleanEmail && await storage.getGHIIByEmailHash(createHash('sha256').update(cleanEmail).digest('hex'))) {
            res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN', 'That email is already associated with another account.'));
            return;
        }

        // First real owner gets operator role (same logic as /v1/owners)
        // Self-heal: if no operator exists anywhere, promote this user
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        const hasOperator = allOwners.some(o => o.roles.includes('operator'));
        const roles: string[] = ['owner'];
        if (realOwners.length === 0 || !hasOperator) {
            roles.push('operator');
        }

        const owner = await storage.createOwner({
            name: username,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Create GHII profile with welcome bonus
        const now = new Date().toISOString();
        const ghiiRecord = await storage.createGHII({
            username,
            nodeId: config.nodeId,
            ghii,
            displayName: display_name,
            bio: typeof bio === 'string' ? bio : undefined,
            avatar: typeof avatar === 'string' ? avatar : undefined,
            locale: typeof locale === 'string' ? locale : undefined,
            passwordHash,
            verificationLevel: 0,
            ownerName: owner.name,
            totpEnabled: false,
            notificationEmail: cleanEmail || undefined,  // unverified — does NOT reserve the emailHash
            magicLinkEnabled: cleanEmail ? true : undefined,
            morselBalance: config.welcomeBonus,
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

        // Kick off email verification when an email was supplied (see helper).
        let verificationId: string | null = null;
        let emailSent = false;
        if (cleanEmail) {
            ({ verificationId, emailSent } = await startRegistrationEmailVerification(
                storage, emailService, username, cleanEmail, typeof locale === 'string' ? locale : undefined));
        }

        // SECURITY: Prevent caching of response containing private key
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.status(201).json(success(config.nodeId, {
            ghii: {
                ghii: ghiiRecord.ghii,
                username: ghiiRecord.username,
                display_name: ghiiRecord.displayName,
                bio: ghiiRecord.bio,
                avatar: ghiiRecord.avatar,
                locale: ghiiRecord.locale,
                verification_level: ghiiRecord.verificationLevel,
                created_at: ghiiRecord.createdAt,
            },
            owner: {
                name: owner.name,
                roles: owner.roles,
            },
            verification_id: verificationId,
            email_sent: emailSent,
            private_key: keyPair.privateKey,
            public_key: keyPair.publicKey,
            has_password: !!passwordHash,
            note: 'SECURITY: Store the private key securely. It cannot be retrieved again. Consider client-side key generation for enhanced security.',
        }, [
            { description: 'Create an agent for your identity', method: 'POST', url: '/v1/agents' },
            { description: 'Update your GHII profile', method: 'PUT', url: '/v1/ghii' },
            { description: 'View your public profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
        emitChange('ghii');
    });

    // TOTP config for login 2FA verification (Phase 0.5)
    const totpConfig: TotpConfig = {
        issuer: config.totpIssuer,
        algorithm: 'SHA1' as const,
        digits: 6 as const,
        period: config.totpPeriod,
        window: config.totpWindow,
        backupCodeCount: config.totpBackupCodeCount,
        encryptionKey: config.totpSecretEncryptionKey
            ? Buffer.from(config.totpSecretEncryptionKey, 'hex')
            : undefined,
    };

    // POST /v1/ghii/login — Login with username + password from any device
    // Mints a fresh owner keypair only when the client has none locally
    // (request_owner_key) or the owner has no key yet; otherwise reuses the
    // existing key so other devices keep their refresh capability.
    router.post('/v1/ghii/login', rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }), validateBody(GhiiLoginSchema, config.nodeId), async (req, res) => {
        const { username, password, totp_code, backup_code } = req.body ?? {};
        // Only mint a fresh owner signing key when the client has none locally.
        const wantsOwnerKey = req.body?.request_owner_key === true;

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }
        if (!password || typeof password !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required'));
            return;
        }

        // Accept full GHII (e.g. "alice@node-id") -- strip the @node-id for local lookup
        let loginName = username.trim().toLowerCase();
        let federatedNodeId: string | undefined;
        if (loginName.includes('@')) {
            const atIdx = loginName.indexOf('@');
            const nodePart = loginName.substring(atIdx + 1);
            loginName = loginName.substring(0, atIdx);
            if (nodePart !== config.nodeId) {
                federatedNodeId = nodePart;
            }
        }

        // --- Federated login: route auth request to the home node ---
        if (federatedNodeId) {
            if (!peers || peers.size === 0) {
                res.status(400).json(error(config.nodeId, 'FEDERATION_UNREACHABLE',
                    `Cannot reach home node ${federatedNodeId}. No federation peers configured.`));
                return;
            }

            // Find a direct peer route to the home node
            const homePeer = [...peers.values()].find(
                p => p.nodeId === federatedNodeId && p.status === 'active',
            );
            if (!homePeer) {
                res.status(400).json(error(config.nodeId, 'FEDERATION_UNREACHABLE',
                    `Cannot reach home node ${federatedNodeId}. No active peer route found.`));
                return;
            }

            // Check node-level federation auth policy
            if (config.federationAuthPolicy === 'disabled') {
                res.status(403).json(error(config.nodeId, 'FEDERATION_AUTH_DISABLED',
                    'This node does not accept federated logins'));
                return;
            }
            if (config.federationAuthPolicy === 'specific_peers' && !homePeer.allowFederatedAuth) {
                res.status(403).json(error(config.nodeId, 'FEDERATION_AUTH_NOT_ALLOWED',
                    'Federated login from this node is not permitted'));
                return;
            }

            // Send verification request to the home node
            try {
                const verifyResp = await fetch(`${homePeer.url}/v1/federation/auth/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: loginName,
                        password,
                        requesting_node: config.nodeId,
                        timestamp: new Date().toISOString(),
                    }),
                    signal: AbortSignal.timeout(10_000),
                });

                if (!verifyResp.ok) {
                    const body = await verifyResp.json().catch(() => ({})) as Record<string, unknown>;
                    const errCode = (body as { error?: { code?: string } }).error?.code ?? 'FEDERATION_AUTH_FAILED';
                    const errMsg = (body as { error?: { message?: string } }).error?.message ?? 'Remote authentication failed';
                    res.status(verifyResp.status === 403 ? 403 : 401).json(
                        error(config.nodeId, errCode as string, errMsg as string));
                    return;
                }

                const result = await verifyResp.json() as {
                    data?: {
                        verified?: boolean;
                        ghii?: string;
                        display_name?: string;
                        home_node?: string;
                        home_url?: string;
                        scopes?: string[];
                        signature?: string;
                    };
                };
                const attestation = result.data;
                if (!attestation?.ghii) {
                    res.status(502).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED',
                        'Invalid attestation received from home node'));
                    return;
                }

                // Verify attestation signature against peer's known public key
                if (homePeer.publicKey && attestation.signature) {
                    const { verify: verifySignature } = await import('../../auth/keypair.js');
                    const attestationPayload = Object.fromEntries(
                        Object.entries(attestation).filter(([k]) => k !== 'signature'),
                    );
                    const payloadJson = JSON.stringify(attestationPayload);
                    const sigValid = await verifySignature(homePeer.publicKey, payloadJson, attestation.signature);
                    if (!sigValid) {
                        logger.warn(`Federation attestation signature verification failed for ${attestation.ghii} from ${homePeer.nodeId}`);
                        res.status(401).json(error(config.nodeId, 'INVALID_ATTESTATION', 'Attestation signature verification failed'));
                        return;
                    }
                }

                // Determine scopes from RECEIVING node policy (not home node attestation)
                const fedScopes = (homePeer.federationAuthScopes?.length > 0)
                    ? homePeer.federationAuthScopes
                    : config.federationDefaultScopes;
                const fedTtl = Math.min(config.jwtTtlSeconds, 3600); // max 1 hour
                const token = await issueJWT({
                    sub: loginName,
                    owner: loginName,
                    node: config.nodeId,
                    roles: ['owner'],
                    scopes: fedScopes,
                    federated: true,
                    homeNode: attestation.home_node ?? federatedNodeId,
                    homeUrl: attestation.home_url ?? homePeer.url,
                }, fedTtl);

                res.set('Cache-Control', 'no-store');
                res.set('Pragma', 'no-cache');
                res.json(success(config.nodeId, {
                    ghii: {
                        ghii: attestation.ghii,
                        username: loginName,
                        display_name: attestation.display_name,
                    },
                    owner: { name: loginName },
                    token,
                    expires_at: new Date(Date.now() + fedTtl * 1000).toISOString(),
                    federated: true,
                    home_node: attestation.home_node ?? federatedNodeId,
                    home_url: attestation.home_url ?? homePeer.url,
                }));
                return;
            } catch (err) {
                if (err instanceof Error && err.name === 'TimeoutError') {
                    res.status(504).json(error(config.nodeId, 'FEDERATION_UNREACHABLE',
                        `Home node ${federatedNodeId} did not respond in time`));
                    return;
                }
                logger.warn('Federation auth error', { node: federatedNodeId, error: String(err) });
                res.status(502).json(error(config.nodeId, 'FEDERATION_UNREACHABLE',
                    `Failed to reach home node ${federatedNodeId}`));
                return;
            }
        }

        const ghii = `${loginName}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        if (!ghiiRecord) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        if (!ghiiRecord.passwordHash) {
            res.status(400).json(error(config.nodeId, 'NO_PASSWORD', 'This account has no password set. Password login is not available.'));
            return;
        }

        // Per-account password lockout (brute-force protection)
        if (ghiiRecord.passwordLockedUntil) {
            const lockExpires = new Date(ghiiRecord.passwordLockedUntil).getTime();
            if (Date.now() < lockExpires) {
                res.status(429).json(error(config.nodeId, 'PASSWORD_LOCKED',
                    `Account temporarily locked due to too many failed login attempts. Try again after ${ghiiRecord.passwordLockedUntil}`));
                return;
            }
            await storage.updateGHII(ghiiRecord.ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
            ghiiRecord.passwordFailedAttempts = 0;
            ghiiRecord.passwordLockedUntil = undefined;
        }

        const valid = await verifyPassword(password, ghiiRecord.passwordHash);
        if (!valid) {
            const attempts = (ghiiRecord.passwordFailedAttempts ?? 0) + 1;
            const update: Record<string, unknown> = { passwordFailedAttempts: attempts };
            if (attempts >= config.passwordLockoutAttempts) {
                update.passwordLockedUntil = new Date(Date.now() + config.passwordLockoutMinutes * 60_000).toISOString();
            }
            await storage.updateGHII(ghiiRecord.ghii, update);
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        // Reset failed attempts on successful login
        if (ghiiRecord.passwordFailedAttempts) {
            await storage.updateGHII(ghiiRecord.ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
        }

        // Transparent scrypt parameter upgrade (v1 -> v2)
        if (ghiiRecord.passwordHash && isLegacyHash(ghiiRecord.passwordHash)) {
            const newHash = await hashPassword(password);
            await storage.updateGHII(ghiiRecord.ghii, { passwordHash: newHash });
        }

        // Email confirmation check — if operator requires it, block unverified users.
        // The password was already verified above, so we return a machine-readable signal
        // letting the sign-in modal collect/confirm an email and finish account setup.
        // `has_email` distinguishes legacy accounts with no email at all (attach one) from
        // accounts registered with an unverified email (prefill + resend a code).
        if (config.emailConfirmationRequired && ghiiRecord.verificationLevel < 1) {
            res.status(403).json(error(config.nodeId, 'EMAIL_NOT_VERIFIED',
                'Email verification is required before you can log in. Check your email for the verification code.',
                undefined, { email_required: true, has_email: !!ghiiRecord.notificationEmail }));
            return;
        }

        // TOTP 2FA check (Phase 0.5) — if TOTP is enabled, require a valid code
        if (ghiiRecord.totpEnabled && ghiiRecord.totpSecret) {
            // Check lockout
            if (ghiiRecord.totpLockedUntil) {
                const lockExpires = new Date(ghiiRecord.totpLockedUntil).getTime();
                if (Date.now() < lockExpires) {
                    res.status(429).json(error(config.nodeId, 'TOTP_LOCKED',
                        `Account temporarily locked due to too many failed TOTP attempts. Try again after ${ghiiRecord.totpLockedUntil}`));
                    return;
                }
                // Lock expired — reset counters
                await storage.updateGHII(ghiiRecord.ghii, {
                    totpFailedAttempts: 0,
                    totpLockedUntil: undefined,
                });
                ghiiRecord.totpFailedAttempts = 0;
                ghiiRecord.totpLockedUntil = undefined;
            }

            let totpVerified = false;

            // Try TOTP code
            if (totp_code && typeof totp_code === 'string') {
                // Replay protection: reject if same code was just used
                if (ghiiRecord.totpLastUsedCode === totp_code) {
                    res.status(401).json(error(config.nodeId, 'TOTP_REPLAY', 'This TOTP code has already been used. Wait for the next code.'));
                    return;
                }
                const totpResult = validateTotpCode(ghiiRecord.totpSecret, totp_code, totpConfig);
                if (totpResult.valid) {
                    totpVerified = true;
                    await storage.updateGHII(ghiiRecord.ghii, {
                        totpLastUsedAt: new Date().toISOString(),
                        totpLastUsedCode: totp_code,
                        totpFailedAttempts: 0,
                        totpLockedUntil: undefined,
                    });
                }
            }

            // Try backup code
            if (!totpVerified && backup_code && typeof backup_code === 'string' && ghiiRecord.totpBackupCodes) {
                const backupResult = validateBackupCode(backup_code, ghiiRecord.totpBackupCodes);
                if (backupResult.valid) {
                    totpVerified = true;
                    // Remove used backup code
                    const updatedCodes = [...ghiiRecord.totpBackupCodes];
                    updatedCodes.splice(backupResult.index, 1);
                    await storage.updateGHII(ghiiRecord.ghii, {
                        totpBackupCodes: updatedCodes,
                        totpFailedAttempts: 0,
                        totpLockedUntil: undefined,
                    });
                }
            }

            if (!totpVerified) {
                // If neither code was provided at all, tell the client TOTP is required
                if (!totp_code && !backup_code) {
                    res.status(401).json(error(config.nodeId, 'TOTP_REQUIRED',
                        'This account has two-factor authentication enabled. Provide totp_code or backup_code.'));
                    return;
                }

                // Increment failed attempts
                const attempts = (ghiiRecord.totpFailedAttempts ?? 0) + 1;
                const lockUntil = attempts >= config.totpMaxFailedAttempts
                    ? new Date(Date.now() + config.totpLockoutSeconds * 1000).toISOString()
                    : undefined;
                await storage.updateGHII(ghiiRecord.ghii, {
                    totpFailedAttempts: attempts,
                    totpLockedUntil: lockUntil,
                });

                if (lockUntil) {
                    res.status(429).json(error(config.nodeId, 'TOTP_LOCKED',
                        `Too many failed TOTP attempts. Account locked until ${lockUntil}`));
                    return;
                }

                res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'Invalid TOTP code or backup code.'));
                return;
            }
        }

        // Password (+ TOTP if enabled) verified — track login
        const isFirstLogin = (ghiiRecord.loginCount ?? 0) === 0;
        const loginNow = new Date().toISOString();
        await storage.updateGHII(ghiiRecord.ghii, {
            lastLoginAt: loginNow,
            loginCount: (ghiiRecord.loginCount ?? 0) + 1,
        });

        // Provisioned-code ("key") account, first sign-in: rotate its dash-carrying bootstrap code to
        // a durable, validator-clean password and hand the owner their real login (username + password),
        // both in this response and by email. Runs exactly once (gated by the invite flipping accepted).
        const keyCredentials = isFirstLogin
            ? await issueFirstLoginKeyCredentials(storage, config, ghiiRecord)
            : null;

        // Issue OWNER JWT (human users authenticate as owners, not agents)
        const ownerRecord = await storage.getOwner(loginName);

        // Owner signing-key handling — mint a fresh keypair ONLY when necessary.
        // Rotating the key on every login (the previous behaviour) rewrote the
        // stored public key, which silently invalidated the private key held by
        // every OTHER device/tab in IndexedDB. Those sessions could then no longer
        // sign a refresh and were force-logged-out at JWT expiry. The server only
        // persists the public key (the private key lives solely in the browser),
        // so we re-mint only when the owner has no key yet, or the client asks for
        // one because it holds none locally (a brand-new device). Otherwise we keep
        // the existing key and return no private key, leaving every already-signed-in
        // device's refresh capability intact.
        const needsNewOwnerKey = wantsOwnerKey || !ownerRecord?.publicKey;
        let ownerKeyPair: { publicKey: string; privateKey: string } | null = null;
        if (needsNewOwnerKey) {
            ownerKeyPair = await generateKeyPair();
            await storage.updateOwner(loginName, { publicKey: ownerKeyPair.publicKey });
        }

        const roles: string[] = [];
        if (ownerRecord?.roles.includes('owner')) roles.push('owner');
        if (ownerRecord?.roles.includes('operator')) roles.push('operator');

        // Self-heal: if no operator exists anywhere, promote this user
        if (ownerRecord && !roles.includes('operator')) {
          const allOwners = await storage.listOwners();
          const hasOperator = allOwners.some(o => o.roles.includes('operator'));
          if (!hasOperator) {
            roles.push('operator');
            await storage.updateOwner(loginName, { roles: [...ownerRecord.roles, 'operator'] });
          }
        }

        // Establish an owner session: short-lived access JWT (bound to the session via
        // jti) + a rotating refresh token delivered as an httpOnly cookie. Refresh no
        // longer depends on the owner keypair, so other devices are never invalidated.
        const { token, sessionId, expiresIn } = await establishOwnerSession(
            storage, config, req, res, { owner: loginName, roles },
        );

        // SECURITY: Prevent caching of response containing private keys
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.json(success(config.nodeId, {
            ghii: {
                ghii: ghiiRecord.ghii,
                username: ghiiRecord.username,
                display_name: ghiiRecord.displayName,
            },
            owner: { name: loginName },
            token,
            session_id: sessionId,
            expires_in: expiresIn,
            expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
            // Only hand back the private key when a new one was minted — otherwise
            // the client keeps the key it already holds in IndexedDB (see above).
            ...(ownerKeyPair ? { owner_private_key: ownerKeyPair.privateKey } : {}),
            owner_public_key: ownerKeyPair?.publicKey ?? ownerRecord?.publicKey ?? '',
            // First-login durable credentials for a provisioned-code account (also emailed). Lets the
            // entry surface show the exact username + password the login form accepts. Absent otherwise.
            ...(keyCredentials ? { key_credentials: keyCredentials } : {}),
        }, [
            { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
            { description: 'Upload an app', method: 'POST', url: '/v1/apps' },
        ]));
        emitChange('ghii');
    });

    // POST /v1/ghii/login/attach-email — Complete a legacy/unverified account during sign-in (no auth).
    // Chicken-and-egg fix: /v1/ghii/email/verify requires a session, but login is blocked at the
    // EMAIL_NOT_VERIFIED gate for accounts with verificationLevel < 1 — so those users can never reach
    // it. This endpoint re-verifies username+password (so nobody can attach an email to someone else's
    // account), attaches/updates the email, and sends a verification code. The caller then confirms via
    // the existing /v1/ghii/verify-email (which sets verificationLevel=1), and re-runs the password
    // login to obtain a normal owner session.
    router.post('/v1/ghii/login/attach-email', rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }), async (req, res) => {
        const { username, password, email } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }
        if (!password || typeof password !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required'));
            return;
        }
        if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A valid email is required'));
            return;
        }

        // Accept full GHII — strip @node-id for local lookup (federated accounts are managed by their home node)
        let loginName = username.trim().toLowerCase();
        if (loginName.includes('@')) {
            const atIdx = loginName.indexOf('@');
            const nodePart = loginName.substring(atIdx + 1);
            loginName = loginName.substring(0, atIdx);
            if (nodePart !== config.nodeId) {
                res.status(400).json(error(config.nodeId, 'FEDERATION_UNSUPPORTED',
                    'Email setup must be completed on your home node.'));
                return;
            }
        }

        const ghii = `${loginName}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        // Uniform failure for missing account / no password / wrong password — never reveal which.
        if (!ghiiRecord || !ghiiRecord.passwordHash) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        // Per-account password lockout (mirror the login handler)
        if (ghiiRecord.passwordLockedUntil) {
            const lockExpires = new Date(ghiiRecord.passwordLockedUntil).getTime();
            if (Date.now() < lockExpires) {
                res.status(429).json(error(config.nodeId, 'PASSWORD_LOCKED',
                    `Account temporarily locked due to too many failed login attempts. Try again after ${ghiiRecord.passwordLockedUntil}`));
                return;
            }
            await storage.updateGHII(ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
        }

        const valid = await verifyPassword(password, ghiiRecord.passwordHash);
        if (!valid) {
            const attempts = (ghiiRecord.passwordFailedAttempts ?? 0) + 1;
            const update: Record<string, unknown> = { passwordFailedAttempts: attempts };
            if (attempts >= config.passwordLockoutAttempts) {
                update.passwordLockedUntil = new Date(Date.now() + config.passwordLockoutMinutes * 60_000).toISOString();
            }
            await storage.updateGHII(ghii, update);
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }
        if (ghiiRecord.passwordFailedAttempts) {
            await storage.updateGHII(ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
        }

        // This endpoint is only for accounts still short of email verification. Once verified there is
        // nothing to complete — the user should just log in.
        if (ghiiRecord.verificationLevel >= 1) {
            res.status(409).json(error(config.nodeId, 'ALREADY_VERIFIED',
                'This account is already verified. Please sign in.'));
            return;
        }

        const normalizedEmail = email.toLowerCase().trim();
        const emailHash = createHash('sha256').update(normalizedEmail).digest('hex');

        // Reject if the email already belongs to a different account (email is a recovery handle).
        const emailOwner = await storage.getGHIIByEmailHash(emailHash);
        if (emailOwner && emailOwner.ghii !== ghii) {
            res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN',
                'That email is already associated with another account.'));
            return;
        }

        // Attach the email now so notification/recovery work once the code is confirmed. emailHash +
        // verificationLevel are finalised by /v1/ghii/verify-email on a correct code.
        await storage.updateGHII(ghii, { notificationEmail: normalizedEmail, magicLinkEnabled: true });

        const { verificationId: verId, emailSent } = await startRegistrationEmailVerification(
            storage, emailService, loginName, normalizedEmail, ghiiRecord.locale);

        res.json(success(config.nodeId, {
            ok: true,
            verification_id: verId,
            email_sent: emailSent,
            message: 'Verification code sent',
        }, [
            { description: 'Confirm the code to finish setup', method: 'POST', url: '/v1/ghii/verify-email' },
        ]));
    });
}
