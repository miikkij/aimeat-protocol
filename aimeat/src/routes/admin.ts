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
import { validateOwnerName } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { generateOtk } from '../utils/otk.js';

export function adminRouter(
    config: AimeatConfig,
    storage: Storage,
    maintenanceCache?: {
        get: () => import('../storage/interface.js').MaintenanceState;
        set: (state: import('../storage/interface.js').MaintenanceState) => void;
    },
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

        const { name, display_name } = req.body ?? {};
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

        res.json({ ok: true, owner: { name: owner.name, roles: owner.roles }, private_key: keyPair.privateKey, public_key: keyPair.publicKey });
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
            dashboard_url: `/v1/admin/ui?token=${token}`,
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

    // GET /v1/admin/ui — graphical admin dashboard (operator only, serves HTML)
    router.get('/v1/admin/ui', requireAuth(), requireRole('operator'), (_req, res) => {
        res.type('text/html').send(ADMIN_DASHBOARD_HTML);
    });

    // GET /v1/admin/config — full config schema with types, ranges, descriptions (§14.2)
    router.get('/v1/admin/config', requireAuth(), requireRole('operator'), async (_req, res) => {
        const schema: Record<string, { value: unknown; type: string; description: string; range?: string; mutable: boolean; path: string }> = {
            'node.id': { value: config.nodeId, type: 'string', description: 'Unique node identifier', mutable: false, path: 'node.id' },
            'node.port': { value: config.port, type: 'integer', description: 'HTTP listen port', range: '1-65535', mutable: false, path: 'node.port' },
            'node.type': { value: config.nodeType, type: 'string', description: 'Node type: full, relay, or mirror', mutable: false, path: 'node.type' },
            'storage.type': { value: config.dbUrl ? 'mongodb' : 'in-memory', type: 'string', description: 'Storage backend type', mutable: false, path: 'storage.type' },
            'morsel_policy.welcome_bonus': { value: config.welcomeBonus, type: 'integer', description: 'Morsels granted to new agents', range: '0-10000', mutable: true, path: 'morsel_policy.welcome_bonus' },
            'morsel_policy.daily_allowance': { value: config.dailyAllowance, type: 'integer', description: 'Daily morsel allowance per agent', range: '0-10000', mutable: true, path: 'morsel_policy.daily_allowance' },
            'morsel_policy.daily_allowance_cap': { value: config.dailyAllowanceCap, type: 'integer', description: 'Max balance for daily allowance eligibility', range: '0-100000', mutable: true, path: 'morsel_policy.daily_allowance_cap' },
            'morsel_policy.burn_rate': { value: config.burnRate, type: 'float', description: 'Fraction of network fees burned', range: '0.0-1.0', mutable: true, path: 'morsel_policy.burn_rate' },
            'morsel_policy.max_operator_mint_per_day': { value: config.maxOperatorMintPerDay, type: 'integer', description: 'Max morsels operator can mint per day', range: '0-1000000', mutable: true, path: 'morsel_policy.max_operator_mint_per_day' },
            'morsel_policy.board_post_base_cost': { value: config.boardPostBaseCost, type: 'integer', description: 'Base morsel cost for public board posts', range: '0-1000', mutable: true, path: 'morsel_policy.board_post_base_cost' },
            'morsel_policy.board_post_cost_per_kb': { value: config.boardPostCostPerKb, type: 'integer', description: 'Additional morsel cost per KB of post body', range: '0-100', mutable: true, path: 'morsel_policy.board_post_cost_per_kb' },
            'auth.jwt_ttl_seconds': { value: config.jwtTtlSeconds, type: 'integer', description: 'JWT token time-to-live in seconds', range: '60-86400', mutable: true, path: 'auth.jwt_ttl_seconds' },
            'features.keyed_browse_enabled': { value: config.keyedBrowseEnabled, type: 'boolean', description: 'Allow browsing with API keys', mutable: true, path: 'features.keyed_browse_enabled' },
            'features.extended_features_enabled': { value: config.extendedFeaturesEnabled, type: 'boolean', description: 'Enable extended feature set', mutable: true, path: 'features.extended_features_enabled' },
            'work.queue_max_pending': { value: config.workQueueMaxPending, type: 'integer', description: 'Max pending work items per provider', range: '1-1000', mutable: true, path: 'work.queue_max_pending' },
            'work.webhook_max_retries': { value: config.webhookMaxRetries, type: 'integer', description: 'Max webhook delivery retry attempts', range: '0-10', mutable: true, path: 'work.webhook_max_retries' },
            'quota.memory_mb': { value: config.memoryQuotaMb, type: 'integer', description: 'Memory quota per agent in MB', range: '1-10000', mutable: true, path: 'quota.memory_mb' },
            'quota.storage_mb': { value: config.storageQuotaMb, type: 'integer', description: 'Storage quota per agent in MB', range: '1-100000', mutable: true, path: 'quota.storage_mb' },
            'quota.micro_memory_kb': { value: config.microMemoryQuotaKb, type: 'integer', description: 'Micro-memory quota per agent in KB', range: '1-10000', mutable: true, path: 'quota.micro_memory_kb' },
            'federation.max_relay_hops': { value: config.maxRelayHops, type: 'integer', description: 'Max relay hops for federated requests', range: '1-10', mutable: true, path: 'federation.max_relay_hops' },
            'rate_limits': { value: config.rateLimits, type: 'object', description: 'Rate limiting configuration per endpoint category', mutable: true, path: 'rate_limits' },
        };

        res.json(success(config.nodeId, { schema }));
    });

    // PUT /v1/admin/config — atomic config update with dot-path addressing (§14.2, Appendix B)
    // Body format: {"changes": [{"path": "morsel_policy.daily_allowance", "value": 75}, ...]}
    router.put('/v1/admin/config', requireAuth(), requireRole('operator'), async (req, res) => {
        const { changes } = req.body ?? {};

        if (!Array.isArray(changes) || changes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Body must contain "changes" array with [{path, value}] entries'));
            return;
        }

        // Map dot-paths to config keys with validation
        const pathMap: Record<string, { key: keyof AimeatConfig; validate: (v: unknown) => boolean }> = {
            'morsel_policy.welcome_bonus': { key: 'welcomeBonus', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.daily_allowance': { key: 'dailyAllowance', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.daily_allowance_cap': { key: 'dailyAllowanceCap', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.burn_rate': { key: 'burnRate', validate: v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1 },
            'morsel_policy.max_operator_mint_per_day': { key: 'maxOperatorMintPerDay', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.board_post_base_cost': { key: 'boardPostBaseCost', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'morsel_policy.board_post_cost_per_kb': { key: 'boardPostCostPerKb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'auth.jwt_ttl_seconds': { key: 'jwtTtlSeconds', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 60 },
            'features.keyed_browse_enabled': { key: 'keyedBrowseEnabled', validate: v => typeof v === 'boolean' },
            'features.extended_features_enabled': { key: 'extendedFeaturesEnabled', validate: v => typeof v === 'boolean' },
            'work.queue_max_pending': { key: 'workQueueMaxPending', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'work.webhook_max_retries': { key: 'webhookMaxRetries', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 },
            'quota.memory_mb': { key: 'memoryQuotaMb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'quota.storage_mb': { key: 'storageQuotaMb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'quota.micro_memory_kb': { key: 'microMemoryQuotaKb', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'federation.max_relay_hops': { key: 'maxRelayHops', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 },
            'rate_limits': { key: 'rateLimits', validate: v => typeof v === 'object' && v !== null },
        };

        const applied: { path: string; old_value: unknown; new_value: unknown }[] = [];
        const errors: { path: string; reason: string }[] = [];

        for (const change of changes) {
            const { path, value } = change ?? {};
            if (typeof path !== 'string' || value === undefined) {
                errors.push({ path: path ?? '(missing)', reason: 'Each change must have "path" (string) and "value"' });
                continue;
            }
            const mapping = pathMap[path];
            if (!mapping) {
                errors.push({ path, reason: `Unknown config path. Valid paths: ${Object.keys(pathMap).join(', ')}` });
                continue;
            }
            if (!mapping.validate(value)) {
                errors.push({ path, reason: `Invalid value for ${path}` });
                continue;
            }
            const oldValue = config[mapping.key];
            (config as any)[mapping.key] = value;
            applied.push({ path, old_value: oldValue, new_value: value });
        }

        if (applied.length === 0 && errors.length > 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid changes applied', undefined, { errors }));
            return;
        }

        res.json(success(config.nodeId, {
            applied,
            errors: errors.length > 0 ? errors : undefined,
            note: 'Runtime config updated. Changes lost on restart unless persisted to environment or config file.',
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
                created_at: a.createdAt,
                last_seen: a.lastSeen,
            })),
            total: agents.length,
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

// ── Admin Dashboard HTML ──
const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--purple:#a855f7;
--cyan:#06b6d4;--font:system-ui,-apple-system,sans-serif}
body{background:var(--bg);color:var(--text);font-family:var(--font);padding:0;min-height:100vh}
h1{font-size:1.4rem;font-weight:700;margin-bottom:0}
.layout{display:flex;min-height:100vh}
/* Sidebar */
.sidebar{width:220px;background:#0c1222;border-right:1px solid var(--border);padding:16px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto}
.sidebar h1{padding:0 16px;margin-bottom:16px;font-size:1.1rem}
.sidebar .node-id{padding:0 16px;color:var(--muted);font-size:.7rem;margin-bottom:16px;word-break:break-all}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;color:var(--muted);font-size:.85rem;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:inherit;transition:all .1s}
.nav-item:hover{background:#1e293b;color:var(--text)}
.nav-item.active{background:#1e293b;color:var(--cyan);border-left:3px solid var(--cyan);padding-left:13px}
.nav-item .icon{font-size:1rem;width:20px;text-align:center}
.nav-item .label{flex:1}
.nav-item .count{background:var(--border);color:var(--muted);font-size:.7rem;padding:2px 7px;border-radius:10px}
.nav-sep{height:1px;background:var(--border);margin:8px 16px}
/* Main */
.main{flex:1;padding:20px 28px;overflow-y:auto}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.topbar-right{display:flex;align-items:center;gap:12px}
.refresh{background:var(--blue);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600}
.refresh:hover{opacity:.85}
.refresh:disabled{opacity:.5;cursor:not-allowed}
#lastUpdate{color:var(--muted);font-size:.7rem}
/* Cards */
.grid{display:grid;gap:16px;margin-bottom:20px}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px}
.stat{font-size:1.8rem;font-weight:700;line-height:1.1}
.stat-label{color:var(--muted);font-size:.75rem;margin-top:2px}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.7rem;font-weight:600;text-transform:uppercase}
.badge-healthy{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-watch{background:#ca8a0422;color:var(--yellow);border:1px solid #ca8a0455}
.badge-danger{background:#dc262622;color:var(--red);border:1px solid #dc262655}
.badge-info{background:#3b82f622;color:var(--blue);border:1px solid #3b82f655}
.badge-private{background:#a855f722;color:var(--purple);border:1px solid #a855f755}
.badge-public{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-pending{background:#ca8a0422;color:var(--yellow);border:1px solid #ca8a0455}
.badge-accepted,.badge-in_progress{background:#3b82f622;color:var(--blue);border:1px solid #3b82f655}
.badge-delivered,.badge-settled{background:#16a34a22;color:var(--green);border:1px solid #16a34a55}
.badge-cancelled,.badge-expired,.badge-disputed{background:#dc262622;color:var(--red);border:1px solid #dc262655}
.health-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.health-row:last-child{border-bottom:none}
.health-metric{font-size:.85rem}
.health-value{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--cyan)}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--border);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--border)}
tr:hover td{background:#ffffff06}
.econ-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.econ-row:last-child{border-bottom:none}
.econ-label{color:var(--muted);font-size:.85rem}
.econ-val{font-family:'SF Mono',Consolas,monospace;font-size:.85rem;color:var(--text)}
.mono{font-family:'SF Mono',Consolas,monospace;font-size:.78rem}
.loading{text-align:center;padding:40px;color:var(--muted)}
.error-box{background:#dc262622;border:1px solid var(--red);border-radius:8px;padding:16px;color:var(--red);margin:20px 0}
.empty{color:var(--muted);text-align:center;padding:24px;font-size:.85rem}
.detail-row{padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem}
.detail-row:last-child{border-bottom:none}
.detail-label{color:var(--muted);min-width:140px;display:inline-block}
.expand-btn{background:none;border:1px solid var(--border);color:var(--cyan);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:.75rem;font-family:inherit}
.expand-btn:hover{background:var(--border)}
.sub-panel{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;margin-top:8px;font-size:.8rem}
.page-title{font-size:1.1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.page-title .icon{font-size:1.2rem}
.tag{display:inline-block;background:var(--border);color:var(--muted);padding:1px 6px;border-radius:4px;font-size:.7rem;margin:1px}
.scrollable{max-height:600px;overflow-y:auto}
@media(max-width:768px){.sidebar{display:none}.main{padding:12px}}
</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">
  <h1>&#x1F969; AIMEAT</h1>
  <div class="node-id" id="sideNodeId"></div>
  <button class="nav-item active" onclick="nav('overview')"><span class="icon">&#x1F4CA;</span><span class="label">Overview</span></button>
  <button class="nav-item" onclick="nav('owners')"><span class="icon">&#x1F464;</span><span class="label">Owners</span><span class="count" id="cntOwners">0</span></button>
  <button class="nav-item" onclick="nav('agents')"><span class="icon">&#x1F916;</span><span class="label">Agents</span><span class="count" id="cntAgents">0</span></button>
  <button class="nav-item" onclick="nav('actions')"><span class="icon">&#x26A1;</span><span class="label">Actions</span><span class="count" id="cntActions">0</span></button>
  <button class="nav-item" onclick="nav('boards')"><span class="icon">&#x1F4CB;</span><span class="label">Boards</span><span class="count" id="cntBoards">0</span></button>
  <button class="nav-item" onclick="nav('work')"><span class="icon">&#x1F4E6;</span><span class="label">Work</span><span class="count" id="cntWork">0</span></button>
  <div class="nav-sep"></div>
  <button class="nav-item" onclick="nav('economy')"><span class="icon">&#x1FA99;</span><span class="label">Economy</span></button>
  <button class="nav-item" onclick="nav('maintenance')"><span class="icon">&#x1F6A7;</span><span class="label">Maintenance</span></button>
  <button class="nav-item" onclick="nav('config')"><span class="icon">&#x2699;</span><span class="label">Config</span></button>
</nav>
<div class="main">
  <div class="topbar">
    <div id="pageTitle" class="page-title"><span class="icon">&#x1F4CA;</span> Overview</div>
    <div class="topbar-right">
      <button class="refresh" id="btnRefresh" onclick="loadAll()">Refresh</button>
      <span id="lastUpdate"></span>
    </div>
  </div>
  <div id="app"><div class="loading">Loading&#8230;</div></div>
</div>
</div>
<script>
const TOKEN=new URLSearchParams(location.search).get('token')||localStorage.getItem('aimeat_token')||'';
if(TOKEN)localStorage.setItem('aimeat_token',TOKEN);

let D={};// cached data
let currentPage='overview';

async function api(path){
  const h={};
  if(TOKEN)h['Authorization']='Bearer '+TOKEN;
  const r=await fetch(path,{headers:h});
  if(!r.ok)throw new Error(r.status+' '+r.statusText);
  return r.json();
}

function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML}
function badge(z){return '<span class="badge badge-'+z+'">'+z+'</span>'}
function num(n){return typeof n==='number'?n.toLocaleString():String(n??'—')}
function dt(s){return s?new Date(s).toLocaleString():'—'}
function sc(l,v,sub,col){return '<div class="card"><h2>'+l+'</h2><div class="stat" style="color:'+col+'">'+num(v)+'</div>'+(sub?'<div class="stat-label">'+sub+'</div>':'')+'</div>'}
function er(l,v){return '<div class="econ-row"><span class="econ-label">'+l+'</span><span class="econ-val">'+v+'</span></div>'}
function hRow(l,obj){return '<div class="health-row"><span class="health-metric">'+l+'</span><span>'+badge(obj.zone)+' <span class="health-value">'+obj.value+'</span></span></div>'}
function fmtUp(s){var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return (d?d+'d ':'')+(h?h+'h ':'')+(m?m+'m':'<1m')}

function nav(page){
  currentPage=page;
  document.querySelectorAll('.nav-item').forEach(function(b){b.classList.remove('active')});
  var btns=document.querySelectorAll('.nav-item');
  var pages=['overview','owners','agents','actions','boards','work','','economy','maintenance','config'];
  for(var i=0;i<btns.length;i++){if(pages[i]===page)btns[i].classList.add('active')}
  var titles={overview:'&#x1F4CA; Overview',owners:'&#x1F464; Owners',agents:'&#x1F916; Agents',actions:'&#x26A1; Actions',boards:'&#x1F4CB; Boards',work:'&#x1F4E6; Work Contracts',economy:'&#x1FA99; Economy',maintenance:'&#x1F6A7; Maintenance',config:'&#x2699; Configuration'};
  document.getElementById('pageTitle').innerHTML=titles[page]||page;
  render();
}

async function loadAll(){
  var btn=document.getElementById('btnRefresh');
  btn.disabled=true;btn.textContent='Loading...';
  try{
    var [dash,agents,actions,boards]=await Promise.all([
      api('/v1/admin/dashboard'),
      api('/v1/admin/agents'),
      api('/v1/actions'),
      api('/v1/boards')
    ]);
    D.dash=dash.data;D.agents=agents.data;D.actions=actions.data;D.boards=boards.data;
    // Update sidebar counts
    if(D.dash&&D.dash.counts){
      document.getElementById('cntOwners').textContent=D.dash.counts.owners;
      document.getElementById('cntAgents').textContent=D.dash.counts.agents;
      document.getElementById('cntActions').textContent=D.dash.counts.actions;
      document.getElementById('cntBoards').textContent=D.dash.counts.boards;
    }
    // Load maintenance state
    try{var mt=await api('/v1/admin/maintenance');D.maintenance=mt.data;}catch(e){D.maintenance=null;}
    // Try work listing (may fail if no agent auth)
    try{var w=await api('/v1/admin/backup');D.workItems=extractWork(w.data);}catch(e){D.workItems=[];}
    // Load owners
    try{
      var ownerNames=D.agents&&D.agents.agents?[...new Set(D.agents.agents.map(function(a){return a.owner}))]:[];
      D.owners=[];
      for(var i=0;i<ownerNames.length;i++){
        try{var o=await api('/v1/owners/'+encodeURIComponent(ownerNames[i]));D.owners.push(o.data);}catch(e){}
      }
    }catch(e){D.owners=[];}
    if(D.workItems)document.getElementById('cntWork').textContent=D.workItems.length;
    document.getElementById('sideNodeId').textContent=D.dash?D.dash.node_id:'';
    document.getElementById('lastUpdate').textContent=new Date().toLocaleTimeString();
    render();
  }catch(e){
    document.getElementById('app').innerHTML='<div class="error-box"><strong>Failed to load</strong><br/>'+esc(e.message)+'</div>';
  }
  btn.disabled=false;btn.textContent='Refresh';
}

function extractWork(backup){
  if(!backup||!backup.agent_data)return[];
  var items=[];
  // Work items are in the backup as transactions or via agent_data
  return items;
}

function render(){
  var app=document.getElementById('app');
  if(!D.dash){app.innerHTML='<div class="loading">Loading&#8230;</div>';return;}
  switch(currentPage){
    case 'overview':app.innerHTML=renderOverview();break;
    case 'owners':app.innerHTML=renderOwners();break;
    case 'agents':app.innerHTML=renderAgents();break;
    case 'actions':app.innerHTML=renderActions();break;
    case 'boards':app.innerHTML=renderBoards();break;
    case 'work':app.innerHTML=renderWork();break;
    case 'economy':app.innerHTML=renderEconomy();break;
    case 'maintenance':app.innerHTML=renderMaintenance();break;
    case 'config':app.innerHTML=renderConfig();break;
    default:app.innerHTML='<div class="empty">Unknown page</div>';
  }
}

/* ── OVERVIEW ── */
function renderOverview(){
  var d=D.dash,h=d.health,c=d.counts,e=d.economy,w=d.warnings||[];
  var hColor=h.status==='healthy'?'green':h.status==='watch'?'yellow':'red';
  var o='';
  o+='<div class="card" style="border-left:4px solid var(--'+hColor+');margin-bottom:20px">';
  o+='<div style="display:flex;justify-content:space-between;align-items:center">';
  o+='<div><h2>Node Health</h2><div class="stat" style="color:var(--'+hColor+')">'+h.status.toUpperCase()+'</div>';
  o+='<div class="stat-label">Uptime: '+fmtUp(d.uptime_seconds)+' &middot; Storage: '+esc(d.storage_type)+'</div></div>';
  o+='<div>'+badge(h.status)+'</div></div>';
  o+='<div style="margin-top:14px">';
  o+=hRow('Burn/Mint Ratio',h.burn_mint_ratio);
  o+=hRow('Agent Churn (30d)',h.agent_churn_rate_30d);
  o+=hRow('Work Expiry (30d)',h.work_expiry_rate_30d);
  o+=hRow('Dispute Rate (30d)',h.dispute_rate_30d);
  o+='</div></div>';
  o+='<div class="grid grid-4">';
  o+=sc('Owners',c.owners,'','var(--blue)');
  o+=sc('Agents',c.agents,'('+c.active_agents_24h+' active 24h)','var(--purple)');
  o+=sc('Actions',c.actions,'','var(--cyan)');
  o+=sc('Boards',c.boards,'','var(--green)');
  o+='</div>';
  o+='<div class="grid grid-2">';
  o+='<div class="card"><h2>Economy Today</h2>';
  o+=er('Transactions',num(e.transactions_today));
  o+=er('Morsels Moved',num(e.morsels_transacted_today));
  o+=er('In Circulation',num(e.total_morsels_in_circulation));
  o+=er('Burned Today',num(e.burned_today));
  o+='</div>';
  o+='<div class="card"><h2>Quick Config</h2>';
  o+=er('Port',d.config.port);
  o+=er('JWT TTL',d.config.jwt_ttl_seconds+'s');
  o+=er('Keyed Browse',d.config.keyed_browse_enabled?'Enabled':'Disabled');
  o+=er('Welcome Bonus',num(e.welcome_bonus));
  o+='</div></div>';
  if(w.length>0){
    o+='<div class="card" style="border-left:3px solid var(--yellow);margin-bottom:20px"><h2>Warnings ('+w.length+')</h2>';
    o+='<table><thead><tr><th>Metric</th><th>Value</th><th>Zone</th><th>Threshold</th></tr></thead><tbody>';
    for(var i=0;i<w.length;i++){var x=w[i];o+='<tr><td>'+esc(x.metric)+'</td><td>'+x.value+'</td><td>'+badge(x.zone)+'</td><td style="color:var(--muted)">'+esc(x.threshold)+'</td></tr>';}
    o+='</tbody></table></div>';
  }
  return o;
}

/* ── OWNERS ── */
function renderOwners(){
  var owners=D.owners||[];
  if(owners.length===0)return '<div class="empty">No owners found</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>Name</th><th>Display Name</th><th>Agents</th><th>Created</th></tr></thead><tbody>';
  for(var i=0;i<owners.length;i++){
    var ow=owners[i];
    var agCount=ow.agents?ow.agents.length:0;
    var agNames=ow.agents?ow.agents.map(function(a){return esc(a.gaii)}).join(', '):'—';
    o+='<tr><td><strong>'+esc(ow.name)+'</strong></td><td>'+esc(ow.display_name||'—')+'</td>';
    o+='<td><span title="'+esc(agNames)+'">'+agCount+'</span></td>';
    o+='<td style="color:var(--muted)">'+dt(ow.created_at)+'</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── AGENTS ── */
function renderAgents(){
  var ag=D.agents;
  if(!ag||!ag.agents||ag.agents.length===0)return '<div class="empty">No agents registered</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>GAII</th><th>Owner</th><th>Display Name</th><th>Trust</th><th>Morsels</th><th>Last Seen</th><th></th></tr></thead><tbody>';
  for(var i=0;i<ag.agents.length;i++){
    var a=ag.agents[i];
    var trust=typeof a.trust_score==='number'?a.trust_score.toFixed(1):'—';
    var tColor=a.trust_score>=70?'var(--green)':a.trust_score>=30?'var(--yellow)':'var(--red)';
    o+='<tr><td class="mono">'+esc(a.gaii)+'</td><td>'+esc(a.owner)+'</td><td>'+esc(a.display_name||'—')+'</td>';
    o+='<td style="color:'+tColor+'">'+trust+'</td><td>'+num(a.morsel_balance)+'</td>';
    o+='<td style="color:var(--muted)">'+dt(a.last_seen)+'</td>';
    o+='<td><button class="expand-btn" onclick="loadAgentDetail(\\''+esc(a.gaii)+'\\',this)">Details</button></td></tr>';
    o+='<tr class="agent-detail" id="ad-'+i+'" style="display:none"><td colspan="7"></td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── ACTIONS ── */
function renderActions(){
  var ac=D.actions;
  if(!ac||!ac.actions||ac.actions.length===0)return '<div class="empty">No actions published</div>';
  var o='<div class="card"><div class="scrollable"><table><thead><tr><th>ID</th><th>Name</th><th>Provider</th><th>Category</th><th>Base Cost</th><th>Tags</th></tr></thead><tbody>';
  for(var i=0;i<ac.actions.length;i++){
    var a=ac.actions[i];
    var tags=(a.tags||[]).map(function(t){return '<span class="tag">'+esc(t)+'</span>'}).join(' ');
    var price=a.pricing?num(a.pricing.base_morsels)+' morsels':'—';
    o+='<tr><td class="mono">'+esc(a.id)+'</td><td><strong>'+esc(a.display_name||a.id)+'</strong><br/><span style="color:var(--muted);font-size:.75rem">'+esc(a.description||'')+'</span></td>';
    o+='<td class="mono" style="font-size:.75rem">'+esc(a.provider_gaii)+'</td>';
    o+='<td>'+badge(a.category||'general')+'</td><td>'+price+'</td>';
    o+='<td>'+tags+'</td></tr>';
  }
  o+='</tbody></table></div></div>';
  return o;
}

/* ── BOARDS ── */
function renderBoards(){
  var bo=D.boards;
  if(!bo||!bo.boards||bo.boards.length===0)return '<div class="empty">No boards created</div>';
  var o='';
  for(var i=0;i<bo.boards.length;i++){
    var b=bo.boards[i];
    o+='<div class="card" style="margin-bottom:16px">';
    o+='<div style="display:flex;justify-content:space-between;align-items:flex-start">';
    o+='<div><h2>'+esc(b.name||b.id)+'</h2><p style="color:var(--muted);font-size:.8rem;margin-bottom:8px">'+esc(b.description||'No description')+'</p></div>';
    o+='<div>'+badge(b.visibility||'public')+'</div></div>';
    o+='<div style="font-size:.8rem;color:var(--muted);margin-bottom:8px">ID: <span class="mono">'+esc(b.id)+'</span> &middot; Created: '+dt(b.created_at)+'</div>';
    o+='<button class="expand-btn" onclick="loadBoardPosts(\\''+esc(b.id)+'\\',this)">Load Posts</button>';
    o+='<div id="bp-'+esc(b.id)+'" style="margin-top:8px"></div>';
    o+='</div>';
  }
  return o;
}

/* ── WORK ── */
function renderWork(){
  return '<div class="card"><p style="color:var(--muted);font-size:.85rem;margin-bottom:12px">Work contracts are agent-scoped. Use the agent details view to see individual work items, or browse via the API.</p>'
    +'<div style="font-size:.85rem">'
    +er('API: List by provider','GET /v1/work/inbox')
    +er('API: Work status','GET /v1/work/:tracking_code')
    +er('API: Request work','POST /v1/work')
    +'</div></div>';
}

/* ── ECONOMY ── */
function renderEconomy(){
  var e=D.dash.economy;
  var o='<div class="grid grid-2">';
  o+='<div class="card"><h2>Morsel Supply</h2>';
  o+=er('In Circulation',num(e.total_morsels_in_circulation));
  o+=er('Total Minted (all time)',num(e.total_minted_all_time));
  o+=er('Total Burned (all time)',num(e.total_burned_all_time));
  o+=er('Inflation Rate (30d)',e.inflation_rate_30d_percent+'%');
  o+=er('Burn/Mint Ratio',e.burn_mint_ratio);
  o+='</div>';
  o+='<div class="card"><h2>Today\\'s Activity</h2>';
  o+=er('Transactions',num(e.transactions_today));
  o+=er('Morsels Moved',num(e.morsels_transacted_today));
  o+=er('Network Fees',num(e.network_fees_today));
  o+=er('Burned',num(e.burned_today));
  o+=er('Daily Allowances Issued',num(e.daily_allowances_issued_today));
  o+='</div></div>';
  o+='<div class="card"><h2>Morsel Policy</h2>';
  o+=er('Welcome Bonus',num(e.welcome_bonus)+' morsels');
  o+=er('Daily Allowance',num(e.daily_allowance)+' morsels');
  o+=er('Allowance Cap',num(e.daily_allowance_cap)+' morsels');
  o+=er('Burn Rate',e.burn_rate);
  o+=er('Max Operator Mint/Day',num(e.max_operator_mint_per_day)+' morsels');
  o+='</div>';
  return o;
}

/* ── MAINTENANCE ── */
function renderMaintenance(){
  var m=D.maintenance||{enabled:false,message:'',enabledAt:null,enabledBy:null};
  var color=m.enabled?'red':'green';
  var status=m.enabled?'MAINTENANCE ON':'OPERATIONAL';
  var o='<div class="card" style="border-left:4px solid var(--'+color+')">';
  o+='<h2>Maintenance Mode</h2>';
  o+='<div class="stat" style="color:var(--'+color+');margin-bottom:12px">'+status+'</div>';
  if(m.enabled){
    o+='<div style="margin-bottom:12px">';
    if(m.message)o+=er('Message',esc(m.message));
    if(m.enabledAt)o+=er('Since',dt(m.enabledAt));
    if(m.enabledBy)o+=er('By',esc(m.enabledBy));
    o+='</div>';
  }
  o+='<div style="margin-top:16px">';
  o+='<label style="display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px">Custom Message (optional)</label>';
  o+='<input type="text" id="maintMsg" value="'+esc(m.message||'')+'" placeholder="e.g. Upgrading to v1.3" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;margin-bottom:12px"/>';
  if(m.enabled){
    o+='<button class="refresh" style="background:var(--green);width:100%" onclick="toggleMaintenance(false)">Disable Maintenance Mode</button>';
  }else{
    o+='<button class="refresh" style="background:var(--red);width:100%" onclick="toggleMaintenance(true)">Enable Maintenance Mode</button>';
  }
  o+='</div>';
  o+='<p style="color:var(--muted);font-size:.75rem;margin-top:12px">When maintenance mode is on, all non-essential endpoints return 503. Operators, health checks, and admin routes remain accessible.</p>';
  o+='</div>';
  return o;
}

async function toggleMaintenance(on){
  try{
    var msg=document.getElementById('maintMsg')?document.getElementById('maintMsg').value:'';
    var h={'Content-Type':'application/json'};
    if(TOKEN)h['Authorization']='Bearer '+TOKEN;
    var r=await fetch('/v1/admin/maintenance',{method:'POST',headers:h,body:JSON.stringify({enabled:on,message:msg})});
    var data=await r.json();
    if(data.ok!==false)D.maintenance=data.data;
    render();
  }catch(e){alert('Failed: '+e.message)}
}

/* ── CONFIG ── */
function renderConfig(){
  var d=D.dash;
  var o='<div class="card"><h2>Node Settings</h2>';
  o+=er('Node ID',esc(d.node_id));
  o+=er('Storage',esc(d.storage_type));
  o+=er('Port',d.config.port);
  o+=er('JWT TTL',d.config.jwt_ttl_seconds+'s');
  o+=er('Keyed Browse',d.config.keyed_browse_enabled?'Enabled':'Disabled');
  o+=er('Uptime',fmtUp(d.uptime_seconds));
  o+='</div>';
  o+='<div class="card" style="margin-top:16px"><h2>Config API</h2>';
  o+='<p style="color:var(--muted);font-size:.85rem;margin-bottom:8px">Use the API to view and update runtime config:</p>';
  o+='<div style="font-size:.85rem">';
  o+=er('View full config','GET /v1/admin/config');
  o+=er('Update config','PUT /v1/admin/config');
  o+=er('Backup all data','GET /v1/admin/backup');
  o+=er('Restore data','POST /v1/admin/restore');
  o+='</div></div>';
  return o;
}

/* ── Detail loaders ── */
async function loadAgentDetail(gaii,btn){
  btn.textContent='Loading...';btn.disabled=true;
  try{
    var r=await api('/v1/agents/'+encodeURIComponent(gaii));
    var a=r.data;
    var row=btn.closest('tr').nextElementSibling;
    var o='<div class="sub-panel">';
    o+='<strong>'+esc(a.display_name||a.gaii)+'</strong>';
    if(a.description)o+='<p style="color:var(--muted);font-size:.8rem;margin:4px 0">'+esc(a.description)+'</p>';
    if(a.capabilities&&a.capabilities.length){
      o+='<div style="margin:6px 0">Capabilities: '+a.capabilities.map(function(c){return '<span class="tag">'+esc(c)+'</span>'}).join(' ')+'</div>';
    }
    if(a.trust){
      o+='<div style="margin-top:8px"><strong style="font-size:.8rem;color:var(--muted)">TRUST DETAILS</strong></div>';
      o+=er('Score',a.trust.score);
      o+=er('Deliveries',a.trust.total_deliveries+' ('+a.trust.successful_deliveries+' ok)');
      o+=er('Success Rate',(a.trust.success_rate*100).toFixed(1)+'%');
      o+=er('Avg Delivery Time',a.trust.avg_delivery_time_seconds+'s');
      o+=er('Ratings','+'+a.trust.positive_ratings+' / -'+a.trust.negative_ratings);
      o+=er('Age',a.trust.age_days+' days');
    }
    o+='<div style="margin-top:8px;font-size:.75rem;color:var(--muted)">Created: '+dt(a.created_at)+' &middot; Home: '+esc(a.home_node)+'</div>';
    o+='</div>';
    row.querySelector('td').innerHTML=o;
    row.style.display='';
    btn.textContent='Hide';btn.disabled=false;
    btn.onclick=function(){row.style.display=row.style.display?'':'none';btn.textContent=row.style.display?'Details':'Hide'};
  }catch(e){btn.textContent='Error';setTimeout(function(){btn.textContent='Details';btn.disabled=false},2000)}
}

async function loadBoardPosts(boardId,btn){
  btn.textContent='Loading...';btn.disabled=true;
  try{
    var r=await api('/v1/boards/'+encodeURIComponent(boardId)+'/posts?limit=50');
    var posts=r.data.posts||[];
    var el=document.getElementById('bp-'+boardId);
    if(posts.length===0){el.innerHTML='<div class="empty">No posts</div>';btn.textContent='Load Posts';btn.disabled=false;return;}
    var o='<table><thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Created</th></tr></thead><tbody>';
    for(var i=0;i<posts.length;i++){
      var p=posts[i];
      o+='<tr><td><strong>'+esc(p.title||'(untitled)')+'</strong><br/><span style="color:var(--muted);font-size:.75rem">'+esc((p.body||'').substring(0,120))+'</span></td>';
      o+='<td class="mono" style="font-size:.75rem">'+esc(p.author_gaii)+'</td>';
      o+='<td>'+badge(p.category||'general')+'</td>';
      o+='<td style="color:var(--muted)">'+dt(p.created_at)+'</td></tr>';
    }
    o+='</tbody></table>';
    el.innerHTML=o;
    btn.textContent='Refresh Posts';btn.disabled=false;
  }catch(e){btn.textContent='Error';setTimeout(function(){btn.textContent='Load Posts';btn.disabled=false},2000)}
}

loadAll();
</script>
</body>
</html>`;

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
<h1>&#x1F969; AIMEAT Admin</h1>
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
<h1>&#x1F969; AIMEAT</h1>
<p class="sub">Node: <strong>{{NODE_ID}}</strong></p>

<div class="tabs">
  <button class="tab active" onclick="switchTab('login')">Login</button>
  <button class="tab" onclick="switchTab('register')">Register</button>
</div>

<!-- ═══ LOGIN TAB ═══ -->
<div class="tab-panel active" id="panel-login">
<div class="card">
  <p style="font-size:.9rem;color:var(--muted);margin-bottom:4px">Sign in with your owner name and private key.</p>
  <label>Owner Name</label>
  <input type="text" id="loginOwner" placeholder="e.g. myname" autocomplete="off" autofocus/>
  <label>Private Key</label>
  <textarea id="loginKey" placeholder="Paste your private key here" rows="3"></textarea>
  <button class="btn-primary" id="btnLogin" onclick="doLogin()">Login</button>
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

async function api(method,path,body){
  const h={'Content-Type':'application/json','X-Admin-Password':PW};
  const r=await fetch(path+'?pw='+encodeURIComponent(PW),{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

function show(id,html,cls){const el=document.getElementById(id);el.className='result '+(cls||'');el.innerHTML=html;el.classList.remove('hidden');}
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

/* ── LOGIN ── */
async function doLogin(){
  const owner=document.getElementById('loginOwner').value.trim();
  const key=document.getElementById('loginKey').value.trim();
  if(!owner||!key){show('loginResult','Owner name and private key are required','result-err');return;}
  document.getElementById('btnLogin').disabled=true;
  document.getElementById('btnLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:owner,private_key:key});
    if(!r.ok){show('loginResult',esc(r.error),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';return;}
    document.getElementById('loginResult').classList.add('hidden');
    document.getElementById('loginRoles').textContent='Roles: '+r.roles.join(', ');
    document.getElementById('loginDashLink').href=r.dashboard_url;
    document.getElementById('loginJwtBox').textContent=r.token;
    document.getElementById('loginSuccess').classList.remove('hidden');
    document.getElementById('btnLogin').textContent='Login';
    document.getElementById('btnLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';}
}

/* ── REGISTER ── */
async function doRegister(){
  const name=document.getElementById('regOwner').value.trim();
  const dname=document.getElementById('regDisplay').value.trim();
  if(!name){show('regResult','Owner name is required','result-err');return;}
  document.getElementById('btnRegister').disabled=true;
  try{
    const r=await api('POST','/v1/admin/setup/register',{name:name,display_name:dname||undefined});
    if(!r.ok){show('regResult',esc(r.error),'result-err');document.getElementById('btnRegister').disabled=false;return;}
    regOwner=r.owner.name;regKey=r.private_key;
    var roles=r.owner.roles.join(', ');
    show('regResult','<strong>Account created!</strong> Roles: '+roles,'result-ok');
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
    if(!r.ok){show('regTokenResult',esc(r.error),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';return;}
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
