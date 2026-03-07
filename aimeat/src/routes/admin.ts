import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { listHooks } from '../services/hooks.js';
import type { HookName } from '../config.js';
import { RoleGrantSchema, validateBody } from '../models/schemas.js';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, sign } from '../auth/keypair.js';
import { validateOwnerName, buildGAII } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { generateOtk } from '../utils/otk.js';
// i18n imports removed — admin UI is now a client-side SPA
// admin-dashboard.ts SSR removed — admin UI is now a SPA at /v1/admin
import { hashPassword } from '../services/password.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP, DOT_PATH_TO_ENV, serializeConfigValue } from '../services/config-schema.js';
import type { ConfigProvenance } from '../services/config-provenance.js';

export function adminRouter(
    config: AimeatConfig,
    storage: Storage,
    maintenanceCache?: {
        get: () => import('../storage/interface.js').MaintenanceState;
        set: (state: import('../storage/interface.js').MaintenanceState) => void;
    },
    provenance?: ConfigProvenance,
): Router {
    const router = Router();

    // ── Admin Setup Pages (password-protected, no JWT needed) ──

    function checkSetupPassword(req: import('express').Request, res: import('express').Response): boolean {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
            res.status(401).type('text/html').send(ADMIN_LOGIN_HTML);
            return false;
        }
        return true;
    }

    // GET /v1/admin/setup — setup wizard (register owner + get token)
    router.get('/v1/admin/setup', (req, res) => {
        if (!checkSetupPassword(req, res)) return;
        res.type('text/html').send(ADMIN_SETUP_HTML.replace(/\{\{PW\}\}/g, config.adminPassword!).replace(/\{\{NODE_ID\}\}/g, config.nodeId));
    });

    // POST /v1/admin/setup/register — register owner (password-protected, no auth)
    router.post('/v1/admin/setup/register', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
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
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        // Setup wizard is admin-password-protected — always grant operator
        const roles = ['owner', 'operator'];

        const owner = await storage.createOwner({
            name,
            displayName: display_name,
            publicKey: keyPair.publicKey,
            roles,
            createdAt: new Date().toISOString(),
        });

        // Create GHII profile if password provided (human-friendly login)
        let hasPassword = false;
        if (password && typeof password === 'string' && password.length >= 4) {
            const passwordHash = await hashPassword(password);
            const ghii = `${name}@${config.nodeId}`;
            const now = new Date().toISOString();
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
                    createdAt: now,
                    updatedAt: now,
                });
                hasPassword = true;
            } catch { /* GHII record may already exist */ }
        }

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey, has_password: hasPassword });
    });

    // POST /v1/admin/setup/token — sign + get JWT for an owner (password-protected)
    router.post('/v1/admin/setup/token', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
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
    router.post('/v1/admin/setup/initial-otk', async (req, res) => {
        const pw = (req.query.pw as string) ?? (req.headers['x-admin-password'] as string) ?? '';
        if (!config.adminPassword || pw !== config.adminPassword) {
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

            // Daily aggregations
            if (isToday) {
                transactionsToday++;
                morselsTransactedToday += Math.abs(tx.amount);
                if (tx.type === 'network_fee') networkFeesToday += Math.abs(tx.amount);
                if (tx.type === 'burn') burnedToday += Math.abs(tx.amount);
                if (tx.type === 'daily_allowance') dailyAllowancesIssuedToday++;
            }
        }

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
            storage_type: config.dbUrl ? 'mongodb' : 'in-memory',
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

    // GET /v1/admin/ui — legacy URL, redirect to SPA
    router.get('/v1/admin/ui', (_req, res) => {
        res.redirect(301, '/v1/admin');
    });

    // GET /v1/admin/work — list all work items (operator only)
    router.get('/v1/admin/work', requireAuth(), requireRole('operator'), async (_req, res) => {
        const allWork = await storage.listAllWork();
        res.json(success(config.nodeId, {
            work: allWork.map(w => ({
                tracking_code: w.trackingCode,
                status: w.status,
                action_id: w.actionId,
                provider_gaii: w.providerGaii,
                requester_gaii: w.requesterGaii,
                cost: w.cost,
                created_at: w.createdAt,
                updated_at: w.updatedAt,
                ttl_expires_at: w.ttlExpiresAt,
            })),
            total: allWork.length,
        }));
    });

    // GET /v1/admin/federation — federation info (operator only)
    router.get('/v1/admin/federation', requireAuth(), requireRole('operator'), async (_req, res) => {
        const peers = await storage.listPeeringRequests();
        res.json(success(config.nodeId, {
            peers: peers.map(p => ({
                id: p.id,
                from_node_url: p.fromNodeUrl,
                from_node_id: p.fromNodeId,
                target_url: p.targetUrl,
                status: p.status,
                message: p.message,
                created_at: p.createdAt,
            })),
            total: peers.length,
        }));
    });

    // GET /v1/admin/config — full config schema with types, ranges, descriptions (§14.2)
    // Schema is built dynamically from the shared CONFIG_FIELDS definitions
    router.get('/v1/admin/config', requireAuth(), requireRole('operator'), async (_req, res) => {
        const editable = storage.supportsConfigPersistence();
        const schema: Record<string, { value: unknown; type: string; description: string; range?: string; mutable: boolean; editable: boolean; path: string }> = {};

        for (const field of CONFIG_FIELDS) {
            if (field.adminDisplay === 'hidden') continue;

            if (field.adminDisplay === 'configured') {
                // Secret fields — show as boolean indicating whether configured
                const configuredPath = `${field.dotPath}_configured`;
                schema[configuredPath] = {
                    value: !!config[field.key],
                    type: 'boolean',
                    description: `Whether ${field.description.toLowerCase().replace(' (secret)', '')} is configured (read-only secret)`,
                    mutable: false,
                    editable: false,
                    path: configuredPath,
                };
                continue;
            }

            // Normal field — show actual value
            const typeStr = field.type === 'number' ? 'integer' : field.type;
            schema[field.dotPath] = {
                value: config[field.key],
                type: typeStr,
                description: field.description,
                ...(field.range ? { range: field.range } : {}),
                mutable: !field.immutable,
                editable: editable && !field.immutable,
                path: field.dotPath,
            };
        }

        // Combined virtual field: VAPID keys configured
        schema['push.vapid_configured'] = {
            value: !!config.vapidPublicKey && !!config.vapidPrivateKey,
            type: 'boolean',
            description: 'Whether VAPID keys are configured (read-only secret)',
            mutable: false,
            editable: false,
            path: 'push.vapid_configured',
        };

        res.json(success(config.nodeId, {
            editable,
            storageType: config.storageProvider,
            note: editable ? undefined : 'In-memory storage detected. Config is read-only. Use .env or aimeat.ini to configure this node.',
            schema,
        }));
    });

    // PUT /v1/admin/config — atomic config update with dot-path addressing (§14.2, Appendix B)
    // Body format: {"changes": [{"path": "morsel_policy.daily_allowance", "value": 75}, ...]}
    // Mutable field lookup comes from the shared config-schema module (single source of truth)
    router.put('/v1/admin/config', requireAuth(), requireRole('operator'), async (req, res) => {
        // In-memory guard — config editing requires persistent storage
        if (!storage.supportsConfigPersistence()) {
            res.status(403).json(error(config.nodeId, 'READONLY_CONFIG',
                'Config editing requires a persistent database (MongoDB or SQLite). Use .env or aimeat.ini created with "aimeat init".'));
            return;
        }

        const { changes } = req.body ?? {};

        if (!Array.isArray(changes) || changes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Body must contain "changes" array with [{path, value}] entries'));
            return;
        }

        const applied: { path: string; old_value: unknown; new_value: unknown }[] = [];
        const errors: { path: string; reason: string }[] = [];

        for (const change of changes) {
            const { path, value } = change ?? {};
            if (typeof path !== 'string' || value === undefined) {
                errors.push({ path: path ?? '(missing)', reason: 'Each change must have "path" (string) and "value"' });
                continue;
            }
            const mapping = MUTABLE_CONFIG_MAP[path];
            if (!mapping) {
                errors.push({ path, reason: `Unknown or immutable config path. Valid mutable paths: ${Object.keys(MUTABLE_CONFIG_MAP).join(', ')}` });
                continue;
            }
            if (!mapping.validate(value)) {
                errors.push({ path, reason: `Invalid value for ${path}` });
                continue;
            }
            const oldValue = config[mapping.key];
            (config as any)[mapping.key] = value;
            applied.push({ path, old_value: oldValue, new_value: value });

            // Persist to database as raw string
            try {
                await storage.setConfigValue(path, serializeConfigValue(value));
                if (provenance) provenance.markDatabase([path]);
            } catch (e) {
                console.warn(`[config] Failed to persist ${path} to DB:`, e);
            }
        }

        if (applied.length === 0 && errors.length > 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid changes applied', undefined, { errors }));
            return;
        }

        res.json(success(config.nodeId, {
            applied,
            errors: errors.length > 0 ? errors : undefined,
            note: 'Config updated and persisted to database. Changes survive restart.',
        }));
    });

    // DELETE /v1/admin/config/:path — remove a DB override (revert to file/env/default)
    router.delete('/v1/admin/config/:path', requireAuth(), requireRole('operator'), async (req, res) => {
        if (!storage.supportsConfigPersistence()) {
            res.status(403).json(error(config.nodeId, 'READONLY_CONFIG',
                'Config persistence not available with in-memory storage.'));
            return;
        }

        const path = req.params.path as string;
        const field = MUTABLE_CONFIG_MAP[path];
        if (!field) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `Unknown or immutable config path: ${path}`));
            return;
        }

        await storage.deleteConfigValue(path);

        // Recalculate provenance for this field
        if (provenance) {
            const envVarName = DOT_PATH_TO_ENV[path];
            const envExists = envVarName ? process.env[envVarName] !== undefined : false;
            // File/consul checks are simplified — full detection added with file/consul wiring
            provenance.revertSource(path, envExists, false, false);
        }

        res.json(success(config.nodeId, {
            deleted: path,
            newSource: provenance?.getSource(path) ?? 'default',
            note: 'DB override removed. Value reverts to file/env/default on next restart.',
        }));
    });

    // GET /v1/admin/agents — list all agents with full details (operator only)
    router.get('/v1/admin/agents', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();

        res.json(success(config.nodeId, {
            agents: agents.map(a => ({
                gaii: a.gaii,
                owner: a.owner,
                display_name: a.displayName,
                trust_score: a.trustScore,
                morsel_balance: a.morselBalance,
                allowed_origins: a.allowedOrigins ?? null,
                created_at: a.createdAt,
                last_seen: a.lastSeen,
            })),
            total: agents.length,
        }));
    });

    // PUT /v1/admin/agents/:gaii/cors — Operator sets/clears CORS for any agent
    router.put('/v1/admin/agents/:gaii/cors', requireAuth(), requireRole('operator'), async (req, res) => {
        const gaii = req.params.gaii as string;
        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${gaii}`));
            return;
        }

        const { allowed_origins } = req.body ?? {};
        if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to clear'));
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

        const updated = await storage.updateAgent(gaii, {
            allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
        });
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update CORS settings'));
            return;
        }
        res.json(success(config.nodeId, {
            gaii: updated.gaii,
            allowed_origins: updated.allowedOrigins ?? null,
        }));
    });

    // GET /v1/admin/stats — aggregate statistics (operator only)
    router.get('/v1/admin/stats', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();
        const actions = await storage.listActions();

        const trustBuckets = { low: 0, medium: 0, high: 0 };
        for (const a of agents) {
            if (a.trustScore < 30) trustBuckets.low++;
            else if (a.trustScore < 70) trustBuckets.medium++;
            else trustBuckets.high++;
        }

        res.json(success(config.nodeId, {
            agents: {
                total: agents.length,
                trust_distribution: trustBuckets,
            },
            actions: {
                total: actions.length,
                categories: [...new Set(actions.map(a => a.category).filter(Boolean))],
            },
        }));
    });

    // GET /v1/admin/backup — export all data as JSON (operator only)
    router.get('/v1/admin/backup', requireAuth(), requireRole('operator'), async (_req, res) => {
        const owners = await storage.listOwners();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();
        const boards = await storage.listBoards();

        // Collect all memories and transactions per agent
        const agentData: Record<string, { memories: unknown[]; transactions: unknown[] }> = {};
        for (const a of agents) {
            const memories = await storage.listMemory(a.gaii);
            const transactions = await storage.getTransactions(a.gaii, 100_000);
            agentData[a.gaii] = { memories, transactions };
        }

        res.json(success(config.nodeId, {
            version: '1.2',
            exported_at: new Date().toISOString(),
            node_id: config.nodeId,
            owners,
            agents,
            actions,
            boards,
            agent_data: agentData,
        }));
    });

    // POST /v1/admin/restore — import data from backup (operator only)
    router.post('/v1/admin/restore', requireAuth(), requireRole('operator'), async (req, res) => {
        const { owners, agents, actions, boards, agent_data } = req.body ?? {};
        const imported = { owners: 0, agents: 0, actions: 0, boards: 0, memories: 0 };

        if (owners) {
            for (const o of owners) {
                try { await storage.createOwner(o); imported.owners++; } catch { /* skip duplicates */ }
            }
        }
        if (agents) {
            for (const a of agents) {
                try { await storage.createAgent(a); imported.agents++; } catch { /* skip duplicates */ }
            }
        }
        if (actions) {
            for (const a of actions) {
                try { await storage.createAction(a); imported.actions++; } catch { /* skip duplicates */ }
            }
        }
        if (boards) {
            for (const b of boards) {
                try { await storage.createBoard(b); imported.boards++; } catch { /* skip duplicates */ }
            }
        }
        if (agent_data) {
            for (const [gaii, data] of Object.entries(agent_data as Record<string, any>)) {
                if (data.memories) {
                    for (const m of data.memories) {
                        await storage.setMemory(m);
                        imported.memories++;
                    }
                }
                if (data.transactions) {
                    for (const tx of data.transactions) {
                        await storage.addTransaction(tx);
                    }
                }
            }
        }

        res.json(success(config.nodeId, {
            restored: true,
            imported,
        }));
    });

    // POST /v1/admin/roles/grant — grant operator role (operator only)
    router.post('/v1/admin/roles/grant', requireAuth(), requireRole('operator'), validateBody(RoleGrantSchema, config.nodeId), async (req, res) => {
        const { owner, role } = req.body ?? {};

        const ownerRecord = await storage.getOwner(owner);
        if (!ownerRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${owner}`));
            return;
        }

        if (ownerRecord.roles.includes('operator')) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Owner "${owner}" already has operator role`));
            return;
        }

        await storage.updateOwner(owner, { roles: [...ownerRecord.roles, 'operator'] });

        res.json(success(config.nodeId, {
            owner,
            role: 'operator',
            granted: true,
        }));
    });

    // GET /v1/admin/hooks — list all extension hooks
    router.get('/v1/admin/hooks', requireAuth(), requireRole('operator'), (_req, res) => {
        res.json(success(config.nodeId, {
            extension_hooks: listHooks(config),
        }));
    });

    // PUT /v1/admin/hooks/:hookName — set actions for a hook
    router.put('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), (req, res) => {
        const hookName = req.params.hookName as string;
        const validHooks: HookName[] = [
            'pre_owner_registration', 'post_owner_registration',
            'pre_agent_registration', 'post_agent_registration',
            'owner_recovery', 'agent_rekey',
            'pre_work_request', 'post_work_delivery', 'post_settlement',
            'pre_board_post', 'pre_federation_peer',
        ];

        if (!validHooks.includes(hookName as HookName)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid hook name. Valid hooks: ${validHooks.join(', ')}`));
            return;
        }

        const { actions } = req.body ?? {};
        if (!Array.isArray(actions) || !actions.every((a: unknown) => typeof a === 'string')) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'actions must be an array of action reference strings'));
            return;
        }

        config.extensionHooks[hookName as HookName] = actions;

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: config.extensionHooks[hookName as HookName],
            updated: true,
        }));
    });

    // DELETE /v1/admin/hooks/:hookName — clear all actions from a hook
    router.delete('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), (req, res) => {
        const hookName = req.params.hookName as string;
        if (!(hookName in config.extensionHooks)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Hook "${hookName}" not found`));
            return;
        }

        config.extensionHooks[hookName as HookName] = [];

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: [],
            cleared: true,
        }));
    });

    // GET /v1/admin/maintenance — get maintenance mode status (operator only)
    router.get('/v1/admin/maintenance', requireAuth(), requireRole('operator'), async (_req, res) => {
        const state = maintenanceCache ? maintenanceCache.get() : await storage.getMaintenanceMode();
        res.json(success(config.nodeId, state));
    });

    // POST /v1/admin/maintenance — toggle maintenance mode (operator only)
    router.post('/v1/admin/maintenance', requireAuth(), requireRole('operator'), async (req, res) => {
        const { enabled, message } = req.body ?? {};
        if (typeof enabled !== 'boolean') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', '"enabled" (boolean) is required'));
            return;
        }
        const state: import('../storage/interface.js').MaintenanceState = {
            enabled,
            message: typeof message === 'string' ? message : '',
            enabledAt: enabled ? new Date().toISOString() : null,
            enabledBy: enabled ? (req.auth?.sub ?? null) : null,
        };
        await storage.setMaintenanceMode(state);
        if (maintenanceCache) maintenanceCache.set(state);
        res.json(success(config.nodeId, state));
    });

    // POST /v1/admin/mint — operator mints morsels for an agent (§16.1)
    router.post('/v1/admin/mint', requireAuth(), requireRole('operator'), async (req, res) => {
        const { gaii, amount } = req.body ?? {};

        if (!gaii || typeof gaii !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'gaii is required'));
            return;
        }
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive integer'));
            return;
        }

        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${gaii}`));
            return;
        }

        // Enforce daily mint cap (§16.1: max_operator_mint_per_day default 10,000)
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const allTx = await storage.listAllTransactions();
        const mintedToday = allTx
            .filter(tx => tx.type === 'mint' && new Date(tx.timestamp) >= dayStart)
            .reduce((sum, tx) => sum + tx.amount, 0);

        if (mintedToday + amount > config.maxOperatorMintPerDay) {
            res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `Daily mint cap is ${config.maxOperatorMintPerDay} morsels. Already minted ${mintedToday} today. Requested ${amount} would exceed cap.`));
            return;
        }

        await storage.updateAgent(gaii, { morselBalance: agent.morselBalance + amount });
        await storage.addTransaction({
            id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
            gaii,
            type: 'mint',
            amount,
            counterpartyGaii: req.auth!.sub,
            timestamp: new Date().toISOString(),
        });

        res.json(success(config.nodeId, {
            gaii,
            minted: amount,
            new_balance: agent.morselBalance + amount,
            daily_minted: mintedToday + amount,
            daily_cap: config.maxOperatorMintPerDay,
        }));
    });

    return router;
}


// ── Admin Login Page HTML ──
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:380px;text-align:center}
h1{font-size:1.4rem;margin-bottom:8px}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:24px}
input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.95rem;margin-bottom:16px}
input:focus{outline:none;border-color:#3b82f6}
button{width:100%;padding:10px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
button:hover{background:#2563eb}
.hint{color:#64748b;font-size:.75rem;margin-top:16px}
</style></head><body>
<div class="box">
<h1>&#x2764;&#xFE0F; AIMEAT Admin</h1>
<p class="sub">Enter the admin password to continue</p>
<form onsubmit="go(event)">
<input type="password" id="pw" placeholder="Admin password" autofocus/>
<button type="submit">Continue</button>
</form>
<p class="hint">Password is printed when the server starts, or set via AIMEAT_ADMIN_PASSWORD</p>
</div>
<script>
function go(e){e.preventDefault();var pw=document.getElementById('pw').value;if(pw)location.href='/v1/admin/setup?pw='+encodeURIComponent(pw);}
</script>
</body></html>`;

// ── Admin Setup Wizard HTML (Login + Register tabs) ──
const ADMIN_SETUP_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--cyan:#06b6d4}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;padding:20px;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding-top:60px}
.container{max-width:480px;width:100%}
h1{font-size:1.5rem;margin-bottom:4px;text-align:center}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:24px;text-align:center}

/* Tabs */
.tabs{display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border)}
.tab{flex:1;padding:12px 16px;text-align:center;font-size:.95rem;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--cyan);border-bottom-color:var(--cyan)}
.tab-panel{display:none}
.tab-panel.active{display:block}

.card{background:var(--card);border:1px solid var(--border);border-radius:0 0 10px 10px;padding:24px;margin-bottom:16px}
.card.standalone{border-radius:10px}
label{display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px;margin-top:14px}
label:first-child{margin-top:0}
input[type=text],input[type=password],textarea{width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.9rem;font-family:inherit}
textarea{resize:vertical;min-height:60px;font-family:'SF Mono',Consolas,monospace;font-size:.8rem}
input:focus,textarea:focus{outline:none;border-color:var(--blue)}
button{padding:12px 24px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:16px;width:100%}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-green{background:var(--green);color:#000;display:inline-block;text-decoration:none;text-align:center;padding:12px 24px;border-radius:8px;font-weight:600;font-size:.95rem;margin-top:16px;width:100%}
.btn-green:hover{opacity:.85}
.result{margin-top:14px;padding:12px;border-radius:8px;font-size:.85rem;word-break:break-all}
.result-ok{background:#16a34a18;border:1px solid #16a34a55;color:var(--green)}
.result-err{background:#dc262618;border:1px solid #dc262655;color:var(--red)}
.key-box{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:6px;word-break:break-all;user-select:all}
.hidden{display:none}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
.warn{color:var(--yellow);font-size:.8rem;margin-top:8px}
.divider{border-top:1px solid var(--border);margin:20px 0;position:relative}
.divider span{position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--card);padding:0 12px;color:var(--muted);font-size:.75rem}
.success-panel{text-align:center;padding:16px 0}
.success-panel h3{color:var(--green);font-size:1.1rem;margin-bottom:8px}
</style></head><body>
<div class="container">
<h1>&#x2764;&#xFE0F; AIMEAT</h1>
<p class="sub">Node: <strong>{{NODE_ID}}</strong></p>

<div class="tabs">
  <button class="tab active" onclick="switchTab('login')">Login</button>
  <button class="tab" onclick="switchTab('register')">Register</button>
</div>

<!-- ═══ LOGIN TAB ═══ -->
<div class="tab-panel active" id="panel-login">
<div class="card">
  <!-- Password Login (default for humans) -->
  <div id="loginPasswordMode">
    <p style="font-size:.9rem;color:var(--muted);margin-bottom:4px">Sign in with your username and password.</p>
    <label>Username</label>
    <input type="text" id="loginUser" placeholder="e.g. myname" autocomplete="username" autofocus/>
    <label>Password</label>
    <input type="password" id="loginPass" placeholder="Your password" autocomplete="current-password"/>
    <button class="btn-primary" id="btnPwLogin" onclick="doPasswordLogin()">Login</button>
    <p style="color:var(--muted);font-size:.75rem;margin-top:12px;text-align:center">
      <a href="#" onclick="toggleLoginMode(event)">Advanced: Login with private key</a>
    </p>
  </div>
  <!-- Key Login (advanced, for developers/agents) -->
  <div id="loginKeyMode" class="hidden">
    <p style="font-size:.9rem;color:var(--muted);margin-bottom:4px">Sign in with your owner name and private key.</p>
    <label>Owner Name</label>
    <input type="text" id="loginOwner" placeholder="e.g. myname" autocomplete="off"/>
    <label>Private Key</label>
    <textarea id="loginKey" placeholder="Paste your private key here" rows="3"></textarea>
    <button class="btn-primary" id="btnLogin" onclick="doLogin()">Login</button>
    <p style="color:var(--muted);font-size:.75rem;margin-top:12px;text-align:center">
      <a href="#" onclick="toggleLoginMode(event)">Back to password login</a>
    </p>
  </div>
  <div id="loginResult" class="hidden"></div>
  <div id="loginSuccess" class="hidden">
    <div class="success-panel">
      <h3>&#x2713; Authenticated</h3>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:4px" id="loginRoles"></p>
      <a id="loginDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
      <div style="margin-top:14px;text-align:left">
        <label>JWT Token (for API use)</label>
        <div class="key-box" id="loginJwtBox"></div>
      </div>
    </div>
  </div>
</div>
</div>

<!-- ═══ REGISTER TAB ═══ -->
<div class="tab-panel" id="panel-register">
<div class="card">
  <p style="font-size:.9rem;color:var(--muted);margin-bottom:4px">Create a new owner account. The first owner gets the <strong>operator</strong> role.</p>
  <label>Owner Name</label>
  <input type="text" id="regOwner" placeholder="e.g. myname" autocomplete="off"/>
  <label>Display Name (optional)</label>
  <input type="text" id="regDisplay" placeholder="e.g. Node Operator"/>
  <label>Password <span style="color:var(--cyan);font-size:.7rem">(recommended)</span></label>
  <input type="password" id="regPassword" placeholder="Set a login password" autocomplete="new-password"/>
  <p style="color:var(--muted);font-size:.72rem;margin-top:2px">With a password you can login from any device without keys.</p>
  <button class="btn-primary" id="btnRegister" onclick="doRegister()">Create Account</button>
  <div id="regResult" class="hidden"></div>
  <div id="regKeys" class="hidden">
    <div class="divider"><span>YOUR KEYS</span></div>
    <div class="warn">&#x26A0; Save your private key NOW \u2014 it cannot be recovered!</div>
    <label>Private Key</label>
    <div class="key-box" id="regPrivateKey"></div>
    <label>Public Key</label>
    <div class="key-box" id="regPublicKey"></div>
    <div class="divider"><span>CONTINUE</span></div>
    <button class="btn-primary" id="btnRegToken" onclick="doRegToken()">Login &amp; Open Dashboard</button>
    <div id="regTokenResult" class="hidden"></div>
    <div id="regSuccess" class="hidden">
      <div class="success-panel">
        <h3>&#x2713; Authenticated</h3>
        <p style="color:var(--muted);font-size:.85rem;margin-bottom:4px" id="regRoles"></p>
        <a id="regDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
        <div style="margin-top:14px;text-align:left">
          <label>JWT Token (for API use)</label>
          <div class="key-box" id="regJwtBox"></div>
        </div>
      </div>
    </div>
  </div>
</div>
</div>

</div>
<script>
const PW='{{PW}}';
let regOwner='',regKey='';

function switchTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('.tab[onclick*="'+name+'"]').classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}

function toggleLoginMode(e){
  e.preventDefault();
  document.getElementById('loginPasswordMode').classList.toggle('hidden');
  document.getElementById('loginKeyMode').classList.toggle('hidden');
}

async function api(method,path,body){
  const h={'Content-Type':'application/json','X-Admin-Password':PW};
  const r=await fetch(path+'?pw='+encodeURIComponent(PW),{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

async function apiNoAdmin(method,path,body){
  const h={'Content-Type':'application/json'};
  const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

function show(id,html,cls){const el=document.getElementById(id);el.className='result '+(cls||'');el.innerHTML=html;el.classList.remove('hidden');}
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

function showLoginSuccess(token,roles,dashUrl){
  document.getElementById('loginResult').classList.add('hidden');
  document.getElementById('loginRoles').textContent='Roles: '+(Array.isArray(roles)?roles.join(', '):roles);
  document.getElementById('loginDashLink').href=dashUrl||'/v1/admin';
  document.getElementById('loginJwtBox').textContent=token;
  document.getElementById('loginSuccess').classList.remove('hidden');
}

/* \u2500\u2500 PASSWORD LOGIN \u2500\u2500 */
async function doPasswordLogin(){
  const user=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  if(!user||!pass){show('loginResult','Username and password are required','result-err');return;}
  document.getElementById('btnPwLogin').disabled=true;
  document.getElementById('btnPwLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await apiNoAdmin('POST','/v1/ghii/login',{username:user,password:pass});
    if(r.error_code||!r.data){
      show('loginResult',esc((r.error&&r.error.message)||r.error||(r.data&&r.data.error)||'Login failed'),'result-err');
      document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';return;
    }
    var d=r.data;
    showLoginSuccess(d.token,['owner','operator'],'/v1/admin');
    document.getElementById('btnPwLogin').textContent='Login';
    document.getElementById('btnPwLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';}
}

/* \u2500\u2500 KEY LOGIN \u2500\u2500 */
async function doLogin(){
  const owner=document.getElementById('loginOwner').value.trim();
  const key=document.getElementById('loginKey').value.trim();
  if(!owner||!key){show('loginResult','Owner name and private key are required','result-err');return;}
  document.getElementById('btnLogin').disabled=true;
  document.getElementById('btnLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:owner,private_key:key});
    if(!r.ok){show('loginResult',esc((r.error&&r.error.message)||r.error||'Login failed'),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';return;}
    showLoginSuccess(r.token,r.roles,r.dashboard_url);
    document.getElementById('btnLogin').textContent='Login';
    document.getElementById('btnLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';}
}

/* \u2500\u2500 REGISTER \u2500\u2500 */
async function doRegister(){
  const name=document.getElementById('regOwner').value.trim();
  const dname=document.getElementById('regDisplay').value.trim();
  const password=document.getElementById('regPassword').value;
  if(!name){show('regResult','Owner name is required','result-err');return;}
  document.getElementById('btnRegister').disabled=true;
  try{
    const body={name:name,display_name:dname||undefined};
    if(password&&password.length>=4)body.password=password;
    const r=await api('POST','/v1/admin/setup/register',body);
    if(!r.ok){show('regResult',esc((r.error&&r.error.message)||r.error||'Registration failed'),'result-err');document.getElementById('btnRegister').disabled=false;return;}
    regOwner=r.owner.name;regKey=r.private_key;
    var roles=r.owner.roles.join(', ');
    var msg='<strong>Account created!</strong> Roles: '+roles;
    if(r.has_password)msg+='<br/><span style="color:var(--cyan)">Password login enabled \u2014 you can login with your username and password.</span>';
    show('regResult',msg,'result-ok');
    document.getElementById('regPrivateKey').textContent=r.private_key;
    document.getElementById('regPublicKey').textContent=r.public_key;
    document.getElementById('regKeys').classList.remove('hidden');
  }catch(e){show('regResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegister').disabled=false;}
}

async function doRegToken(){
  if(!regOwner||!regKey){show('regTokenResult','Register first','result-err');return;}
  document.getElementById('btnRegToken').disabled=true;
  document.getElementById('btnRegToken').textContent='Signing in...';
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:regOwner,private_key:regKey});
    if(!r.ok){show('regTokenResult',esc((r.error&&r.error.message)||r.error||'Token request failed'),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';return;}
    document.getElementById('regTokenResult').classList.add('hidden');
    document.getElementById('regRoles').textContent='Roles: '+r.roles.join(', ');
    document.getElementById('regDashLink').href=r.dashboard_url;
    document.getElementById('regJwtBox').textContent=r.token;
    document.getElementById('regSuccess').classList.remove('hidden');
    document.getElementById('btnRegToken').classList.add('hidden');
  }catch(e){show('regTokenResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';}
}
</script>
</body></html>`;
