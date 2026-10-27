/**
 * @file src/routes/setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description First-run node setup routes — serves the setup wizard, reports whether the node still
 *   needs an initial owner, and creates the first owner account (keypair, hashed password, owner JWT)
 *   before any owners exist; guarded by an optional setup-IP allowlist and, on a node whose base URL
 *   is not loopback, by the one-time setup code the start log prints (services/setup-code.ts).
 *
 * @structure
 *   - resolvePublicFile: locate a public/ asset from both src/ and dist/ layouts
 *   - setupRouter: builds the Express router, with a checkSetupIp gate and the setup-code refusal
 *   - GET /v1/setup/status: report whether setup is needed (no owners yet) and whether it needs the code
 *   - GET /v1/setup/wizard + POST /v1/setup/init: serve the wizard and provision the first owner
 *
 * @version-history
 *   2026-10-27 -- The status and POST /v1/setup/init read requestFromThisMachine: a forwarded request, or one with a Host that is not loopback, is asked for the code (secaudit2026oct26).
 *   v1.10.0 -- 2026-10-23 -- The status and POST /v1/setup/init read the request's socket address: a loopback base URL waives the setup code only for a request from loopback (secaudit2026oct22).
 *   v1.9.0 -- 2026-10-18 -- A new agent gets the node's classification.agent_clearance_default as its clearance (plan doc-mvdipuyqraas, L2.1).
 *   v1.8.0 -- 2026-10-18 -- The first account's app agent is tagged `unlisted` when visibility.agent_listed_default is off (plan doc-mvcn6c7e4e5q, V5.8).
 *   v1.7.2 -- 2026-10-16 -- ALREADY_CONFIGURED no longer clears the setup code: while the node has no
 *     operator the self-heal paths still need it (Jouni, 2026-10-16).
 *   v1.7.1 -- 2026-10-16 -- The code refusal is setupCodeRefusal (services/setup-code.ts), the one the
 *     registration routes answer for the first account too (Jouni, 2026-10-16).
 *   v1.7.0 -- 2026-10-16 -- On a node whose base URL is not loopback, POST /v1/setup/init takes
 *     `setupCode`, the one-time code the start log prints while the node has no owner, and refuses
 *     403 SETUP_CODE_REQUIRED without it and SETUP_CODE_INVALID with a wrong one, before it reads
 *     anything else; the code is used once, in one synchronous step before the owner is created.
 *     GET /v1/setup/status says `setupCodeRequired`. The setup was open to any address, so whoever
 *     reached a fresh public node first became its operator (Jouni, 2026-10-16).
 *   v1.6.1 -- 2026-10-16 -- The owner row and the GHII profile are written in one transaction (QA audit E6-02).
 *   v1.6.0 -- 2026-10-16 -- POST /v1/setup/init answers `settings` (per node setting: unchanged,
 *     written to .env for the next start, or not written because a .env exists or the write failed)
 *     and `restart_required`, and its message says "complete" only when nothing was dropped; dropped
 *     settings are logged at warn level. GET /v1/setup/status also gives nodeType and port, the
 *     wizard's defaults. The answer said "Node setup complete" while the settings were dropped
 *     (QA audit F1-03).
 *   2026-10-16 — Caught errors are logged with errorFields(err), so the line carries the message and the stack instead of {} (QA audit E1-04).
 *   v1.5.0 -- 2026-10-09 -- The node settings (nodeId, nodeType, genesisUrl, locale) are checked by
 *     services/setup-env.ts before anything is created, and .env is written through its one writer
 *     at mode 0600. A line break in any of them used to add a variable to .env (secrets audit
 *     2026-10-09, S1).
 *   v1.4.0 -- 2026-09-08 -- The `anonymous` system owner does not count as an owner: in anonymous
 *     mode a node nobody had set up reported itself configured and refused its own setup.
 *   v1.3.0 -- 2026-09-06 -- Review item 2.8: /v1/setup/init mints an OWNER session, which is what
 *     the wizard does with it. It used to put roles ['agent','owner','operator'] on a token whose
 *     `sub` was an agent GAII, with scopes omitted (so ['*']) -- the last invariant-12 mint.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
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
import { errorFields } from '../utils/error-fields.js';
import { writePrivateFile } from '../utils/private-file.js';
import { parseSetupNodeSettings, buildSetupEnv, setupSettingOutcomes, setupMessage, type SetupEnvWrite } from '../services/setup-env.js';
import { setupCodeGateFor, setupCodeRequired, setupCodeRefusal, SETUP_CODE_USED_MESSAGE, requestFromThisMachine } from '../services/setup-code.js';
import { agentListingTags } from '../services/content-defaults.js';
import { newAgentClearance } from '../services/agent-clearance.js';

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
        res.status(403).json(error(config.nodeId, 'IP_RESTRICTED', 'Setup can only be done from an approved network. Ask whoever runs this node to let your address in.'));
        return false;
    };

    // The one-time setup code of a node others can reach (services/setup-code.ts). The start log
    // (index-start.ts) issues it through the same gate.
    const codeGate = setupCodeGateFor(config);

    // GET /v1/setup/status — Check if node needs setup
    router.get('/v1/setup/status', async (req, res) => {
        try {
            // The `anonymous` system owner is created at boot in anonymous mode and is nobody's:
            // counting it told a brand-new node it was already configured (2026-09-08,
            // e2e-setup-and-verification). owners.ts skips it the same way for the operator grant.
            const owners = (await storage.listOwners()).filter(o => o.name !== 'anonymous');
            const needsSetup = owners.length === 0;
            // nodeType and port are the wizard's defaults, so an untouched form matches the running node.
            // setupCodeRequired tells the wizard to ask for the code the start log printed. It is
            // this request's answer: from outside the machine a loopback node asks for it too.
            res.json(success(config.nodeId, {
                needsSetup,
                setupCodeRequired: needsSetup && setupCodeRequired(config, requestFromThisMachine(req)),
                nodeId: config.nodeId,
                nodeType: config.nodeType,
                port: config.port,
            }));
        } catch (err) {
            logger.error('Setup status check failed', errorFields(err));
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
            const existingOwners = (await storage.listOwners()).filter(o => o.name !== 'anonymous');
            if (existingOwners.length > 0) {
                // The code stays: while the node has no operator, the self-heal that makes the next
                // account or sign-in the operator still needs it (services/owner-provisioning.ts).
                res.status(403).json(error(config.nodeId, 'ALREADY_CONFIGURED', 'This node is already configured. Setup can only run once.'));
                return;
            }

            // On a node others can reach, the one-time code from the start log, before anything else
            // is read (services/setup-code.ts; Jouni, 2026-10-16).
            const fromLoopback = requestFromThisMachine(req);
            const codeRefusal = setupCodeRefusal(config, req.body?.setupCode, fromLoopback);
            if (codeRefusal) {
                res.status(403).json(error(config.nodeId, codeRefusal.code, codeRefusal.message));
                return;
            }

            const { owner } = req.body ?? {};

            // The node settings go into .env, so each is held to a value the node takes and refused
            // with a quote or a line break in it, before anything is created (secrets audit
            // 2026-10-09, S1: a line break used to add any variable to the file).
            const nodeSettings = parseSetupNodeSettings(req.body);
            if (!nodeSettings.ok) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nodeSettings.problem));
                return;
            }
            const { locale } = nodeSettings.settings;

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
            // 3. ...and the GHII profile that holds the password, in ONE transaction with the owner
            //    row: written apart, a failure between them left a taken name nobody could sign in
            //    with, on the one node that has no other operator to remove it (QA audit E6-02).
            const now = new Date().toISOString();
            const ghii = `${username}@${config.nodeId}`;
            const passwordHash = await hashPassword(password);
            // The code is used here, checked and taken in one synchronous step, so of two requests
            // carrying it (this route or a registration route, services/owner-provisioning.ts) only
            // one creates the first owner. Taken from the gate itself rather than through
            // claimOperatorSetupCode, because this route makes an operator whatever the owner count
            // says by now. It waits again if the owner cannot be created.
            const codeNeeded = setupCodeRequired(config, fromLoopback);
            if (codeNeeded && !codeGate.take(req.body?.setupCode)) {
                res.status(403).json(error(config.nodeId, 'SETUP_CODE_INVALID', SETUP_CODE_USED_MESSAGE));
                return;
            }
            const ownerRecord = await storage.transaction(async () => {
                const created = await storage.createOwner({
                    name: username,
                    displayName: resolvedDisplayName,
                    publicKey: ownerPublicKey,
                    roles: ['owner', 'operator'],
                    createdAt: now,
                });
                await storage.createGHII({
                    username,
                    nodeId: config.nodeId,
                    ghii,
                    displayName: resolvedDisplayName,
                    locale,
                    passwordHash,
                    verificationLevel: 0,
                    ownerName: created.name,
                    totpEnabled: false,
                    createdAt: now,
                    updatedAt: now,
                });
                return created;
            }).catch((err: unknown) => {
                if (codeNeeded) codeGate.release();
                throw err;
            });
            if (codeNeeded) codeGate.commit();

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
                // Tagged `unlisted` when new agents are listed nowhere (visibility.agent_listed_default, plan V5.8).
                ...agentListingTags(config),
                ...newAgentClearance(config),
            });

            // 5. Write .env file with config values (best effort), at mode 0600: it is the file the
            //    node reads its secrets from once the operator adds them. What happened is reported
            //    per setting below, because the running node takes none of them (QA audit F1-03).
            let envWrite: SetupEnvWrite;
            try {
                const envContent = buildSetupEnv(nodeSettings.settings, config, now);

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
                    writePrivateFile(envPath, envContent);
                    logger.info('Setup wizard wrote .env file', { path: envPath });
                    envWrite = { written: true };
                } else {
                    envWrite = { written: false, reason: 'A .env configuration file already exists, and setup does not overwrite it.' };
                }
            } catch (envErr) {
                // Non-fatal: .env writing is best-effort
                logger.warn('Setup wizard could not write .env file', errorFields(envErr));
                envWrite = { written: false, reason: 'The .env file could not be written; the node log says why.' };
            }
            const settings = setupSettingOutcomes(nodeSettings.settings, config, envWrite);
            const dropped = settings.filter(o => o.status === 'not_written');
            if (dropped.length > 0) {
                logger.warn('Setup wizard: node settings were not saved; the node keeps its current values', {
                    settings: dropped.map(o => ({ setting: o.setting, requested: o.requested, running: o.running })),
                    reason: dropped[0].reason,
                });
            }

            // 6. An OWNER session for auto-login, which is what the wizard does with it: it stores the
            //    token and sends the browser to the portal.
            //
            //    INVARIANT 12, and this was the last mint in the repo still breaking it. The token's
            //    `sub` was the AGENT's GAII while its roles were ['agent','owner','operator'], so the
            //    agent this wizard had just created carried the node's operator role — and `scopes`
            //    was omitted, which makes issueJWT default it to ['*'], the H-1 defect the other
            //    mints were corrected for in August. A role is granted, never inherited at mint time.
            //
            //    The roles are the OWNER RECORD's own, read rather than assembled: the first owner of
            //    a node really is its operator, and saying so from the record means this line cannot
            //    drift from what the account is.
            const token = await issueJWT({
                sub: username,
                owner: username,
                node: config.nodeId,
                roles: ownerRecord.roles,
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
                message: setupMessage(settings),
                settings,
                restart_required: settings.some(o => o.restart_required),
            }, [
                { description: 'View your profile', method: 'GET', url: `/v1/ghii/${encodeURIComponent(ghii)}` },
                { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
                { description: 'Visit the portal', method: 'GET', url: '/v1/portal' },
            ]));
        } catch (err) {
            logger.error('Setup init failed', errorFields(err));
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Setup failed. Please try again.'));
        }
    });

    return router;
}
