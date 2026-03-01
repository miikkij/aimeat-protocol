import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateOwnerName, buildGAII } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { validateTotpCode, validateBackupCode } from '../services/totp.js';
import type { TotpConfig } from '../services/totp.js';

// Password hashing with scrypt
async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(salt.toString('hex') + ':' + derivedKey.toString('hex'));
        });
    });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const [saltHex, keyHex] = hash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const storedKey = Buffer.from(keyHex, 'hex');
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(timingSafeEqual(storedKey, derivedKey));
        });
    });
}

/**
 * GHII — Global Human Intelligence Identifier
 *
 * Human identity layer on top of AIMEAT's owner system.
 * GHII format: username@nodeId (e.g. alice@meat-finland-001)
 *
 * Key distinction:
 * - Operators/admins are owners with role=['owner','operator'] — they manage the node
 * - GHII users are owners with role=['owner'] + a GHII profile — they use apps
 */
export function ghiiRouter(config: AimeatConfig, storage: Storage): Router {
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

        // Validate password if provided
        if (password !== undefined && password !== null) {
            if (typeof password !== 'string' || password.length < 4) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Password must be at least 4 characters'));
                return;
            }
        }

        // Hash password if provided
        const passwordHash = (typeof password === 'string' && password.length >= 4)
            ? await hashPassword(password)
            : undefined;

        // Check if owner name is already taken
        const existingOwner = await storage.getOwner(username);
        const ghii = `${username}@${config.nodeId}`;

        if (existingOwner) {
            if (config.devMode) {
                // Dev mode: wipe old account and re-create (lost credentials recovery)
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

        // Create owner with role=['owner'] (NOT operator — operators are node admins)
        const owner = await storage.createOwner({
            name: username,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles: ['owner'],
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
            note: 'Store the private key securely. It cannot be retrieved again. You need it to authenticate and create agents.',
        }, [
            { description: 'Create an agent for your identity', method: 'POST', url: '/v1/agents' },
            { description: 'Update your GHII profile', method: 'PUT', url: '/v1/ghii' },
            { description: 'View your public profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
        ]));
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

        const token = await issueJWT({
            sub: agent.gaii,
            owner: username,
            node: config.nodeId,
            roles,
        }, config.jwtTtlSeconds);

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
    });

    // GET /v1/ghii/directory — Search/list human identities (Tier 0, no auth)
    // Must be registered BEFORE the /:ghii param route
    router.get('/v1/ghii/directory', async (req, res) => {
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

        const { display_name, bio, avatar, locale } = req.body ?? {};
        const updates: Record<string, unknown> = {};
        if (typeof display_name === 'string') updates.displayName = display_name;
        if (typeof bio === 'string') updates.bio = bio;
        if (typeof avatar === 'string') updates.avatar = avatar;
        if (typeof locale === 'string') updates.locale = locale;

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
    });

    return router;
}
