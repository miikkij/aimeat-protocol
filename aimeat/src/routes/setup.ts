/**
 * @file src/routes/setup.ts
 * @description First-run node setup routes — serves the setup wizard, reports whether the node still
 *   needs an initial owner, and creates the first owner account (keypair, hashed password, owner JWT)
 *   before any owners exist; guarded by an optional setup-IP allowlist.
 *
 * @structure
 *   - resolvePublicFile: locate a public/ asset from both src/ and dist/ layouts
 *   - setupRouter: builds the Express router, with a checkSetupIp gate
 *   - GET /v1/setup/status: report whether setup is needed (no owners yet)
 *   - GET /v1/setup/wizard + POST /v1/setup/init: serve the wizard and provision the first owner
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { issueJWT } from '../auth/jwt.js';
import { success, error } from '../middleware/envelope.js';
import { validateOwnerName, buildGAII } from '../utils/gaii.js';
import { hashPassword } from '../services/password.js';
import { logger } from '../utils/logger.js';

const __dirname_setup = dirname(fileURLToPath(import.meta.url));

/** Resolve a file from public/ directory (works from both src/ and dist/). */
function resolvePublicFile(filename: string): string | null {
    const candidates = [
        join(__dirname_setup, '..', '..', 'public', filename),      // dev: src/routes/../../public
        join(__dirname_setup, '..', '..', '..', 'public', filename), // dist: dist/src/routes/../../../public
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

/** Callback to invalidate the first-run cache when setup completes. */
export type SetupCompleteCallback = () => void;

export function setupRouter(config: AimeatConfig, storage: Storage, onSetupComplete?: SetupCompleteCallback): Router {
    const router = Router();

    // Phase 1.2 — IP restriction for setup endpoints
    const checkSetupIp = (req: import('express').Request, res: import('express').Response): boolean => {
        const allowedIps = config.setupAllowedIps;
        if (allowedIps.length === 0) return true;  // No restriction if not configured
        const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
        if (allowedIps.includes(clientIp) || allowedIps.includes('127.0.0.1') && (clientIp === '::1' || clientIp === '::ffff:127.0.0.1')) {
            return true;
        }
        res.status(403).json(error(config.nodeId, 'IP_RESTRICTED', 'Setup access is restricted by IP'));
        return false;
    };

    // GET /v1/setup/status — Check if node needs setup
    router.get('/v1/setup/status', async (_req, res) => {
        try {
            const owners = await storage.listOwners();
            const needsSetup = owners.length === 0;
            res.json(success(config.nodeId, {
                needsSetup,
                nodeId: config.nodeId,
            }));
        } catch (err) {
            logger.error('Setup status check failed', { error: err });
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to check setup status'));
        }
    });

    // GET /v1/setup/wizard — Serve the wizard HTML page with CSP nonce injection
    router.get('/v1/setup/wizard', (req, res) => {
        if (!checkSetupIp(req, res)) return;
        const htmlPath = resolvePublicFile('wizard.html');
        if (htmlPath) {
            let html = readFileSync(htmlPath, 'utf-8');
            // Inject CSP nonce into all script and style tags
            const nonce = res.locals.cspNonce as string || '';
            if (nonce) {
                html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
                html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
            }
            res.type('text/html').send(html);
        } else {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Setup wizard page not found'));
        }
    });

    // POST /v1/setup/init — First-run initialization
    router.post('/v1/setup/init', async (req, res) => {
        if (!checkSetupIp(req, res)) return;
        try {
            // Guard: only works when no owners exist
            const existingOwners = await storage.listOwners();
            if (existingOwners.length > 0) {
                res.status(403).json(error(config.nodeId, 'ALREADY_CONFIGURED', 'This node is already configured. Setup can only run once.'));
                return;
            }

            const { locale, nodeId, nodeType, owner, genesisUrl, port } = req.body ?? {};

            // Validate owner object
            if (!owner || typeof owner !== 'object') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner object is required'));
                return;
            }

            const { username, displayName, password, importPublicKey } = owner;

            // Validate username
            if (!username || typeof username !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner.username is required'));
                return;
            }

            const nameError = validateOwnerName(username);
            if (nameError) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
                return;
            }

            // Validate password
            if (!password || typeof password !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner.password is required'));
                return;
            }

            if (password.length < 8) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Password must be at least 8 characters'));
                return;
            }

            // Validate importPublicKey if provided
            if (importPublicKey !== undefined && (typeof importPublicKey !== 'string' || importPublicKey.trim().length === 0)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner.importPublicKey must be a non-empty string'));
                return;
            }

            const resolvedDisplayName = (typeof displayName === 'string' && displayName.length > 0)
                ? displayName
                : username;

            // 1. Get keypair: use imported public key or generate a new one
            let ownerPublicKey: string;
            if (typeof importPublicKey === 'string' && importPublicKey.trim().length > 0) {
                ownerPublicKey = importPublicKey.trim();
            } else {
                const keyPair = await generateKeyPair();
                ownerPublicKey = keyPair.publicKey;
            }

            // 2. Create owner with roles ['owner', 'operator'] (first owner = operator)
            const now = new Date().toISOString();
            const ownerRecord = await storage.createOwner({
                name: username,
                displayName: resolvedDisplayName,
                publicKey: ownerPublicKey,
                roles: ['owner', 'operator'],
                createdAt: now,
            });

            // 3. Create GHII profile
            const ghii = `${username}@${config.nodeId}`;
            const passwordHash = await hashPassword(password);
            await storage.createGHII({
                username,
                nodeId: config.nodeId,
                ghii,
                displayName: resolvedDisplayName,
                locale: typeof locale === 'string' ? locale : undefined,
                passwordHash,
                verificationLevel: 0,
                ownerName: ownerRecord.name,
                totpEnabled: false,
                createdAt: now,
                updatedAt: now,
            });

            // 4. Create a default agent for the owner
            const agentKeyPair = await generateKeyPair();
            const gaii = buildGAII('app', username, config.nodeId);
            const agentRecord = await storage.createAgent({
                name: 'app',
                owner: username,
                gaii,
                displayName: `${resolvedDisplayName}'s App Agent`,
                description: 'Default agent created during setup',
                capabilities: [],
                publicKey: agentKeyPair.publicKey,
                trustScore: 50,
                morselBalance: config.welcomeBonus,
                createdAt: now,
                lastSeen: now,
            });

            // 5. Write .env file with config values (best effort)
            try {
                const envLines: string[] = [
                    '# AIMEAT Node Configuration (generated by setup wizard)',
                    `# Created: ${now}`,
                    '',
                    `AIMEAT_NODE_ID="${typeof nodeId === 'string' && nodeId.length > 0 ? nodeId : config.nodeId}"`,
                    `AIMEAT_PORT="${typeof port === 'number' ? port : config.port}"`,
                    `AIMEAT_NODE_TYPE="${typeof nodeType === 'string' && nodeType.length > 0 ? nodeType : config.nodeType}"`,
                ];
                if (typeof genesisUrl === 'string' && genesisUrl.length > 0) {
                    envLines.push(`AIMEAT_GENESIS_URL="${genesisUrl}"`);
                }
                if (typeof locale === 'string' && locale.length > 0) {
                    envLines.push(`AIMEAT_LOCALE="${locale}"`);
                }
                envLines.push('');

                const envContent = envLines.join('\n') + '\n';

                // Try to find or create .env in the project root
                const envCandidates = [
                    join(__dirname_setup, '..', '..', '.env'),      // dev: src/routes/../../.env
                    join(__dirname_setup, '..', '..', '..', '.env'), // dist: dist/src/routes/../../../.env
                ];
                let envPath = envCandidates.find(p => existsSync(p));
                if (!envPath) {
                    // Create in the first candidate location (project root)
                    envPath = envCandidates[0];
                }
                // Only write if no .env exists yet (don't overwrite existing config)
                if (!existsSync(envPath)) {
                    writeFileSync(envPath, envContent, 'utf-8');
                    logger.info('Setup wizard wrote .env file', { path: envPath });
                }
            } catch (envErr) {
                // Non-fatal: .env writing is best-effort
                logger.warn('Setup wizard could not write .env file', { error: envErr });
            }

            // 6. Generate JWT for auto-login
            const roles = ['agent', 'owner', 'operator'];
            const token = await issueJWT({
                sub: agentRecord.gaii,
                owner: username,
                node: config.nodeId,
                roles,
            }, config.jwtTtlSeconds);

            // 7. Invalidate first-run cache
            if (onSetupComplete) {
                onSetupComplete();
            }

            res.status(201).json(success(config.nodeId, {
                owner: {
                    name: ownerRecord.name,
                    displayName: ownerRecord.displayName,
                    roles: ownerRecord.roles,
                },
                agent: {
                    gaii: agentRecord.gaii,
                    name: agentRecord.name,
                },
                token,
                expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
                message: 'Node setup complete. You are now the operator of this node.',
            }, [
                { description: 'View your profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
                { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
                { description: 'Visit the portal', method: 'GET', url: '/v1/portal' },
            ]));
        } catch (err) {
            logger.error('Setup init failed', { error: err });
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Setup failed. Please try again.'));
        }
    });

    return router;
}
