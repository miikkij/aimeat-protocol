import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EmailService } from '../services/email.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { validateOwnerName, buildGAII } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { createHash, randomBytes } from 'node:crypto';
import { validateTotpCode, validateBackupCode } from '../services/totp.js';
import type { TotpConfig } from '../services/totp.js';
import { hashPassword, verifyPassword } from '../services/password.js';

// SECURITY: Password strength validation
const WEAK_PASSWORDS = [
    'password', 'admin', 'testadminpw123', '123456', '12345678', 'letmein', 'qwerty',
    'abc123', 'TestAdminPw123!', 'secret', 'test', 'demo', 'welcome', 'login',
    'master', 'dragon', 'monkey', 'shadow', 'sunshine', 'trustno1',
];

function validatePasswordStrength(password: string): string | null {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain a number';
    if (WEAK_PASSWORDS.includes(password.toLowerCase())) return 'Password is too common';
    return null;
}

/**
 * GHII — Global Human Intelligence Identifier
 *
 * Human identity layer on top of AIMEAT's owner system.
 * GHII format: username@nodeId (e.g. alice@aimeat-finland-001)
 *
 * Key distinction:
 * - Operators/admins are owners with role=['owner','operator'] — they manage the node
 * - GHII users are owners with role=['owner'] + a GHII profile — they use apps
 */
export function ghiiRouter(config: AimeatConfig, storage: Storage, emailService?: EmailService, onDirectoryChange?: () => void): Router {
    const router = Router();

    // POST /v1/ghii — Register a new human identity (no auth required)
    // Creates an owner account + GHII profile in one step
    router.post('/v1/ghii', async (req, res) => {
        const { username, display_name, bio, avatar, locale, password } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
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

        // Preserve old roles before dev-mode wipe (so operator isn't lost)
        let preservedRoles: string[] | null = null;
        if (existingOwner) {
            if (config.devMode) {
                // Dev mode: wipe old account and re-create (lost credentials recovery)
                preservedRoles = existingOwner.roles;
                const oldAgents = await storage.getAgentsByOwner(username);
                for (const agent of oldAgents) {
                    await storage.deleteAgent(agent.gaii);
                }
                const oldGhii = await storage.getGHII(ghii);
                if (oldGhii) await storage.deleteGHII(ghii);
                await storage.deleteOwner(username);
            } else {
                res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`));
                return;
            }
        }

        // Generate keypair for the owner account
        const keyPair = await generateKeyPair();

        // First real owner gets operator role (same logic as /v1/owners)
        // Also restore operator if the account previously had it (dev-mode re-create)
        // Self-heal: if no operator exists anywhere, promote this user
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        const hasOperator = allOwners.some(o => o.roles.includes('operator'));
        const roles: string[] = ['owner'];
        if (realOwners.length === 0 || !hasOperator || preservedRoles?.includes('operator')) {
            roles.push('operator');
        }

        const owner = await storage.createOwner({
            name: username,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Create GHII profile
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
            createdAt: now,
            updatedAt: now,
        });

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
    // Regenerates keys, creates agent if missing, returns full session
    router.post('/v1/ghii/login', async (req, res) => {
        const { username, password, totp_code, backup_code } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }
        if (!password || typeof password !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required'));
            return;
        }

        const ghii = `${username}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        if (!ghiiRecord) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        if (!ghiiRecord.passwordHash) {
            res.status(400).json(error(config.nodeId, 'NO_PASSWORD', 'This account has no password set. Password login is not available.'));
            return;
        }

        const valid = await verifyPassword(password, ghiiRecord.passwordHash);
        if (!valid) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        // Email confirmation check — if operator requires it, block unverified users
        if (config.emailConfirmationRequired && ghiiRecord.verificationLevel < 1) {
            res.status(403).json(error(config.nodeId, 'EMAIL_NOT_VERIFIED',
                'Email verification is required before you can log in. Check your email for the verification code.'));
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

        // Password (+ TOTP if enabled) verified — regenerate owner keys
        const ownerKeyPair = await generateKeyPair();
        await storage.updateOwner(username, { publicKey: ownerKeyPair.publicKey });

        // Find or create a default agent
        const agents = await storage.getAgentsByOwner(username);
        let agent = agents.find(a => a.name === 'app');
        let agentPrivKey: string;

        if (agent) {
            // Re-key existing agent
            const agentKeyPair = await generateKeyPair();
            await storage.updateAgent(agent.gaii, { publicKey: agentKeyPair.publicKey });
            agentPrivKey = agentKeyPair.privateKey;
        } else {
            // Create new default agent
            const agentKeyPair = await generateKeyPair();
            const gaii = buildGAII('app', username, config.nodeId);
            agent = await storage.createAgent({
                name: 'app',
                owner: username,
                gaii,
                displayName: `${ghiiRecord.displayName}'s App Agent`,
                description: 'Default agent for AIMEAT apps',
                capabilities: [],
                publicKey: agentKeyPair.publicKey,
                trustScore: 50,
                morselBalance: config.welcomeBonus,
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            });
            agentPrivKey = agentKeyPair.privateKey;
        }

        // Issue agent JWT
        const ownerRecord = await storage.getOwner(username);
        const roles = ['agent'];
        if (ownerRecord?.roles.includes('owner')) roles.push('owner');
        if (ownerRecord?.roles.includes('operator')) roles.push('operator');

        // Self-heal: if no operator exists anywhere, promote this user
        if (ownerRecord && !roles.includes('operator')) {
          const allOwners = await storage.listOwners();
          const hasOperator = allOwners.some(o => o.roles.includes('operator'));
          if (!hasOperator) {
            roles.push('operator');
            await storage.updateOwner(username, { roles: [...ownerRecord.roles, 'operator'] });
          }
        }

        const token = await issueJWT({
            sub: agent.gaii,
            owner: username,
            node: config.nodeId,
            roles,
        }, config.jwtTtlSeconds);

        // SECURITY: Prevent caching of response containing private keys
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.json(success(config.nodeId, {
            ghii: {
                ghii: ghiiRecord.ghii,
                username: ghiiRecord.username,
                display_name: ghiiRecord.displayName,
            },
            owner: { name: username },
            agent: { gaii: agent.gaii },
            token,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            owner_private_key: ownerKeyPair.privateKey,
            agent_private_key: agentPrivKey,
            owner_public_key: ownerKeyPair.publicKey,
        }, [
            { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
            { description: 'Upload an app', method: 'POST', url: '/v1/apps' },
        ]));
        emitChange('ghii');
    });

    // ── Phase 1.3 — Web Registration, Email Verification, Magic Link ──

    // POST /v1/ghii/register-web — Web registration (no auth required)
    // Creates owner + GHII profile with optional email verification
    router.post('/v1/ghii/register-web', async (req, res) => {
        const { username, display_name, email, locale, city, area, interests } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
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

        // Check if owner name is already taken
        const existingOwner = await storage.getOwner(username);
        if (existingOwner) {
            res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`));
            return;
        }

        // Hash email if provided
        const emailHash = (typeof email === 'string' && email.length > 0)
            ? createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
            : undefined;

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

        // Create GHII profile with verificationLevel: 0
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
            emailHash,
            magicLinkEnabled: !!emailHash,
            notificationEmail: (typeof email === 'string' && email.length > 0) ? email.toLowerCase().trim() : undefined,
            loginCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        // Store interest profile in memory if interests provided
        if (Array.isArray(interests) && interests.length > 0) {
            const agentGaii = `app#${username}@${config.nodeId}`;
            await storage.setMemory({
                key: `profile.${username}.interests`,
                ownerGaii: agentGaii,
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
    router.post('/v1/ghii/verify-email', async (req, res) => {
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

        // Update GHII with verified email info
        const ghii = `${record.ownerName}@${config.nodeId}`;
        await storage.updateGHII(ghii, {
            emailHash: record.emailHash,
            emailVerifiedAt: now,
            verificationLevel: 1,
            verificationMethod: 'email',
            magicLinkEnabled: true,
        });

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
                morselBalance: config.welcomeBonus,
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
        const ownerRecord = await storage.getOwner(record.ownerName);
        const roles = ['agent'];
        if (ownerRecord?.roles.includes('owner')) roles.push('owner');
        if (ownerRecord?.roles.includes('operator')) roles.push('operator');

        const token = await issueJWT({
            sub: agent.gaii,
            owner: record.ownerName,
            node: config.nodeId,
            roles,
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
    router.post('/v1/ghii/magic-link', async (req, res) => {
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
                morselBalance: config.welcomeBonus,
                createdAt: now,
                lastSeen: now,
            });
            agentPrivKey = agentKeyPair.privateKey;
        }

        // Issue JWT
        const ownerRecord = await storage.getOwner(record.ownerName);
        const roles = ['agent'];
        if (ownerRecord?.roles.includes('owner')) roles.push('owner');
        if (ownerRecord?.roles.includes('operator')) roles.push('operator');

        const jwtToken = await issueJWT({
            sub: agent.gaii,
            owner: record.ownerName,
            node: config.nodeId,
            roles,
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

    // GET /v1/ghii/list — Search/list human identities (Tier 0, no auth)
    // Note: renamed from /v1/ghii/directory to avoid confusion with /v1/catalogue/directory
    // Must be registered BEFORE the /:ghii param route
    router.get('/v1/ghii/list', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q : undefined;
        const level = typeof req.query.level === 'string' ? parseInt(req.query.level, 10) : undefined;

        const results = await storage.listGHIIs({
            q,
            level: level !== undefined && !isNaN(level) ? level : undefined,
        });

        res.json(success(config.nodeId, {
            humans: results.map(r => ({
                ghii: r.ghii,
                display_name: r.displayName,
                bio: r.bio,
                avatar: r.avatar,
                locale: r.locale,
                verification_level: r.verificationLevel,
                created_at: r.createdAt,
            })),
            total: results.length,
        }));
    });

    // Backward-compatible redirect: /v1/ghii/directory → /v1/ghii/list
    router.get('/v1/ghii/directory', (req, res) => {
        const qs = Object.keys(req.query).length > 0
            ? '?' + new URLSearchParams(req.query as Record<string, string>).toString()
            : '';
        res.redirect(301, `/v1/ghii/list${qs}`);
    });

    // ── CORS per-GHII management ──

    // GET /v1/ghii/cors — Get your CORS allowed origins
    router.get('/v1/ghii/cors', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        res.json(success(config.nodeId, {
            ghii: ghiiRecord.ghii,
            allowed_origins: ghiiRecord.allowedOrigins ?? null,
            effective: ghiiRecord.allowedOrigins ?? config.corsAllowedOrigins,
            inherited: !ghiiRecord.allowedOrigins,
        }));
    });

    // PUT /v1/ghii/cors — Set your CORS allowed origins
    router.put('/v1/ghii/cors', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        const { allowed_origins } = req.body ?? {};

        // null = inherit from node default, array = explicit origins
        if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to inherit'));
            return;
        }

        if (Array.isArray(allowed_origins)) {
            for (const origin of allowed_origins) {
                if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid origin: ${origin}. Must be an http(s) URL or '*'`));
                    return;
                }
            }
        }

        const updates: Record<string, unknown> = {
            allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
        };

        const updated = await storage.updateGHII(ghiiRecord.ghii, updates);
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update CORS settings'));
            return;
        }

        res.json(success(config.nodeId, {
            ghii: updated.ghii,
            allowed_origins: updated.allowedOrigins ?? null,
            effective: updated.allowedOrigins ?? config.corsAllowedOrigins,
            inherited: !updated.allowedOrigins,
        }));
        emitChange('ghii');
    });

    // GET /v1/ghii/:ghii — Public profile (Tier 0, no auth)
    router.get('/v1/ghii/:ghii', async (req, res) => {
        const ghii = req.params.ghii as string;
        const record = await storage.getGHII(ghii);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII "${ghii}" not found`));
            return;
        }

        // Get agents owned by this human
        const agents = await storage.getAgentsByOwner(record.ownerName);

        res.json(success(config.nodeId, {
            ghii: record.ghii,
            display_name: record.displayName,
            bio: record.bio,
            avatar: record.avatar,
            locale: record.locale,
            verification_level: record.verificationLevel,
            semantic: record.semantic,
            created_at: record.createdAt,
            agents: agents.map(a => ({
                gaii: a.gaii,
                display_name: a.displayName,
                trust_score: a.trustScore,
            })),
        }));
    });

    // PUT /v1/ghii — Update own profile (requires JWT auth as owner)
    router.put('/v1/ghii', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
            return;
        }

        const { display_name, bio, avatar, locale, notification_email } = req.body ?? {};
        const updates: Record<string, unknown> = {};
        if (typeof display_name === 'string') updates.displayName = display_name;
        if (typeof bio === 'string') updates.bio = bio;
        if (typeof avatar === 'string') updates.avatar = avatar;
        if (typeof locale === 'string') updates.locale = locale;
        if (typeof notification_email === 'string') updates.notificationEmail = notification_email;

        if (Object.keys(updates).length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid fields to update'));
            return;
        }

        const updated = await storage.updateGHII(ghiiRecord.ghii, updates);
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update profile'));
            return;
        }

        res.json(success(config.nodeId, {
            ghii: updated.ghii,
            display_name: updated.displayName,
            bio: updated.bio,
            avatar: updated.avatar,
            locale: updated.locale,
            verification_level: updated.verificationLevel,
            updated_at: updated.updatedAt,
        }));
        emitChange('ghii');

        // Notify directory of profile changes (Phase 1.4 — event-driven refresh)
        if (onDirectoryChange) onDirectoryChange();
    });

    // DELETE /v1/ghii — Delete own GHII profile (requires JWT auth as owner)
    router.delete('/v1/ghii', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        await storage.deleteGHII(ghiiRecord.ghii);

        res.json(success(config.nodeId, {
            deleted: true,
            ghii: ghiiRecord.ghii,
            note: 'GHII profile deleted. Your owner account and agents are not affected.',
        }));
        emitChange('ghii');
    });

    return router;
}
