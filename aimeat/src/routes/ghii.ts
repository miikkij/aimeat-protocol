/**
 * @file src/routes/ghii.ts
 * @description GHII (Global Human Intelligence Identifier) routes — the human identity layer on top
 *   of AIMEAT's owner system (GHII format username@nodeId): registration, password/federated/social
 *   login, email verification, magic link, password reset, account recovery, and legacy-account
 *   email completion during sign-in. Operators are owners with role ['owner','operator']; GHII users
 *   are owners with role ['owner'] plus a GHII profile.
 *
 * @structure
 *   - ghiiRouter(config, storage, emailService, onDirectoryChange, peers): registers all /v1/ghii/* routes
 *   - Route handlers live in sibling modules under ./ghii/ (registered in original order):
 *     - ghii/register-login.ts — POST /v1/ghii, /v1/ghii/login, /v1/ghii/login/attach-email
 *     - ghii/web-verify.ts — /v1/ghii/register-web, /verify-email, /magic-link, /magic-link/verify
 *     - ghii/recovery.ts — /v1/ghii/email/*, /password/*, /account/recover
 *     - ghii/profile.ts — /v1/ghii/list, /directory, /cors, /me, /:ghii, PUT, DELETE
 *
 * @usage app.use(ghiiRouter(config, storage, emailService)) from server.ts
 *
 * @version-history
 *   v1.2.0 — 2026-07-13 — Split route handlers into sibling modules under ./ghii/ (max-file-lines);
 *     pure extraction, registration order + behavior preserved.
 *   v1.1.0 — 2026-07-08 — Added POST /v1/ghii/login/attach-email — legacy/unverified accounts (correct
 *     password but verificationLevel < 1) can attach + verify an email during sign-in; the login gate
 *     returns { email_required, has_email } so the client can drive the completion flow.
 *   v1.0.0 — 2026-07-13 — Header standardized to @file/@description format
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EmailService } from '../services/email.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { PeerInfo } from '../services/federation.js';
import { registerRegisterLoginRoutes } from './ghii/register-login.js';
import { registerWebVerifyRoutes } from './ghii/web-verify.js';
import { registerRecoveryRoutes } from './ghii/recovery.js';
import { registerProfileRoutes } from './ghii/profile.js';

export function ghiiRouter(config: AimeatConfig, storage: Storage, emailService?: EmailService, onDirectoryChange?: () => void, peers?: Map<string, PeerInfo>): Router {
    const router = Router();

    // Shared registration rate limiter — one instance across POST /v1/ghii and
    // POST /v1/ghii/register-web so both paths share the same counter.
    const registrationLimit = rateLimit({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs });

    registerRegisterLoginRoutes(router, config, storage, emailService, peers, registrationLimit);
    registerWebVerifyRoutes(router, config, storage, emailService, onDirectoryChange, registrationLimit);
    registerRecoveryRoutes(router, config, storage, emailService);
    registerProfileRoutes(router, config, storage, onDirectoryChange);

    return router;
}
