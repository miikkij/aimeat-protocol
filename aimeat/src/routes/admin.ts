/**
 * @file src/routes/admin.ts
 * @description Top-level admin router — operator authentication (timing-safe password, ephemeral
 *   in-memory sessions) and composition of the domain-split admin sub-routers.
 *
 * @structure
 *   - adminRouter(config, storage, maintenanceCache?, provenance?, consulService?, peers?): mounts sub-routers
 *   - verifyAdminPassword / adminSessions / create+validateAdminSession: in-memory 1h operator sessions
 *   - imports adminConfig/Monitoring/Agents/Maintenance/Economy/Memory sub-routers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Extract ADMIN_LOGIN_HTML / ADMIN_SETUP_HTML to ./admin/setup-html.ts (max-file-lines)
 *   v1.2.0 — 2026-07-16 — GET /v1/admin/owners rosters via getAgentsByOwners (one IN, was per-owner)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { generateKeyPair, sign } from '../auth/keypair.js';
import { validateOwnerName } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { generateOtk } from '../utils/otk.js';
// i18n imports removed — admin UI is now a client-side SPA
// admin-dashboard.ts SSR removed — admin UI is now a SPA at /v1/admin
import { hashPassword } from '../services/password.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import { emitChange } from '../services/event-bus.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sub-routers (domain-split from admin.ts)
import { adminConfigRouter } from './admin-config.js';
import { adminMonitoringRouter } from './admin-monitoring.js';
import { adminAgentsRouter } from './admin-agents.js';
import { adminMaintenanceRouter } from './admin-maintenance.js';
import { adminEconomyRouter } from './admin-economy.js';
import { adminMemoryRouter } from './admin-memory.js';
import { validatePasswordStrength } from '../utils/password-validation.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { ADMIN_LOGIN_HTML, ADMIN_SETUP_HTML } from './admin/setup-html.js';
import { logger } from '../utils/logger.js';

export function adminRouter(
    config: AimeatConfig,
    storage: Storage,
    maintenanceCache?: {
        get: () => import('../storage/interface.js').MaintenanceState;
        set: (state: import('../storage/interface.js').MaintenanceState) => void;
    },
    provenance?: ConfigProvenance,
    consulService?: ConsulConfigService | null,
    peers?: Map<string, import('../services/federation.js').PeerInfo>,
): Router {
    const router = Router();

    function verifyAdminPassword(input: string, expected: string): boolean {
        if (!expected || !input) return false;
        const a = Buffer.from(input);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    }

    // ── Admin session management (in-memory, ephemeral) ──
    const adminSessions = new Map<string, { createdAt: number }>();
    const ADMIN_SESSION_TTL = 3600_000; // 1 hour

    function createAdminSession(): string {
        const sessionId = randomBytes(32).toString('hex');
        adminSessions.set(sessionId, { createdAt: Date.now() });
        return sessionId;
    }

    function validateAdminSession(sessionId: string): boolean {
        const session = adminSessions.get(sessionId);
        if (!session) return false;
        if (Date.now() - session.createdAt > ADMIN_SESSION_TTL) {
            adminSessions.delete(sessionId);
            return false;
        }
        return true;
    }

    /** Parse a named cookie from the raw Cookie header */
    function getCookie(req: import('express').Request, name: string): string | undefined {
        const header = req.headers.cookie;
        if (!header) return undefined;
        const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
        return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
    }

    /** Inject CSP nonce attributes into all <script> and <style> tags in an HTML string */
    function injectCspNonce(html: string, res: import('express').Response): string {
        const nonce = res.locals.cspNonce as string || '';
        if (!nonce) return html;
        return html
            .replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`)
            .replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
    }

    // ── Admin Setup Pages (password-protected, no JWT needed) ──

    /** Set the admin session cookie on a response */
    function setSessionCookie(res: import('express').Response, sessionId: string): void {
        const isHttps = config.baseUrl?.startsWith('https://');
        res.setHeader('Set-Cookie',
            `admin_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/v1/admin; Max-Age=3600${isHttps ? '; Secure' : ''}`);
    }

    // POST /v1/admin/setup/auth — authenticate with admin password, get session cookie
    const adminAuthLimit = rateLimit({ max: config.adminAuthRateLimitMax, windowMs: config.adminAuthRateLimitWindowMs });
    router.post('/v1/admin/setup/auth', adminAuthLimit, (req, res) => {
        const pw = (req.headers['x-admin-password'] as string) ?? req.body?.admin_password ?? '';
        if (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword)) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }
        const sessionId = createAdminSession();
        setSessionCookie(res, sessionId);
        res.json({ ok: true, session_id: sessionId });
    });

    // GET /v1/admin/setup — setup wizard (password never embedded in HTML)
    router.get('/v1/admin/setup', (req, res) => {
        // Check if already authenticated via session cookie
        const sessionId = getCookie(req, 'admin_session');
        if (sessionId && validateAdminSession(sessionId)) {
            res.type('text/html').send(injectCspNonce(ADMIN_SETUP_HTML.replace(/\{\{NODE_ID\}\}/g, config.nodeId), res));
            return;
        }
        // Show login page (no password embedded anywhere)
        res.type('text/html').send(injectCspNonce(ADMIN_LOGIN_HTML, res));
    });

    // POST /v1/admin/setup/register — register owner (password-protected, no auth)
    router.post('/v1/admin/setup/register', adminAuthLimit, async (req, res) => {
        // Check admin session (cookie or header) or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword))) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
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

        const keyPair = await generateKeyPair();
        // Setup wizard is admin-password-protected — always grant operator
        const roles = ['owner', 'operator'];

        const owner = await storage.createOwner({
            name,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Always create GHII profile (required for single-balance economy)
        let hasPassword = false;
        const ghii = `${name}@${config.nodeId}`;
        const now = new Date().toISOString();
        const existingGhii = await storage.getGHIIByOwner(name);
        if (!existingGhii) {
            let passwordHash: string | undefined;
            if (password && typeof password === 'string') {
                const pwErr = validatePasswordStrength(password);
                if (pwErr) {
                    res.status(400).json({ ok: false, error: pwErr });
                    return;
                }
                passwordHash = await hashPassword(password);
            }
            if (passwordHash) hasPassword = true;
            try {
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
            // eslint-disable-next-line aimeat/no-silent-catch -- GHII record may already exist
            } catch { /* GHII record may already exist */ }
        } else {
            hasPassword = !!existingGhii.passwordHash;
        }

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey, has_password: hasPassword });
        emitChange('config');
    });

    // POST /v1/admin/setup/token — sign + get JWT for an owner (password-protected)
    router.post('/v1/admin/setup/token', adminAuthLimit, async (req, res) => {
        // Check admin session (cookie or header) or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword))) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { owner: ownerName, private_key } = req.body ?? {};
        if (!ownerName || !private_key) {
            res.status(400).json({ ok: false, error: 'owner and private_key are required' });
            return;
        }

        const ownerRecord = await storage.getOwner(ownerName);
        if (!ownerRecord) {
            res.status(404).json({ ok: false, error: `Owner not found: ${ownerName}` });
            return;
        }

        const timestamp = new Date().toISOString();
        const message = ownerName + config.nodeId + timestamp;
        const signature = await sign(private_key, message);

        // Verify signature matches stored public key (sanity check)
        const { verify: ed25519Verify } = await import('../auth/keypair.js');
        const valid = await ed25519Verify(ownerRecord.publicKey, message, signature);
        if (!valid) {
            res.status(401).json({ ok: false, error: 'Private key does not match the owner\'s public key' });
            return;
        }

        const token = await issueJWT({
            sub: ownerName,
            owner: ownerName,
            node: config.nodeId,
            roles: [...ownerRecord.roles],
        }, config.jwtTtlSeconds);

        res.json({
            ok: true,
            token,
            expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
            roles: ownerRecord.roles,
            dashboard_url: '/v1/admin',
        });
    });

    // POST /v1/admin/setup/initial-otk — generate an Initial OTK (password-protected)
    router.post('/v1/admin/setup/initial-otk', adminAuthLimit, async (req, res) => {
        // Check admin session or password via header (NOT query param)
        const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
        const pw = (req.headers['x-admin-password'] as string) ?? '';
        if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword))) {
            res.status(401).json({ ok: false, error: 'Invalid admin password' });
            return;
        }

        const { owner } = req.body ?? {};
        if (!owner || typeof owner !== 'string') {
            res.status(400).json({ ok: false, error: 'owner name is required' });
            return;
        }

        // Find agent or use owner as identity
        const agents = await storage.getAgentsByOwner(owner);
        const ownerGaii = agents.length > 0 ? agents[0].gaii : owner;

        const key = generateOtk();
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

        await storage.createOtk({
            key,
            ownerGaii,
            action: 'initial',
            params: {},
            expiresAt: farFuture,
            initial: true,
            used: false,
            usedAt: null,
            sessionId: null,
            createdAt: new Date().toISOString(),
        });

        res.json({
            ok: true,
            otk: key,
            initial: true,
            owner: ownerGaii,
            grace_ms: config.otkGraceMs,
            dev_mode: config.devMode,
            node_url: config.baseUrl,
            note: `Initial OTK — no expiry until first use. After first use, valid for ${config.otkGraceMs / 1000}s.`,
        });
    });

    // GET /v1/admin/dashboard — node overview (operator only)
    router.get('/v1/admin/dashboard', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();
        const chatInstances = await storage.listChatInstances({});
        const allWork = await storage.listAllWork();
        const allDisputes = await storage.listAllDisputes();

        let totalMorsels = 0;
        let activeAgents = 0;
        const now = Date.now();
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);

        for (const a of agents) {
            totalMorsels += a.morselBalance;
            if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) {
                activeAgents++;
            }
        }

        // §14.2 / §14.3: Compute full economy metrics from transaction history
        const allTx = await storage.listAllTransactions();
        const thirtyDaysAgo = new Date(now - 30 * 86_400_000);

        let totalMinted = 0;
        let totalBurned = 0;
        let minted30d = 0;
        let burned30d = 0;
        // Daily metrics (§14.2)
        let transactionsToday = 0;
        let morselsTransactedToday = 0;
        let networkFeesToday = 0;
        let burnedToday = 0;
        let dailyAllowancesIssuedToday = 0;
        // Commerce / marketplace sales (TARGET-033): every morsel sale flow's spend leg + the fee leg.
        const SALE_SPEND_TYPES = new Set(['commerce_spend', 'offer_spend', 'org_offer_spend', 'app_purchase']);
        let salesVolumeAllTime = 0;
        let salesVolumeToday = 0;
        let operatorFeesAllTime = 0;
        let operatorFeesToday = 0;

        for (const tx of allTx) {
            const txDate = new Date(tx.timestamp);
            const isToday = txDate >= dayStart;

            if (tx.type === 'mint' || tx.type === 'welcome_bonus' || tx.type === 'daily_allowance') {
                totalMinted += tx.amount;
                if (txDate >= thirtyDaysAgo) minted30d += tx.amount;
            }
            if (tx.type === 'burn') {
                totalBurned += Math.abs(tx.amount);
                if (txDate >= thirtyDaysAgo) burned30d += Math.abs(tx.amount);
            }
            if (SALE_SPEND_TYPES.has(tx.type)) {
                salesVolumeAllTime += Math.abs(tx.amount);
                if (isToday) salesVolumeToday += Math.abs(tx.amount);
            }
            if (tx.type === 'marketplace_fee') {
                operatorFeesAllTime += tx.amount;
                if (isToday) operatorFeesToday += tx.amount;
            }

            // Daily aggregations
            if (isToday) {
                transactionsToday++;
                morselsTransactedToday += Math.abs(tx.amount);
                if (tx.type === 'network_fee') networkFeesToday += Math.abs(tx.amount);
                if (tx.type === 'burn') burnedToday += Math.abs(tx.amount);
                if (tx.type === 'daily_allowance') dailyAllowancesIssuedToday++;
            }
        }

        // Checkout-session lifecycle counts (commerce.session.* memory records, buyer-side truth) +
        // real-money (EUR/USD) volume per currency, kept entirely separate from morsels.
        const sessionCounts = { open: 0, completed: 0, cancelled: 0, expired: 0, total: 0 };
        const moneyVolume: Record<string, number> = {};   // completed money-sale gross, by currency
        const operatorMoneyFees: Record<string, number> = {}; // operator's platform-fee cut, by currency
        try {
            const { items: sessionRecs } = await storage.listAllMemory({ prefix: 'commerce.session.', limit: 2000 });
            for (const r of sessionRecs) {
                const v = r.value as { status?: string; currency?: string; total?: number } | undefined;
                const status = v?.status ?? 'open';
                if (status in sessionCounts) sessionCounts[status as keyof typeof sessionCounts]++;
                sessionCounts.total++;
                if (status === 'completed' && v?.currency && v.currency !== 'morsel') {
                    moneyVolume[v.currency] = (moneyVolume[v.currency] ?? 0) + (v.total ?? 0);
                }
            }
            // Operator platform-fee records for money sales (commerce.platform-fee.*).
            const { items: feeRecs } = await storage.listAllMemory({ prefix: 'commerce.platform-fee.', limit: 2000 });
            for (const r of feeRecs) {
                const v = r.value as { fee?: number; currency?: string } | undefined;
                if (v?.currency && v.fee) operatorMoneyFees[v.currency] = (operatorMoneyFees[v.currency] ?? 0) + v.fee;
            }
        } catch (err) { logger.warn('GET /v1/admin/dashboard: commerce metrics must never break the dashboard', { error: String(err) }); }

        // Inflation rate = net new morsels over 30d as % of current supply
        const netNew30d = minted30d - burned30d;
        const inflationRate30d = totalMorsels > 0
            ? parseFloat(((netNew30d / totalMorsels) * 100).toFixed(2))
            : 0;
        const burnMintRatio = minted30d > 0
            ? parseFloat((burned30d / minted30d).toFixed(4))
            : 0;

        // §14.3: Health thresholds (Table 14.3)
        // Compute rates for threshold evaluation
        const recentWork30d = allWork.filter(w => new Date(w.createdAt) >= thirtyDaysAgo);
        const expiredWork30d = recentWork30d.filter(w => w.status === 'expired' || (w.status === 'pending' && new Date(w.ttlExpiresAt) < new Date()));
        const workExpiryRate = recentWork30d.length > 0
            ? parseFloat((expiredWork30d.length / recentWork30d.length).toFixed(4))
            : 0;

        const recentDisputes30d = allDisputes.filter(d => new Date(d.createdAt) >= thirtyDaysAgo);
        const disputeRate = recentWork30d.length > 0
            ? parseFloat((recentDisputes30d.length / recentWork30d.length).toFixed(4))
            : 0;

        // Agent churn: agents created in last 30d that have no work
        const newAgents30d = agents.filter(a => new Date(a.createdAt) >= thirtyDaysAgo);
        const churned30d = newAgents30d.filter(a =>
            !a.lastSeen || (now - new Date(a.lastSeen).getTime() > 7 * 86_400_000)
        );
        const agentChurnRate = newAgents30d.length > 0
            ? parseFloat((churned30d.length / newAgents30d.length).toFixed(4))
            : 0;

        type HealthZone = 'healthy' | 'watch' | 'danger';
        const warnings: { metric: string; zone: HealthZone; value: number; threshold: string; message: string }[] = [];

        function evaluateThreshold(metric: string, value: number, watchMin: number, dangerMin: number, direction: 'above' | 'below'): HealthZone {
            let zone: HealthZone = 'healthy';
            if (direction === 'above') {
                if (value >= dangerMin) zone = 'danger';
                else if (value >= watchMin) zone = 'watch';
            } else {
                if (value <= dangerMin) zone = 'danger';
                else if (value <= watchMin) zone = 'watch';
            }
            if (zone !== 'healthy') {
                warnings.push({
                    metric,
                    zone,
                    value,
                    threshold: `${direction === 'above' ? '>=' : '<='} ${zone === 'danger' ? dangerMin : watchMin} (${zone})`,
                    message: `${metric} is ${value} — ${zone} zone`,
                });
            }
            return zone;
        }

        // Thresholds per RFC Table 14.3
        const bmrZone = evaluateThreshold('burn_mint_ratio', burnMintRatio, 0, 0.1, 'below');
        const churnZone = evaluateThreshold('agent_churn_rate_30d', agentChurnRate, 0.3, 0.5, 'above');
        const expiryZone = evaluateThreshold('work_expiry_rate_30d', workExpiryRate, 0.1, 0.25, 'above');
        const disputeZone = evaluateThreshold('dispute_rate_30d', disputeRate, 0.05, 0.15, 'above');

        // Overall health = worst zone
        const zones: HealthZone[] = [bmrZone, churnZone, expiryZone, disputeZone];
        const overallHealth: HealthZone = zones.includes('danger') ? 'danger' : zones.includes('watch') ? 'watch' : 'healthy';

        res.json(success(config.nodeId, {
            node_id: config.nodeId,
            uptime_seconds: Math.floor(process.uptime()),
            storage_type: config.storageProvider,
            health: {
                status: overallHealth,
                burn_mint_ratio: { value: burnMintRatio, zone: bmrZone },
                agent_churn_rate_30d: { value: agentChurnRate, zone: churnZone },
                work_expiry_rate_30d: { value: workExpiryRate, zone: expiryZone },
                dispute_rate_30d: { value: disputeRate, zone: disputeZone },
            },
            warnings,
            counts: {
                owners: owners.length,
                agents: agents.length,
                active_agents_24h: activeAgents,
                actions: actions.length,
                boards: boards.length,
                chat_instances: chatInstances.length,
            },
            economy: {
                total_morsels_in_circulation: totalMorsels,
                total_minted_all_time: totalMinted,
                total_burned_all_time: totalBurned,
                inflation_rate_30d_percent: inflationRate30d,
                burn_mint_ratio: burnMintRatio,
                transactions_today: transactionsToday,
                morsels_transacted_today: morselsTransactedToday,
                network_fees_today: networkFeesToday,
                burned_today: burnedToday,
                daily_allowances_issued_today: dailyAllowancesIssuedToday,
                welcome_bonus: config.welcomeBonus,
                daily_allowance: config.dailyAllowance,
                daily_allowance_cap: config.dailyAllowanceCap,
                burn_rate: config.burnRate,
                max_operator_mint_per_day: config.maxOperatorMintPerDay,
                commerce: {
                    enabled: config.commerceEnabled,
                    fee_mode: config.marketplaceFeeMode,
                    fee_percent: config.commerceFeePercent ?? config.marketplaceTransactionFeePercent,
                    checkout_sessions: sessionCounts,
                    sales_volume_all_time: salesVolumeAllTime,
                    sales_volume_today: salesVolumeToday,
                    operator_fees_all_time: operatorFeesAllTime,
                    operator_fees_today: operatorFeesToday,
                    // Real-money commerce (minor units per ISO currency), separate from morsels.
                    money_volume: moneyVolume,
                    operator_money_fees: operatorMoneyFees,
                },
            },
            config: {
                port: config.port,
                jwt_ttl_seconds: config.jwtTtlSeconds,
                keyed_browse_enabled: config.keyedBrowseEnabled,
            },
            ...(config.personalNodesEnabled ? await (async () => {
                const personalNodes = await storage.listPersonalNodes();
                let mailboxTotalBytes = 0;
                const statusCounts = { online: 0, offline: 0, degraded: 0, detached: 0 };
                for (const pn of personalNodes) {
                    statusCounts[pn.status] = (statusCounts[pn.status] ?? 0) + 1;
                    const stats = await storage.getMailboxStats(pn.nodeId);
                    mailboxTotalBytes += stats.totalBytes;
                }
                return {
                    personal_nodes: {
                        total: personalNodes.length,
                        max_slots: config.personalNodeMaxSlots,
                        ...statusCounts,
                        mailbox_total_bytes: mailboxTotalBytes,
                    },
                };
            })() : {}),
        }, [
            { description: 'View all agents', method: 'GET', url: '/v1/agents' },
            { description: 'Update config', method: 'PUT', url: '/v1/admin/config' },
        ]));
    });

    // GET /v1/admin/owners — full owners list with roles
    router.get('/v1/admin/owners', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agentsByOwner = await storage.getAgentsByOwners(owners.map(o => o.name));
        const result = owners.map(o => ({
            name: o.name,
            display_name: o.displayName,
            roles: o.roles,
            agents: (agentsByOwner[o.name] ?? []).map(a => ({ gaii: a.gaii, display_name: a.displayName, trust_score: a.trustScore })),
            created_at: o.createdAt,
        }));
        res.json(success(config.nodeId, { owners: result }));
    });

    // GET /v1/admin/ui — legacy URL, redirect to SPA
    router.get('/v1/admin/ui', (_req, res) => {
        res.redirect(301, '/v1/admin');
    });

    // GET /v1/admin/translations — serve locale JSON for admin dashboard
    router.get('/v1/admin/translations', requireAuth(), requireRole('operator'), (req, res) => {
        const lang = (req.query.lang as string) ?? 'en';
        const safeLang = lang.replace(/[^a-z]/gi, '').slice(0, 5) || 'en';
        try {
            const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../locales');
            const data = JSON.parse(readFileSync(resolve(localesDir, `${safeLang}.json`), 'utf8'));
            const dashboard = data.dashboard ?? {};
            res.json(success(config.nodeId, { locale: safeLang, translations: dashboard }));
        } catch {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Locale "${safeLang}" not found`));
        }
    });

    // POST /v1/admin/seed-examples — seed example packages into the system
    // Accepts either: JWT (operator role) OR admin password via x-admin-password header
    router.post('/v1/admin/seed-examples', async (req, res) => {
        // Auth: JWT operator OR admin password
        // System-seeded packages always use 'system' as author so they don't
        // appear in users' "my packages" lists.  Templates still show them.
        const operator = 'system';
        const operatorGhii = 'system';

        // Auth: JWT operator OR admin password
        if (req.auth?.sub && req.auth.roles?.includes('operator')) {
            // OK — operator JWT
        } else {
            // Check admin password
            const sessionId = getCookie(req, 'admin_session') ?? (req.headers['x-admin-session'] as string);
            const pw = (req.headers['x-admin-password'] as string) ?? '';
            if (!(sessionId && validateAdminSession(sessionId)) && (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword))) {
                res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Requires operator JWT or admin password'));
                return;
            }
        }

        try {
            const { getExamplePackages, buildRecords } = await import('../data/example-packages.js');
            const examples = getExamplePackages();

            const results: { name: string; packageGroupId: string; templateId: string }[] = [];

            for (const def of examples) {
                const groupId = `${def.name}::${operator}`;

                // Archive existing package versions and delete listing for this group (reseed)
                const { packages: existingPkgs } = await storage.listPackages({ author: operator, search: def.name, limit: 100, offset: 0 });
                for (const oldPkg of existingPkgs.filter(p => p.packageGroupId === groupId)) {
                    await storage.archivePackage(oldPkg.id);
                }
                try {
                    const oldListing = await storage.getListingByPackage(groupId);
                    if (oldListing) await storage.deleteTemplateListing(oldListing.id);
                // eslint-disable-next-line aimeat/no-silent-catch -- no listing to delete
                } catch { /* no listing to delete */ }

                const { pkg, listing } = buildRecords(def, operator, operatorGhii);
                await storage.createPackage(pkg);
                await storage.createTemplateListing(listing);
                results.push({ name: def.name, packageGroupId: pkg.packageGroupId, templateId: listing.id });
            }

            emitChange('packages');
            res.json(success(config.nodeId, { seeded: results }));
        } catch (e) {
            res.status(500).json(error(config.nodeId, 'SEED_FAILED', e instanceof Error ? e.message : 'Seed failed'));
        }
    });

    // ── Mount domain sub-routers ──
    router.use(adminConfigRouter(config, storage, provenance, consulService));
    router.use(adminMonitoringRouter(config, storage, peers));
    router.use(adminAgentsRouter(config, storage));
    router.use(adminMaintenanceRouter(config, storage, maintenanceCache));
    router.use(adminEconomyRouter(config, storage));
    router.use(adminMemoryRouter(config, storage));

    return router;
}
