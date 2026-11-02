/**
 * @file src/routes/admin/setup-register.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/admin/setup/register: the admin password's one job, creating the node's FIRST
 *   operator. Moved out of routes/admin.ts unchanged on 2026-11-02, when the setup-code check below
 *   would have put that file past the 800-line limit.
 *
 *   THE SETUP CODE. Every other route that makes the first operator (POST /v1/setup/init, the
 *   registration routes, an identity provider's first sign-in, the self-heal) asks for the one-time
 *   code the start log prints while the node has no operator (services/setup-code.ts). This route
 *   asked only for the admin password, so on a node others can reach, whoever held that password
 *   before the operator existed took the role without the code (IT adoption review, 2026-11-01;
 *   Jouni, 2026-11-02). It now asks for the code the same way, through claimOperatorSetupCode: not
 *   from this machine to a loopback node (local development, the E2E runner, `pnpm sandbox`), and not
 *   once an operator exists. The code is checked and taken before any write, spent when the operator
 *   is written, and put back when the write fails. A provisioner that sets up a node from outside reads
 *   the code from the node's start log and sends it as `setupCode`.
 * @structure registerSetupRegisterRoute(router, deps) — the route, with the admin check passed in
 * @usage registerSetupRegisterRoute(router, { config, storage, rateLimiter: adminAuthLimit, isAdmin });
 * @version-history
 *   v1.1.0 -- 2026-11-02 -- On a node without an operator, the one-time setup code as on every other
 *     first-operator route (SETUP_CODE_REQUIRED, SETUP_CODE_INVALID), unless the request comes from this
 *     machine to a loopback node.
 *   v1.0.0 -- 2026-11-02 -- Moved from routes/admin.ts unchanged.
 */
import type { Router, Request, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { validateOwnerName } from '../../utils/gaii.js';
import { hashPassword } from '../../services/password.js';
import { emitChange } from '../../services/event-bus.js';
import { validatePasswordStrength } from '../../utils/password-validation.js';
import { logger } from '../../utils/logger.js';
import { isOperatorAccount } from '../../utils/operator-account.js';
import { adminSetupSecretDir, removeAdminSetupSecretFile } from '../../services/admin-setup-secret.js';
import { claimOperatorSetupCode, SetupCodeRefusedError } from '../../services/owner-provisioning.js';
import { requestFromThisMachine } from '../../services/setup-code.js';

export interface SetupRegisterDeps {
    config: AimeatConfig;
    storage: Storage;
    rateLimiter: RequestHandler;
    /** The admin session (cookie or header) or the admin password in its header, as routes/admin.ts checks it. */
    isAdmin: (req: Request) => boolean;
}

export function registerSetupRegisterRoute(router: Router, deps: SetupRegisterDeps): void {
    const { config, storage, rateLimiter, isAdmin } = deps;

    // POST /v1/admin/setup/register — register owner (password-protected, no auth)
    router.post('/v1/admin/setup/register', rateLimiter, async (req, res) => {
        // Check admin session (cookie or header) or password via header (NOT query param)
        if (!isAdmin(req)) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        // The admin password creates the FIRST operator and nothing after it. Until 2026-10-09 this
        // route created an operator for anyone holding the password for the life of the process,
        // and a node without AIMEAT_ADMIN_PASSWORD wrote its generated password to stderr, so
        // reading the server log was enough to become an operator (secrets audit 2026-10-09, 1.4).
        // Refused before any write. The setting keeps the old behaviour for test nodes, whose
        // suites register several operators with the password.
        if (!config.adminSetupOpenAfterFirstOperator && (await storage.listOwners()).some(isOperatorAccount)) {
            res.status(410).json(error(config.nodeId, 'SETUP_CLOSED',
                'This node already has an operator, so setup registration is closed. '
                + 'The new person creates an ordinary account (POST /v1/ghii), and an operator grants it the operator role '
                + 'on the admin Owners page (/v1/admin?tab=owners, Grant operator) or with POST /v1/admin/roles/grant.'));
            return;
        }

        const { name, display_name, password } = req.body ?? {};
        if (!name || typeof name !== 'string') {
            res.status(400).json({ ok: false, error: 'name is required' });
            return;
        }

        const nameError = validateOwnerName(name);
        if (nameError) {
            res.status(400).json({ ok: false, error: nameError });
            return;
        }

        const existing = await storage.getOwner(name);
        if (existing) {
            res.status(409).json({ ok: false, error: `Owner "${name}" already exists` });
            return;
        }

        // Refuse before you write: until 2026-09-08 the owner row was created first and the
        // password judged after, so a weak password answered 400 and left a half-made account
        // behind with the name taken (e2e-admin-doors-2). The strength check comes first now.
        // The password is required: the account-key sign-in was removed in 4.0.0, so an account
        // made here without one had no way to sign in (secaudit2026oct22; Jouni, 2026-10-23).
        if (typeof password !== 'string' || password.length === 0) {
            res.status(400).json({ ok: false, error: 'password is required: the new operator signs in with the name and this password (POST /v1/ghii/login).' });
            return;
        }
        const pwErr = validatePasswordStrength(password);
        if (pwErr) {
            res.status(400).json({ ok: false, error: pwErr });
            return;
        }

        // Setup wizard is admin-password-protected — always grant operator
        const roles = ['owner', 'operator'];

        // The one-time setup code, as on every other route that makes the first operator: checked and
        // taken here, before any write (header above).
        let claim;
        try {
            claim = await claimOperatorSetupCode(storage, config, roles, req.body?.setupCode, requestFromThisMachine(req));
        } catch (err) {
            if (err instanceof SetupCodeRefusedError) {
                res.status(403).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }

        const keyPair = await generateKeyPair();

        // Always create GHII profile (required for single-balance economy)
        let hasPassword = false;
        const ghii = `${name}@${config.nodeId}`;
        const now = new Date().toISOString();
        const existingGhii = await storage.getGHIIByOwner(name);
        let passwordHash: string | undefined;
        if (!existingGhii && password && typeof password === 'string') {
            passwordHash = await hashPassword(password);
        }
        // The owner row, the GHII profile and the welcome bonus commit together or not at all. The
        // profile write had its error swallowed, so a failure left an operator account with no
        // profile and no password (QA audit E6-02); now the whole request fails and can be retried.
        let owner;
        try {
            owner = await storage.transaction(async () => {
                const created = await storage.createOwner({
                    name,
                    displayName: display_name,
                    publicKey: keyPair.publicKey,
                    roles,
                    createdAt: now,
                });
                if (!existingGhii) {
                    if (passwordHash) hasPassword = true;
                    await storage.createGHII({
                        username: name,
                        nodeId: config.nodeId,
                        ghii,
                        displayName: display_name ?? name,
                        passwordHash,
                        verificationLevel: 0,
                        ownerName: name,
                        totpEnabled: false,
                        morselBalance: config.welcomeBonus,
                        createdAt: now,
                        updatedAt: now,
                    });
                    // Record welcome bonus transaction
                    await storage.addTransaction({
                        id: `tx-${randomUUID()}`,
                        gaii: ghii,
                        type: 'welcome_bonus',
                        amount: config.welcomeBonus,
                        timestamp: now,
                    });
                } else {
                    hasPassword = !!existingGhii.passwordHash;
                }
                return created;
            });
        } catch (err) {
            claim.release();
            throw err;
        }
        claim.commit();

        // The node has an owner now, so the boot's secret file has done its job (services/admin-setup-secret.ts).
        try {
            removeAdminSetupSecretFile(adminSetupSecretDir(config));
        } catch (err) {
            logger.warn('setup/register: the admin-setup-secret file could not be deleted', { error: String(err) });
        }

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey, has_password: hasPassword });
        emitChange('config');
    });
}
